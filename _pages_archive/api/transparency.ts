import type { NextApiRequest, NextApiResponse } from 'next';
import { supabaseServer, supabaseServiceReady } from '../../lib/supabaseServer';

function toNumber(x: any) {
  const n = Number(x)
  return isFinite(n) ? n : 0
}

const rates: Record<string, number> = {
  USD: 1,
  EUR: 0.92,
  GBP: 0.79,
  NGN: 1550,
  BTC: 1 / 65000,
  ETH: 1 / 3500,
  USDT: 1,
  USDC: 1,
}

export default async function handler(_req: NextApiRequest, res: NextApiResponse) {
  if (!supabaseServer) return res.status(500).json({ error: 'server_configuration_error' })
  const supabase = supabaseServer

  try {
    let currencyBreakdown: { currency: string; total: number }[] = []
    let aumUSD = 0
    let reserveAmount = 0
    let updatedAt: string | null = null

    if (supabaseServiceReady) {
      try {
        const { data: wData } = await supabase
          .from('Wallet')
          .select('currency,balance')
        const items = Array.isArray(wData) ? wData : []
        const map = new Map<string, number>()
        for (const it of items as any[]) {
          const cur = String(it.currency || '').toUpperCase()
          const bal = toNumber(it.balance || 0)
          map.set(cur, (map.get(cur) || 0) + bal)
        }
        currencyBreakdown = Array.from(map.entries()).map(([currency, total]) => ({ currency, total }))
      } catch {}

      try {
        const { data: inv } = await supabase
          .from('Investment')
          .select('amount,status')
          .eq('status', 'ACTIVE')
        const items = Array.isArray(inv) ? inv : []
        aumUSD = items.reduce((s, it: any) => s + toNumber(it.amount || 0), 0)
      } catch {}

      try {
        const { data: rb } = await supabase
          .from('ReserveBuffer')
          .select('currentAmount,totalAUM,updatedAt')
          .limit(1)
          .maybeSingle()
        if (rb) {
          reserveAmount = toNumber((rb as any).currentAmount || 0)
          updatedAt = (rb as any).updatedAt || null
          const ta = toNumber((rb as any).totalAUM || 0)
          if (!aumUSD) aumUSD = ta
        }
      } catch {}
    }

    const currencyBreakdownUSD = currencyBreakdown.map((c) => {
      const r = rates[c.currency] ?? 1
      const usd = c.total / r
      return { currency: c.currency, total: c.total, usd }
    })
    const usdTotal = currencyBreakdownUSD.reduce((s, c) => s + c.usd, 0)
    if (!aumUSD) aumUSD = usdTotal
    const coveragePct = aumUSD > 0 ? Number(((reserveAmount / aumUSD) * 100).toFixed(2)) : 0

    const payload = {
      reserveBuffer: {
        currentAmount: reserveAmount,
        totalAUM: aumUSD,
        updatedAt,
      },
      aumUSD,
      walletsUSDTotal: usdTotal,
      currencyBreakdown,
      currencyBreakdownUSD,
      coveragePct,
      generatedAt: new Date().toISOString(),
    }
    res.status(200).json(payload)
  } catch (e: any) {
    res.status(200).json({
      reserveBuffer: { currentAmount: 0, totalAUM: 0, updatedAt: null },
      aumUSD: 0,
      walletsUSDTotal: 0,
      currencyBreakdown: [],
      currencyBreakdownUSD: [],
      coveragePct: 0,
      generatedAt: new Date().toISOString(),
      error: e?.message || 'server_error',
    })
  }
}
