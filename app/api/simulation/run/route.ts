export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest, NextResponse } from 'next/server';
import { SimulationEngine } from '@/lib/simulation/engine';

export async function GET(req: NextRequest) {
  // Optional: Add admin auth check here if needed, but simulation might be public or protected.
  // Assuming public or protected by middleware if needed.
  
  const engine = new SimulationEngine();
  try {
    const results = await engine.runFullSimulation();
    return NextResponse.json(results);
  } catch (error: any) {
    console.error('Simulation failed:', error);
    return NextResponse.json({ error: error.message || 'Simulation failed' }, { status: 500 });
  }
}
