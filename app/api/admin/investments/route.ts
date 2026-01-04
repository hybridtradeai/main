import { NextRequest } from 'next/server'
import { supabaseServer } from '@lib/supabaseServer'
import { publish } from '@lib/sse'
import { requireRole } from '@lib/requireRole'

export async function GET(req: NextRequest) {
  const { error } = await requireRole('ADMIN')
  if (error) return new Response(JSON.stringify({ error }), { status: error === 'unauthenticated' ? 401 : 403 })
  const url = new URL(req.url)
  const status = url.searchParams.get('status')
  const userId = url.searchParams.get('userId')
  const take = Math.max(1, Math.min(100, Number(url.searchParams.get('limit') ?? '50')))

  if (!supabaseServer) return new Response(JSON.stringify({ error: 'server_configuration_error' }), { status: 500 })

  // Try PascalCase
  let q = supabaseServer.from('Investment').select('*').order('createdAt', { ascending: false }).limit(take)
  if (status) q = q.eq('status', status)
  if (userId) q = q.eq('userId', userId)

  let result = await q;

  if (result.error && (result.error.message.includes('relation "public.Investment" does not exist') || result.error.code === '42P01')) {
       // Fallback to lowercase
       let q2 = supabaseServer.from('investments').select('*').order('created_at', { ascending: false }).limit(take)
       if (status) q2 = q2.eq('status', status)
       if (userId) q2 = q2.eq('user_id', userId)
       
       result = await q2;
       
       if (result.data) {
           result.data = result.data.map((d: any) => ({
               ...d,
               userId: d.user_id,
               planId: d.plan_id,
               createdAt: d.created_at,
               updatedAt: d.updated_at,
               startDate: d.start_date,
               roiMinPct: d.roi_min_pct,
               payoutFrequency: d.payout_frequency
           }))
       }
  }

  if (result.error) {
      return new Response(JSON.stringify({ error: result.error.message }), { status: 500 })
  }

  const mapped = (result.data || []).map((i: any) => ({
    ...i,
    amount: i.principal // Map principal to amount for backward compatibility
  }))
  return new Response(JSON.stringify({ items: mapped }), { status: 200 })
}

export async function PATCH(req: NextRequest) {
  const { error: authErr } = await requireRole('ADMIN')
  if (authErr) return new Response(JSON.stringify({ error: authErr }), { status: authErr === 'unauthenticated' ? 401 : 403 })
  const body = await req.json()
  const id = String(body?.id || '')
  const action = String(body?.action || '')
  if (!id || !action) return new Response(JSON.stringify({ error: 'invalid' }), { status: 400 })

  if (!supabaseServer) return new Response(JSON.stringify({ error: 'server_configuration_error' }), { status: 500 })

  if (action === 'approve') {
    let inv: any = null;
    let upd = await supabaseServer.from('Investment').update({ status: 'ACTIVE' }).eq('id', id).select().single()
    
    if (upd.error && (upd.error.message.includes('relation "public.Investment" does not exist') || upd.error.code === '42P01')) {
         const upd2 = await supabaseServer.from('investments').update({ status: 'ACTIVE' }).eq('id', id).select().single()
         if (upd2.data) {
             inv = {
               ...upd2.data,
               userId: upd2.data.user_id,
               createdAt: upd2.data.created_at
             }
         }
         if (upd2.error) return new Response(JSON.stringify({ error: upd2.error.message }), { status: 500 })
    } else if (upd.error) {
         return new Response(JSON.stringify({ error: upd.error.message }), { status: 500 })
    } else {
         inv = upd.data
    }

    try {
      const crypto = require('crypto')
      const nData = { id: crypto.randomUUID(), userId: String(inv.userId), type: 'investment_status', title: 'Investment Approved', message: 'Your investment is now active.', read: false, createdAt: new Date().toISOString() }
      
      const nIns = await supabaseServer.from('Notification').insert(nData).select().single()
      let n = nIns.data;
      if (nIns.error && (nIns.error.message.includes('relation "public.Notification" does not exist') || nIns.error.code === '42P01')) {
           const nIns2 = await supabaseServer.from('notifications').insert({ ...nData, user_id: nData.userId, created_at: nData.createdAt }).select().single()
           if (nIns2.data) n = { ...nIns2.data, userId: nIns2.data.user_id, createdAt: nIns2.data.created_at }
      }
      
      if (n) {
          await publish(`user:${String(inv.userId)}`, { id: n.id, type: n.type, title: n.title, message: n.message, createdAt: n.createdAt })
      }
    } catch {}
    return new Response(JSON.stringify({ ok: true, investment: inv }), { status: 200 })
  }
  
  if (action === 'settle') {
    let inv: any = null;
    const now = new Date().toISOString()
    let upd = await supabaseServer.from('Investment').update({ status: 'MATURED', maturedAt: now }).eq('id', id).select().single()
    
    if (upd.error && (upd.error.message.includes('relation "public.Investment" does not exist') || upd.error.code === '42P01')) {
         const upd2 = await supabaseServer.from('investments').update({ status: 'MATURED', matured_at: now }).eq('id', id).select().single()
         if (upd2.data) {
             inv = {
               ...upd2.data,
               userId: upd2.data.user_id,
               createdAt: upd2.data.created_at
             }
         }
         if (upd2.error) return new Response(JSON.stringify({ error: upd2.error.message }), { status: 500 })
    } else if (upd.error) {
         return new Response(JSON.stringify({ error: upd.error.message }), { status: 500 })
    } else {
         inv = upd.data
    }

    try {
      const crypto = require('crypto')
      const nData = { id: crypto.randomUUID(), userId: String(inv.userId), type: 'investment_status', title: 'Investment Matured', message: 'Your investment has matured.', read: false, createdAt: new Date().toISOString() }
      
      const nIns = await supabaseServer.from('Notification').insert(nData).select().single()
      let n = nIns.data;
      if (nIns.error && (nIns.error.message.includes('relation "public.Notification" does not exist') || nIns.error.code === '42P01')) {
           const nIns2 = await supabaseServer.from('notifications').insert({ ...nData, user_id: nData.userId, created_at: nData.createdAt }).select().single()
           if (nIns2.data) n = { ...nIns2.data, userId: nIns2.data.user_id, createdAt: nIns2.data.created_at }
      }
      
      if (n) {
          await publish(`user:${String(inv.userId)}`, { id: n.id, type: n.type, title: n.title, message: n.message, createdAt: n.createdAt })
      }
    } catch {}
    return new Response(JSON.stringify({ ok: true, investment: inv }), { status: 200 })
  }
  return new Response(JSON.stringify({ error: 'unknown_action' }), { status: 400 })
}
