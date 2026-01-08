export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextResponse } from 'next/server';
import { redis } from '@/lib/redis';
import { getTransparencySummary } from '@/lib/transparencyLogic';

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n))
}
function laplaceNoise(scale: number) {
  const u = Math.random() - 0.5
  return -scale * Math.sign(u) * Math.log(1 - 2 * Math.abs(u))
}

export async function GET() {
  try {
    const live = await getTransparencySummary();

    const dpRaw = redis ? await redis.get('por:dp') : null
    const dp = dpRaw ? JSON.parse(String(dpRaw)) : null
    const epsilon = Number(dp?.epsilon ?? process.env.DP_EPSILON ?? 0.5)
    const sensitivity = Number(dp?.sensitivity ?? process.env.DP_SENSITIVITY ?? 1000)
    const scale = sensitivity / Math.max(0.001, epsilon)

    const baseCov = Number(live?.coveragePct || 0)
    const noisyCov = clamp(baseCov + laplaceNoise(scale / 1000), 0, 200)
    const liquidityLevel = noisyCov >= 110 ? 'very_high' : noisyCov >= 80 ? 'high' : noisyCov >= 50 ? 'medium' : 'low'

    const now = Date.now()
    const nextUpdateAt = new Date(now + (30_000 + Math.random() * 90_000)).toISOString()
    const lastRaw = redis ? await redis.get('por:last:coverage') : null
    const last = lastRaw ? Number(lastRaw) : null
    const trend = last == null ? 'flat' : noisyCov > last ? 'up' : noisyCov < last ? 'down' : 'flat'
    if (redis) await redis.set('por:last:coverage', String(noisyCov))

    return NextResponse.json({
      mode: 'public',
      liquidityLevel,
      coverageApprox: Number(noisyCov.toFixed(2)),
      trend,
      nextUpdateAt,
      generatedAt: new Date().toISOString(),
    })
  } catch (e: any) {
    return NextResponse.json({ mode: 'public', liquidityLevel: 'unknown', coverageApprox: 0, trend: 'flat', nextUpdateAt: new Date(Date.now() + 60000).toISOString(), generatedAt: new Date().toISOString(), error: e?.message || 'server_error' })
  }
}
