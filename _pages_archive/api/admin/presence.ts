import type { NextApiRequest, NextApiResponse } from 'next'
import { redis } from '../../../src/lib/redis'
import { requireAdmin } from '../../../lib/adminAuth'

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const check = await requireAdmin(req)
  if (!check.ok) return res.status(403).json({ error: check.error || 'forbidden' })
  try {
    const now = Date.now()
    const key = 'presence:users'
    let count = 0
    let entries: { userId: string; ts: number }[] = []
    try {
      if (redis) {
        const c = await redis.zcount(key, now - 60_000, '+inf')
        count = Number(c || 0)
        const raw = await redis.zrevrange(key, 0, 50, 'WITHSCORES')
        for (let i = 0; i < raw.length; i += 2) {
          entries.push({ userId: String(raw[i]), ts: Number(raw[i + 1]) })
        }
      }
    } catch {}
    return res.status(200).json({ generatedAt: new Date().toISOString(), activeCount: count, entries })
  } catch (e: any) {
    return res.status(500).json({ error: e?.message || 'server_error' })
  }
}

export const config = { api: { bodyParser: false } }

