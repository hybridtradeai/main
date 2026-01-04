export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from 'next/server'
import { supabaseServer } from '@lib/supabaseServer'

const DISPLAY_NAME: Record<string, string> = {
  trading: 'High Frequency Trading',
  copy_trading: 'Copy Trading',
  ai: 'AI Arbitrage',
  staking_yield: 'Staking Yield',
  ads_tasks: 'Ads & Tasks'
}

export async function GET(req: NextRequest) {
  try {
    if (!supabaseServer) {
        return NextResponse.json({ error: 'server_configuration_error' }, { status: 500 })
    }
    const supabase = supabaseServer

    const now = Date.now()
    const dayAgoISO = new Date(now - 24 * 60 * 60 * 1000).toISOString()

    const { data, error } = await supabase
      .from('TradeLog')
      .select('streamId, profitPct, simulatedAt')
      .gte('simulatedAt', dayAgoISO)
      .order('simulatedAt', { ascending: false })

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    const trades = Array.isArray(data) ? data : []
    const agg: Record<string, { count: number; sum: number }> = {}
    for (const t of trades as any[]) {
      const k = String(t.streamId || '').trim() || 'trading'
      const roi = Number(t.profitPct || 0)
      if (!agg[k]) agg[k] = { count: 0, sum: 0 }
      agg[k].count += 1
      agg[k].sum += roi
    }

    let bestKey = ''
    let bestAvg = -Infinity
    const stats: Record<string, { avg: number; count: number; name: string }> = {}
    for (const [k, v] of Object.entries(agg)) {
      const avg = v.count ? v.sum / v.count : 0
      stats[k] = { avg, count: v.count, name: DISPLAY_NAME[k] || k }
      if (avg > bestAvg) { bestAvg = avg; bestKey = k }
    }

    const best = bestKey ? { key: bestKey, name: DISPLAY_NAME[bestKey] || bestKey, avg: Number(bestAvg.toFixed(3)) } : null

    return NextResponse.json({ stats, best }, { status: 200 })
  } catch (e: any) {
    return NextResponse.json({ error: 'internal_error', details: e?.message || 'error' }, { status: 500 })
  }
}
