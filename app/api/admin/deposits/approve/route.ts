export const dynamic = "force-dynamic";

import { NextRequest } from 'next/server'
import { supabaseServer } from '@lib/supabaseServer'
import { requireRole } from '@lib/requireRole'

export async function POST(req: NextRequest) {
  const { user, error } = await requireRole('ADMIN')
  if (error) return new Response(JSON.stringify({ error }), { status: error === 'unauthenticated' ? 401 : 403 })
  const body = await req.json().catch(() => ({}))
  const id = String(body?.transactionId || '')
  if (!id) return new Response(JSON.stringify({ error: 'invalid' }), { status: 400 })

  // 1. Fetch Transaction with Fallback
  if (!supabaseServer) return new Response(JSON.stringify({ error: 'server_configuration_error' }), { status: 500 })
  let tx: any = null;
  const { data: tx1, error: txErr1 } = await supabaseServer.from('Transaction').select('*').eq('id', id).maybeSingle()
  
  if (txErr1 && (txErr1.message.includes('relation "public.Transaction" does not exist') || txErr1.code === '42P01')) {
       const { data: tx2 } = await supabaseServer.from('transactions').select('*').eq('id', id).maybeSingle()
       if (tx2) {
           tx = { ...tx2, userId: tx2.user_id, createdAt: tx2.created_at, updatedAt: tx2.updated_at, amount: tx2.amount, currency: tx2.currency, type: tx2.type, status: tx2.status, reference: tx2.reference }
       }
  } else {
      tx = tx1
  }

  if (!tx || tx.type !== 'DEPOSIT' || (tx.status !== 'PENDING' && tx.status !== 'pending')) {
    return new Response(JSON.stringify({ error: 'not_found_or_not_pending' }), { status: 404 })
  }
  
  let meta: any = {}
  try {
    meta = tx.reference ? JSON.parse(tx.reference) : {}
  } catch {}
  
  const currency = String(meta.currency || tx.currency || 'USD')
  const amount = Number(tx.amount)

  // 2. Find or Create Wallet with Fallback
  let wallet: any = null
  const { data: w1, error: wErr1 } = await supabaseServer.from('Wallet').select('*').eq('userId', tx.userId).eq('currency', currency).maybeSingle()
  
  if (wErr1 && (wErr1.message.includes('relation "public.Wallet" does not exist') || wErr1.code === '42P01')) {
      const { data: w2 } = await supabaseServer.from('wallets').select('*').eq('user_id', tx.userId).eq('currency', currency).maybeSingle()
      if (w2) wallet = { ...w2, userId: w2.user_id, id: w2.id, balance: w2.balance }
  } else {
      wallet = w1
  }

  let walletId = wallet?.id
  const now = new Date().toISOString()
  
  if (wallet) {
    const newBal = Number(wallet.balance) + amount
    // Update Wallet
    const { error: uErr1 } = await supabaseServer.from('Wallet').update({ balance: newBal, updatedAt: now }).eq('id', walletId)
    if (uErr1 && (uErr1.message.includes('relation "public.Wallet" does not exist') || uErr1.code === '42P01')) {
         await supabaseServer.from('wallets').update({ balance: newBal, updated_at: now }).eq('id', walletId)
    }
  } else {
    // Create Wallet
    const crypto = require('crypto')
    walletId = crypto.randomUUID()
    const { error: cErr1 } = await supabaseServer.from('Wallet').insert({ id: walletId, userId: tx.userId, currency, balance: amount, createdAt: now, updatedAt: now })
    if (cErr1 && (cErr1.message.includes('relation "public.Wallet" does not exist') || cErr1.code === '42P01')) {
         await supabaseServer.from('wallets').insert({ id: walletId, user_id: tx.userId, currency, balance: amount, created_at: now, updated_at: now })
    }
  }

  const updatedMeta = { ...meta, approvedBy: String(user?.id || 'admin'), approvedAt: now }
  
  // 3. Update Transaction status
  const { error: tUpdErr } = await supabaseServer.from('Transaction').update({ status: 'COMPLETED', reference: JSON.stringify(updatedMeta), updatedAt: now }).eq('id', id)
  if (tUpdErr && (tUpdErr.message.includes('relation "public.Transaction" does not exist') || tUpdErr.code === '42P01')) {
       await supabaseServer.from('transactions').update({ status: 'COMPLETED', reference: JSON.stringify(updatedMeta), updated_at: now }).eq('id', id)
  }

  const autoActivate = Boolean(meta.autoActivate)
  const planId = String(meta.planId || '')
  
  if (autoActivate && planId) {
    const crypto = require('crypto')
    const invId = crypto.randomUUID()
    
    // Create Investment
    const invData = { id: invId, userId: tx.userId, planId, principal: amount, status: 'ACTIVE', startDate: now, createdAt: now, updatedAt: now }
    const { error: iErr } = await supabaseServer.from('Investment').insert(invData)
    if (iErr && (iErr.message.includes('relation "public.Investment" does not exist') || iErr.code === '42P01')) {
         await supabaseServer.from('investments').insert({
             ...invData,
             user_id: invData.userId,
             plan_id: invData.planId,
             start_date: invData.startDate,
             created_at: invData.createdAt,
             updated_at: invData.updatedAt
         })
    }
    
    // Update Wallet (deduct)
    // Re-fetch wallet to get current balance safely? Or just trust previous calculation if atomic.
    // Ideally we should use database functions or precise math, but for now we follow existing logic.
    
    // We already added 'amount' to wallet. Now we subtract 'amount'. So net change is 0 if we started from 0.
    // But wait, if we updated wallet above, we need to update it again.
    // The previous logic did: find wallet, update (+amount). Then find wallet again, update (-amount).
    
    // Optimization: If autoActivate is true, we could have skipped the credit and just created investment. 
    // But we need to record the deposit transaction and the debit transaction for history.
    
    // Let's assume we need to deduct now.
    // Fetch wallet again to be safe on balance
    let wCheck: any = null
    const { data: w3, error: wErr3 } = await supabaseServer.from('Wallet').select('id,balance').eq('id', walletId).single()
    if (wErr3 && (wErr3.message.includes('relation "public.Wallet" does not exist') || wErr3.code === '42P01')) {
         const { data: w4 } = await supabaseServer.from('wallets').select('id,balance').eq('id', walletId).single()
         wCheck = w4
    } else {
         wCheck = w3
    }
    
    if (wCheck && Number(wCheck.balance) >= amount) {
         const afterDed = Number(wCheck.balance) - amount
         const { error: wDedErr } = await supabaseServer.from('Wallet').update({ balance: afterDed, updatedAt: now }).eq('id', walletId)
         if (wDedErr && (wDedErr.message.includes('relation "public.Wallet" does not exist') || wDedErr.code === '42P01')) {
              await supabaseServer.from('wallets').update({ balance: afterDed, updated_at: now }).eq('id', walletId)
         }
    }

    // Create DEBIT Transaction
    const txId2 = crypto.randomUUID()
    const txData2 = { id: txId2, userId: tx.userId, investmentId: invId, type: 'DEPOSIT', amount, status: 'COMPLETED', reference: JSON.stringify({ autoActivate: true, approvedBy: String(user?.id || 'admin') }), createdAt: now, updatedAt: now }
    // Usually investment creation is a DEBIT or 'INVESTMENT' type. But I will stick to original logic to avoid breaking frontend assumptions.
    
    const { error: txErr2 } = await supabaseServer.from('Transaction').insert(txData2)
    if (txErr2 && (txErr2.message.includes('relation "public.Transaction" does not exist') || txErr2.code === '42P01')) {
         await supabaseServer.from('transactions').insert({
             ...txData2,
             user_id: txData2.userId,
             investment_id: txData2.investmentId,
             created_at: txData2.createdAt,
             updated_at: txData2.updatedAt
         })
    }
  }

  return new Response(JSON.stringify({ ok: true }), { status: 200 })
}


