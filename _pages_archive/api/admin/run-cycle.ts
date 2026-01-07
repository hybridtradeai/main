import type { NextApiRequest, NextApiResponse } from 'next';
import { supabaseServer } from '../../../lib/supabaseServer';
import { requireAdmin } from '../../../lib/adminAuth';
import crypto from 'crypto';

import { runProfitDistributionCycle } from '@lib/admin/cycle-runner';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const admin = await requireAdmin(req);
  if (!admin.ok) return res.status(401).json({ error: admin.error || 'Unauthorized' });

  try {
    const result = await runProfitDistributionCycle();
    return res.status(200).json(result);
  } catch (error: any) {
    console.error('Cycle run failed:', error);
    return res.status(500).json({ ok: false, error: error.message });
  }
}
