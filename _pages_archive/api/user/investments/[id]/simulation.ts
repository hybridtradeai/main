import type { NextApiRequest, NextApiResponse } from 'next';
import { InvestmentRunner } from '../../../../../src/lib/simulation/investment-runner';
import { getCurrentUserId } from '../../../../../lib/db';
import { supabase } from '../../../../../lib/supabase';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { id } = req.query;
  
  // Auth check
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'Unauthorized' });

  const { data: { user }, error } = await supabase.auth.getUser(token);
  if (error || !user) return res.status(401).json({ error: 'Unauthorized' });

  if (!id || typeof id !== 'string') {
    return res.status(400).json({ error: 'Invalid investment ID' });
  }

  try {
    const runner = new InvestmentRunner();
    const data = await runner.runInvestmentSimulation(id);
    res.status(200).json(data);
  } catch (error: any) {
    console.error('Investment simulation failed:', error);
    res.status(500).json({ error: error.message || 'Failed to generate simulation' });
  }
}
