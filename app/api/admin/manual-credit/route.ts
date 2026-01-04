export const dynamic = "force-dynamic";

import { NextRequest } from 'next/server'
import { supabaseServer } from '@lib/supabaseServer'
import { requireRole } from '@lib/requireRole'
import { publish } from '@lib/sse'
import crypto from 'crypto'

export async function POST(req: NextRequest) {
  const { user, error } = await requireRole('ADMIN', req)
  if (error || !user) return new Response(JSON.stringify({ error: error || 'unauthenticated' }), { status: error === 'unauthenticated' ? 401 : 403 })
  const adminId = String(user.id)

  const body = await req.json()
  const userId = String(body?.userId || '')
  const amount = Number(body?.amount || 0)
  const currency = String(body?.currency || 'USD')
  const note = String(body?.note || '')

  if (!userId || !amount || Number.isNaN(amount) || amount <= 0) {
    return new Response(JSON.stringify({ error: 'invalid' }), { status: 400 })
  }

  if (!supabaseServer) return new Response(JSON.stringify({ error: 'server_configuration_error' }), { status: 500 })

  try {
    const now = new Date().toISOString()
    const newId = crypto.randomUUID()

    // 1. Find or create wallet with Fallback
    let walletId = ''
    let wallet: any = null
    
    const { data: w1, error: wErr1 } = await supabaseServer
        .from('Wallet')
        .select('*')
        .eq('userId', userId)
        .eq('currency', currency)
        .maybeSingle()
    
    if (wErr1 && (wErr1.message.includes('relation "public.Wallet" does not exist') || wErr1.code === '42P01')) {
        const { data: w2 } = await supabaseServer
           .from('wallets')
           .select('*')
           .eq('user_id', userId)
           .eq('currency', currency)
           .maybeSingle()
        if (w2) wallet = { ...w2, userId: w2.user_id, id: w2.id, balance: w2.balance }
    } else {
        wallet = w1
    }

    if (!wallet) {
        walletId = crypto.randomUUID()
        const wData = {
            id: walletId,
            userId,
            currency,
            balance: amount,
            createdAt: now,
            updatedAt: now
        }
        
        const { error: cErr } = await supabaseServer.from('Wallet').insert(wData)
        if (cErr && (cErr.message.includes('relation "public.Wallet" does not exist') || cErr.code === '42P01')) {
            const { error: cErr2 } = await supabaseServer.from('wallets').insert({
                ...wData,
                user_id: wData.userId,
                created_at: wData.createdAt,
                updated_at: wData.updatedAt
            })
            if (cErr2) throw cErr2
        } else if (cErr) {
            throw cErr
        }
    } else {
        walletId = wallet.id
        const newBal = Number(wallet.balance) + amount
        
        const { error: uErr } = await supabaseServer
            .from('Wallet')
            .update({ balance: newBal, updatedAt: now })
            .eq('id', walletId)
        
        if (uErr && (uErr.message.includes('relation "public.Wallet" does not exist') || uErr.code === '42P01')) {
             await supabaseServer.from('wallets').update({ balance: newBal, updated_at: now }).eq('id', walletId)
        }
    }

    // 2. Create Transaction with Fallback
    const txData = {
        id: newId,
        userId,
        type: 'admin_credit', 
        amount: amount,
        currency: currency,
        provider: 'system',
        status: 'COMPLETED',
        reference: JSON.stringify({ description: `Manual credit: ${note} (${currency})`, note, adminId }),
        createdAt: now,
        updatedAt: now
    }
    
    const { error: txErr } = await supabaseServer.from('Transaction').insert(txData)
    if (txErr && (txErr.message.includes('relation "public.Transaction" does not exist') || txErr.code === '42P01')) {
         const { error: txErr2 } = await supabaseServer.from('transactions').insert({
             ...txData,
             user_id: txData.userId,
             created_at: txData.createdAt,
             updated_at: txData.updatedAt
         })
         if (txErr2) throw txErr2
    } else if (txErr) {
        throw txErr
    }

    // 3. Create WalletTransaction with Fallback
    const wtData = {
        id: crypto.randomUUID(),
        walletId,
        amount: amount,
        type: 'CREDIT',
        source: 'admin_manual_credit',
        reference: JSON.stringify({ txnId: newId, note }),
        performedBy: adminId,
        createdAt: now
    }
    
    const { error: wtErr } = await supabaseServer.from('WalletTransaction').insert(wtData)
    if (wtErr && (wtErr.message.includes('relation "public.WalletTransaction" does not exist') || wtErr.code === '42P01')) {
         await supabaseServer.from('wallet_transactions').insert({
             ...wtData,
             wallet_id: wtData.walletId,
             performed_by: wtData.performedBy,
             created_at: wtData.createdAt
         })
    }

    // 4. Create AdminAction (optional/legacy) - skipping fallback for AdminAction as it's less critical and likely PascalCase if exists, or missing.
    try {
        await supabaseServer.from('AdminAction').insert({
            id: crypto.randomUUID(),
            adminId,
            userId,
            amount: amount,
            action: 'MANUAL_CREDIT',
            note, 
            status: 'COMPLETED',
            createdAt: now
        })
    } catch (e) {
        console.warn('Failed to create AdminAction:', e)
    }

    // 5. Create Notification with Fallback
    let notificationId = ''
    try {
        const notifData = {
            id: crypto.randomUUID(),
            userId,
            type: 'info',
            title: 'Account credited',
            message: `Your account was credited with ${amount} ${currency}. ${note || ''}`.trim(),
            read: false,
            createdAt: now
        }
        
        const { data: notif, error: nErr } = await supabaseServer.from('Notification').insert(notifData).select().single()
        
        if (nErr && (nErr.message.includes('relation "public.Notification" does not exist') || nErr.code === '42P01')) {
             const { data: notif2 } = await supabaseServer.from('notifications').insert({
                 ...notifData,
                 user_id: notifData.userId,
                 created_at: notifData.createdAt
             }).select().single()
             if (notif2) notificationId = notif2.id
        } else if (notif) {
            notificationId = notif.id
        }
    } catch (e) {
        console.warn('Failed to create Notification:', e)
    }

    // publish notification to user channel
    if (notificationId) {
        await publish(`user:${userId}`, { id: notificationId, title: 'Account credited', message: `Your account was credited with ${amount} ${currency}.`, createdAt: now })
    }

    // publish admin audit event
    await publish(`admin:${adminId}`, { type: 'manual_credit', userId, amount, currency, note, notificationId })

    return new Response(JSON.stringify({ ok: true, id: newId }), { status: 200 })
  } catch (err: any) {
    console.error('manual-credit error', err)
    return new Response(JSON.stringify({ error: 'server_error', details: err.message }), { status: 500 })
  }
}
