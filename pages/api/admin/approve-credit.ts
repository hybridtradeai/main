import type { NextApiRequest, NextApiResponse } from 'next'
import { createRateLimiter } from '../../../lib/rateLimit'
import { requireAdmin } from '../../../lib/adminAuth'
import { supabaseServer } from '../../../lib/supabaseServer'
import crypto from 'crypto'

const limiter = createRateLimiter({ windowMs: 60_000, max: 5 })

type Body = { actionId?: string }

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' })
  if (!(await limiter(req, res, 'admin-approve-credit'))) return

  if (!supabaseServer) return res.status(500).json({ error: 'server_configuration_error' })
  const supabase = supabaseServer

  const admin = await requireAdmin(req)
  if (!admin.ok || !admin.userId) return res.status(403).json({ error: admin.error || 'forbidden' })
  const approverId = admin.userId

  const { actionId } = (req.body ?? {}) as Body
  if (!actionId) return res.status(400).json({ error: 'missing_action_id' })

  try {
    // Fetch action from Supabase (replacing Prisma)
    // Try PascalCase
    let action: any = null
    const { data: act1, error: err1 } = await supabase.from('AdminAction').select('*').eq('id', actionId).maybeSingle()
    
    if (err1 && (err1.message.includes('relation') || err1.code === '42P01')) {
        const { data: act2 } = await supabase.from('admin_actions').select('*').eq('id', actionId).maybeSingle()
        if (act2) action = { ...act2, userId: act2.user_id, approvedBy: act2.approved_by, approvedAt: act2.approved_at }
    } else if (act1) {
        action = act1
    }
    
    if (!action) throw new Error('action_not_found')
    if (action.status !== 'PENDING') throw new Error('action_not_pending')
    const userId = action.userId

    // Always approve credits into USD wallet
    const currency = 'USD'

    // Fetch or create wallet in Supabase
    // Try PascalCase
    let walletId: string | undefined
    let currentAmount = 0
    
    const { data: existing, error: wErr1 } = await supabase
      .from('Wallet')
      .select('id,balance')
      .eq('userId', userId)
      .eq('currency', currency)
      .maybeSingle()

    let useLowerWallet = false
    if (wErr1 && (wErr1.message.includes('relation') || wErr1.code === '42P01')) {
        useLowerWallet = true
        const { data: ex2 } = await supabase
            .from('wallets')
            .select('id,balance')
            .eq('user_id', userId)
            .eq('currency', currency)
            .maybeSingle()
        if (ex2) {
            walletId = ex2.id
            currentAmount = Number(ex2.balance ?? 0)
        }
    } else {
        walletId = existing?.id
        currentAmount = Number(existing?.balance ?? 0)
    }

    if (!walletId) {
      if (useLowerWallet) {
          const { data: inserted, error: insertErr } = await supabase
            .from('wallets')
            .insert({ user_id: userId, currency, balance: 0, created_at: new Date().toISOString(), updated_at: new Date().toISOString() })
            .select()
            .maybeSingle()
          if (insertErr) throw new Error('wallet_create_failed')
          walletId = inserted?.id
      } else {
          const { data: inserted, error: insertErr } = await supabase
            .from('Wallet')
            .insert({ userId: userId, currency, balance: 0, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() })
            .select()
            .maybeSingle()
          
          if (insertErr && (insertErr.message.includes('relation') || insertErr.code === '42P01')) {
              // Retry lower
               const { data: ins2, error: insErr2 } = await supabase
                .from('wallets')
                .insert({ user_id: userId, currency, balance: 0, created_at: new Date().toISOString(), updated_at: new Date().toISOString() })
                .select()
                .maybeSingle()
               if (insErr2) throw new Error('wallet_create_failed')
               walletId = ins2?.id
               useLowerWallet = true
          } else if (insertErr) {
               throw new Error('wallet_create_failed')
          } else {
               walletId = inserted?.id
          }
      }
      currentAmount = 0
    }

    const amountNum = Number(action.amount)
    const newAmount = Number((currentAmount + amountNum).toFixed(8))
    
    if (useLowerWallet) {
        const { error: updateErr } = await supabase
          .from('wallets')
          .update({ balance: newAmount, updated_at: new Date().toISOString() })
          .eq('id', walletId!)
        if (updateErr) throw new Error('wallet_update_failed')
    } else {
        const { error: updateErr } = await supabase
          .from('Wallet')
          .update({ balance: newAmount, updatedAt: new Date().toISOString() })
          .eq('id', walletId!)
        if (updateErr) throw new Error('wallet_update_failed')
    }

    const txnId = crypto.randomUUID()
    const noteStr = JSON.stringify({ note: action.note || null })
    const now = new Date().toISOString()
    
    // WalletTransaction
    // Try PascalCase
    let txn: any = null
    const { data: wtx, error: wtErr } = await supabase.from('WalletTransaction').insert({
        id: txnId,
        walletId: walletId!,
        amount: amountNum,
        type: 'CREDIT',
        source: 'admin_credit_approval',
        reference: action.id,
        note: noteStr,
        performedBy: approverId,
        createdAt: now
    }).select().single()
    
    if (wtErr && (wtErr.message.includes('relation') || wtErr.code === '42P01')) {
        const { data: wtx2 } = await supabase.from('wallet_transactions').insert({
            id: txnId,
            wallet_id: walletId!,
            amount: amountNum,
            type: 'CREDIT',
            source: 'admin_credit_approval',
            reference: action.id,
            note: noteStr,
            performed_by: approverId,
            created_at: now
        }).select().single()
        txn = wtx2
    } else {
        txn = wtx
    }
    
    // Update AdminAction status
    if (err1 && (err1.message.includes('relation') || err1.code === '42P01')) {
         await supabase.from('admin_actions').update({
             status: 'COMPLETED',
             approved_by: approverId,
             approved_at: new Date().toISOString()
         }).eq('id', action.id)
    } else {
         await supabase.from('AdminAction').update({
             status: 'COMPLETED',
             approvedBy: approverId,
             approvedAt: new Date().toISOString()
         }).eq('id', action.id)
    }

    // Return updated action (mocked since we just updated it)
    const completed = { ...action, status: 'COMPLETED', approvedBy: approverId, approvedAt: new Date() }

    return res.json({ balance: newAmount, transaction: txn, action: completed })
  } catch (e: any) {
    return res.status(500).json({ error: e?.message || 'approve_failed' })
  }
}

export const config = { api: { bodyParser: true } }
