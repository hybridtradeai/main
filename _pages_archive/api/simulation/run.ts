import type { NextApiRequest, NextApiResponse } from 'next';
import { SimulationEngine } from '../../../src/lib/simulation/engine';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  // Optional: Add admin auth check here
  
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const engine = new SimulationEngine();
  try {
    const results = await engine.runFullSimulation();
    res.status(200).json(results);
  } catch (error: any) {
    console.error('Simulation failed:', error);
    res.status(500).json({ error: error.message || 'Simulation failed' });
  }
}
