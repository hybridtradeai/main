export const dynamic = "force-dynamic";

import { NextRequest } from 'next/server'
import { supabaseServer, supabaseServiceReady } from '@lib/supabaseServer'
import { requireRole } from '@lib/requireRole'
import { publish } from '@lib/sse'

function isUuid(v: string) {
  return /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$/.test(v)
}

async function createNotification(userId: string, type: string, title: string, message: string) {
    if (!supabaseServer) return null
    const supabase = supabaseServer
    const now = new Date().toISOString()
    const nData = { userId, type, title, message, createdAt: now }
    
    // Try PascalCase
    const { data: n1, error: err1 } = await supabase.from('Notification').insert(nData).select().single()
    
    if (err1 && (err1.message.includes('relation') || err1.code === '42P01')) {
        // Fallback
        const { data: n2 } = await supabase.from('notifications').insert({
            user_id: userId,
            type,
            title,
            message,
            created_at: now
        }).select().single()
        
        if (n2) return { ...n2, userId: n2.user_id, createdAt: n2.created_at }
    } else if (n1) {
        return n1
    }
    return null
}

export async function GET(req: NextRequest) {
  const { error } = await requireRole('ADMIN', req)
  if (error) return new Response(JSON.stringify({ error }), { status: error === 'unauthenticated' ? 401 : 403 })

  if (!supabaseServer) return new Response(JSON.stringify({ error: 'server_configuration_error' }), { status: 500 })
  const supabase = supabaseServer

  // Try PascalCase with relations
  const { data: d1, error: err1 } = await supabase
    .from('SupportTicket')
    .select('id,userId,subject,status,createdAt, User(email), Reply(id,body,isAdmin,createdAt)')
    .order('createdAt', { ascending: false })

  if (!err1) {
      // Map to expected format
      const items = (d1 || []).map((t: any) => ({
          id: t.id,
          user_id: t.userId,
          subject: t.subject,
          status: t.status,
          created_at: t.createdAt,
          profiles: t.User, // Map User -> profiles
          replies: (t.Reply || []).map((r: any) => ({
              id: r.id,
              body: r.body,
              is_admin: r.isAdmin,
              created_at: r.createdAt
          }))
      }))
      return new Response(JSON.stringify({ items }), { status: 200 })
  }

  // Fallback: Manual Join Strategy (Robust against relation errors)
  console.warn('SupportTicket relation fetch failed, trying manual join:', err1.message)

  // 1. Fetch Tickets (Try PascalCase first, then snake_case)
  let tickets = []
  let isSnake = false
  
  const { data: t1, error: tErr1 } = await supabase
      .from('SupportTicket')
      .select('id,userId,subject,status,createdAt')
      .order('createdAt', { ascending: false })
  
  if (!tErr1) {
      tickets = t1
  } else {
      // Try snake_case
      const { data: t2, error: tErr2 } = await supabase
          .from('support_tickets')
          .select('id,user_id,subject,status,created_at')
          .order('created_at', { ascending: false })
      
      if (tErr2) {
           return new Response(JSON.stringify({ error: `Failed to fetch tickets: ${tErr1.message} | ${tErr2.message}` }), { status: 500 })
      }
      tickets = t2
      isSnake = true
  }

  // 2. Fetch Users
  const userIds = [...new Set(tickets.map((t: any) => isSnake ? t.user_id : t.userId))]
  let usersMap: Record<string, any> = {}
  
  if (userIds.length > 0) {
      // Try 'User'
      const { data: u1, error: uErr1 } = await supabase.from('User').select('id,email').in('id', userIds)
      if (!uErr1) {
          (u1 || []).forEach((u: any) => usersMap[u.id] = u)
      } else {
          // Try 'users'
          const response = await supabase.from('users').select('id,email').in('id', userIds)
          const u2 = response.data
          if (u2) {
              (u2 as any[]).forEach((u: any) => usersMap[u.id] = u)
          }
      }
  }

  // 3. Fetch Replies
  const ticketIds = tickets.map((t: any) => t.id)
  let repliesMap: Record<string, any[]> = {}
  
  if (ticketIds.length > 0) {
      // Try 'Reply'
      const { data: r1, error: rErr1 } = await supabaseServer
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
          const response = await supabaseServer
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

  // 4. Combine
  const items = tickets.map((t: any) => {
      const uid = isSnake ? t.user_id : t.userId
      const tid = t.id
      return {
          id: tid,
          user_id: uid,
          subject: t.subject,
          status: t.status,
          created_at: isSnake ? t.created_at : t.createdAt,
          profiles: usersMap[uid] || { email: 'unknown' },
          replies: repliesMap[tid] || []
      }
  })

  return new Response(JSON.stringify({ items }), { status: 200 })
}

export async function POST(req: NextRequest) {
  const { user, error } = await requireRole('ADMIN', req)
  if (error) return new Response(JSON.stringify({ error }), { status: error === 'unauthenticated' ? 401 : 403 })
  
  if (!supabaseServer) return new Response(JSON.stringify({ error: 'server_configuration_error' }), { status: 500 })
  const supabase = supabaseServer
  
  const body = await req.json().catch(() => ({}))
  
  // Handle new ticket creation from admin
  if (body?.userId && body?.subject && body?.body) {
    const userId = String(body.userId)
    const subject = String(body.subject)
    const message = String(body.body)
    
    // Create ticket
    // Try PascalCase
    let ticket: any = null
    const { data: t1, error: tErr1 } = await supabase
        .from('SupportTicket')
        .insert({ userId, subject, status: 'open' })
        .select()
        .single()
    
    if (tErr1 && (tErr1.message.includes('relation') || tErr1.code === '42P01')) {
        const { data: t2, error: tErr2 } = await supabase
          .from('support_tickets')
          .insert({ user_id: userId, subject, status: 'open' })
          .select()
          .single()
        if (tErr2 || !t2) return new Response(JSON.stringify({ error: 'create_failed', details: tErr2 }), { status: 500 })
        ticket = { ...t2, userId: t2.user_id }
    } else if (t1) {
        ticket = t1
    } else {
        return new Response(JSON.stringify({ error: 'create_failed', details: tErr1 }), { status: 500 })
    }
    
    // Create first message
    // Try PascalCase
    const { error: mErr1 } = await supabase
        .from('Reply')
        .insert({ ticketId: ticket.id, body: message, isAdmin: true })
        
    if (mErr1 && (mErr1.message.includes('relation') || mErr1.code === '42P01')) {
        const { error: msgErr } = await supabase
          .from('replies')
          .insert({ ticket_id: ticket.id, body: message, is_admin: true })
        if (msgErr) return new Response(JSON.stringify({ error: 'message_failed', details: msgErr }), { status: 500 })
    } else if (mErr1) {
        return new Response(JSON.stringify({ error: 'message_failed', details: mErr1 }), { status: 500 })
    }

    // Notify user
    const note = await createNotification(userId, 'support_reply', `Support: ${subject}`, message)
    try { await publish(`user:${userId}`, { id: note?.id || `support:${Date.now()}`, type: 'support_reply', title: `Support: ${subject}`, message, createdAt: new Date().toISOString() }) } catch {}

    return new Response(JSON.stringify({ ok: true, ticketId: ticket.id }), { status: 200 })
  }

  const ticketId = String(body?.ticketId || '')
  const replyBody = String(body?.body || '')
  if (!ticketId || !replyBody) return new Response(JSON.stringify({ error: 'invalid' }), { status: 400 })
  
  // Get ticket to find userId
  let ticket: any = null
  const { data: t1, error: tErr1 } = await supabase.from('SupportTicket').select('id,userId').eq('id', ticketId).maybeSingle()
  
  if (tErr1 && (tErr1.message.includes('relation') || tErr1.code === '42P01')) {
      const { data: t2, error: tErr2 } = await supabase.from('support_tickets').select('id,user_id').eq('id', ticketId).maybeSingle()
      if (tErr2 || !t2) return new Response(JSON.stringify({ error: 'ticket_not_found' }), { status: 404 })
      ticket = { ...t2, userId: t2.user_id }
  } else if (t1) {
      ticket = t1
  } else {
      return new Response(JSON.stringify({ error: 'ticket_not_found' }), { status: 404 })
  }

  // Insert reply
  const { error: rErr1 } = await supabaseServer.from('Reply').insert({ ticketId: ticketId, body: replyBody, isAdmin: true })
  
  if (rErr1 && (rErr1.message.includes('relation') || rErr1.code === '42P01')) {
      const { error: insErr } = await supabaseServer.from('replies').insert({ ticket_id: ticketId, body: replyBody, is_admin: true })
      if (insErr) return new Response(JSON.stringify({ error: 'reply_failed', details: insErr }), { status: 500 })
  } else if (rErr1) {
      return new Response(JSON.stringify({ error: 'reply_failed', details: rErr1 }), { status: 500 })
  }
  
  const note = await createNotification(String(ticket.userId), 'support_reply', 'Support Reply', replyBody)
  try { await publish(`user:${String(ticket.userId)}`, { id: note?.id || `support:${Date.now()}`, type: 'support_reply', title: 'Support Reply', message: replyBody, createdAt: new Date().toISOString() }) } catch {}
  return new Response(JSON.stringify({ ok: true }), { status: 200 })
}

export async function PATCH(req: NextRequest) {
  const { user, error } = await requireRole('ADMIN', req)
  if (error) return new Response(JSON.stringify({ error }), { status: error === 'unauthenticated' ? 401 : 403 })
  
  if (!supabaseServer) return new Response(JSON.stringify({ error: 'server_configuration_error' }), { status: 500 })
  const supabase = supabaseServer
  
  const body = await req.json().catch(() => ({}))
  const ticketId = String(body?.ticketId || '')
  const status = String(body?.status || '')
  if (!ticketId || !status) return new Response(JSON.stringify({ error: 'invalid' }), { status: 400 })
  
  let ticket: any = null
  const { data: t1, error: tErr1 } = await supabase.from('SupportTicket').select('id,userId').eq('id', ticketId).maybeSingle()
  
  if (tErr1 && (tErr1.message.includes('relation') || tErr1.code === '42P01')) {
      const { data: t2 } = await supabase.from('support_tickets').select('id,user_id').eq('id', ticketId).maybeSingle()
      if (t2) ticket = { ...t2, userId: t2.user_id }
      
      const { error: updErr } = await supabase.from('support_tickets').update({ status }).eq('id', ticketId)
      if (updErr) return new Response(JSON.stringify({ error: 'update_failed', details: updErr }), { status: 500 })
  } else {
      ticket = t1
      const { error: updErr } = await supabase.from('SupportTicket').update({ status }).eq('id', ticketId)
      if (updErr) {
          if (updErr.message.includes('relation') || updErr.code === '42P01') {
              // Should have been caught by select, but just in case
               const { error: updErr2 } = await supabase.from('support_tickets').update({ status }).eq('id', ticketId)
               if (updErr2) return new Response(JSON.stringify({ error: 'update_failed', details: updErr2 }), { status: 500 })
          } else {
              return new Response(JSON.stringify({ error: 'update_failed', details: updErr }), { status: 500 })
          }
      }
  }

  if (ticket?.userId) {
    const msg = status === 'closed' ? 'Your support ticket was closed.' : 'Your support ticket status changed.'
    const note = await createNotification(String(ticket.userId), 'support_status', 'Support Update', msg)
    try { await publish(`user:${String(ticket.userId)}`, { id: note?.id || `support:${Date.now()}`, type: 'support_status', title: 'Support Update', message: msg, createdAt: new Date().toISOString() }) } catch {}
  }
  return new Response(JSON.stringify({ ok: true }), { status: 200 })
}
