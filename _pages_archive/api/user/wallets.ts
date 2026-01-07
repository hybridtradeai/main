import type { NextApiRequest, NextApiResponse } from 'next'
import { supabaseServer } from '../../../lib/supabaseServer'

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (!supabaseServer) return res.status(500).json({ error: 'server_configuration_error' })
  const supabase = supabaseServer

  if (req.method !== 'GET') return res.status(405).json({ error: 'method_not_allowed' })
  try {
    const auth = String(req.headers.authorization || '')
    const token = auth.startsWith('Bearer ') ? auth.slice(7) : ''
    if (!token) return res.status(401).json({ error: 'missing_token' })

    const { data: userData, error: userErr } = await supabase.auth.getUser(token)
    if (userErr || !userData?.user?.id) return res.status(401).json({ error: 'invalid_token' })
    const userId = userData.user.id

    const { data, error } = await supabase
      .from('Wallet')
      .select('id,userId,currency,balance')
      .eq('userId', userId)

    if (error) {
      console.error('wallets api error', error)
      return res.status(500).json({ error: 'wallets_fetch_failed' })
    }
    return res.json({ wallets: data ?? [] })
  } catch (e: any) {
    console.error('wallets api error', e)
    return res.status(500).json({ error: e?.message || 'server_error' })
  }
}

export const config = { api: { bodyParser: false } }
