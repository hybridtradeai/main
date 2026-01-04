export const dynamic = "force-dynamic";

import { NextRequest } from 'next/server'
import { supabaseServer } from '@lib/supabaseServer'
import { requireRole } from '@lib/requireRole'
import { subscribe } from '@lib/sse'

function sse(data: any, id?: string, event?: string) {
  const payload = typeof data === 'string' ? data : JSON.stringify(data)
  const idLine = id ? `id: ${id}\n` : ''
  const eventLine = event ? `event: ${event}\n` : ''
  return new TextEncoder().encode(`${idLine}${eventLine}data: ${payload}\n\n`)
}

export async function GET(req: NextRequest) {
  const { user, error } = await requireRole('ADMIN')
  if (error || !user) return new Response(JSON.stringify({ error: error || 'unauthenticated' }), { status: error === 'unauthenticated' ? 401 : 403 })

  if (!supabaseServer) return new Response(JSON.stringify({ error: 'server_configuration_error' }), { status: 500 })

  const supabase = supabaseServer
  const adminId = String(user.id)
  const lastEventId = new URL(req.url).searchParams.get('lastEventId')
  const lastDate = lastEventId ? new Date(lastEventId) : null

  const stream = new ReadableStream({
    async start(controller) {
      const heartbeat = setInterval(() => controller.enqueue(new TextEncoder().encode(`:hb\n\n`)), 25000)

      if (lastDate && !isNaN(lastDate.getTime())) {
        const isoDate = lastDate.toISOString()
        
        // Fetch globals
        // Try PascalCase
        let { data: globals, error: gErr } = await supabase
            .from('GlobalNotification')
            .select('*')
            .gt('createdAt', isoDate)
            .order('createdAt', { ascending: true })
            .limit(100)
            
        if (gErr && (gErr.message.includes('relation') || gErr.code === '42P01')) {
            const { data: g2 } = await supabase
                .from('global_notifications')
                .select('*')
                .gt('created_at', isoDate)
                .order('created_at', { ascending: true })
                .limit(100)
            
            if (g2) {
                globals = g2.map((d: any) => ({ ...d, createdAt: d.created_at }))
            }
        }
        
        for (const g of (globals || [])) {
            controller.enqueue(sse({ type: g.type, title: g.title, message: g.message, createdAt: g.createdAt }, g.id, 'global'))
        }

        // Fetch personals
        // Try PascalCase
        let { data: personals, error: pErr } = await supabase
            .from('Notification')
            .select('*')
            .eq('userId', adminId)
            .gt('createdAt', isoDate)
            .order('createdAt', { ascending: true })
            .limit(100)
            
        if (pErr && (pErr.message.includes('relation') || pErr.code === '42P01')) {
            const { data: p2 } = await supabase
                .from('notifications')
                .select('*')
                .eq('user_id', adminId)
                .gt('created_at', isoDate)
                .order('created_at', { ascending: true })
                .limit(100)
                
            if (p2) {
                personals = p2.map((d: any) => ({ ...d, userId: d.user_id, createdAt: d.created_at }))
            }
        }

        for (const n of (personals || [])) {
            controller.enqueue(sse(n, n.id, 'personal'))
        }
      }

      const unsubBroadcast = subscribe('broadcast', (payload) => {
        controller.enqueue(sse(payload, payload.id ?? undefined, 'global'))
      })
      const adminChannel = `admin:${adminId}`
      const unsubAdmin = subscribe(adminChannel, (payload) => {
        controller.enqueue(sse(payload, payload.id ?? undefined, 'personal'))
      })

      controller.enqueue(new TextEncoder().encode(`:connected\n\n`))

      ;(req as any).signal?.addEventListener?.('abort', () => {
        clearInterval(heartbeat)
        unsubBroadcast()
        unsubAdmin()
        controller.close()
      })
    },
    cancel() {},
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
    },
  })
}
