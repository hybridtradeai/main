export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';
import { requireAdminApp } from '@/lib/adminAuth';
import { supabaseServer } from '@/lib/supabaseServer';

type Body = { userId?: string; email?: string; amount?: number; currency?: string; note?: string; description?: string }

// Helper functions inline
function isUuidLike(id?: string) {
  if (!id) return false
  const s = String(id).trim()
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s)
}

function isEmailLike(s?: string) {
  if (!s) return false
  return /.+@.+\..+/.test(String(s).trim())
}

async function findPublicUser(criteria: { id?: string, email?: string }) {
  if (!supabaseServer) return null
  if (!criteria.id && !criteria.email) return null
  
  let q = supabaseServer.from('User').select('id')
  if (criteria.id) q = q.eq('id', criteria.id)
  else if (criteria.email) q = q.eq('email', criteria.email)
  
  const { data, error } = await q.maybeSingle()
  if (!error && data) return data
  
  if (error && (error.message.includes('relation') || error.code === '42P01')) {
     let q2 = supabaseServer.from('users').select('id')
     if (criteria.id) q2 = q2.eq('id', criteria.id)
     else if (criteria.email) q2 = q2.eq('email', criteria.email)
     const { data: d2 } = await q2.maybeSingle()
     return d2
  }
  return null
}

async function syncUserToPublic(id: string, email: string) {
    if (!supabaseServer) return false
    if (!id || !email) return false
    try {
        const { error } = await supabaseServer.from('User').insert({
            id, email, role: 'USER', kycStatus: 'PENDING', updatedAt: new Date().toISOString()
        })
        if (error && (error.message.includes('relation') || error.code === '42P01')) {
             await supabaseServer.from('users').insert({
                id, email, role: 'USER', kyc_status: 'PENDING', updated_at: new Date().toISOString()
            })
        }
        return true
    } catch (e: any) {
        if (e?.code === '23505' || e?.message?.includes('duplicate key')) return true
        console.error('Sync user failed:', e)
        return false
    }
}

async function resolveSupabaseUserId({ userId, email }: { userId?: string; email?: string }): Promise<string | ''> {
  if (!supabaseServer) return ''
  const id = String(userId || '').trim()
  const mail = String(email || '').trim()

  if (id) {
      const u = await findPublicUser({ id })
      if (u?.id) return u.id
  }

  let emailToUse = isEmailLike(mail) ? mail : (isEmailLike(id) ? id : '')

  if (!emailToUse && isUuidLike(id)) {
      try {
        const { data } = await supabaseServer.from('profiles').select('email').eq('user_id', id).maybeSingle()
        if (data?.email) emailToUse = data.email
      } catch {}
      
      if (!emailToUse) {
        try {
            const { data, error } = await (supabaseServer as any).auth.admin.getUserById(id)
            if (!error && data?.user?.email) emailToUse = data.user.email
        } catch {}
      }
      
      if (emailToUse) {
          await syncUserToPublic(id, emailToUse)
          return id
      }
  }

  if (emailToUse) {
      const u = await findPublicUser({ email: emailToUse })
      if (u?.id) return u.id
      
      let foundId = ''
      try {
        const { data } = await supabaseServer.from('profiles').select('user_id').eq('email', emailToUse).maybeSingle()
        if (data?.user_id) foundId = data.user_id
      } catch {}

      if (!foundId) {
          try {
            const adminRes: any = await (supabaseServer as any).auth?.admin?.listUsers?.({ page: 1, perPage: 200 })
            const users = adminRes?.data?.users || adminRes?.users || []
            const found = users.find((u: any) => String(u?.email || '').toLowerCase() === emailToUse.toLowerCase())
            if (found?.id) foundId = String(found.id)
          } catch {}
      }

      if (foundId) {
          await syncUserToPublic(foundId, emailToUse)
          return foundId
      }
  }
  return ''
}

export async function GET(req: NextRequest) {
  if (!supabaseServer) return NextResponse.json({ error: 'server_configuration_error' }, { status: 500 })
  const supabase = supabaseServer

  const admin = await requireAdminApp(req)
  if (!admin.ok) return NextResponse.json({ error: admin.error || 'forbidden' }, { status: 403 })
  
  const { searchParams } = new URL(req.url);
  const page = Math.max(1, Number(searchParams.get('page') || '1'))
  const limit = Math.min(100, Math.max(1, Number(searchParams.get('limit') || '25')))
  const skip = (page - 1) * limit
  
  let txResult: any = { data: [], error: null, count: 0 }
  
  const txRes1 = await supabase
    .from('Transaction')
    .select('id,userId,amount,currency,createdAt,reference', { count: 'exact' })
    .eq('type', 'admin_credit')
    .order('createdAt', { ascending: false })
    .range(skip, skip + limit - 1)

  if (txRes1.error && (txRes1.error.message.includes('relation "public.Transaction" does not exist') || txRes1.error.code === '42P01')) {
      const txRes2 = await supabase
        .from('transactions')
        .select('id,userId:user_id,amount,currency,createdAt:created_at,reference', { count: 'exact' })
        .eq('type', 'admin_credit')
        .order('created_at', { ascending: false })
        .range(skip, skip + limit - 1)
      txResult = txRes2
  } else {
      txResult = txRes1
  }

  const { data: txs, error: txErr, count } = txResult
  if (txErr) return NextResponse.json({ actions: [], total: 0, page, limit })

  const txIds = (txs || []).map((t: any) => t.id)
  let txNotes: Record<string, any> = {}
  if (txIds.length > 0) {
      let wtxResult: any = { data: [], error: null }
      const wtxRes1 = await supabase.from('WalletTransaction').select('reference, note').in('reference', txIds)

      if (wtxRes1.error && (wtxRes1.error.message.includes('relation "public.WalletTransaction" does not exist') || wtxRes1.error.code === '42P01')) {
           wtxResult = await supabase.from('wallet_transactions').select('reference, note').in('reference', txIds)
      } else { wtxResult = wtxRes1 }
      
      const { data: wtxs } = wtxResult
      if (wtxs) {
          wtxs.forEach((wtx: any) => {
              try {
                  if (wtx.note) {
                      const parsed = typeof wtx.note === 'string' ? JSON.parse(wtx.note) : wtx.note
                      txNotes[wtx.reference] = parsed
                  }
              } catch (e) { txNotes[wtx.reference] = { description: wtx.note } }
          })
      }
  }

  const actions = (txs || []).map((t: any) => {
    const meta = txNotes[t.id] || {}
    return {
      id: String(t.id),
      adminId: String(meta.adminId || ''),
      userId: String(t.userId || ''),
      amount: String(t.amount ?? '0'),
      action: 'MANUAL_CREDIT',
      note: String(meta.description || meta.note || ''),
      status: meta.pending ? 'PENDING' : 'COMPLETED',
      createdAt: String(t.createdAt || new Date().toISOString()),
    }
  })
  return NextResponse.json({ actions, total: count ?? actions.length, page, limit })
}

export async function POST(req: NextRequest) {
  if (!supabaseServer) return NextResponse.json({ error: 'server_configuration_error' }, { status: 500 })
  const supabase = supabaseServer

  const admin = await requireAdminApp(req)
  if (!admin.ok || !admin.userId) return NextResponse.json({ error: admin.error || 'forbidden' }, { status: 403 })
  const adminId = admin.userId

  const body = await req.json().catch(() => ({})) as Body
  const { userId: rawUserId, email: rawEmail, amount } = body
  const note = body.note ?? body.description ?? undefined
  if (typeof amount !== 'number') return NextResponse.json({ error: 'missing_fields' }, { status: 400 })
  if (amount <= 0) return NextResponse.json({ error: 'invalid_amount' }, { status: 400 })

  const enabled = String(process.env.ENABLE_MANUAL_CREDITS || 'false').trim().toLowerCase() === 'true'
  if (!enabled) return NextResponse.json({ error: 'manual_credits_disabled' }, { status: 403 })
  const threshold = Number(process.env.MANUAL_CREDIT_APPROVAL_THRESHOLD || '0')

  try {
    const resolvedUserId = await resolveSupabaseUserId({ userId: rawUserId, email: rawEmail })
    if (!resolvedUserId) return NextResponse.json({ error: 'invalid_user_identifier' }, { status: 400 })

    if (threshold && amount > threshold) {
        const newId = crypto.randomUUID()
        const { data: txInserted } = await supabase
          .from('Transaction')
          .insert({
            id: newId, userId: resolvedUserId, type: 'admin_credit', amount: amount, currency: body.currency || 'USD', status: 'PENDING', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString()
          })
          .select().maybeSingle()
        
        await supabase.from('WalletTransaction').insert({
            id: crypto.randomUUID(), walletId: 'pending', amount: amount, type: 'CREDIT', source: 'admin_credit_pending', reference: newId, performedBy: adminId, note: JSON.stringify({ description: note ?? null, adminId, pending: true }), createdAt: new Date().toISOString()
        })

        return NextResponse.json({ status: 'pending', action: txInserted || null }, { status: 202 })
    }

    const currency = body.currency || 'USD'
    const { data: existing, error: selectErr } = await supabase.from('Wallet').select('id,balance').eq('userId', resolvedUserId).eq('currency', currency).maybeSingle()
    
    let walletId = existing?.id as string | undefined
    let currentAmount = Number(existing?.balance ?? 0)
    if (!walletId) {
      const { data: inserted, error: insertErr } = await supabase.from('Wallet').insert({ id: crypto.randomUUID(), userId: resolvedUserId, currency, balance: 0, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }).select().maybeSingle()
      if (insertErr && (insertErr.message.includes('relation') || insertErr.code === '42P01')) {
           const { data: ins2 } = await supabase.from('wallets').insert({ user_id: resolvedUserId, currency, balance: 0, created_at: new Date().toISOString(), updated_at: new Date().toISOString() }).select().maybeSingle()
           if (!ins2) throw new Error('wallet_create_failed')
           walletId = ins2.id; currentAmount = 0
      } else {
          if (insertErr) throw new Error(`wallet_create_failed:${insertErr.message}`)
          walletId = inserted?.id as string; currentAmount = 0
      }
    }

    const newAmount = Number((currentAmount + amount).toFixed(8))
    const { error: updateErr } = await supabase.from('Wallet').update({ balance: newAmount, updatedAt: new Date().toISOString() }).eq('id', walletId!)
    if (updateErr && (updateErr.message.includes('relation') || updateErr.code === '42P01')) {
         await supabase.from('wallets').update({ balance: newAmount, updated_at: new Date().toISOString() }).eq('id', walletId!)
    } else if (updateErr) throw new Error(`wallet_update_failed:${updateErr.message}`)

    let txId = crypto.randomUUID()
    try {
      const { error: txErr } = await supabase.from('Transaction').insert({ id: txId, userId: resolvedUserId, type: 'ADMIN_CREDIT', amount: amount, currency, status: 'COMPLETED', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() })
      if (txErr && (txErr.message.includes('relation') || txErr.code === '42P01')) {
           await supabase.from('transactions').insert({ id: txId, user_id: resolvedUserId, type: 'ADMIN_CREDIT', amount: amount, currency, status: 'COMPLETED', created_at: new Date().toISOString(), updated_at: new Date().toISOString() })
      }
    } catch {}

    let txn: any = null
    try {
      const { data: wtx } = await supabase.from('WalletTransaction').insert({ id: crypto.randomUUID(), walletId: walletId!, amount: amount, type: 'CREDIT', source: 'admin_credit', reference: txId, performedBy: adminId, note: JSON.stringify({ description: note ?? null, adminId }), createdAt: new Date().toISOString() }).select().single()
      txn = wtx
    } catch {}

    try {
      const { data: notif } = await supabase.from('Notification').insert({ userId: resolvedUserId, type: 'manual_credit', title: 'Manual Credit', message: `Your wallet was credited with ${amount.toFixed(2)} ${currency}`, read: false, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }).select().single()
      if (notif) {
        try {
            const { publish } = await import('../../../src/lib/sse')
            await publish(`user:${resolvedUserId}`, { id: notif.id, type: notif.type, title: notif.title, message: notif.message, createdAt: notif.createdAt || new Date().toISOString() })
        } catch {}
      }
    } catch {}

    return NextResponse.json({ balance: newAmount, transaction: txn })
  } catch (e: any) {
    console.error('wallets api error', e)
    const msg = String(e?.message || 'credit_failed')
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
