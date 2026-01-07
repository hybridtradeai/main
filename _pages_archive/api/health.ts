
import { NextRequest } from 'next/server'
import { createClient } from '@supabase/supabase-js'

export const config = {
  runtime: 'edge',
}

export default async function handler(req: NextRequest) {
  const start = Date.now()
  const results: any = {
    status: 'ok',
    timestamp: new Date().toISOString(),
    env: process.env.NODE_ENV,
    checks: {}
  }

  try {
    // 1. Check Supabase Connectivity
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
    const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY! // Use service key for health check to ensure backend access
    
    if (!supabaseUrl || !supabaseKey) {
        throw new Error('Missing Supabase Credentials')
    }

    const supabase = createClient(supabaseUrl, supabaseKey)
    
    // Simple query
    const { data, error } = await supabase.from('User').select('count', { count: 'exact', head: true })
    
    if (error && error.code !== 'PGRST116') { // PGRST116 is no rows, which is fine for count? No, count returns data.
        // Try 'users' fallback
        const { error: error2 } = await supabase.from('users').select('count', { count: 'exact', head: true })
        if (error2) throw error
    }

    results.checks.database = { status: 'connected', latency: Date.now() - start }
    
    // 2. Check Manual Credit Config
    results.checks.features = {
        manual_credits: process.env.ENABLE_MANUAL_CREDITS === 'true',
    }

    return new Response(JSON.stringify(results), {
      status: 200,
      headers: {
        'content-type': 'application/json',
        'cache-control': 'no-store'
      }
    })
  } catch (e: any) {
    results.status = 'error'
    results.error = e.message
    return new Response(JSON.stringify(results), { status: 503 })
  }
}
