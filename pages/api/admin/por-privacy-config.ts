import type { NextApiRequest, NextApiResponse } from 'next'
import { redis } from '../../../src/lib/redis'
import { requireAdmin } from '../../../lib/adminAuth'

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const check = await requireAdmin(req)
  if (!check.ok) return res.status(403).json({ error: check.error || 'forbidden' })
  if (req.method === 'GET') {
    const raw = redis ? await redis.get('por:dp') : null
    const cfg = raw ? JSON.parse(String(raw)) : null
    return res.status(200).json({ config: cfg })
  }
  if (req.method === 'PUT' || req.method === 'PATCH') {
    const epsilon = Number((req.body as any)?.epsilon ?? 0.5)
    const sensitivity = Number((req.body as any)?.sensitivity ?? 1000)
    const cfg = { epsilon, sensitivity, updatedAt: new Date().toISOString() }
    if (redis) await redis.set('por:dp', JSON.stringify(cfg))
    return res.status(200).json({ ok: true, config: cfg })
  }
  return res.status(405).json({ error: 'method_not_allowed' })
}

export const config = { api: { bodyParser: true } }
