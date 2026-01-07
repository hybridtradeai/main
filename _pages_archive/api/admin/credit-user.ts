import type { NextApiRequest, NextApiResponse } from 'next'
import crypto from 'crypto'
import { createRateLimiter } from '../../../lib/rateLimit'
import { requireAdmin } from '../../../lib/adminAuth'
import { supabaseServer } from '../../../lib/supabaseServer'

const limiter = createRateLimiter({ windowMs: 60_000, max: 5 })

type Body = { userId?: string; email?: string; amount?: number; currency?: string; note?: string; description?: string }

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (!supabaseServer) return res.status(500).json({ error: 'server_configuration_error' })
  const supabase = supabaseServer

  if (req.method === 'GET') {
    // Return recent admin manual credit actions for history table with pagination
    const admin = await requireAdmin(req)
    if (!admin.ok) return res.status(403).json({ error: admin.error || 'forbidden' })
    const page = Math.max(1, Number((req.query.page as string) || '1'))
    const limit = Math.min(100, Math.max(1, Number((req.query.limit as string) || '25')))
    const skip = (page - 1) * limit
    
    // Derive actions from Supabase transactions
    let txResult: any = { data: [], error: null, count: 0 }
    
    // Try PascalCase
    const txRes1 = await supabase
      .from('Transaction')
      .select('id,userId,amount,currency,createdAt,reference', { count: 'exact' })
      .eq('type', 'admin_credit')
      .order('createdAt', { ascending: false })
      .range(skip, skip + limit - 1)

    if (txRes1.error && (txRes1.error.message.includes('relation "public.Transaction" does not exist') || txRes1.error.code === '42P01')) {
        // Fallback to lowercase
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
    
    if (txErr) return res.json({ actions: [], total: 0, page, limit })

    // Fetch WalletTransaction notes
    const txIds = (txs || []).map((t: any) => t.id)
    let txNotes: Record<string, any> = {}
    if (txIds.length > 0) {
        let wtxResult: any = { data: [], error: null }
        
        // Try PascalCase
        const wtxRes1 = await supabase
            .from('WalletTransaction')
            .select('reference, note')
            .in('reference', txIds)

        if (wtxRes1.error && (wtxRes1.error.message.includes('relation "public.WalletTransaction" does not exist') || wtxRes1.error.code === '42P01')) {
             // Fallback to lowercase
             wtxResult = await supabase
                .from('wallet_transactions')
                .select('reference, note')
                .in('reference', txIds)
        } else {
             wtxResult = wtxRes1
        }
        
        const { data: wtxs } = wtxResult

        
        if (wtxs) {
            wtxs.forEach((wtx: any) => {
                try {
                    if (wtx.note) {
                        const parsed = typeof wtx.note === 'string' ? JSON.parse(wtx.note) : wtx.note
                        txNotes[wtx.reference] = parsed
                    }
                } catch (e) {
                     txNotes[wtx.reference] = { description: wtx.note }
                }
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
    return res.json({ actions, total: count ?? actions.length, page, limit })
  }

  if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' })
  if (!(await limiter(req, res, 'admin-credit-user'))) return

  const admin = await requireAdmin(req)
  if (!admin.ok || !admin.userId) return res.status(403).json({ error: admin.error || 'forbidden' })
  const adminId = admin.userId

  const { userId: rawUserId, email: rawEmail, amount } = (req.body ?? {}) as Body
  const note = (req.body as Body)?.note ?? (req.body as Body)?.description ?? undefined
  if (typeof amount !== 'number') return res.status(400).json({ error: 'missing_fields' })
  if (amount <= 0) return res.status(400).json({ error: 'invalid_amount' })

  const enabled = String(process.env.ENABLE_MANUAL_CREDITS || 'false').trim().toLowerCase() === 'true'
  if (!enabled) return res.status(403).json({ error: 'manual_credits_disabled' })
  const threshold = Number(process.env.MANUAL_CREDIT_APPROVAL_THRESHOLD || '0')

  try {
    // Resolve a valid Supabase user_id (UUID) from provided identifiers
    const resolvedUserId = await resolveSupabaseUserId({ userId: rawUserId, email: rawEmail })
    if (!resolvedUserId) return res.status(400).json({ error: 'invalid_user_identifier' })

    if (threshold && amount > threshold) {
        // High value credit: insert into Transaction as PENDING
        const newId = crypto.randomUUID()
        const { data: txInserted } = await supabase
          .from('Transaction')
          .insert({
            id: newId,
            userId: resolvedUserId,
            type: 'admin_credit',
            amount: amount,
            currency: (req.body as Body)?.currency || 'USD',
            status: 'PENDING',
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString()
          })
          .select()
          .maybeSingle()
        
        // Also log wallet transaction for meta
        await supabase.from('WalletTransaction').insert({
            id: crypto.randomUUID(),
            walletId: 'pending', // No wallet yet
            amount: amount,
            type: 'CREDIT', // or PENDING
            source: 'admin_credit_pending',
            reference: newId,
            performedBy: adminId,
            note: JSON.stringify({ description: note ?? null, adminId, pending: true }),
            createdAt: new Date().toISOString()
        })

        return res.status(202).json({ status: 'pending', action: txInserted || null })
    }

    // Always credit USD so balances are standardized
    const currency = (req.body as Body)?.currency || 'USD'

    // Fetch or create wallet in Supabase
    const { data: existing, error: selectErr } = await supabase
      .from('Wallet')
      .select('id,balance')
      .eq('userId', resolvedUserId)
      .eq('currency', currency)
      .maybeSingle()
    if (selectErr) throw new Error(`wallet_select_failed:${selectErr.message}`)

    let walletId = existing?.id as string | undefined
    let currentAmount = Number(existing?.balance ?? 0)
    if (!walletId) {
      const { data: inserted, error: insertErr } = await supabase
        .from('Wallet')
        .insert({ id: crypto.randomUUID(), userId: resolvedUserId, currency, balance: 0, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() })
        .select()
        .maybeSingle()
      if (insertErr) throw new Error(`wallet_create_failed:${insertErr.message}`)
      walletId = inserted?.id as string
      currentAmount = 0
    }

    const newAmount = Number((currentAmount + amount).toFixed(8))
    const { error: updateErr } = await supabase
      .from('Wallet')
      .update({ balance: newAmount, updatedAt: new Date().toISOString() })
      .eq('id', walletId!)
    if (updateErr) throw new Error(`wallet_update_failed:${updateErr.message}`)

    // Record transaction in Supabase for visibility in dashboards/history
    let txId = crypto.randomUUID()
    try {
      const { error: txErr } = await supabase
        .from('Transaction')
        .insert({
          id: txId,
          userId: resolvedUserId,
          type: 'ADMIN_CREDIT',
          amount: amount,
          currency,
          status: 'COMPLETED',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        })
      
      if (txErr) {
          // If error is relation not found, try lowercase
          if (txErr.message.includes('relation') || txErr.code === '42P01') {
              throw new Error('RELATION_NOT_FOUND')
          }
          throw new Error(`transactions_insert_failed:${txErr.message}`)
      }
    } catch (e: any) {
        if (e.message === 'RELATION_NOT_FOUND' || e.message?.includes('relation') || e.code === '42P01') {
            try {
                // Fallback to snake_case 'transactions'
                await supabase
                    .from('transactions')
                    .insert({
                        id: txId,
                         user_id: resolvedUserId,
                         type: 'ADMIN_CREDIT',
                         amount: amount,
                         currency,
                         status: 'COMPLETED',
                         created_at: new Date().toISOString(),
                         updated_at: new Date().toISOString()
                     })
             } catch (e2) {
                 console.error('Failed to insert into transactions (fallback):', e2)
             }
         } else {
             console.error('Transaction insert failed:', e)
         }
     }

    // Log via Supabase (replacing Prisma)
    let txn: any = null
    try {
      const { data: wtx } = await supabase.from('WalletTransaction').insert({
          id: crypto.randomUUID(),
          walletId: walletId!,
          amount: amount,
          type: 'CREDIT',
          source: 'admin_credit',
          reference: txId,
          performedBy: adminId,
          note: JSON.stringify({ description: note ?? null, adminId }),
          createdAt: new Date().toISOString()
      }).select().single()
      txn = wtx
    } catch {}

    // Create and broadcast a user notification for instant feedback
    try {
      // Use Supabase for Notification
      const { data: notif } = await supabase.from('Notification').insert({
          userId: resolvedUserId,
          type: 'manual_credit',
          title: 'Manual Credit',
          message: `Your wallet was credited with ${amount.toFixed(2)} ${currency}`,
          read: false,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
      }).select().single()
      
      // Publish via SSE to notify active sessions immediately
      if (notif) {
        try {
            const { publish } = await import('../../../src/lib/sse')
            await publish(`user:${resolvedUserId}`, {
            id: notif.id,
            type: notif.type,
            title: notif.title,
            message: notif.message,
            createdAt: notif.createdAt || new Date().toISOString(),
            })
        } catch {}
      }
    } catch {}

    return res.json({ balance: newAmount, transaction: txn })
  } catch (e: any) {
    console.error('wallets api error', e)
    const msg = String(e?.message || 'credit_failed')
    // Normalize common supabase failure messages for easier troubleshooting
    if (msg.includes('wallet_select_failed')) return res.status(500).json({ error: msg })
    if (msg.includes('wallet_create_failed')) return res.status(500).json({ error: msg })
    if (msg.includes('wallet_update_failed')) return res.status(500).json({ error: msg })
    if (msg.includes('transactions_insert_failed')) return res.status(500).json({ error: msg })
    return res.status(500).json({ error: msg })
  }
}

export const config = { api: { bodyParser: true } }

// Utilities
function isUuidLike(id?: string) {
  if (!id) return false
  const s = String(id).trim()
  // Permissive UUID check: 36 chars with dashes, hex segments
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s)
}

function isEmailLike(s?: string) {
  if (!s) return false
  return /.+@.+\..+/.test(String(s).trim())
}

async function findPublicUser(criteria: { id?: string, email?: string }) {
  if (!supabaseServer) return null
  if (!criteria.id && !criteria.email) return null
  
  // Try PascalCase User
  let q = supabaseServer.from('User').select('id')
  if (criteria.id) q = q.eq('id', criteria.id)
  else if (criteria.email) q = q.eq('email', criteria.email)
  
  const { data, error } = await q.maybeSingle()
  if (!error && data) return data
  
  // Try lowercase users
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
        // Try PascalCase
        const { error } = await supabaseServer.from('User').insert({
            id,
            email,
            role: 'USER',
            kycStatus: 'PENDING',
            updatedAt: new Date().toISOString()
        })
        
        // If error is "relation does not exist", try lowercase
        if (error && (error.message.includes('relation') || error.code === '42P01')) {
             await supabaseServer.from('users').insert({
                id,
                email,
                role: 'USER',
                kyc_status: 'PENDING',
                updated_at: new Date().toISOString()
            })
        }
        return true
    } catch (e: any) {
        // Ignore duplicate key errors (code 23505 in Postgres)
        if (e?.code === '23505' || e?.message?.includes('duplicate key')) {
            return true
        }
        console.error('Sync user failed:', e)
        return false
    }
}

async function resolveSupabaseUserId({ userId, email }: { userId?: string; email?: string }): Promise<string | ''> {
  if (!supabaseServer) return ''
  const id = String(userId || '').trim()
  const mail = String(email || '').trim()

  // 1. Direct lookup in Public User table (referenced by Wallet)
  if (id) {
      const u = await findPublicUser({ id })
      if (u?.id) return u.id
  }

  // 2. Resolve Email to find User
  let emailToUse = isEmailLike(mail) ? mail : (isEmailLike(id) ? id : '')

  // If provided ID is UUID but not found in User table, maybe we can get email from Auth/Profile
  if (!emailToUse && isUuidLike(id)) {
      // Check profiles
      try {
        const { data } = await supabaseServer.from('profiles').select('email').eq('user_id', id).maybeSingle()
        if (data?.email) emailToUse = data.email
      } catch {}
      
      // Check Auth (if profiles didn't help)
      if (!emailToUse) {
        try {
            const { data, error } = await (supabaseServer as any).auth.admin.getUserById(id)
            if (!error && data?.user?.email) emailToUse = data.user.email
        } catch {}
      }
      
      // Found email for the ID? Now we have both ID and Email.
      // Since we know it wasn't in Public User (step 1 failed), we should sync it.
      if (emailToUse) {
          await syncUserToPublic(id, emailToUse)
          return id
      }
  }

  // 3. Lookup by Email
  if (emailToUse) {
      const u = await findPublicUser({ email: emailToUse })
      if (u?.id) return u.id
      
      // If not in User table, look in profiles or Auth to get the ID, then sync.
      let foundId = ''
      
      // Check profiles
      try {
        const { data } = await supabaseServer.from('profiles').select('user_id').eq('email', emailToUse).maybeSingle()
        if (data?.user_id) foundId = data.user_id
      } catch {}

      // Check Auth
      if (!foundId) {
          try {
            const adminRes: any = await (supabaseServer as any).auth?.admin?.listUsers?.({ page: 1, perPage: 200 })
            const users = adminRes?.data?.users || adminRes?.users || []
            const found = users.find((u: any) => String(u?.email || '').toLowerCase() === emailToUse.toLowerCase())
            if (found?.id) foundId = String(found.id)
          } catch {}
      }

      // If we found the ID in Auth/Profiles but it wasn't in Public User (checked at start of block), sync it.
      if (foundId) {
          await syncUserToPublic(foundId, emailToUse)
          return foundId
      }
  }

  return ''
}

export { resolveSupabaseUserId, isUuidLike, isEmailLike }
