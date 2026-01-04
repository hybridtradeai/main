export const dynamic = "force-dynamic";

import { NextRequest } from 'next/server'
import { supabaseServer } from '@lib/supabaseServer'
import { requireRole } from '@lib/requireRole'

export async function POST(req: NextRequest) {
  const { error } = await requireRole('ADMIN')
  if (error) return new Response(JSON.stringify({ error }), { status: error === 'unauthenticated' ? 401 : 403 })
  const body = await req.json().catch(() => ({}))
  const fee_percent = Number(body?.fee_percent)
  const reserve_percent = Number(body?.reserve_percent)
  const cycle_length_days = Number(body?.cycle_length_days)
  const kv: Record<string, string> = {
    fee_percent: isFinite(fee_percent) ? String(fee_percent) : '5',
    reserve_percent: isFinite(reserve_percent) ? String(reserve_percent) : '10',
    cycle_length_days: isFinite(cycle_length_days) ? String(cycle_length_days) : '7',
  }

  if (!supabaseServer) return new Response(JSON.stringify({ error: 'server_configuration_error' }), { status: 500 })
  
  for (const [key, value] of Object.entries(kv)) {
    // Try PascalCase Setting table first
    const { error } = await supabaseServer.from('Setting').upsert({ key, value })
    
    if (error) {
        // If table missing, try lowercase 'settings' as fallback
        if (error.message.includes('relation "public.Setting" does not exist') || error.code === '42P01') {
             const { error: err2 } = await supabaseServer.from('settings').upsert({ key, value })
             if (err2) {
                 return new Response(JSON.stringify({ error: 'Settings table missing in database. Changes cannot be saved.' }), { status: 503 })
             }
        } else {
             return new Response(JSON.stringify({ error: error.message }), { status: 500 })
        }
    }
  }
  return new Response(JSON.stringify({ ok: true, config: kv }), { status: 200 })
}

export async function GET(req: NextRequest) {
  const { error } = await requireRole('ADMIN')
  if (error) return new Response(JSON.stringify({ error }), { status: error === 'unauthenticated' ? 401 : 403 })

  if (!supabaseServer) return new Response(JSON.stringify({ error: 'server_configuration_error' }), { status: 500 })
  const supabase = supabaseServer

  let config: Record<string, number> = {
    fee_percent: 5,
    reserve_percent: 10,
    cycle_length_days: 7
  }

  // Try PascalCase Setting first
  const { data, error: err } = await supabase.from('Setting').select('key,value')
  
  let rows = data
  if (err && (err.message.includes('relation "public.Setting" does not exist') || err.code === '42P01')) {
     // Fallback to lowercase
     const { data: d2 } = await supabase.from('settings').select('key,value')
     rows = d2
  }

  if (rows && rows.length > 0) {
      for (const row of rows) {
          if (row.key in config) {
              config[row.key] = Number(row.value)
          }
      }
  }

  return new Response(JSON.stringify({ ok: true, config }), { status: 200 })
}

