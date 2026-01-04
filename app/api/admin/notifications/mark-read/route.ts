export const dynamic = "force-dynamic";

import { NextRequest } from 'next/server'
import { supabaseServer } from '@lib/supabaseServer'
import { requireRole } from '@lib/requireRole'

export async function POST(req: NextRequest) {
  const { user, error } = await requireRole('ADMIN')
  if (error || !user) return new Response(JSON.stringify({ error: error || 'unauthenticated' }), { status: error === 'unauthenticated' ? 401 : 403 })
  const body = await req.json()
  const ids: string[] = Array.isArray(body?.ids) ? body.ids : body?.id ? [body.id] : []
  if (!ids.length) return new Response(JSON.stringify({ error: 'invalid' }), { status: 400 })

  if (!supabaseServer) return new Response(JSON.stringify({ error: 'server_configuration_error' }), { status: 500 })

  // Try PascalCase
  const { error: err1 } = await supabaseServer.from('Notification').update({ read: true }).in('id', ids).eq('userId', String(user.id))
  
  if (err1 && (err1.message.includes('relation') || err1.code === '42P01')) {
      // Fallback
      await supabaseServer.from('notifications').update({ read: true }).in('id', ids).eq('user_id', String(user.id))
  }
  
  return new Response(JSON.stringify({ ok: true }), { status: 200 })
}
