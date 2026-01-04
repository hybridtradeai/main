export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from 'next/server'
import { requireRole } from '../../../../src/lib/requireRole'
import { supabaseServer } from '../../../../src/lib/supabaseServer'

export async function GET(req: NextRequest) {
  const { user, error } = await requireRole('USER', req)
  if (error || !user) return NextResponse.json({ error: error || 'unauthenticated' }, { status: error === 'unauthenticated' ? 401 : 403 })

  if (!supabaseServer) return NextResponse.json({ error: 'server_configuration_error' }, { status: 500 })
  const supabase = supabaseServer
  
  const url = new URL(req.url)
  const page = Math.max(1, Number(url.searchParams.get('page') || '1'))
  const limit = Math.min(100, Math.max(1, Number(url.searchParams.get('limit') || '25')))
  const status = String(url.searchParams.get('status') || '')
  
  // Prefer lowercase snake_case table first (matches README schema)
  let queryLow = supabase
      .from('investments')
      .select('*, plan:investment_plans(*)', { count: 'exact' })
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })
      .range((page - 1) * limit, page * limit - 1)

  if (status) queryLow = queryLow.eq('status', status.toLowerCase())

  let { data: items, count: total, error: dbError } = await queryLow

  // Fallback to PascalCase tables if primary fails
  if (dbError) {
    console.warn('[Investments API] Lowercase table fetch failed, trying PascalCase:', dbError.message)
    let query = supabase
      .from('Investment')
      .select('*, plan:InvestmentPlan(*)', { count: 'exact' })
      .eq('userId', user.id)
      .order('createdAt', { ascending: false })
      .range((page - 1) * limit, page * limit - 1)
    if (status) query = query.eq('status', status.toUpperCase())
    const res = await query
    items = res.data
    total = res.count
    
    // Normalize PascalCase items (specifically principal -> amount)
    if (items) {
        items = items.map((i: any) => ({
            ...i,
            amount: i.principal || i.amount || 0, // Prefer principal
            status: String(i.status || '').toUpperCase(),
            plan: i.plan ? {
                ...i.plan,
                slug: i.plan.slug || (i.plan.name ? i.plan.name.toLowerCase().includes('pro') ? 'pro' : i.plan.name.toLowerCase().includes('elite') ? 'elite' : 'starter' : 'starter'),
                roiMinPct: i.plan.returnPercentage || i.plan.roiMinPct || 0,
                roiMaxPct: i.plan.returnPercentage || i.plan.roiMaxPct || 0
            } : null
        }))
    }
  }

  // Normalize snake_case to camelCase for frontend compatibility when using lowercase table
  if (items && items.length > 0 && 'user_id' in (items[0] || {})) {
    items = items.map((i: any) => ({
      id: i.id,
      userId: i.user_id,
      planId: i.plan_id,
      amount: i.amount_usd,
      status: String(i.status || '').toUpperCase(),
      payoutFrequency: i.payout_frequency || 'WEEKLY',
      createdAt: i.created_at,
      plan: i.plan ? {
        id: i.plan.id,
        slug: i.plan.slug || (i.plan.name ? i.plan.name.toLowerCase().includes('pro') ? 'pro' : i.plan.name.toLowerCase().includes('elite') ? 'elite' : 'starter' : 'starter'),
        name: i.plan.name,
        minAmount: i.plan.min_amount,
        maxAmount: i.plan.max_amount,
        roiMinPct: i.plan.return_percentage || i.plan.roi_min_pct || 0,
        roiMaxPct: i.plan.return_percentage || i.plan.roi_max_pct || 0
      } : null
    }))
  }

  return NextResponse.json({ items: items || [], total: total || 0, page, limit }, { status: 200 })
}
