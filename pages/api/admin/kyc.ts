import type { NextApiRequest, NextApiResponse } from 'next'
import { createRateLimiter } from '../../../lib/rateLimit'
import { requireAdmin } from '../../../lib/adminAuth'
import { supabaseServer } from '../../../lib/supabaseServer'

const limiter = createRateLimiter({ windowMs: 60_000, max: 20 })

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (!supabaseServer) return res.status(500).json({ error: 'server_configuration_error' })
  const supabase = supabaseServer

  const admin = await requireAdmin(req)
  if (!admin.ok) return res.status(401).json({ error: admin.error || 'unauthorized' })

  if (req.method === 'GET') {
    const userId = String((req.query as any)?.userId || '')
    const files = String((req.query as any)?.files || '') === '1'
    if (files && userId) {
      try {
        const bucket = (supabase.storage as any).from('kyc')
        const listRes = await bucket.list(userId, { limit: 20 })
        const entries = Array.isArray(listRes.data) ? listRes.data : []
        
        // Attempt to find data.json in list, but also try direct download if missing
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
        // Always try to download data.json if we haven't found it (or even if we have, to be safe)
        try {
          const { data: download, error: downErr } = await bucket.download(`${userId}/data.json`)
          if (download) {
            const txt = await download.text()
            try { details = JSON.parse(txt) } catch { details = { raw: txt } }
          } else if (downErr) {
            console.error('KYC data download error:', downErr)
          }
        } catch (e) {
          console.error('KYC download exception:', e)
        }
        
        return res.json({ 
          ok: true, 
          files: { idUrl, neutralUrl, smileUrl, leftUrl, rightUrl }, 
          details,
          debug: { listCount: entries.length, userId } 
        })
      } catch (e: any) {
        return res.status(500).json({ error: e?.message || 'files_failed' })
      }
    }
    // Fetch without email first to avoid schema differences
    // Try PascalCase Profile first
    let items: any[] = []
    const { data: d1, error: e1 } = await supabase.from('Profile').select('*')
    
    if (!e1 && d1) {
        items = d1.map((p: any) => ({
            ...p,
            user_id: p.userId,
            kyc_status: p.kycStatus,
            kyc_level: p.kycLevel,
            kyc_decision_at: p.kycDecisionAt,
            kyc_reject_reason: p.kycRejectReason
        }))
    } else if (e1 && (e1.message.includes('relation') || e1.code === '42P01')) {
        // Fallback to lowercase profiles
        const { data: d2, error: e2 } = await supabase.from('profiles').select('*')
        if (e2) return res.status(500).json({ error: e2.message || 'list_failed' })
        items = d2 || []
    } else {
        return res.status(500).json({ error: e1.message || 'list_failed' })
    }

    // Enrich with email via Admin API
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
    return res.json({ ok: true, items })
  }

  if (req.method !== 'PATCH') return res.status(405).json({ error: 'method_not_allowed' })
  if (!(await limiter(req, res, 'admin-kyc'))) return

  const userId = String((req.body as any)?.userId || '')
  const status = String((req.body as any)?.status || '').toLowerCase()
  const reason = String((req.body as any)?.reason || '')
  const levelRaw = (req.body as any)?.level
  const level = typeof levelRaw === 'number' ? levelRaw : undefined
  if (!userId || !['approved','rejected','pending'].includes(status)) return res.status(400).json({ error: 'invalid_payload' })

  const now = new Date().toISOString()
  
  // Update logic with fallback
  let updated = false
  let errMsg = ''
  
  // Try PascalCase Profile
  try {
      const pascalUpdates: any = { kycStatus: status, kycDecisionAt: now }
      if (status === 'rejected') pascalUpdates.kycRejectReason = reason
      if (typeof level === 'number') pascalUpdates.kycLevel = level
      
      const { data: u1, error: e1 } = await supabase
        .from('Profile')
        .update(pascalUpdates)
        .eq('userId', userId)
        .select()
        .maybeSingle()
      
      if (!e1 && u1) {
          updated = true
      } else if (e1 && (e1.message.includes('relation') || e1.code === '42P01')) {
          // Fallback to lowercase profiles
          const minimal: any = { kyc_status: status }
          const optional: any = { kyc_decision_at: now }
          if (status === 'rejected') optional.kyc_reject_reason = reason
          if (typeof level === 'number') optional.kyc_level = level
          
          const full: any = { ...minimal, ...optional }
          
          // Try update existing
          const { data: u2, error: e2 } = await supabase
            .from('profiles')
            .update(full)
            .eq('user_id', userId)
            .select()
            .maybeSingle()
            
          if (!e2 && u2) {
              updated = true
          } else {
              // Try upsert if update failed (though usually profiles should exist)
              const { data: u3, error: e3 } = await supabase
                .from('profiles')
                .upsert({ user_id: userId, ...full }, { onConflict: 'user_id' })
                .select()
                .maybeSingle()
              
              if (!e3 && u3) {
                  updated = true
              } else {
                  errMsg = e3?.message || e2?.message || 'update_failed_lowercase'
              }
          }
      } else {
          errMsg = e1?.message || 'update_failed_pascal'
      }
  } catch (e: any) {
      errMsg = e.message
  }

  if (!updated) return res.status(500).json({ error: errMsg || 'update_failed' })

  // Create and publish user notification (best-effort; do not fail request if this part errors)
  try {
    const title = status === 'approved' ? 'KYC Approved' : status === 'rejected' ? 'KYC Rejected' : 'KYC Updated'
    const message = status === 'approved'
      ? 'Your identity verification has been approved. Withdrawals and advanced features are now unlocked.'
      : status === 'rejected'
      ? `Your KYC was rejected${reason ? `: ${reason}` : ''}. Please resubmit with correct details.`
      : 'Your KYC status has been updated.'
      
    const crypto = require('crypto')
    const notifData = { id: crypto.randomUUID(), userId: userId, type: 'kyc_status', title, message, read: false, createdAt: new Date().toISOString() }
    
    let notif: any = null
    const { data: n1, error: nErr1 } = await supabase.from('Notification').insert(notifData).select().single()
    
    if (nErr1 && (nErr1.message.includes('relation "public.Notification" does not exist') || nErr1.code === '42P01')) {
         const { data: n2 } = await supabase.from('notifications').insert({
             ...notifData,
             user_id: notifData.userId,
             created_at: notifData.createdAt
         }).select().single()
         if (n2) notif = { ...n2, userId: n2.user_id, createdAt: n2.created_at }
    } else {
        notif = n1
    }

    if (notif) {
      try {
        const { publish } = await import('../../../src/lib/sse')
        await publish(`user:${userId}`, { id: notif.id, type: notif.type, title: notif.title, message: notif.message, createdAt: notif.createdAt })
      } catch {}
    }
  } catch {}

  return res.json({ ok: true })
}

export const config = { api: { bodyParser: true } }
