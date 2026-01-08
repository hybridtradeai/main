export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { supabaseServer } from '@/lib/supabaseServer';
import { requireAdminApp } from '@/lib/adminAuth';

const BodySchema = z.object({ email: z.string().email() });

export async function POST(req: NextRequest) {
  if (!supabaseServer) return NextResponse.json({ error: 'server_configuration_error' }, { status: 500 });
  const supabase = supabaseServer;

  const admin = await requireAdminApp(req);
  if (!admin.ok) return NextResponse.json({ error: admin.error || 'Unauthorized' }, { status: 401 });
  
  const body = await req.json().catch(() => ({}));
  const parse = BodySchema.safeParse(body);
  if (!parse.success) return NextResponse.json({ error: 'Invalid payload', issues: parse.error.issues }, { status: 400 });
  const { email } = parse.data;

  try {
    const { data: invite, error: inviteErr } = await supabase.auth.admin.inviteUserByEmail(email);
    if (inviteErr) return NextResponse.json({ ok: false, error: inviteErr.message || 'Invite failed' }, { status: 500 });
    const userId = invite.user?.id;
    if (!userId) return NextResponse.json({ ok: false, error: 'Invite did not return a user ID' }, { status: 500 });

    let profileData: any = null
    const upsertData = { user_id: userId, role: 'admin', is_admin: true }
    
    let { data, error } = await supabase.from('profiles').upsert(upsertData, { onConflict: 'user_id' }).select().maybeSingle();

    if (error && (error.message.includes('relation "public.profiles" does not exist') || error.code === '42P01')) {
         const upsertDataPascal = { userId: userId, role: 'admin', isAdmin: true }
         const { data: data2, error: error2 } = await supabase.from('Profile').upsert(upsertDataPascal, { onConflict: 'userId' }).select().maybeSingle();
         if (data2) profileData = data2
         error = error2
    } else {
         profileData = data
    }

    if (error) return NextResponse.json({ ok: false, error: 'Failed to upsert profile', details: error.message }, { status: 500 });
    return NextResponse.json({ ok: true, invited: invite.user, profile: profileData });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || 'Invite-admin failed' }, { status: 500 });
  }
}
