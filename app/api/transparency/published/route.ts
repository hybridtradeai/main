export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextResponse } from 'next/server';
import { redis } from '@/lib/redis';
import { getTransparencySummary } from '@/lib/transparencyLogic';

export async function GET() {
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
      return NextResponse.json(payload)
    }
    const live = await getTransparencySummary();
    return NextResponse.json({ ...live, mode: 'live', userMessage: '', hideMerkleSection: false })
  } catch (e: any) {
    return NextResponse.json({ mode: 'live', userMessage: '', hideMerkleSection: false, reserveBuffer: { currentAmount: 0, totalAUM: 0, updatedAt: null }, aumUSD: 0, walletsUSDTotal: 0, currencyBreakdown: [], currencyBreakdownUSD: [], coveragePct: 0, generatedAt: new Date().toISOString(), error: e?.message || 'server_error' })
  }
}
