export const dynamic = "force-dynamic";

import { NextRequest } from 'next/server'
import { supabaseServer } from '@lib/supabaseServer'
import { requireRole } from '@lib/requireRole'

export async function GET(req: NextRequest) {
  const { user, error } = await requireRole('ADMIN')
  if (error || !user) return new Response(JSON.stringify({ error: error || 'unauthenticated' }), { status: error === 'unauthenticated' ? 401 : 403 })
  const url = new URL(req.url)
  const scope = String(url.searchParams.get('scope') || 'personal')
  const limit = Math.max(1, Math.min(100, Number(url.searchParams.get('limit') || '50')))
  const unreadOnly = url.searchParams.get('unreadOnly') === 'true'
  const type = url.searchParams.get('type')

  if (!supabaseServer) return new Response(JSON.stringify({ error: 'server_configuration_error' }), { status: 500 })

  if (scope === 'global') {
    // Try PascalCase
    let q = supabaseServer.from('GlobalNotification').select('*').order('createdAt', { ascending: false }).limit(limit)
    if (type) q = q.eq('type', type)
    
    let { data: items, error: err } = await q
    
    if (err && (err.message.includes('relation') || err.code === '42P01')) {
        let q2 = supabaseServer.from('global_notifications').select('*').order('created_at', { ascending: false }).limit(limit)
        if (type) q2 = q2.eq('type', type)
        const res2 = await q2
        if (res2.data) {
             items = res2.data.map((d: any) => ({
                 ...d,
                 createdAt: d.created_at
             }))
        }
        if (res2.error && !items) items = [] // If both fail, return empty
    }
    
    return new Response(JSON.stringify({ items: items || [] }), { status: 200 })
  }

  // Personal
  const userId = String(user.id)
  // Try PascalCase
  let q = supabaseServer.from('Notification').select('*').eq('userId', userId).order('createdAt', { ascending: false }).limit(limit)
  if (unreadOnly) q = q.eq('read', false)
  if (type) q = q.eq('type', type)
  
  let { data: items, error: err } = await q
  
  if (err && (err.message.includes('relation') || err.code === '42P01')) {
      let q2 = supabaseServer.from('notifications').select('*').eq('user_id', userId).order('created_at', { ascending: false }).limit(limit)
      if (unreadOnly) q2 = q2.eq('read', false)
      if (type) q2 = q2.eq('type', type)
      
      const res2 = await q2
      if (res2.data) {
          items = res2.data.map((d: any) => ({
              ...d,
              userId: d.user_id,
              createdAt: d.created_at
          }))
      }
      if (res2.error && !items) items = []
  }

  return new Response(JSON.stringify({ items: items || [] }), { status: 200 })
}
