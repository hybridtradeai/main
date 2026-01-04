export const dynamic = "force-dynamic";

import { NextRequest } from 'next/server'
import { requireRole } from '@lib/requireRole'
import { supabaseServer } from '@lib/supabaseServer'

export async function POST(req: NextRequest) {
  if (!supabaseServer) return new Response(JSON.stringify({ error: 'server_configuration_error' }), { status: 500 })
  const supabase = supabaseServer

  const url = new URL(req.url)
  let userId = ''
  const token = url.searchParams.get('token') || req.headers.get('authorization')?.replace(/^Bearer\s+/i, '') || ''
  if (token) {
    const { data, error } = await supabase.auth.getUser(token)
    if (!error && data?.user?.id) userId = String(data.user.id)
  }
  if (!userId) {
    const { user, error } = await requireRole('USER', req)
    if (error || !user) return new Response(JSON.stringify({ error: error || 'unauthenticated' }), { status: error === 'unauthenticated' ? 401 : 403 })
    userId = String(user.id)
  }
  const body = await req.json()
  const ids: string[] = Array.isArray(body?.ids) ? body.ids : body?.id ? [body.id] : []
  if (!ids.length) return new Response(JSON.stringify({ error: 'invalid' }), { status: 400 })
  const { error } = await supabase
    .from('Notification')
    .update({ read: true })
    .eq('userId', userId)
    .in('id', ids)
  
  if (error) {
    return new Response(JSON.stringify({ error: error.message }), { status: 500 })
  }
  return new Response(JSON.stringify({ ok: true }), { status: 200 })
}
