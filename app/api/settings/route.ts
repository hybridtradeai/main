export const dynamic = "force-dynamic";

import { NextRequest } from 'next/server'
import { supabaseServer } from '@lib/supabaseServer'

export async function GET(_req: NextRequest) {
  const keys = ['maintenance_mode', 'global_notice']
  const g = globalThis as any
  const devMap: Record<string, string> = g.__DEV_SETTINGS || {}
  
  if (!supabaseServer) {
     const map: Record<string, string> = {}
     for (const k of keys) { if (devMap[k] !== undefined) map[k] = String(devMap[k]) }
     return new Response(JSON.stringify({ settings: map }), { status: 200 })
  }
  const supabase = supabaseServer

  try {
    const { data, error } = await supabase.from('settings').select('key,value').in('key', keys)
    if (error) throw error
    const map: Record<string, string> = {}
    for (const row of data || []) { map[String((row as any).key)] = String((row as any).value ?? '') }
    // Merge dev overrides
    for (const k of keys) { if (devMap[k] !== undefined) map[k] = String(devMap[k]) }
    return new Response(JSON.stringify({ settings: map }), { status: 200 })
  } catch {
    const map: Record<string, string> = {}
    for (const k of keys) { if (devMap[k] !== undefined) map[k] = String(devMap[k]) }
    return new Response(JSON.stringify({ settings: map }), { status: 200 })
  }
}
