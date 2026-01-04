import type { NextApiRequest, NextApiResponse } from 'next'
import { supabaseServer } from '@lib/supabaseServer'

const PLATFORM_FEE_PERCENT = Number(process.env.PLATFORM_FEE_PERCENT ?? 7)
const PLAN_BASELINE_ROI: Record<string, number> = { starter: 15, pro: 22, elite: 35 }

const ALLOCATIONS: Record<string, Record<string, number>> = {
  starter: { ads_tasks: 0.70, trading: 0.30 },
  pro: { trading: 0.60, copy_trading: 0.25, ads_tasks: 0.15 },
  elite: { trading: 0.50, staking_yield: 0.30, copy_trading: 0.20 },
}

function weightedRoiPct(planId: string, streams: Record<string, number> | null): number {
  const alloc = ALLOCATIONS[planId] || ALLOCATIONS['starter']
  if (!streams) return PLAN_BASELINE_ROI[planId] ?? PLAN_BASELINE_ROI['starter']
  let pct = 0
  for (const [k, w] of Object.entries(alloc)) {
    const s = Number(streams[k] ?? 0)
    pct += w * s
  }
  return Number(pct.toFixed(4))
}

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

    const { data: inv } = await supabase
      .from('investments')
      .select('amount_usd,plan_id,status')
      .eq('user_id', userId)
      .eq('status', 'active')

    const items = Array.isArray(inv) ? inv as any[] : []
    const totalInvestedUSD = items.reduce((s, it) => s + Number(it.amount_usd || 0), 0)

    const { data: perfRow } = await supabase
      .from('performance')
      .select('week_ending,stream_rois')
      .order('week_ending', { ascending: false })
      .limit(1)
      .maybeSingle()

    const streams = perfRow?.stream_rois || null

    let owedUSD = 0
    let planRois: Record<string, number> = {}
    for (const it of items) {
      const planId = String(it.plan_id || 'starter')
      const roiPct = weightedRoiPct(planId, streams)
      planRois[planId] = roiPct
      const gross = Number(it.amount_usd || 0) * roiPct / 100
      const net = gross * (1 - PLATFORM_FEE_PERCENT / 100)
      owedUSD += net
    }
    owedUSD = Number(owedUSD.toFixed(2))
    const roiPct = totalInvestedUSD > 0 ? Number(((owedUSD / totalInvestedUSD) * 100).toFixed(2)) : 0

    return res.status(200).json({
      roiPct,
      owedUSD,
      totalInvestedUSD: Number(totalInvestedUSD.toFixed(2)),
      weekEnding: perfRow?.week_ending || null,
      streams: streams || null,
      planRois,
      feePct: PLATFORM_FEE_PERCENT,
      generatedAt: new Date().toISOString(),
    })
  } catch (e: any) {
    return res.status(500).json({ error: e?.message || 'server_error' })
  }
}

export const config = { api: { bodyParser: false } }

