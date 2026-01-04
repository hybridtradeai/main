import type { NextApiRequest, NextApiResponse } from 'next'
import { requireAdmin } from '../../../lib/adminAuth'
import { supabaseServer, supabaseServiceReady } from '../../../lib/supabaseServer'

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'method_not_allowed' })
  const admin = await requireAdmin(req)
  if (!admin.ok) return res.status(401).json({ ok: false, error: admin.error || 'unauthorized' })

  const status: { manualCreditsEnabled: boolean; serviceRoleConfigured: boolean; walletsTableReady: boolean; walletsTable?: string } = {
    manualCreditsEnabled: String(process.env.ENABLE_MANUAL_CREDITS || 'false').toLowerCase() === 'true',
    serviceRoleConfigured: supabaseServiceReady,
    walletsTableReady: false,
  }

  // Check Supabase wallets accessibility with service role
  try {
    if (!supabaseServer) throw new Error('Supabase not configured')

    // Try PascalCase
    const { error: e1 } = await supabaseServer
      .from('Wallet')
      .select('id')
      .limit(1)
    
    if (!e1) {
        status.walletsTableReady = true
        status.walletsTable = 'Wallet'
    } else if (e1.message.includes('relation') || e1.code === '42P01') {
        // Try lowercase
        const { error: e2 } = await supabaseServer
          .from('wallets')
          .select('id')
          .limit(1)
        if (!e2) {
            status.walletsTableReady = true
            status.walletsTable = 'wallets'
        }
    }
  } catch (e) {
    console.error('wallets api error', e)
    status.serviceRoleConfigured = false
  }

  return res.json({ ok: true, status })
}

export const config = { api: { bodyParser: false } }
