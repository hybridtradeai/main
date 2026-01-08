export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireAdminApp } from '@/lib/adminAuth';
import { supabaseServer } from '@/lib/supabaseServer';

const PatchSchema = z.object({ id: z.string().min(1), status: z.enum(['confirmed', 'rejected']) })

export async function GET(req: NextRequest) {
  if (!supabaseServer) return NextResponse.json({ error: 'server_configuration_error' }, { status: 500 })
  const supabase = supabaseServer

  const admin = await requireAdminApp(req)
  if (!admin.ok) return NextResponse.json({ error: admin.error || 'unauthorized' }, { status: 401 })
  
  const { searchParams } = new URL(req.url);
  const type = String(searchParams.get('type') || '').trim()
  const status = String(searchParams.get('status') || '').trim()
  const page = Math.max(1, Number(searchParams.get('page') || '1'))
  const limit = Math.min(100, Math.max(1, Number(searchParams.get('limit') || '25')))
  const from = (page - 1) * limit
  const to = from + limit - 1

  const typeLower = type.toLowerCase()
  const typeUpper = type.toUpperCase()
  const statusLower = status.toLowerCase()
  const statusUpper = status.toUpperCase()

  try {
    let q = supabase.from('Transaction').select('*', { count: 'exact' }).order('createdAt', { ascending: false })
    
    if (type) q = (q as any).in('type', [typeLower, typeUpper])
    if (status) q = (q as any).in('status', [statusLower, statusUpper])
    q = q.range(from, to)
    
    let result = await q;
    
    if (result.error && (result.error.message.includes('relation "public.Transaction" does not exist') || result.error.code === '42P01')) {
        let q2 = supabase.from('transactions').select('*', { count: 'exact' }).order('created_at', { ascending: false })
        if (type) q2 = (q2 as any).in('type', [typeLower, typeUpper])
        if (status) q2 = (q2 as any).in('status', [statusLower, statusUpper])
        q2 = q2.range(from, to)
        result = await q2;
        if (result.data) {
            result.data = result.data.map((d: any) => ({
                ...d, userId: d.user_id, investmentId: d.investment_id, createdAt: d.created_at, updatedAt: d.updated_at, amountUsd: d.amount_usd, txHash: d.tx_hash
            }));
        }
    }

    let { data, error, count } = result;
    if (error) {
        console.error('Fetch Transaction error:', error)
        return NextResponse.json({ error: 'fetch_failed' }, { status: 500 })
    }

    const arr = Array.isArray(data) ? (data as any[]) : []
    const ids = Array.from(new Set(arr.map((t) => String(t.userId || '')).filter(Boolean)))
    let map: Record<string, string> = {}
    if (ids.length) {
      const { data: users, error: userErr } = await supabase.from('User').select('id,email').in('id', ids)
      let fetchedUsers = users;
      if (userErr && (userErr.message.includes('relation "public.User" does not exist') || userErr.code === '42P01')) {
           const { data: usersLower } = await supabase.from('users').select('id,email').in('id', ids)
           fetchedUsers = usersLower;
      }
      if (fetchedUsers && fetchedUsers.length > 0) {
          for (const u of fetchedUsers) { if (u.id && u.email) map[u.id] = u.email; }
      } else {
          const { data: prof } = await supabase.from('profiles').select('user_id,email').in('user_id', ids)
          if (Array.isArray(prof)) {
            for (const p of prof as any[]) {
              const uid = String((p as any).user_id || ''); const email = String((p as any).email || '');
              if (uid && email) map[uid] = email
            }
          }
      }
    }
    
    const items = arr.map((t) => {
      const uid = String(t.userId || '')
      const email = map[uid]
      let meta = t.meta ?? t.metadata ?? null
      if (!meta && t.reference && (t.reference.startsWith('{') || t.reference.startsWith('['))) {
          try { meta = JSON.parse(t.reference) } catch {}
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
        reference: t.reference
      }
    })

    return NextResponse.json({ items, page, limit, total: typeof count === 'number' ? count : items.length })
  } catch (err) {
    console.error('Admin transactions error:', err)
    return NextResponse.json({ error: 'fetch_failed' }, { status: 500 })
  }
}

export async function PATCH(req: NextRequest) {
  if (!supabaseServer) return NextResponse.json({ error: 'server_configuration_error' }, { status: 500 })
  const supabase = supabaseServer
  const admin = await requireAdminApp(req)
  if (!admin.ok) return NextResponse.json({ error: admin.error || 'unauthorized' }, { status: 401 })
  
  const body = await req.json().catch(() => ({}))
  const parsed = PatchSchema.safeParse(body)
  if (!parsed.success) return NextResponse.json({ error: 'invalid_payload', issues: parsed.error.issues }, { status: 400 })
  const { id, status } = parsed.data

  let tx: any = null;
  let error: any = null;
  const res1 = await supabase.from('Transaction').select('*').eq('id', id).maybeSingle()
  if (res1.error && (res1.error.message.includes('relation "public.Transaction" does not exist') || res1.error.code === '42P01')) {
       const res2 = await supabase.from('transactions').select('*').eq('id', id).maybeSingle()
       if (res2.data) {
           tx = { ...res2.data, userId: res2.data.user_id, investmentId: res2.data.investment_id, createdAt: res2.data.created_at, updatedAt: res2.data.updated_at, amountUsd: res2.data.amount_usd, txHash: res2.data.tx_hash, type: res2.data.type, currency: res2.data.currency }
       }
       error = res2.error;
  } else {
      tx = res1.data; error = res1.error;
  }

  if (error || !tx) return NextResponse.json({ error: 'transaction_not_found' }, { status: 404 })

  const uid = String((tx as any).userId || '')
  const amt = Number((tx as any).amount ?? 0)
  const curr = String((tx as any).currency ?? 'USD')
  const type = String((tx as any).type || '').toUpperCase()

  if (status === 'confirmed') {
    if (type === 'DEPOSIT') {
      let wallet: any = null
      let wq = await supabase.from('Wallet').select('id,balance').eq('userId', uid).eq('currency', curr).maybeSingle()
      if (wq.error && (wq.error.message.includes('relation "public.Wallet" does not exist') || wq.error.code === '42P01')) {
          const wq2 = await supabase.from('wallets').select('id,balance,user_id').eq('user_id', uid).eq('currency', curr).maybeSingle()
          if (wq2.data) wallet = { ...wq2.data, userId: wq2.data.user_id }
      } else { wallet = wq.data }
      
      let walletId: string | null = wallet?.id ? String(wallet.id) : null
      let currentAmount = Number(wallet?.balance || 0)
      
      if (!walletId) {
        const ins = await supabase.from('Wallet').insert({ userId: uid, currency: curr, balance: 0, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }).select('id,balance').maybeSingle()
        if (ins.error && (ins.error.message.includes('relation "public.Wallet" does not exist') || ins.error.code === '42P01')) {
             const ins2 = await supabase.from('wallets').insert({ user_id: uid, currency: curr, balance: 0, created_at: new Date().toISOString(), updated_at: new Date().toISOString() }).select('id,balance').maybeSingle()
             if (ins2.error || !ins2.data) return NextResponse.json({ error: 'wallet_create_failed' }, { status: 500 })
             walletId = String(ins2.data.id); currentAmount = Number(ins2.data.balance || 0)
        } else {
            if (ins.error || !ins.data) return NextResponse.json({ error: 'wallet_create_failed' }, { status: 500 })
            walletId = String(ins.data.id); currentAmount = Number(ins.data.balance || 0)
        }
      }
      const newAmount = Number((currentAmount + amt).toFixed(8))
      const upd = await supabase.from('Wallet').update({ balance: newAmount, updatedAt: new Date().toISOString() }).eq('id', walletId)
      if (upd.error && (upd.error.message.includes('relation "public.Wallet" does not exist') || upd.error.code === '42P01')) {
           const upd2 = await supabase.from('wallets').update({ balance: newAmount, updated_at: new Date().toISOString() }).eq('id', walletId)
           if (upd2.error) return NextResponse.json({ error: 'wallet_update_failed' }, { status: 500 })
      } else if (upd.error) {
           return NextResponse.json({ error: 'wallet_update_failed' }, { status: 500 })
      }
    }
  }
  
  if (status === 'rejected' && type === 'WITHDRAWAL') {
      let wallet: any = null
      let wq = await supabase.from('Wallet').select('*').eq('userId', uid).eq('currency', curr).maybeSingle()
      if (wq.error && (wq.error.message.includes('relation "public.Wallet" does not exist') || wq.error.code === '42P01')) {
          const wq2 = await supabase.from('wallets').select('*').eq('user_id', uid).eq('currency', curr).maybeSingle()
          if (wq2.data) wallet = { ...wq2.data, userId: wq2.data.user_id, id: wq2.data.id, balance: wq2.data.balance }
      } else { wallet = wq.data }
      if (wallet) {
          const newBal = Number(wallet.balance) + amt
          let wUpd = await supabase.from('Wallet').update({ balance: newBal, updatedAt: new Date().toISOString() }).eq('id', wallet.id)
          if (wUpd.error && (wUpd.error.message.includes('relation "public.Wallet" does not exist') || wUpd.error.code === '42P01')) {
               await supabase.from('wallets').update({ balance: newBal, updated_at: new Date().toISOString() }).eq('id', wallet.id)
          }
      }
  }

  let dbStatus = status.toUpperCase()
  if (status === 'confirmed') dbStatus = 'COMPLETED'
  if (status === 'rejected') dbStatus = 'FAILED'

  const { error: updErr } = await supabase.from('Transaction').update({ status: dbStatus, updatedAt: new Date().toISOString() }).eq('id', id)
  if (updErr && (updErr.message.includes('relation "public.Transaction" does not exist') || updErr.code === '42P01')) {
       await supabase.from('transactions').update({ status: dbStatus, updated_at: new Date().toISOString() }).eq('id', id)
  }

  return NextResponse.json({ ok: true })
}
