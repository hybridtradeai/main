import type { NextApiRequest } from 'next';
import { supabaseServer } from './supabaseServer';

export type AdminCheck = { ok: boolean; userId?: string; error?: string };

export async function requireAdmin(req: NextApiRequest): Promise<AdminCheck> {
  try {
    const auth = String(req.headers.authorization || '');
    const token = auth.startsWith('Bearer ') ? auth.slice(7).trim() : '';
    if (!token) return { ok: false, error: 'Missing Authorization bearer token' };

    if (!supabaseServer) return { ok: false, error: 'Server configuration error' };

    const { data: userData, error: userErr } = await supabaseServer.auth.getUser(token);
    if (userErr || !userData?.user?.id) {
        console.error('AdminAuth Token Verification Failed:', userErr?.message || 'No user data', 'Token start:', token.substring(0, 10))
        return { ok: false, error: 'Invalid token' };
    }
    const userId = userData.user.id;

    const { data: profile, error } = await supabaseServer
      .from('profiles')
      .select('role,is_admin')
      .eq('user_id', userId)
      .maybeSingle();
    if (error) return { ok: false, error: 'Profile lookup failed' };
    const role = String(profile?.role || '').toLowerCase();
    const isAdmin = Boolean(profile?.is_admin) || role === 'admin';
    if (!isAdmin) return { ok: false, error: 'Forbidden' };
    return { ok: true, userId };
  } catch (e: any) {
    return { ok: false, error: e?.message || 'Admin check failed' };
  }
}

