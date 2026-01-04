import { NextRequest } from 'next/server'
import { supabaseServer, supabaseServiceReady } from '@lib/supabaseServer'
import { requireRole } from '@lib/requireRole'
import { publish } from '@lib/sse'

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const { user, error } = await requireRole('USER', req)
  if (error || !user) return new Response(JSON.stringify({ error: error || 'unauthenticated' }), { status: error === 'unauthenticated' ? 401 : 403 })
  
  if (!supabaseServer) return new Response(JSON.stringify({ error: 'server_configuration_error' }), { status: 500 })
  const supabase = supabaseServer

  // Robust fetch with fallback and manual join if needed
  let tickets = []
  let isSnake = false

  // 1. Try PascalCase
  const { data: t1, error: tErr1 } = await supabase
    .from('SupportTicket')
    .select('id,userId,subject,status,createdAt, Reply(id,body,isAdmin,createdAt)')
    .eq('userId', String(user.id))
    .order('createdAt', { ascending: false })

  if (!tErr1) {
      const items = (t1 || []).map((t: any) => ({
          id: t.id,
          user_id: t.userId,
          subject: t.subject,
          status: t.status,
          created_at: t.createdAt,
          replies: (t.Reply || []).map((r: any) => ({
              id: r.id,
              body: r.body,
              is_admin: r.isAdmin,
              created_at: r.createdAt
          }))
      }))
      return new Response(JSON.stringify({ items }), { status: 200 })
  }

  // 2. Fallback: Manual Join or snake_case
  // Try PascalCase without relations first (if relation failed)
  let tData = []
  const { data: tRaw, error: tRawErr } = await supabase
      .from('SupportTicket')
      .select('id,userId,subject,status,createdAt')
      .eq('userId', String(user.id))
      .order('createdAt', { ascending: false })
  
  if (!tRawErr) {
      tData = tRaw
  } else {
      // Try snake_case
      const { data: t2, error: tErr2 } = await supabase
        .from('support_tickets')
        .select('id,user_id,subject,status,created_at')
        .eq('user_id', String(user.id))
        .order('created_at', { ascending: false })
      
      if (tErr2) return new Response(JSON.stringify({ error: tErr2 }), { status: 500 })
      tData = t2
      isSnake = true
  }

  // Fetch Replies manually
  const ticketIds = tData.map((t: any) => t.id)
  let repliesMap: Record<string, any[]> = {}
  
  if (ticketIds.length > 0) {
      // Try 'Reply'
      const { data: r1, error: rErr1 } = await supabase
        .from('Reply')
        .select('id,ticketId,body,isAdmin,createdAt')
        .in('ticketId', ticketIds)
        .order('createdAt', { ascending: true })
        
      if (!rErr1) {
          (r1 || []).forEach((r: any) => {
              if (!repliesMap[r.ticketId]) repliesMap[r.ticketId] = []
              repliesMap[r.ticketId].push({
                  id: r.id,
                  body: r.body,
                  is_admin: r.isAdmin,
                  created_at: r.createdAt
              })
          })
      } else {
          // Try 'replies'
          const response = await supabase
            .from('replies')
            .select('id,ticket_id,body,is_admin,created_at')
            .in('ticket_id', ticketIds)
            .order('created_at', { ascending: true })
            
          const r2 = response.data
          if (r2) {
              (r2 as any[]).forEach((r: any) => {
                  if (!repliesMap[r.ticket_id]) repliesMap[r.ticket_id] = []
                  repliesMap[r.ticket_id].push({
                      id: r.id,
                      body: r.body,
                      is_admin: r.is_admin,
                      created_at: r.created_at
                  })
              })
          }
      }
  }

  const items = tData.map((t: any) => {
      const tid = t.id
      return {
          id: tid,
          user_id: isSnake ? t.user_id : t.userId,
          subject: t.subject,
          status: t.status,
          created_at: isSnake ? t.created_at : t.createdAt,
          replies: repliesMap[tid] || []
      }
  })

  return new Response(JSON.stringify({ items }), { status: 200 })
}

export async function POST(req: NextRequest) {
  const { user, error } = await requireRole('USER', req)
  if (error || !user) return new Response(JSON.stringify({ error: error || 'unauthenticated' }), { status: error === 'unauthenticated' ? 401 : 403 })
  
  if (!supabaseServer) return new Response(JSON.stringify({ error: 'server_configuration_error' }), { status: 500 })
  const supabase = supabaseServer

  const body = await req.json().catch(() => ({}))
  const ticketId = String(body?.ticketId || '')
  const replyBody = String(body?.body || '')
  const subject = String(body?.subject || '')
  const message = String(body?.message || '')
  if (!subject && !message && !ticketId && !replyBody) return new Response(JSON.stringify({ error: 'invalid' }), { status: 400 })
  if (ticketId && replyBody) {
    // Try PascalCase first
    let ticket: any = null
    const { data: t1, error: tErr1 } = await supabase
      .from('SupportTicket')
      .select('id,userId,status')
      .eq('id', ticketId)
      .maybeSingle()

    if (tErr1 && (tErr1.message.includes('relation') || tErr1.code === '42P01' || tErr1.message.includes('schema cache'))) {
      const { data: t2, error: tErr2 } = await supabase
        .from('support_tickets')
        .select('id,user_id,status')
        .eq('id', ticketId)
        .maybeSingle()
      if (tErr2 || !t2) return new Response(JSON.stringify({ error: 'ticket_not_found' }), { status: 404 })
      ticket = { ...t2, userId: t2.user_id }
    } else if (t1) {
        ticket = t1
    } else {
        return new Response(JSON.stringify({ error: 'ticket_not_found' }), { status: 404 })
    }

    if (String(ticket.userId) !== String(user.id)) return new Response(JSON.stringify({ error: 'ticket_not_found' }), { status: 404 })
    if (String(ticket.status) === 'closed') return new Response(JSON.stringify({ error: 'ticket_closed' }), { status: 409 })

    // Try PascalCase for Reply
    const { error: mErr1 } = await supabase
      .from('Reply')
      .insert({ ticketId: ticketId, body: replyBody, isAdmin: false })

    if (mErr1 && (mErr1.message.includes('relation') || mErr1.code === '42P01' || mErr1.message.includes('schema cache'))) {
      const { error: insErr } = await supabase.from('replies').insert({ ticket_id: ticketId, body: replyBody, is_admin: false })
      if (insErr) return new Response(JSON.stringify({ error: String(insErr?.message || 'reply_failed') }), { status: 500 })
    } else if (mErr1) {
      return new Response(JSON.stringify({ error: String(mErr1?.message || 'reply_failed') }), { status: 500 })
    }

    try { await publish(`admin:broadcast`, { id: `support:${Date.now()}`, type: 'support_reply', userId: String(user.id), ticketId, message: replyBody }) } catch {}
    return new Response(JSON.stringify({ ok: true }), { status: 200 })
  }
  if (!subject || !message) return new Response(JSON.stringify({ error: 'invalid' }), { status: 400 })
  const email = String((user as any)?.email || '')
  try { await supabase.from('profiles').upsert({ user_id: String(user.id), email: email || null }, { onConflict: 'user_id' }) } catch {}
  
  // Try PascalCase for Create Ticket
  let ticket: any = null
  const { data: t1, error: tErr1 } = await supabase
    .from('SupportTicket')
    .insert({ userId: String(user.id), subject, status: 'open' })
    .select()
    .maybeSingle()
  
  if (tErr1 && (tErr1.message.includes('relation') || tErr1.code === '42P01' || tErr1.message.includes('schema cache'))) {
    // Fallback
    const { data: t2, error: tErr2 } = await supabase
      .from('support_tickets')
      .insert({ user_id: String(user.id), subject, status: 'open' })
      .select()
      .maybeSingle()
    if (!t2?.id) return new Response(JSON.stringify({ error: String(tErr2?.message || 'create_failed') }), { status: 500 })
    ticket = { ...t2, userId: t2.user_id }
  } else if (t1) {
      ticket = t1
  } else {
      return new Response(JSON.stringify({ error: String(tErr1?.message || 'create_failed') }), { status: 500 })
  }

  // Insert initial reply
  const { error: repErr1 } = await supabase.from('Reply').insert({ ticketId: String(ticket.id), body: message, isAdmin: false })
  
  if (repErr1 && (repErr1.message.includes('relation') || repErr1.code === '42P01' || repErr1.message.includes('schema cache'))) {
      const { error: repErr2 } = await supabase.from('replies').insert({ ticket_id: String(ticket.id), body: message, is_admin: false })
      if (repErr2) return new Response(JSON.stringify({ error: String(repErr2?.message || 'reply_failed') }), { status: 500 })
  } else if (repErr1) {
      return new Response(JSON.stringify({ error: String(repErr1?.message || 'reply_failed') }), { status: 500 })
  }

  try { await publish(`admin:broadcast`, { id: `support:${Date.now()}`, type: 'support_ticket', userId: String(user.id), subject, message, ticketId: ticket.id }) } catch {}
  return new Response(JSON.stringify({ ok: true, ticketId: ticket.id }), { status: 200 })
}
