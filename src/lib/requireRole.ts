import { NextRequest } from 'next/server'
import { supabaseServer } from './supabaseServer'
import { headers } from 'next/headers'

export async function requireRole(role: 'USER' | 'ADMIN', req?: NextRequest) {
  let token = ''
  
  if (req) {
    const auth = req.headers.get('Authorization') || ''
    token = auth.startsWith('Bearer ') ? auth.slice(7).trim() : ''
  } else {
    // Fallback to next/headers if req is not provided
    try {
        const headerList = headers()
        const auth = headerList.get('Authorization') || ''
        token = auth.startsWith('Bearer ') ? auth.slice(7).trim() : ''
    } catch (e) {
        // headers() might fail if not in a request context (e.g. static generation)
        return { user: null, error: 'unauthenticated' }
    }
  }
  
  if (!token) return { user: null, error: 'unauthenticated' }
  
  if (!supabaseServer) return { user: null, error: 'server_configuration_error' }

  const { data: { user }, error: userErr } = await supabaseServer.auth.getUser(token)
  
  if (userErr || !user) return { user: null, error: 'unauthenticated' }
  
  if (role === 'ADMIN') {
    const { data: profile } = await supabaseServer
      .from('profiles')
      .select('role,is_admin')
      .eq('user_id', user.id)
      .maybeSingle()
      
    const userRole = String(profile?.role || '').toLowerCase()
    const isAdmin = Boolean(profile?.is_admin) || userRole === 'admin'
    
    if (!isAdmin) return { user: null, error: 'forbidden' }
  }
  
  return { user, error: null }
}
