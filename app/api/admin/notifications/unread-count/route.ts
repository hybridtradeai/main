export const dynamic = "force-dynamic";

import { NextRequest } from 'next/server'
import { supabaseServer } from '@lib/supabaseServer'
import { requireRole } from '@lib/requireRole'

export async function GET(req: NextRequest) {
  const { error } = await requireRole('ADMIN')
  if (error) return new Response(JSON.stringify({ error }), { status: error === 'unauthenticated' ? 401 : 403 })
  const url = new URL(req.url)
  const type = url.searchParams.get('type')
  
  if (!supabaseServer) return new Response(JSON.stringify({ error: 'server_configuration_error' }), { status: 500 })

  // Total count
  let total = 0
  let query = supabaseServer.from('Notification').select('*', { count: 'exact', head: true }).eq('read', false)
  if (type) query = query.eq('type', type)
  
  const { count: c1, error: err1 } = await query
  
  if (err1 && (err1.message.includes('relation') || err1.code === '42P01')) {
      let q2 = supabaseServer.from('notifications').select('*', { count: 'exact', head: true }).eq('read', false)
      if (type) q2 = q2.eq('type', type)
      const { count: c2 } = await q2
      total = c2 || 0
  } else {
      total = c1 || 0
  }

  // Group by type (fetch all types of unread notifications and aggregate in JS)
  // This is not as efficient as SQL GROUP BY but works without raw SQL access
  const unreadByType: Record<string, number> = {}
  
  // Try PascalCase
  const { data: d1, error: e1 } = await supabaseServer.from('Notification').select('type').eq('read', false)
  
  let rows = d1
  if (e1 && (e1.message.includes('relation') || e1.code === '42P01')) {
      const { data: d2 } = await supabaseServer.from('notifications').select('type').eq('read', false)
      rows = d2
  }
  
  if (rows) {
      for (const row of rows) {
          const t = row.type || 'unknown'
          unreadByType[t] = (unreadByType[t] || 0) + 1
      }
  }

  return new Response(JSON.stringify({ total, unreadByType }), { status: 200 })
}
