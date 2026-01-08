import type { NextApiRequest } from 'next';
import { NextRequest } from 'next/server';
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
        return { ok: false, error: 'Invalid token' };
    }
    const userId = userData.user.id;

    // Check profiles (try lowercase first, then PascalCase fallback if needed)
    let { data: profile, error } = await supabaseServer
      .from('profiles')
      .select('role,is_admin')
      .eq('user_id', userId)
      .maybeSingle();
      
    if (error && (error.message.includes('relation "public.profiles" does not exist') || error.code === '42P01')) {
         const { data: p2 } = await supabaseServer.from('Profile').select('role,isAdmin').eq('userId', userId).maybeSingle();
         if (p2) {
             profile = { role: p2.role, is_admin: p2.isAdmin };
             error = null;
         }
    }

    if (error) return { ok: false, error: 'Profile lookup failed' };
    const role = String(profile?.role || '').toLowerCase();
    const isAdmin = Boolean(profile?.is_admin) || role === 'admin';
    if (!isAdmin) return { ok: false, error: 'Forbidden' };
    return { ok: true, userId };
  } catch (e: any) {
    return { ok: false, error: e?.message || 'Admin check failed' };
  }
}

export async function requireAdminApp(req: NextRequest): Promise<AdminCheck> {
  try {
    const auth = req.headers.get('authorization') || '';
    const token = auth.startsWith('Bearer ') ? auth.slice(7).trim() : '';
    if (!token) return { ok: false, error: 'Missing Authorization bearer token' };

    if (!supabaseServer) return { ok: false, error: 'Server configuration error' };

    const { data: userData, error: userErr } = await supabaseServer.auth.getUser(token);
    if (userErr || !userData?.user?.id) {
        return { ok: false, error: 'Invalid token' };
    }
    const userId = userData.user.id;

    let { data: profile, error } = await supabaseServer
      .from('profiles')
      .select('role,is_admin')
      .eq('user_id', userId)
      .maybeSingle();

    if (error && (error.message.includes('relation "public.profiles" does not exist') || error.code === '42P01')) {
         const { data: p2 } = await supabaseServer.from('Profile').select('role,isAdmin').eq('userId', userId).maybeSingle();
         if (p2) {
             profile = { role: p2.role, is_admin: p2.isAdmin };
             error = null;
         }
    }

    if (error) return { ok: false, error: 'Profile lookup failed' };
    const role = String(profile?.role || '').toLowerCase();
    const isAdmin = Boolean(profile?.is_admin) || role === 'admin';
    if (!isAdmin) return { ok: false, error: 'Forbidden' };
    return { ok: true, userId };
  } catch (e: any) {
    return { ok: false, error: e?.message || 'Admin check failed' };
  }
}
