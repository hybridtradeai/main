import type { NextAuthOptions } from 'next-auth'
import { getServerSession } from 'next-auth'
import { supabaseServer } from '@lib/supabaseServer'

export async function getCurrentUser(authOptions?: NextAuthOptions) {
  if (!supabaseServer) return null
  const supabase = supabaseServer

  const session = authOptions ? await getServerSession(authOptions) : await (getServerSession as any)()
  const s = session?.user as any
  if (!s) return null
  const id = String(s.id || '')
  const email = String(s.email || '')

  if (id) {
    const { data: u1, error: e1 } = await supabase.from('User').select('*').eq('id', id).maybeSingle()
    if (!e1 && u1) return u1
    if (e1 && (e1.message.includes('relation') || e1.code === '42P01')) {
      const { data: u2 } = await supabase.from('users').select('*').eq('id', id).maybeSingle()
      if (u2) return { ...u2, id: u2.id, email: u2.email, role: u2.role, name: u2.name, image: u2.image, emailVerified: u2.email_verified }
    }
  }
  
  if (email) {
    const { data: u1, error: e1 } = await supabase.from('User').select('*').eq('email', email).maybeSingle()
    if (!e1 && u1) return u1
    if (e1 && (e1.message.includes('relation') || e1.code === '42P01')) {
      const { data: u2 } = await supabase.from('users').select('*').eq('email', email).maybeSingle()
      if (u2) return { ...u2, id: u2.id, email: u2.email, role: u2.role, name: u2.name, image: u2.image, emailVerified: u2.email_verified }
    }
  }

  return null
}

