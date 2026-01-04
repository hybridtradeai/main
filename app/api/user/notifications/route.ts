export const dynamic = "force-dynamic";

import { NextRequest } from 'next/server'
import { requireRole } from '@lib/requireRole'
import { supabaseServer, supabaseServiceReady } from '@lib/supabaseServer'

export async function GET(req: NextRequest) {
  if (!supabaseServer) {
    return new Response(JSON.stringify({ items: [] }), { status: 200 })
  }
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
  const limit = Number(url.searchParams.get('limit') ?? '20')
  const sinceParam = url.searchParams.get('since')
  const unreadOnly = url.searchParams.get('unreadOnly') === 'true'
  const type = url.searchParams.get('type')
  let query = supabase
    .from('Notification')
    .select('*')
    .eq('userId', userId)
  
  if (unreadOnly) query = query.eq('read', false)
  if (type) query = query.eq('type', type)
  if (sinceParam) {
    const since = new Date(sinceParam)
    if (!isNaN(since.getTime())) query = query.gt('createdAt', since.toISOString())
  }
  
  const { data: items, error: dbError } = await query
    .order('createdAt', { ascending: false })
    .limit(Math.max(1, Math.min(100, limit)))
  
  if (dbError) {
    return new Response(JSON.stringify({ error: dbError.message }), { status: 500 })
  }
  return new Response(JSON.stringify({ items }), { status: 200 })
}
