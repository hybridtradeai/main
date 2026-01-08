export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest, NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabaseServer';

const PLAN_ROI: Record<string, number> = { starter: 30, pro: 35, elite: 40 }

export async function GET(req: NextRequest) {
  if (!supabaseServer) return NextResponse.json({ error: 'server_configuration_error' }, { status: 500 })
  const supabase = supabaseServer

  try {
    const auth = req.headers.get('authorization') || ''
    const token = auth.startsWith('Bearer ') ? auth.slice(7) : ''
    if (!token) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
    const { data: userData, error: userErr } = await supabase.auth.getUser(token)
    if (userErr || !userData?.user?.id) return NextResponse.json({ error: 'invalid_token' }, { status: 401 })
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
      const roi = Number(it.plan?.returnPercentage || 0)
      const minPct = roi * 0.9 
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
      .eq('type', 'PROFIT')
      .gte('createdAt', since)

    const titems = Array.isArray(tx) ? tx as any[] : []
    const last30DaysRoiUSD = Number(titems.reduce((s, it) => s + Number(it.amount || 0), 0).toFixed(2))
    const roiCount = titems.length

    return NextResponse.json({
      totalInvestedUSD: Number(totalInvestedUSD.toFixed(2)),
      projectedWeeklyMinUSD,
      projectedWeeklyMaxUSD,
      last30DaysRoiUSD,
      roiCount,
      generatedAt: new Date().toISOString(),
    })
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || 'server_error' }, { status: 500 })
  }
}
