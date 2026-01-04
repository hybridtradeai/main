export const dynamic = "force-dynamic";

import { NextRequest } from 'next/server'
import { supabaseServer } from '@lib/supabaseServer'
import { requireRole } from '@lib/requireRole'

export async function POST(req: NextRequest) {
  if (process.env.NODE_ENV !== 'production') {
    try {
      const body = await req.json().catch(() => ({}))
      const key = String(body?.key || '')
      const value = String(body?.value ?? '')
      const g = globalThis as any
      g.__DEV_SETTINGS = g.__DEV_SETTINGS || {}
      if (!key) return new Response(JSON.stringify({ error: 'invalid_key' }), { status: 400 })
      g.__DEV_SETTINGS[key] = value
      return new Response(JSON.stringify({ ok: true, key, value, dev: true }), { status: 200 })
    } catch {
      // fallthrough to normal path
    }
  }
  const { error } = await requireRole('ADMIN')
  if (error) return new Response(JSON.stringify({ error }), { status: error === 'unauthenticated' ? 401 : 403 })
  const body = await req.json().catch(() => ({}))
  const key = String(body?.key || '')
  const value = String(body?.value ?? '')
  if (!key) return new Response(JSON.stringify({ error: 'invalid_key' }), { status: 400 })

  if (!supabaseServer) return new Response(JSON.stringify({ error: 'server_configuration_error' }), { status: 500 })
  const supabase = supabaseServer
  
  // Try PascalCase Setting table first
  const { error: upsertError } = await supabase.from('Setting').upsert({ key, value })
  
  if (upsertError) {
      // Fallback to lowercase
      if (upsertError.message.includes('relation "public.Setting" does not exist') || upsertError.code === '42P01') {
          const { error: err2 } = await supabase.from('settings').upsert({ key, value })
          if (err2) {
              return new Response(JSON.stringify({ error: 'Settings table missing in database', details: err2 }), { status: 503 })
          }
      } else {
          return new Response(JSON.stringify({ error: 'upsert_failed', details: upsertError }), { status: 500 })
      }
  }

  return new Response(JSON.stringify({ ok: true, key, value }), { status: 200 })
}
