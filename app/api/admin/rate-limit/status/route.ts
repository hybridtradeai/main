export const dynamic = "force-dynamic";

import { NextRequest } from 'next/server'
import { requireRole } from '@lib/requireRole'
import { redis } from '@lib/redis'

export async function GET(req: NextRequest) {
  const { error } = await requireRole('ADMIN')
  if (error) return new Response(JSON.stringify({ error }), { status: error === 'unauthenticated' ? 401 : 403 })
  const url = new URL(req.url)
  const scope = String(url.searchParams.get('scope') || 'admin')
  const id = url.searchParams.get('id')
  const prefix = scope === 'user' ? 'rl:user:' : 'rl:admin:'
  if (!redis) return new Response(JSON.stringify({ error: 'redis_disabled' }), { status: 503 })

  if (id) {
    const key = `${prefix}${id}`
    const h = await redis.hgetall(key)
    const tokens = Number(h.tokens || '0')
    const timestamp = Number(h.timestamp || '0')
    return new Response(JSON.stringify({ key, tokens, timestamp }), { status: 200 })
  }
  const keys = await redis.keys(`${prefix}*`)
  const items = [] as any[]
  for (let i = 0; i < Math.min(keys.length, 100); i++) {
    const k = keys[i]
    const h = await redis.hgetall(k)
    items.push({ key: k, tokens: Number(h.tokens || '0'), timestamp: Number(h.timestamp || '0') })
  }
  return new Response(JSON.stringify({ items }), { status: 200 })
}

