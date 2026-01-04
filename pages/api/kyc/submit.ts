import type { NextApiRequest, NextApiResponse } from 'next'
import { createRateLimiter } from '../../../lib/rateLimit'
import { supabaseServer } from '../../../lib/supabaseServer'

const limiter = createRateLimiter({ windowMs: 60_000, max: 10 })

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (!supabaseServer) return res.status(500).json({ error: 'server_configuration_error' })
  const supabase = supabaseServer

  if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' })
  if (!(await limiter(req, res, 'kyc-submit'))) return

  try {
    const auth = String(req.headers.authorization || '')
    const token = auth.startsWith('Bearer ') ? auth.slice(7) : ''
    if (!token) return res.status(401).json({ error: 'unauthorized' })
    const { data: userData, error: userErr } = await supabase.auth.getUser(token)
    if (userErr || !userData?.user?.id) return res.status(401).json({ error: 'invalid_token' })
    const userId = String(userData.user.id)

    const levelRaw = (req.body as any)?.level
    const level = typeof levelRaw === 'number' ? levelRaw : 1

    const now = new Date().toISOString()
    const base: any = { user_id: userId, kyc_status: 'pending', kyc_submitted_at: now }
    const full: any = typeof level === 'number' ? { ...base, kyc_level: level } : base
    const minimal: any = { user_id: userId, kyc_status: 'pending' }
    let upsert = await supabase
      .from('profiles')
      .upsert(full, { onConflict: 'user_id' })
      .select('user_id')
      .maybeSingle()
    if (!upsert.error && upsert.data) return res.json({ ok: true })
    upsert = await supabase
      .from('profiles')
      .upsert(base, { onConflict: 'user_id' })
      .select('user_id')
      .maybeSingle()
    if (!upsert.error && upsert.data) return res.json({ ok: true })
    upsert = await supabase
      .from('profiles')
      .upsert(minimal, { onConflict: 'user_id' })
      .select('user_id')
      .maybeSingle()
    if (!upsert.error && upsert.data) return res.json({ ok: true })

    let tryUpdateUser = await supabase
      .from('profiles')
      .update(full)
      .eq('user_id', userId)
      .select('user_id')
      .maybeSingle()
    if (!tryUpdateUser.error && tryUpdateUser.data) return res.json({ ok: true })
    tryUpdateUser = await supabase
      .from('profiles')
      .update(base)
      .eq('user_id', userId)
      .select('user_id')
      .maybeSingle()
    if (!tryUpdateUser.error && tryUpdateUser.data) return res.json({ ok: true })
    tryUpdateUser = await supabase
      .from('profiles')
      .update(minimal)
      .eq('user_id', userId)
      .select('user_id')
      .maybeSingle()
    if (!tryUpdateUser.error && tryUpdateUser.data) return res.json({ ok: true })

    // Skip update by primary key 'id' — not present in this schema

    let insert = await supabase
      .from('profiles')
      .insert(full)
      .select('user_id')
      .maybeSingle()
    if (!insert.error && insert.data) return res.json({ ok: true })
    insert = await supabase
      .from('profiles')
      .insert(base)
      .select('user_id')
      .maybeSingle()
    if (!insert.error && insert.data) return res.json({ ok: true })
    insert = await supabase
      .from('profiles')
      .insert(minimal)
      .select('user_id')
      .maybeSingle()
    if (!insert.error && insert.data) return res.json({ ok: true })

    const message = upsert.error?.message || tryUpdateUser.error?.message || insert.error?.message || 'unknown'
    return res.status(500).json({ error: `submit_failed:${message}` })
  } catch (e: any) {
    return res.status(500).json({ error: e?.message || 'server_error' })
  }
}

export const config = { api: { bodyParser: true } }
