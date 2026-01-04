import type { NextApiRequest, NextApiResponse } from 'next'
import { supabaseServer } from '@lib/supabaseServer'
import { redis } from '../../../src/lib/redis'

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (!supabaseServer) return res.status(500).json({ error: 'server_configuration_error' })
  const supabase = supabaseServer

  try {
    const auth = String(req.headers.authorization || '')
    const token = auth.startsWith('Bearer ') ? auth.slice(7) : ''
    if (!token) return res.status(401).json({ error: 'unauthorized' })
    const { data: userData, error: userErr } = await supabase.auth.getUser(token)
    if (userErr || !userData?.user?.id) return res.status(401).json({ error: 'invalid_token' })
    const userId = String(userData.user.id)

    const now = Date.now()
    const key = 'presence:users'
    try {
      if (redis) {
        await redis.zadd(key, now, userId)
        await redis.zremrangebyscore(key, 0, now - 70_000)
      }
    } catch {}

    return res.status(200).json({ ok: true, ts: new Date(now).toISOString() })
  } catch (e: any) {
    return res.status(500).json({ error: e?.message || 'server_error' })
  }
}

export const config = { api: { bodyParser: false } }

