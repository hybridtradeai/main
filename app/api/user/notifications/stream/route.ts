export const dynamic = "force-dynamic";

import { NextRequest } from 'next/server'
import { requireRole } from '@lib/requireRole'
import { supabaseServer, supabaseServiceReady } from '@lib/supabaseServer'
import { subscribe } from '@lib/sse'

function sse(data: any, id?: string, event?: string) {
  const payload = typeof data === 'string' ? data : JSON.stringify(data)
  const idLine = id ? `id: ${id}\n` : ''
  const eventLine = event ? `event: ${event}\n` : ''
  return new TextEncoder().encode(`${idLine}${eventLine}data: ${payload}\n\n`)
}

export async function GET(req: NextRequest) {
  if (!supabaseServer) {
    return new Response(JSON.stringify({ error: 'server_configuration_error' }), { status: 500 })
  }
  const supabase = supabaseServer

  let userId = ''
  const url = new URL(req.url)
  const token = url.searchParams.get('token') || ''
  if (token) {
    const { data, error } = await supabase.auth.getUser(token)
    if (!error && data?.user?.id) userId = String(data.user.id)
  }
  if (!userId) {
    const { user, error } = await requireRole('USER', req)
    if (error || !user) return new Response(JSON.stringify({ error: error || 'unauthenticated' }), { status: error === 'unauthenticated' ? 401 : 403 })
    userId = String(user.id)
  }
  const lastEventId = url.searchParams.get('lastEventId')
  const lastDate = lastEventId ? new Date(lastEventId) : null

  const stream = new ReadableStream({
    async start(controller) {
      const heartbeat = setInterval(() => controller.enqueue(new TextEncoder().encode(`:hb\n\n`)), 25000)

      if (lastDate && !isNaN(lastDate.getTime())) {
        const { data: personals, error } = await supabase
          .from('Notification')
          .select('*')
          .eq('userId', userId)
          .gt('createdAt', lastDate.toISOString())
          .order('createdAt', { ascending: true })
          .limit(100)
        
        if (!error && personals) {
          for (const n of personals) controller.enqueue(sse(n, n.id, 'personal'))
        }
      }

      const channel = `user:${userId}`
      const unsubUser = subscribe(channel, (payload) => {
        controller.enqueue(sse(payload, payload.id ?? undefined, 'personal'))
      })
      const unsubGlobal = subscribe('broadcast', (payload) => {
        controller.enqueue(sse(payload, payload.id ?? undefined, 'global'))
      })

      controller.enqueue(new TextEncoder().encode(`:connected\n\n`))

      ;(req as any).signal?.addEventListener?.('abort', () => {
        clearInterval(heartbeat)
        unsubUser()
        unsubGlobal()
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
