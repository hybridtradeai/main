export const dynamic = "force-dynamic";

import { NextRequest } from 'next/server'
import { supabaseServer } from '@lib/supabaseServer'
import { requireRole } from '@lib/requireRole'
import { adminRateLimit } from '@lib/rate-limit/redis-token-bucket'
import { publish } from '@lib/sse'
import { broadcastQueue } from '@lib/queue/broadcastQueue'
import crypto from 'crypto'

export async function POST(req: NextRequest) {
  const { user, error } = await requireRole('ADMIN')
  if (error || !user) return new Response(JSON.stringify({ error: error || 'unauthenticated' }), { status: error === 'unauthenticated' ? 401 : 403 })
  const allowed = await adminRateLimit.allow(String(user.id))
  if (!allowed) return new Response(JSON.stringify({ error: 'rate_limited' }), { status: 429 })
  const body = await req.json()
  const type = String(body?.type || 'info')
  const title = String(body?.title || '')
  const message = String(body?.message || '')
  if (!title || !message) return new Response(JSON.stringify({ error: 'invalid' }), { status: 400 })

  if (!supabaseServer) return new Response(JSON.stringify({ error: 'server_configuration_error' }), { status: 500 })

  const id = crypto.randomUUID()
  const now = new Date().toISOString()
  const data = { id, type, title, message, createdAt: now }
  
  let g = null
  const { data: g1, error: err1 } = await supabaseServer.from('GlobalNotification').insert(data).select().single()
  
  if (err1 && (err1.message.includes('relation') || err1.code === '42P01')) {
      const { data: g2, error: err2 } = await supabaseServer.from('global_notifications').insert({
          id,
          type,
          title,
          message,
          created_at: now
      }).select().single()
      
      if (g2) {
          g = { ...g2, createdAt: g2.created_at }
      } else {
          // If insert fails, maybe return error
          return new Response(JSON.stringify({ error: 'db_error', details: err2 }), { status: 500 })
      }
  } else if (err1) {
      return new Response(JSON.stringify({ error: 'db_error', details: err1 }), { status: 500 })
  } else {
      g = g1
  }

  if (g) {
      await publish('broadcast', { id: g.id, type: g.type, title: g.title, message: g.message, createdAt: g.createdAt })
      await broadcastQueue.add(
        'broadcast',
        { globalNotificationId: g.id },
        { attempts: 3, backoff: { type: 'exponential', delay: 5000 } }
      )
      return new Response(JSON.stringify({ ok: true, id: g.id }), { status: 200 })
  }
  return new Response(JSON.stringify({ error: 'unknown_error' }), { status: 500 })
}
