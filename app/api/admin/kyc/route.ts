export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest, NextResponse } from 'next/server';
import { requireAdminApp } from '@/lib/adminAuth';
import { supabaseServer } from '@/lib/supabaseServer';

export async function GET(req: NextRequest) {
  if (!supabaseServer) return NextResponse.json({ error: 'server_configuration_error' }, { status: 500 })
  const supabase = supabaseServer

  const admin = await requireAdminApp(req)
  if (!admin.ok) return NextResponse.json({ error: admin.error || 'unauthorized' }, { status: 401 })
  
  const { searchParams } = new URL(req.url);
  const userId = String(searchParams.get('userId') || '')
  const files = String(searchParams.get('files') || '') === '1'

  if (files && userId) {
    try {
      const bucket = (supabase.storage as any).from('kyc')
      const listRes = await bucket.list(userId, { limit: 20 })
      const entries = Array.isArray(listRes.data) ? listRes.data : []
      
      const nameStartsWith = (p: string) => entries.find((e: any) => String(e.name).startsWith(p))
      const idEntry = nameStartsWith('id')
      const selfieNeutral = nameStartsWith('selfie_neutral')
      const selfieSmile = nameStartsWith('selfie_smile')
      const selfieLeft = nameStartsWith('selfie_left')
      const selfieRight = nameStartsWith('selfie_right')
      
      async function signed(path?: string) {
        if (!path) return undefined
        const s = await bucket.createSignedUrl(`${userId}/${path}`, 3600)
        return s.data?.signedUrl as string | undefined
      }
      
      const idUrl = idEntry ? (await signed(idEntry.name)) : undefined
      const neutralUrl = await signed(selfieNeutral?.name)
      const smileUrl = await signed(selfieSmile?.name)
      const leftUrl = await signed(selfieLeft?.name)
      const rightUrl = await signed(selfieRight?.name)
      
      let details: any = null
      try {
        const { data: download } = await bucket.download(`${userId}/data.json`)
        if (download) {
          const txt = await download.text()
          try { details = JSON.parse(txt) } catch { details = { raw: txt } }
        }
      } catch {}
      
      return NextResponse.json({ ok: true, files: { idUrl, neutralUrl, smileUrl, leftUrl, rightUrl }, details })
    } catch (e: any) {
      return NextResponse.json({ error: e?.message || 'files_failed' }, { status: 500 })
    }
  }

  let items: any[] = []
  const { data: d1, error: e1 } = await supabase.from('Profile').select('*')
  if (!e1 && d1) {
      items = d1.map((p: any) => ({ ...p, user_id: p.userId, kyc_status: p.kycStatus, kyc_level: p.kycLevel, kyc_decision_at: p.kycDecisionAt, kyc_reject_reason: p.kycRejectReason }))
  } else if (e1 && (e1.message.includes('relation') || e1.code === '42P01')) {
      const { data: d2 } = await supabase.from('profiles').select('*')
      items = d2 || []
  } else {
      return NextResponse.json({ error: e1.message || 'list_failed' }, { status: 500 })
  }

  try {
    const adminRes: any = await (supabase as any).auth?.admin?.listUsers?.({ page: 1, perPage: 1000 })
    const users = adminRes?.data?.users || adminRes?.users || []
    const map = new Map<string, string>()
    for (const u of users) {
      const id = String(u?.id || '')
      const email = String(u?.email || '')
      if (id && email) map.set(id, email)
    }
    for (const it of items) {
      const email = map.get(String(it.user_id)) || null
      ;(it as any).email = email
    }
  } catch {}
  return NextResponse.json({ ok: true, items })
}

export async function PATCH(req: NextRequest) {
  if (!supabaseServer) return NextResponse.json({ error: 'server_configuration_error' }, { status: 500 })
  const supabase = supabaseServer

  const admin = await requireAdminApp(req)
  if (!admin.ok) return NextResponse.json({ error: admin.error || 'unauthorized' }, { status: 401 })
  
  const body = await req.json().catch(() => ({}))
  const userId = String(body.userId || '')
  const status = String(body.status || '').toLowerCase()
  const reason = String(body.reason || '')
  const levelRaw = body.level
  const level = typeof levelRaw === 'number' ? levelRaw : undefined
  if (!userId || !['approved','rejected','pending'].includes(status)) return NextResponse.json({ error: 'invalid_payload' }, { status: 400 })

  const now = new Date().toISOString()
  let updated = false
  let errMsg = ''
  
  try {
      const pascalUpdates: any = { kycStatus: status, kycDecisionAt: now }
      if (status === 'rejected') pascalUpdates.kycRejectReason = reason
      if (typeof level === 'number') pascalUpdates.kycLevel = level
      
      const { data: u1, error: e1 } = await supabase.from('Profile').update(pascalUpdates).eq('userId', userId).select().maybeSingle()
      if (!e1 && u1) { updated = true } 
      else if (e1 && (e1.message.includes('relation') || e1.code === '42P01')) {
          const minimal: any = { kyc_status: status }
          const optional: any = { kyc_decision_at: now }
          if (status === 'rejected') optional.kyc_reject_reason = reason
          if (typeof level === 'number') optional.kyc_level = level
          const full: any = { ...minimal, ...optional }
          
          const { data: u2, error: e2 } = await supabase.from('profiles').update(full).eq('user_id', userId).select().maybeSingle()
          if (!e2 && u2) { updated = true }
          else {
              const { data: u3, error: e3 } = await supabase.from('profiles').upsert({ user_id: userId, ...full }, { onConflict: 'user_id' }).select().maybeSingle()
              if (!e3 && u3) { updated = true }
              else { errMsg = e3?.message || e2?.message || 'update_failed_lowercase' }
          }
      } else { errMsg = e1?.message || 'update_failed_pascal' }
  } catch (e: any) { errMsg = e.message }

  if (!updated) return NextResponse.json({ error: errMsg || 'update_failed' }, { status: 500 })

  return NextResponse.json({ ok: true })
}
