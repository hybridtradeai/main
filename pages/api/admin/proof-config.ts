import type { NextApiRequest, NextApiResponse } from 'next'
import { redis } from '../../../src/lib/redis'
import { supabaseServer } from '@lib/supabaseServer'
import { requireAdmin } from '../../../lib/adminAuth'

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (!supabaseServer) return res.status(500).json({ error: 'server_configuration_error' })
  const supabase = supabaseServer

  const check = await requireAdmin(req)
  if (!check.ok) return res.status(403).json({ error: check.error || 'forbidden' })

  if (req.method === 'GET') {
    const raw = redis ? await redis.get('por:published') : null
    const cfg = raw ? JSON.parse(String(raw)) : null
    return res.status(200).json({ config: cfg })
  }
  if (req.method === 'PUT' || req.method === 'PATCH') {
    const body = req.body || {}
    const cfg = {
      mode: String(body.mode || 'published'),
      userMessage: String(body.userMessage || ''),
      hideMerkleSection: body.hideMerkleSection === true,
      reserveBuffer: body.reserveBuffer || { currentAmount: 0, totalAUM: 0, updatedAt: null },
      aumUSD: Number(body.aumUSD || 0),
      walletsUSDTotal: Number(body.walletsUSDTotal || 0),
      currencyBreakdown: Array.isArray(body.currencyBreakdown) ? body.currencyBreakdown : [],
      currencyBreakdownUSD: Array.isArray(body.currencyBreakdownUSD) ? body.currencyBreakdownUSD : [],
      coveragePct: Number(body.coveragePct || 0),
      generatedAt: body.generatedAt || new Date().toISOString(),
      publishedAt: new Date().toISOString(),
    }
    if (redis) await redis.set('por:published', JSON.stringify(cfg))
    try {
      const adminId = String((check as any)?.userId || '')
      const audit = {
        adminId,
        publishedAt: cfg.publishedAt,
        coveragePct: cfg.coveragePct,
        reserveAmountUSD: Number(cfg?.reserveBuffer?.currentAmount || 0),
        aumUSD: Number(cfg?.aumUSD || 0),
        walletsUSDTotal: Number(cfg?.walletsUSDTotal || 0),
        message: cfg.userMessage,
        hideMerkleSection: cfg.hideMerkleSection === true,
      }
      if (redis) {
        await redis.lpush('por:audit', JSON.stringify(audit))
        await redis.ltrim('por:audit', 0, 499)
      }
      try {
        // Try PascalCase first
        const { error: e1 } = await supabase
          .from('PorAudit')
          .insert({
            adminId: adminId || null,
            publishedAt: cfg.publishedAt,
            coveragePct: cfg.coveragePct,
            reserveUsd: Number(cfg?.reserveBuffer?.currentAmount || 0),
            aumUsd: Number(cfg?.aumUSD || 0),
            walletsUsdTotal: Number(cfg?.walletsUSDTotal || 0),
            message: String(cfg.userMessage || ''),
            hideMerkleSection: cfg.hideMerkleSection === true,
          })

        if (e1 && (e1.message.includes('relation') || e1.code === '42P01')) {
            await supabase
              .from('por_audit')
              .insert({
                admin_id: adminId || null,
                published_at: cfg.publishedAt,
                coverage_pct: cfg.coveragePct,
                reserve_usd: Number(cfg?.reserveBuffer?.currentAmount || 0),
                aum_usd: Number(cfg?.aumUSD || 0),
                wallets_usd_total: Number(cfg?.walletsUSDTotal || 0),
                message: String(cfg.userMessage || ''),
                hide_merkle_section: cfg.hideMerkleSection === true,
              })
        }
      } catch {}
    } catch {}
    return res.status(200).json({ ok: true, config: cfg })
  }
  return res.status(405).json({ error: 'method_not_allowed' })
}

export const config = { api: { bodyParser: true } }
