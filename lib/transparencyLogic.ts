import { supabaseServer, supabaseServiceReady } from './supabaseServer';

const rates: Record<string, number> = {
  USD: 1, EUR: 0.92, GBP: 0.79, NGN: 1550, BTC: 1 / 65000, ETH: 1 / 3500, USDT: 1, USDC: 1,
}

function toNumber(x: any) {
  const n = Number(x)
  return isFinite(n) ? n : 0
}

export async function getTransparencySummary() {
  if (!supabaseServer) throw new Error('server_configuration_error')
  const supabase = supabaseServer

  let currencyBreakdown: { currency: string; total: number }[] = []
  let aumUSD = 0
  let reserveAmount = 0
  let updatedAt: string | null = null

  if (supabaseServiceReady) {
      try {
        const { data: wData } = await supabase.from('Wallet').select('currency,balance')
        
        let items = Array.isArray(wData) ? wData : []
        if (!wData) {
            try {
                const { data: wData2 } = await supabase.from('wallets').select('currency,balance')
                if (wData2) items = wData2
            } catch {}
        }

        const map = new Map<string, number>()
        for (const it of items as any[]) {
          const cur = String(it.currency || '').toUpperCase()
          const bal = toNumber(it.balance || 0)
          map.set(cur, (map.get(cur) || 0) + bal)
        }
        currencyBreakdown = Array.from(map.entries()).map(([currency, total]) => ({ currency, total }))
      } catch {}

      try {
        const { data: inv } = await supabase.from('Investment').select('amount,status').eq('status', 'ACTIVE')
        let items = Array.isArray(inv) ? inv : []
        if (!inv) {
            try {
                const { data: inv2 } = await supabase.from('investments').select('amount,status').eq('status', 'ACTIVE')
                if (inv2) items = inv2
            } catch {}
        }
        aumUSD = items.reduce((s, it: any) => s + toNumber(it.amount || 0), 0)
      } catch {}

      try {
        const { data: rb } = await supabase.from('ReserveBuffer').select('currentAmount,totalAUM,updatedAt').limit(1).maybeSingle()
        if (rb) {
          reserveAmount = toNumber((rb as any).currentAmount || 0)
          updatedAt = (rb as any).updatedAt || null
          const ta = toNumber((rb as any).totalAUM || 0)
          if (!aumUSD) aumUSD = ta
        } else {
             try {
                const { data: rb2 } = await supabase.from('reserve_buffers').select('current_amount,total_aum,updated_at').limit(1).maybeSingle()
                if (rb2) {
                    reserveAmount = toNumber((rb2 as any).current_amount || 0)
                    updatedAt = (rb2 as any).updated_at || null
                    const ta = toNumber((rb2 as any).total_aum || 0)
                    if (!aumUSD) aumUSD = ta
                }
             } catch {}
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

  return {
      reserveBuffer: { currentAmount: reserveAmount, totalAUM: aumUSD, updatedAt },
      aumUSD,
      walletsUSDTotal: usdTotal,
      currencyBreakdown,
      currencyBreakdownUSD,
      coveragePct,
      generatedAt: new Date().toISOString(),
  }
}
