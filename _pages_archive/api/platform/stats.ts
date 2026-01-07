import type { NextApiRequest, NextApiResponse } from 'next'
import { supabaseServer } from '@lib/supabaseServer'
import summary from '../transparency'
import { redis } from '../../../src/lib/redis'

function toNumber(x: any) {
  const n = Number(x)
  return isFinite(n) ? n : 0
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (!supabaseServer) return res.status(500).json({ error: 'server_configuration_error' })
  const supabase = supabaseServer

  try {
    const since1h = new Date(Date.now() - 3600_000).toISOString()
    const since24h = new Date(Date.now() - 24 * 3600_000).toISOString()

    let usersJoined = 0
    try {
      const { count } = await supabase
        .from('profiles')
        .select('id', { count: 'exact', head: true })
      usersJoined = Number(count || 0)
    } catch {}

    let recentTx: any[] = []
    try {
      const { data } = await supabase
        .from('Transaction')
        .select('userId,type,amount,createdAt')
        .gte('createdAt', since1h)
        .order('createdAt', { ascending: false })
      recentTx = Array.isArray(data) ? data as any[] : []
    } catch {}

    const activityCounts = {
      lastHour: recentTx.length,
      deposits: recentTx.filter((t) => String(t.type).toUpperCase() === 'DEPOSIT').length,
      withdrawals: recentTx.filter((t) => String(t.type).toUpperCase() === 'WITHDRAWAL').length,
      roiCredits: recentTx.filter((t) => String(t.type).toUpperCase() === 'PROFIT').length,
    }

    // Active traders online approximation: users with a transaction in last hour AND at least one active investment
    const activeUserIds = Array.from(new Set(recentTx.map((t) => String(t.userId || '')))).filter(Boolean)
    let activeTradersOnline = 0
    try {
      if (activeUserIds.length) {
        const { data } = await supabase
          .from('Investment')
          .select('userId,status')
          .in('userId', activeUserIds)
          .eq('status', 'ACTIVE')
        const items = Array.isArray(data) ? data as any[] : []
        const ids = new Set(items.map((it) => String(it.userId)))
        activeTradersOnline = ids.size
      }
    } catch {}

    // Pull current reserve/AUM summary using existing transparency handler
    const live = await new Promise<any>((resolve) => {
      const fakeRes = {
        status: (_: number) => fakeRes,
        json: (payload: any) => resolve(payload),
      } as any
      ;(summary as any)(req, fakeRes)
    })

    let presenceCount = activeTradersOnline
    try {
      if (redis) {
        const now = Date.now()
        const c = await redis.zcount('presence:users', now - 60_000, '+inf')
        presenceCount = Math.max(Number(c || 0), activeTradersOnline)
      }
    } catch {}

    const payload = {
      generatedAt: new Date().toISOString(),
      usersJoined,
      activeTradersOnline: presenceCount,
      activity: activityCounts,
      aumUSD: toNumber(live?.aumUSD || 0),
      reserveUSD: toNumber(live?.reserveBuffer?.currentAmount || 0),
      walletsUSDTotal: toNumber(live?.walletsUSDTotal || 0),
      coveragePct: toNumber(live?.coveragePct || 0),
    }
    return res.status(200).json(payload)
  } catch (e: any) {
    return res.status(500).json({ error: e?.message || 'server_error' })
  }
}

export const config = { api: { bodyParser: false } }
