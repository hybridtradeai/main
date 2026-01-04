import type { NextApiRequest, NextApiResponse } from 'next'
import { supabaseServer } from '@lib/supabaseServer'

const PLAN_ROI: Record<string, number> = { starter: 30, pro: 35, elite: 40 }
function roiRangePct(planId: string) {
  const mid = Number(PLAN_ROI[planId] || PLAN_ROI['starter'] || 0)
  const min = Math.max(0, mid - 5)
  const max = mid + 5
  return { min, max }
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
      .from('Investment')
      .select(`
        principal,
        planId,
        status,
        plan:InvestmentPlan(returnPercentage)
      `)
      .eq('userId', userId)
      .eq('status', 'ACTIVE')

    const items = Array.isArray(inv) ? inv as any[] : []
    const totalInvestedUSD = items.reduce((s, it) => s + Number(it.principal || 0), 0)

    let projectedWeeklyMinUSD = 0
    let projectedWeeklyMaxUSD = 0
    for (const it of items) {
      // Use DB plan returnPercentage if available
      const roi = Number(it.plan?.returnPercentage || 0)
      const minPct = roi * 0.9 // +/- 10% range assumption if we don't have min/max
      const maxPct = roi * 1.1 
      
      projectedWeeklyMinUSD += Number(it.principal || 0) * (minPct / 100)
      projectedWeeklyMaxUSD += Number(it.principal || 0) * (maxPct / 100)
    }
    projectedWeeklyMinUSD = Number(projectedWeeklyMinUSD.toFixed(2))
    projectedWeeklyMaxUSD = Number(projectedWeeklyMaxUSD.toFixed(2))

    const since = new Date(Date.now() - 30 * 24 * 3600_000).toISOString()
    const { data: tx } = await supabase
      .from('Transaction')
      .select('amount,type,createdAt')
      .eq('userId', userId)
      .eq('type', 'PROFIT') // Enum PROFIT? Schema says PROFIT.
      .gte('createdAt', since)

    const titems = Array.isArray(tx) ? tx as any[] : []
    const last30DaysRoiUSD = Number(titems.reduce((s, it) => s + Number(it.amount || 0), 0).toFixed(2))
    const roiCount = titems.length

    return res.status(200).json({
      totalInvestedUSD: Number(totalInvestedUSD.toFixed(2)),
      projectedWeeklyMinUSD,
      projectedWeeklyMaxUSD,
      last30DaysRoiUSD,
      roiCount,
      generatedAt: new Date().toISOString(),
    })
  } catch (e: any) {
    return res.status(500).json({ error: e?.message || 'server_error' })
  }
}

export const config = { api: { bodyParser: false } }
