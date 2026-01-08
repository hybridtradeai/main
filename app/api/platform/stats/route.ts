export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest, NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabaseServer';
import { redis } from '@/src/lib/redis';
import { getTransparencySummary } from '@/lib/transparencyLogic';

function toNumber(x: any) {
  const n = Number(x)
  return isFinite(n) ? n : 0
}

export async function GET(req: NextRequest) {
  if (!supabaseServer) return NextResponse.json({ error: 'server_configuration_error' }, { status: 500 })
  const supabase = supabaseServer

  try {
    const since1h = new Date(Date.now() - 3600_000).toISOString()
    
    let usersJoined = 0
    try {
      const { count } = await supabase.from('profiles').select('id', { count: 'exact', head: true })
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

    const live = await getTransparencySummary();

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
    return NextResponse.json(payload)
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || 'server_error' }, { status: 500 })
  }
}
