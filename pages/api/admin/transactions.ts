import type { NextApiRequest, NextApiResponse } from 'next'
import { z } from 'zod'
import { requireAdmin } from '../../../lib/adminAuth'
import { supabaseServer } from '../../../lib/supabaseServer'
import { createRateLimiter } from '../../../lib/rateLimit'
import crypto from 'crypto'

const PatchSchema = z.object({ id: z.string().min(1), status: z.enum(['confirmed', 'rejected']) })

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (!supabaseServer) return res.status(500).json({ error: 'server_configuration_error' })
  const supabase = supabaseServer

  if (req.method === 'GET') {
    const admin = await requireAdmin(req)
    if (!admin.ok) return res.status(401).json({ error: admin.error || 'unauthorized' })
    if (!(await getLimiter(req, res, 'admin-transactions-get'))) return
    const type = String(req.query.type || '').trim()
    const status = String(req.query.status || '').trim()
    const page = Math.max(1, Number((req.query.page as string) || '1'))
    const limit = Math.min(100, Math.max(1, Number((req.query.limit as string) || '25')))
    const from = (page - 1) * limit
    const to = from + limit - 1

    const typeLower = type.toLowerCase()
    const typeUpper = type.toUpperCase()
    const statusLower = status.toLowerCase()
    const statusUpper = status.toUpperCase()

    try {
      // Try PascalCase first
      let q = supabase
        .from('Transaction')
        .select('*', { count: 'exact' })
        .order('createdAt', { ascending: false })
      
      let useLowercase = false;
      // We can't easily detect table existence in a query builder chain without executing it.
      // So we'll try to execute a small check or just catch the error.
      // However, for list endpoints, it's better to just try one and if it fails, try the other.
      
      // Let's modify the strategy:
      // Since we can't chain conditionally easily with error handling in between,
      // We will try to fetch with PascalCase. If it errors with 'relation does not exist', we try lowercase.
      
      if (type) q = (q as any).in('type', [typeLower, typeUpper])
      if (status) q = (q as any).in('status', [statusLower, statusUpper])
      q = q.range(from, to)
      
      let result = await q;
      
      if (result.error && (result.error.message.includes('relation "public.Transaction" does not exist') || result.error.code === '42P01')) {
          // Fallback to lowercase 'transactions'
          let q2 = supabase
            .from('transactions')
            .select('*', { count: 'exact' })
            .order('created_at', { ascending: false })
          
          if (type) q2 = (q2 as any).in('type', [typeLower, typeUpper])
          if (status) q2 = (q2 as any).in('status', [statusLower, statusUpper])
          q2 = q2.range(from, to)
          
          result = await q2;
          
          // Map snake_case to camelCase for consistency
          if (result.data) {
              result.data = result.data.map((d: any) => ({
                  ...d,
                  userId: d.user_id,
                  investmentId: d.investment_id,
                  createdAt: d.created_at,
                  updatedAt: d.updated_at,
                  amountUsd: d.amount_usd,
                  txHash: d.tx_hash
              }));
          }
      }

      let { data, error, count } = result;
      
      if (error) {
          console.error('Fetch Transaction error:', error)
          return res.status(500).json({ error: 'fetch_failed' })
      }

      const arr = Array.isArray(data) ? (data as any[]) : []
      const ids = Array.from(new Set(arr.map((t) => String(t.userId || '')).filter(Boolean)))
      let map: Record<string, string> = {}
      if (ids.length) {
        // Try PascalCase User
        const { data: users, error: userErr } = await supabase
          .from('User')
          .select('id,email')
          .in('id', ids)
        
        let fetchedUsers = users;
        
        if (userErr && (userErr.message.includes('relation "public.User" does not exist') || userErr.code === '42P01')) {
             // Fallback to lowercase 'users'
             const { data: usersLower } = await supabase
                .from('users')
                .select('id,email')
                .in('id', ids)
             fetchedUsers = usersLower;
        }

        if (fetchedUsers && fetchedUsers.length > 0) {
            for (const u of fetchedUsers) {
                if (u.id && u.email) map[u.id] = u.email;
            }
        } else {
            // Fallback to profiles if User table empty or missing (legacy)
            const { data: prof } = await supabase
              .from('profiles')
              .select('user_id,email')
              .in('user_id', ids)
            if (Array.isArray(prof)) {
              for (const p of prof as any[]) {
                const uid = String((p as any).user_id || '')
                const email = String((p as any).email || '')
                if (uid && email) map[uid] = email
              }
            }
        }
      }

      // WalletTransaction fetching removed as note column is missing and we store details in Transaction.reference now.
      
      const items = arr.map((t) => {
        const uid = String(t.userId || '')
        const email = map[uid]
        let meta = t.meta ?? t.metadata ?? null
        
        // Try to parse reference as metadata if it's a JSON string (new way)
        if (!meta && t.reference && (t.reference.startsWith('{') || t.reference.startsWith('['))) {
            try {
                meta = JSON.parse(t.reference)
            } catch {}
        }

        return {
          id: String(t.id),
          user_id: uid,
          type: String(t.type || '').toLowerCase(),
          amount: typeof t.amount === 'number' ? t.amount : undefined,
          amount_usd: typeof t.amount_usd === 'number' ? t.amount_usd : (typeof t.amountUsd === 'number' ? t.amountUsd : undefined),
          currency: String(t.currency ?? meta?.currency ?? ''),
          status: String(t.status || '').toLowerCase(),
          meta: meta,
          tx_hash: t.txHash ?? meta?.txHash ?? meta?.hash ?? undefined,
          created_at: t.createdAt ?? new Date().toISOString(),
          profiles: email ? { email } : null,
          reference: t.reference // Return reference too
        }
      })

      return res.json({ items, page, limit, total: typeof count === 'number' ? count : items.length })
    } catch (err) {
      console.error('Admin transactions error:', err)
      return res.status(500).json({ error: 'fetch_failed' })
    }
  }

  if (req.method === 'PATCH') {
    const admin = await requireAdmin(req)
    if (!admin.ok) return res.status(401).json({ error: admin.error || 'unauthorized' })
    if (!(await patchLimiter(req, res, 'admin-transactions-patch'))) return
    const parsed = PatchSchema.safeParse(req.body || {})
    if (!parsed.success) return res.status(400).json({ error: 'invalid_payload', issues: parsed.error.issues })
    const { id, status } = parsed.data

    let tx: any = null;
    let error: any = null;

    // Try PascalCase
    const res1 = await supabase
      .from('Transaction')
      .select('*')
      .eq('id', id)
      .maybeSingle()
    
    if (res1.error && (res1.error.message.includes('relation "public.Transaction" does not exist') || res1.error.code === '42P01')) {
         // Fallback to lowercase
         const res2 = await supabase
            .from('transactions')
            .select('*')
            .eq('id', id)
            .maybeSingle()
         
         if (res2.data) {
             tx = {
                 ...res2.data,
                 userId: res2.data.user_id,
                 investmentId: res2.data.investment_id,
                 createdAt: res2.data.created_at,
                 updatedAt: res2.data.updated_at,
                 amountUsd: res2.data.amount_usd,
                 txHash: res2.data.tx_hash,
                 type: res2.data.type,
                 currency: res2.data.currency
             }
         }
         error = res2.error;
    } else {
        tx = res1.data;
        error = res1.error;
    }

    if (error || !tx) return res.status(404).json({ error: 'transaction_not_found' })

    const uid = String((tx as any).userId || '')
    const amt = Number((tx as any).amount ?? 0)
    // Try to get currency from tx or meta. Since we don't have meta in tx usually, we might need to fetch it if it's critical. 
    // But for withdrawal/deposit, currency is usually in the row.
    const curr = String((tx as any).currency ?? 'USD')
    const type = String((tx as any).type || '').toUpperCase()

    if (status === 'confirmed') {
      if (type === 'WITHDRAWAL') {
        // Funds were already deducted when the user made the request (atomic model).
        // So we just confirm the transaction status (done below).
      }
      if (type === 'DEPOSIT') {
        let wallet: any = null
        // Try PascalCase Wallet
        let wq = await supabase.from('Wallet').select('id,balance').eq('userId', uid).eq('currency', curr).maybeSingle()
        
        if (wq.error && (wq.error.message.includes('relation "public.Wallet" does not exist') || wq.error.code === '42P01')) {
            // Fallback to lowercase
            const wq2 = await supabase.from('wallets').select('id,balance,user_id').eq('user_id', uid).eq('currency', curr).maybeSingle()
            if (wq2.data) {
                wallet = { ...wq2.data, userId: wq2.data.user_id }
            }
        } else {
            wallet = wq.data
        }
        
        let walletId: string | null = wallet?.id ? String(wallet.id) : null
        let currentAmount = Number(wallet?.balance || 0)
        
        if (!walletId) {
          // Try create wallet PascalCase
          const ins = await supabase.from('Wallet').insert({ userId: uid, currency: curr, balance: 0, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }).select('id,balance').maybeSingle()
          
          if (ins.error && (ins.error.message.includes('relation "public.Wallet" does not exist') || ins.error.code === '42P01')) {
               // Fallback create lowercase
               const ins2 = await supabase.from('wallets').insert({ user_id: uid, currency: curr, balance: 0, created_at: new Date().toISOString(), updated_at: new Date().toISOString() }).select('id,balance').maybeSingle()
               if (ins2.error || !ins2.data) return res.status(500).json({ error: 'wallet_create_failed' })
               walletId = String(ins2.data.id)
               currentAmount = Number(ins2.data.balance || 0)
          } else {
              if (ins.error || !ins.data) return res.status(500).json({ error: 'wallet_create_failed' })
              walletId = String(ins.data.id)
              currentAmount = Number(ins.data.balance || 0)
          }
        }
        
        const newAmount = Number((currentAmount + amt).toFixed(8))
        
        // Update Wallet Balance
        const upd = await supabase.from('Wallet').update({ balance: newAmount, updatedAt: new Date().toISOString() }).eq('id', walletId)
        if (upd.error && (upd.error.message.includes('relation "public.Wallet" does not exist') || upd.error.code === '42P01')) {
             const upd2 = await supabase.from('wallets').update({ balance: newAmount, updated_at: new Date().toISOString() }).eq('id', walletId)
             if (upd2.error) return res.status(500).json({ error: 'wallet_update_failed' })
        } else if (upd.error) {
             return res.status(500).json({ error: 'wallet_update_failed' })
        }
        
        try { 
            const crypto = require('crypto')
            // WalletTransaction fallback
            const wtData = { 
                id: crypto.randomUUID(),
                walletId: walletId, 
                amount: amt, 
                type: 'CREDIT', 
                source: 'deposit_confirmation', 
                reference: String(id), 
                performedBy: String(admin.userId || ''),
                createdAt: new Date().toISOString()
            }
            
            const wtIns = await supabase.from('WalletTransaction').insert(wtData)
            if (wtIns.error && (wtIns.error.message.includes('relation "public.WalletTransaction" does not exist') || wtIns.error.code === '42P01')) {
                 await supabase.from('wallet_transactions').insert({
                     ...wtData,
                     wallet_id: wtData.walletId,
                     performed_by: wtData.performedBy,
                     created_at: wtData.createdAt
                 })
            }

            // Auto-activate logic
            let meta: any = {}
            const ref = (tx as any).reference
            if (ref && (ref.startsWith('{') || ref.startsWith('['))) {
                try { meta = JSON.parse(ref) } catch {}
            }

            if (meta.autoActivate && meta.planId) {
                const planId = meta.planId
                const invId = crypto.randomUUID()
                
                // Debit wallet
                const afterInvest = Number((newAmount - amt).toFixed(8))
                
                // Update wallet (we know which table works now ideally, but just safe retry)
                let wUpd = await supabase.from('Wallet').update({ balance: afterInvest, updatedAt: new Date().toISOString() }).eq('id', walletId)
                if (wUpd.error && (wUpd.error.message.includes('relation "public.Wallet" does not exist') || wUpd.error.code === '42P01')) {
                    await supabase.from('wallets').update({ balance: afterInvest, updated_at: new Date().toISOString() }).eq('id', walletId)
                }
                
                // Create Investment
                const invData = {
                    id: invId,
                    userId: uid,
                    planId: planId,
                    principal: amt,
                    status: 'ACTIVE',
                    payoutFrequency: 'WEEKLY',
                    startDate: new Date().toISOString(),
                    createdAt: new Date().toISOString(),
                    updatedAt: new Date().toISOString()
                }
                
                const invIns = await supabase.from('Investment').insert(invData)
                if (invIns.error && (invIns.error.message.includes('relation "public.Investment" does not exist') || invIns.error.code === '42P01')) {
                    await supabase.from('investments').insert({
                        ...invData,
                        user_id: invData.userId,
                        plan_id: invData.planId,
                        payout_frequency: invData.payoutFrequency,
                        start_date: invData.startDate,
                        created_at: invData.createdAt,
                        updated_at: invData.updatedAt
                    })
                }

                // Log DEBIT
                const debData = {
                    id: crypto.randomUUID(),
                    walletId: walletId,
                    amount: amt,
                    type: 'DEBIT',
                    source: 'investment_creation',
                    reference: `Auto-investment in plan ${planId}`,
                    performedBy: String(admin.userId || ''),
                    createdAt: new Date().toISOString()
                }
                
                const debIns = await supabase.from('WalletTransaction').insert(debData)
                if (debIns.error && (debIns.error.message.includes('relation "public.WalletTransaction" does not exist') || debIns.error.code === '42P01')) {
                     await supabase.from('wallet_transactions').insert({
                        ...debData,
                        wallet_id: debData.walletId,
                        performed_by: debData.performedBy,
                        created_at: debData.createdAt
                     })
                }

                // Log Transaction
                const txData = {
                    id: crypto.randomUUID(),
                    userId: uid,
                    investmentId: invId,
                    type: 'DEPOSIT',
                    amount: amt,
                    currency: curr,
                    provider: 'system',
                    status: 'COMPLETED',
                    reference: JSON.stringify({ autoActivate: true, approvedBy: String(admin.userId || 'admin'), sourceDepositId: id }),
                    createdAt: new Date().toISOString(),
                    updatedAt: new Date().toISOString()
                }
                
                const txIns = await supabase.from('Transaction').insert(txData)
                if (txIns.error && (txIns.error.message.includes('relation "public.Transaction" does not exist') || txIns.error.code === '42P01')) {
                    await supabase.from('transactions').insert({
                        ...txData,
                        user_id: txData.userId,
                        investment_id: txData.investmentId,
                        created_at: txData.createdAt,
                        updated_at: txData.updatedAt
                    })
                }
            }

        } catch {}
      }
    }
    
    if (status === 'rejected') {
        if (type === 'WITHDRAWAL') {
            // Refund the user since funds were deducted at request time
            let wallet: any = null
            let wq = await supabase.from('Wallet').select('*').eq('userId', uid).eq('currency', curr).maybeSingle()
            
            if (wq.error && (wq.error.message.includes('relation "public.Wallet" does not exist') || wq.error.code === '42P01')) {
                const wq2 = await supabase.from('wallets').select('*').eq('user_id', uid).eq('currency', curr).maybeSingle()
                if (wq2.data) wallet = { ...wq2.data, userId: wq2.data.user_id, id: wq2.data.id, balance: wq2.data.balance }
            } else {
                wallet = wq.data
            }

            if (wallet) {
                const newBal = Number(wallet.balance) + amt
                
                let wUpd = await supabase.from('Wallet').update({ balance: newBal, updatedAt: new Date().toISOString() }).eq('id', wallet.id)
                if (wUpd.error && (wUpd.error.message.includes('relation "public.Wallet" does not exist') || wUpd.error.code === '42P01')) {
                     await supabase.from('wallets').update({ balance: newBal, updated_at: new Date().toISOString() }).eq('id', wallet.id)
                }
                
                // Log the refund
                try {
                     const crypto = require('crypto')
                     const refData = { 
                         id: crypto.randomUUID(),
                         walletId: wallet.id, 
                         amount: amt, 
                         type: 'CREDIT', 
                         source: 'withdrawal_rejection_refund', 
                         reference: String(id), 
                         performedBy: String(admin.userId || ''),
                         createdAt: new Date().toISOString()
                     }
                     
                     const refIns = await supabase.from('WalletTransaction').insert(refData)
                     if (refIns.error && (refIns.error.message.includes('relation "public.WalletTransaction" does not exist') || refIns.error.code === '42P01')) {
                          await supabase.from('wallet_transactions').insert({
                              ...refData,
                              wallet_id: refData.walletId,
                              performed_by: refData.performedBy,
                              created_at: refData.createdAt
                          })
                     }
                } catch {}
            }
        }
    }

    // Map UI status to DB enum
    let dbStatus = status.toUpperCase()
    if (status === 'confirmed') dbStatus = 'COMPLETED'
    if (status === 'rejected') dbStatus = 'FAILED'

    const { error: updErr } = await supabase.from('Transaction').update({ status: dbStatus, updatedAt: new Date().toISOString() }).eq('id', id)
    if (updErr && (updErr.message.includes('relation "public.Transaction" does not exist') || updErr.code === '42P01')) {
         const { error: updErr2 } = await supabase.from('transactions').update({ status: dbStatus, updated_at: new Date().toISOString() }).eq('id', id)
         if (updErr2) {
             console.error('Transaction update error:', updErr2)
             return res.status(500).json({ error: 'update_failed', details: updErr2.message })
         }
    } else if (updErr) {
        console.error('Transaction update error:', updErr)
        return res.status(500).json({ error: 'update_failed', details: updErr.message })
    }

    try {
      const title = type === 'DEPOSIT'
        ? (status === 'confirmed' ? 'Deposit Confirmed' : 'Deposit Rejected')
        : (status === 'confirmed' ? 'Withdrawal Approved' : 'Withdrawal Rejected')
      const message = type === 'DEPOSIT'
        ? (status === 'confirmed' ? `Your deposit of ${amt} ${curr} was confirmed.` : `Your deposit of ${amt} ${curr} was rejected.`)
        : (status === 'confirmed' ? `Your withdrawal of ${amt} ${curr} was approved.` : `Your withdrawal of ${amt} ${curr} was rejected.`)

      const notifId = crypto.randomUUID()
      const createdAt = new Date().toISOString()
      const notifType = type === 'DEPOSIT' ? 'deposit_status' : 'withdrawal_status'

      const notifData = {
        id: notifId,
        userId: uid,
        title,
        message,
        type: notifType,
        read: false,
        createdAt
      }

      const notifIns = await supabase.from('Notification').insert(notifData)
      if (notifIns.error && (notifIns.error.message.includes('relation "public.Notification" does not exist') || notifIns.error.code === '42P01')) {
           await supabase.from('notifications').insert({
               ...notifData,
               user_id: notifData.userId,
               created_at: notifData.createdAt
           })
      }

      try {
        const { publish } = await import('../../../src/lib/sse')
        await publish(`user:${uid}`, {
          id: notifId,
          type: notifType,
          title,
          message,
          createdAt
        })
      } catch {}
    } catch {}

    return res.json({ ok: true })
  }

  return res.status(405).json({ error: 'method_not_allowed' })
}

export const config = { api: { bodyParser: true } }
const getLimiter = createRateLimiter({ windowMs: 60_000, max: 60 })
const patchLimiter = createRateLimiter({ windowMs: 60_000, max: 20 })
