import { NextApiRequest, NextApiResponse } from 'next';
import { supabaseServer } from '../../../lib/supabaseServer';
import { requireAdmin } from '../../../lib/adminAuth';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'PATCH') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  if (!supabaseServer) return res.status(500).json({ error: 'server_configuration_error' });
  const supabase = supabaseServer;

  try {
    const admin = await requireAdmin(req);
    if (!admin.ok) return res.status(401).json({ error: admin.error || 'Unauthorized' });

    const { id, returnPercentage, minAmount, maxAmount, duration, active } = req.body;

    if (!id) {
      return res.status(400).json({ error: 'Missing plan ID' });
    }

    // Try PascalCase first
    const { data, error } = await supabase
      .from('InvestmentPlan')
      .update({
        returnPercentage,
        minAmount,
        maxAmount,
        duration,
        active,
        updatedAt: new Date().toISOString()
      })
      .eq('id', id)
      .select()
      .single();

    if (error) {
      // Check for table not found error
      if (error.message.includes('relation "public.InvestmentPlan" does not exist') || error.code === '42P01') {
           // Fallback to lowercase
           const { data: dataLower, error: errorLower } = await supabase
              .from('investment_plans')
              .update({
                return_percentage: returnPercentage,
                min_amount: minAmount,
                max_amount: maxAmount,
                duration,
                active,
                updated_at: new Date().toISOString()
              })
              .eq('id', id)
              .select()
              .single();
              
           if (errorLower) {
               console.error('Error updating plan (lowercase):', errorLower);
               return res.status(500).json({ error: errorLower.message });
           }
           
           // Map back to camelCase
           const mapped = {
               ...dataLower,
               returnPercentage: dataLower.return_percentage,
               minAmount: dataLower.min_amount,
               maxAmount: dataLower.max_amount,
               updatedAt: dataLower.updated_at
           };
           return res.status(200).json({ ok: true, plan: mapped });
      }

      console.error('Error updating plan:', error);
      return res.status(500).json({ error: error.message });
    }

    return res.status(200).json({ ok: true, plan: data });
  } catch (err: any) {
    console.error('API Error:', err);
    return res.status(500).json({ error: err.message || 'Internal server error' });
  }
}
