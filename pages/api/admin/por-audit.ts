import type { NextApiRequest, NextApiResponse } from 'next'
import { redis } from '../../../src/lib/redis'
import { requireAdmin } from '../../../lib/adminAuth'
import { supabaseServer } from '@lib/supabaseServer'

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (!supabaseServer) return res.status(500).json({ error: 'server_configuration_error' })
  const supabase = supabaseServer

  const check = await requireAdmin(req)
  if (!check.ok) return res.status(403).json({ error: check.error || 'forbidden' })
  const limit = Math.max(1, Math.min(200, Number((req.query as any)?.limit ?? 50)))
  try {
    // Try PascalCase first
    const { data: d1, error: e1 } = await supabase
      .from('PorAudit')
      .select('adminId,publishedAt,coveragePct,reserveUsd,aumUsd,walletsUsdTotal,message,hideMerkleSection')
      .order('publishedAt', { ascending: false })
      .limit(limit)

    if (!e1 && Array.isArray(d1)) {
        return res.status(200).json({ items: d1 })
    }

    if (e1 && (e1.message.includes('relation') || e1.code === '42P01')) {
        const { data, error } = await supabase
          .from('por_audit')
          .select('admin_id,published_at,coverage_pct,reserve_usd,aum_usd,wallets_usd_total,message,hide_merkle_section')
          .order('published_at', { ascending: false })
          .limit(limit)
        if (!error && Array.isArray(data)) {
          const items = (data as any[]).map((row) => ({
            adminId: row.admin_id,
            publishedAt: row.published_at,
            coveragePct: row.coverage_pct,
            reserveUsd: row.reserve_usd,
            aumUsd: row.aum_usd,
            walletsUsdTotal: row.wallets_usd_total,
            message: row.message,
            hideMerkleSection: row.hide_merkle_section,
          }))
          return res.status(200).json({ items })
        }
    }
  } catch {}
  const entries = redis ? await redis.lrange('por:audit', 0, limit - 1) : []
  const items = entries.map((e: string) => { try { return JSON.parse(e) } catch { return { raw: e } } })
  return res.status(200).json({ items })
}

export const config = { api: { bodyParser: false } }
