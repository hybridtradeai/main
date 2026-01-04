export const dynamic = "force-dynamic";

import { NextRequest } from 'next/server'
import { supabaseServer } from '@lib/supabaseServer'
import { runBaselineCycle, runStreamDistribution } from '@lib/profit/engine'
import { requireRole } from '@lib/requireRole'

export async function POST(req: NextRequest) {
  const { error } = await requireRole('ADMIN')
  if (error) return new Response(JSON.stringify({ error }), { status: error === 'unauthenticated' ? 401 : 403 })
  
  if (!supabaseServer) return new Response(JSON.stringify({ error: 'server_configuration_error' }), { status: 500 })

  const url = new URL(req.url)
  const body = await req.json().catch(() => ({}))
  const dryRun = body?.dryRun === true || String(url.searchParams.get('dryRun') || '').toLowerCase() === 'true'
  const weekEnding = body?.weekEnding || url.searchParams.get('weekEnding') || new Date().toISOString()
  const mode = String(body?.mode || url.searchParams.get('mode') || 'baseline')
  if (!dryRun) {
    const week = new Date(weekEnding)
    // Check ProfitLog with fallback
    let existingCount = 0
    const { count: c1, error: err1 } = await supabaseServer.from('ProfitLog').select('*', { count: 'exact', head: true }).eq('weekEnding', week.toISOString())
    
    if (err1 && (err1.message.includes('relation "public.ProfitLog" does not exist') || err1.code === '42P01')) {
         const { count: c2 } = await supabaseServer.from('profit_logs').select('*', { count: 'exact', head: true }).eq('week_ending', week.toISOString())
         existingCount = c2 || 0
    } else {
         existingCount = c1 || 0
    }

    if (existingCount > 0) return new Response(JSON.stringify({ error: 'already_distributed' }), { status: 409 })
  }
  if (mode === 'baseline') {
    const result = await runBaselineCycle({ weekEnding, dryRun })
    return new Response(JSON.stringify(result), { status: 200 })
  }
  if (mode === 'stream') {
    const performance = body?.performance || {}
    const result = await runStreamDistribution({ weekEnding, performance, dryRun })
    return new Response(JSON.stringify(result), { status: 200 })
  }
  return new Response(JSON.stringify({ error: 'invalid_mode' }), { status: 400 })
}
