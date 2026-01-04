import type { NextApiRequest, NextApiResponse } from 'next';
import { z } from 'zod';
import { supabaseServer } from '../../../../lib/supabaseServer';
import { requireAdmin } from '../../../../lib/adminAuth';

const BodySchema = z.object({ email: z.string().email() });

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (!supabaseServer) return res.status(500).json({ error: 'server_configuration_error' })
  const supabase = supabaseServer

  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const admin = await requireAdmin(req);
  if (!admin.ok) return res.status(401).json({ error: admin.error || 'Unauthorized' });
  const parse = BodySchema.safeParse(req.body || {});
  if (!parse.success) return res.status(400).json({ error: 'Invalid payload', issues: parse.error.issues });
  const { email } = parse.data;

  try {
    // Invite user by email (sends a sign-up email) and returns the user if exists/created
    const { data: invite, error: inviteErr } = await supabase.auth.admin.inviteUserByEmail(email);
    if (inviteErr) return res.status(500).json({ ok: false, error: inviteErr.message || 'Invite failed' });
    const userId = invite.user?.id;
    if (!userId) return res.status(500).json({ ok: false, error: 'Invite did not return a user ID' });

    // Upsert admin profile
    // Try lowercase profiles first (standard Supabase)
    let profileData: any = null
    const upsertData = { user_id: userId, role: 'admin', is_admin: true }
    
    let { data, error } = await supabase
      .from('profiles')
      .upsert(upsertData, { onConflict: 'user_id' })
      .select()
      .maybeSingle();

    if (error && (error.message.includes('relation "public.profiles" does not exist') || error.code === '42P01')) {
         // Fallback to PascalCase Profile
         // Note: PascalCase usually uses camelCase columns in our mapping, but Supabase columns are what they are.
         // If table is Profile, columns might be userId, isAdmin.
         const upsertDataPascal = { userId: userId, role: 'admin', isAdmin: true }
         const { data: data2, error: error2 } = await supabase
            .from('Profile')
            .upsert(upsertDataPascal, { onConflict: 'userId' })
            .select()
            .maybeSingle();
         
         if (data2) profileData = data2
         error = error2
    } else {
         profileData = data
    }

    if (error) return res.status(500).json({ ok: false, error: 'Failed to upsert profile', details: error.message });

    return res.status(200).json({ ok: true, invited: invite.user, profile: profileData });
  } catch (e: any) {
    return res.status(500).json({ ok: false, error: e?.message || 'Invite-admin failed' });
  }
}

