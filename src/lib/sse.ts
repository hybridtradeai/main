import type Redis from 'ioredis'
import { pub, sub, redisEnabled } from './redis'

export async function publish(channel: string, payload: unknown) {
  const data = JSON.stringify(payload)
  if (!redisEnabled || !pub) return
  try { await pub.publish(channel, data) } catch {}
}

export function subscribe(channel: string, handler: (payload: any) => void, client: Redis | null = sub) {
  if (!redisEnabled || !client) return () => {}
  try { 
    const p: any = (client as any).subscribe(channel)
    if (p && typeof p.then === 'function') { p.catch(() => {}) }
  } catch {}
  const onMessage = (ch: string, message: string) => {
    if (ch !== channel) return
    try {
      handler(JSON.parse(message))
    } catch {
      handler(message)
    }
  }
  client.on('message', onMessage)
  return () => {
    client.off('message', onMessage)
    try { 
      const u: any = (client as any).unsubscribe(channel)
      if (u && typeof u.then === 'function') { u.catch(() => {}) }
    } catch {}
  }
}

export const HEARTBEAT_MS = 25000

export function encodeSSE(data: any, id?: string, event?: string) {
  const payload = typeof data === 'string' ? data : JSON.stringify(data)
  const idLine = id ? `id: ${id}\n` : ''
  const eventLine = event ? `event: ${event}\n` : ''
  return new TextEncoder().encode(`${idLine}${eventLine}data: ${payload}\n\n`)
}
