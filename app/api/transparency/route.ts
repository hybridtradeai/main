export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextResponse } from 'next/server';
import { getTransparencySummary } from '@/lib/transparencyLogic';

export async function GET() {
  try {
    const summary = await getTransparencySummary();
    return NextResponse.json(summary);
  } catch (e: any) {
    return NextResponse.json({
      reserveBuffer: { currentAmount: 0, totalAUM: 0, updatedAt: null },
      aumUSD: 0,
      walletsUSDTotal: 0,
      currencyBreakdown: [],
      currencyBreakdownUSD: [],
      coveragePct: 0,
      generatedAt: new Date().toISOString(),
      error: e?.message || 'server_error',
    });
  }
}
