import type { NextApiRequest, NextApiResponse } from 'next'
import { requireAdmin } from '../../../lib/adminAuth'
import { supabaseServer } from '../../../src/lib/supabaseServer'
import { logInfo, logError } from '../../../src/lib/observability/logger'

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (!supabaseServer) return res.status(500).json({ error: 'server_configuration_error' })
  const supabase = supabaseServer
  if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' })
  const check = await requireAdmin(req)
  if (!check.ok) return res.status(403).json({ error: 'forbidden' })

  const daysParam = req.query.days ?? req.body?.days
  const days = Number(daysParam ?? process.env.DELIVERY_RETENTION_DAYS ?? 30)
  if (isNaN(days) || days <= 0) return res.status(400).json({ error: 'invalid_days' })
  const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000)

  try {
    let count = 0
    // Try PascalCase
    const { count: c1, error: e1 } = await supabase
      .from('NotificationDelivery')
      .delete({ count: 'exact' })
      .lt('deliveredAt', cutoff.toISOString())

    if (e1 && (e1.message.includes('relation') || e1.code === '42P01')) {
        // Fallback
        const { count: c2, error: e2 } = await supabase
          .from('notification_deliveries')
          .delete({ count: 'exact' })
          .lt('delivered_at', cutoff.toISOString())
        
        if (e2) throw new Error(e2.message)
        count = c2 || 0
    } else if (e1) {
        throw new Error(e1.message)
    } else {
        count = c1 || 0
    }

    logInfo('retention.notification_delivery_deleted', { days, count })
    return res.status(200).json({ ok: true, deleted: count, days })
  } catch (e: any) {
    logError('retention.notification_delivery_error', { days, error: e?.message })
    return res.status(500).json({ error: 'retention_failed', details: e?.message })
  }
}

