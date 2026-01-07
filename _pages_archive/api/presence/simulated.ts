import type { NextApiRequest, NextApiResponse } from 'next'
import { supabaseServer } from '@lib/supabaseServer'
import { redis } from '../../../src/lib/redis'

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n))
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (!supabaseServer) return res.status(500).json({ error: 'server_configuration_error' })
  const supabase = supabaseServer

  try {
    const since1h = new Date(Date.now() - 3600_000).toISOString()

    let recentTx: any[] = []
    try {
      const { data } = await supabase
        .from('Transaction')
        .select('userId,type,amount,createdAt')
        .gte('createdAt', since1h)
        .order('createdAt', { ascending: false })
      recentTx = Array.isArray(data) ? (data as any[]) : []
    } catch {}

    const activeUserIds = Array.from(new Set(recentTx.map((t) => String(t.userId || '')))).filter(Boolean)
    let baseCount = 0
    try {
      if (activeUserIds.length) {
        const { data } = await supabase
          .from('Investment')
          .select('userId,status')
          .in('userId', activeUserIds)
          .eq('status', 'ACTIVE') // Enum ACTIVE
        const items = Array.isArray(data) ? (data as any[]) : []
        const ids = new Set(items.map((it) => String(it.userId)))
        baseCount = ids.size
      }
    } catch {}

    let last = 0
    try {
      const raw = redis ? await redis.get('presence:simulated:last') : null
      last = Number(raw || 0) || 0
    } catch {}

    const drift = Math.round((Math.random() - 0.5) * 4)
    const approx = clamp(baseCount + drift, 0, baseCount + 7)
    try {
      if (redis) await redis.set('presence:simulated:last', String(approx))
    } catch {}

    return res.status(200).json({
      source: 'simulated',
      generatedAt: new Date().toISOString(),
      activeTradersApprox: approx,
      baseCount,
    })
  } catch (e: any) {
    return res.status(500).json({ error: e?.message || 'server_error' })
  }
}

export const config = { api: { bodyParser: false } }
