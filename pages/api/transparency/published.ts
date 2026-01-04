import type { NextApiRequest, NextApiResponse } from 'next'
import { redis } from '../../../src/lib/redis'
import summary from '../transparency'

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    const raw = redis ? await redis.get('por:published') : null
    if (raw) {
      const cfg = JSON.parse(String(raw))
      const payload = {
        mode: String(cfg?.mode || 'published'),
        userMessage: String(cfg?.userMessage || ''),
        hideMerkleSection: cfg?.hideMerkleSection === true,
        reserveBuffer: cfg?.reserveBuffer || { currentAmount: 0, totalAUM: 0, updatedAt: null },
        aumUSD: Number(cfg?.aumUSD || 0),
        walletsUSDTotal: Number(cfg?.walletsUSDTotal || 0),
        currencyBreakdown: Array.isArray(cfg?.currencyBreakdown) ? cfg.currencyBreakdown : [],
        currencyBreakdownUSD: Array.isArray(cfg?.currencyBreakdownUSD) ? cfg.currencyBreakdownUSD : [],
        coveragePct: Number(cfg?.coveragePct || 0),
        generatedAt: cfg?.generatedAt || new Date().toISOString(),
        publishedAt: cfg?.publishedAt || cfg?.generatedAt || new Date().toISOString(),
      }
      return res.status(200).json(payload)
    }
    const live = await new Promise<any>((resolve) => {
      const fakeRes = {
        status: (_: number) => fakeRes,
        json: (payload: any) => resolve(payload),
      } as any
      ;(summary as any)(req, fakeRes)
    })
    return res.status(200).json({ ...live, mode: 'live', userMessage: '', hideMerkleSection: false })
  } catch (e: any) {
    return res.status(200).json({ mode: 'live', userMessage: '', hideMerkleSection: false, reserveBuffer: { currentAmount: 0, totalAUM: 0, updatedAt: null }, aumUSD: 0, walletsUSDTotal: 0, currencyBreakdown: [], currencyBreakdownUSD: [], coveragePct: 0, generatedAt: new Date().toISOString(), error: e?.message || 'server_error' })
  }
}

export const config = { api: { bodyParser: false } }
