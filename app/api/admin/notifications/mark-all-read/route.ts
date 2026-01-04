export const dynamic = "force-dynamic";

import { NextRequest } from 'next/server'
import { supabaseServer } from '@lib/supabaseServer'
import { requireRole } from '@lib/requireRole'
import { publish } from '@lib/sse'

export async function POST(req: NextRequest) {
  const { user, error } = await requireRole('ADMIN')
  if (error || !user) return new Response(JSON.stringify({ error: error || 'unauthenticated' }), { status: error === 'unauthenticated' ? 401 : 403 })
  const body = await req.json().catch(() => ({}))
  const type = String(body?.type || '')
  const beforeStr = String(body?.before || '')
  const before = beforeStr ? new Date(beforeStr) : null
  
  if (!supabaseServer) return new Response(JSON.stringify({ error: 'server_configuration_error' }), { status: 500 })

  // Try PascalCase
  let query = supabaseServer.from('Notification').update({ read: true }).eq('userId', String(user.id))
  if (type) query = query.eq('type', type)
  if (before && !isNaN(before.getTime())) query = query.lt('createdAt', before.toISOString())
  
  const { error: err1 } = await query
  
  if (err1 && (err1.message.includes('relation') || err1.code === '42P01')) {
      // Fallback
      let q2 = supabaseServer.from('notifications').update({ read: true }).eq('user_id', String(user.id))
      if (type) q2 = q2.eq('type', type)
      if (before && !isNaN(before.getTime())) q2 = q2.lt('created_at', before.toISOString())
      await q2
  }

  await publish(`admin:${String(user.id)}`, { id: `read:${Date.now()}`, type: 'admin_read', title: '', message: '' })
  return new Response(JSON.stringify({ ok: true }), { status: 200 })
}
