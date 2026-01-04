import type { NextApiRequest, NextApiResponse } from 'next';
import crypto from 'crypto';
import { supabaseServer } from '@lib/supabaseServer';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (!supabaseServer) return res.status(500).json({ error: 'server_configuration_error' })
  const supabase = supabaseServer

  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  
  // Authentication check
  const auth = String(req.headers.authorization || '');
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  if (!token) return res.status(401).json({ error: 'UNAUTHENTICATED' });
  
  const { userId, amountUSD = 0 } = req.body || {};
  if (!userId) return res.status(400).json({ error: 'Missing userId' });
  
  try {
    // Generate referral code
    const referralCode = crypto.createHash('sha256').update(`${userId}:${Date.now()}`).digest('hex').slice(0, 8);
    const now = new Date().toISOString();

    // Upsert equivalent: Try to find existing first
    let existing: any = null;
    const { data: r1, error: e1 } = await supabase.from('Referral').select('*').eq('userId', userId).maybeSingle();
    
    if (e1 && (e1.message.includes('relation') || e1.code === '42P01')) {
      const { data: r2 } = await supabase.from('referrals').select('*').eq('user_id', userId).maybeSingle();
      if (r2) existing = { ...r2, id: r2.id, userId: r2.user_id, code: r2.code };
    } else {
      existing = r1;
    }

    let finalCode = referralCode;
    
    if (existing) {
      // Update
      const { error: u1 } = await supabase.from('Referral').update({ code: referralCode, updatedAt: now }).eq('id', existing.id);
      if (u1 && (u1.message.includes('relation') || u1.code === '42P01')) {
         await supabase.from('referrals').update({ code: referralCode, updated_at: now }).eq('id', existing.id);
      }
    } else {
      // Create
      const id = crypto.randomUUID();
      const { error: c1 } = await supabase.from('Referral').insert({ id, userId, code: referralCode, createdAt: now, updatedAt: now });
      if (c1 && (c1.message.includes('relation') || c1.code === '42P01')) {
         await supabase.from('referrals').insert({ id, user_id: userId, code: referralCode, created_at: now, updated_at: now });
      }
    }
    
    return res.status(200).json({ 
      ok: true, 
      referralCode: finalCode, 
      message: 'Referral code generated successfully'
    });
  } catch (error) {
    console.error('Referral error:', error);
    return res.status(500).json({ 
      error: 'Failed to generate referral code', 
      details: error instanceof Error ? error.message : 'Unknown error' 
    });
  }
}
