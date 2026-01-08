export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { supabaseServer } from '@/lib/supabaseServer';
import { requireAdminApp } from '@/lib/adminAuth';

const BodySchema = z.object({ userId: z.string().uuid() });

export async function POST(req: NextRequest) {
  if (!supabaseServer) return NextResponse.json({ error: 'server_configuration_error' }, { status: 500 });
  const supabase = supabaseServer;

  const admin = await requireAdminApp(req);
  if (!admin.ok) return NextResponse.json({ error: admin.error || 'Unauthorized' }, { status: 401 });
  
  const body = await req.json().catch(() => ({}));
  const parse = BodySchema.safeParse(body);
  if (!parse.success) return NextResponse.json({ error: 'Invalid payload', issues: parse.error.issues }, { status: 400 });
  const { userId } = parse.data;

  try {
    const payload = { user_id: userId, role: 'admin', is_admin: true };
    let profileData: any = null
    
    let { data, error } = await supabase
      .from('profiles')
      .upsert(payload, { onConflict: 'user_id' })
      .select()
      .maybeSingle();
      
    if (error && (error.message.includes('relation "public.profiles" does not exist') || error.code === '42P01')) {
         const payloadPascal = { userId: userId, role: 'admin', isAdmin: true }
         const { data: data2, error: error2 } = await supabase
            .from('Profile')
            .upsert(payloadPascal, { onConflict: 'userId' })
            .select()
            .maybeSingle();
         
         if (data2) profileData = data2
         error = error2
    } else {
         profileData = data
    }

    if (error) return NextResponse.json({ ok: false, error: 'Failed to promote user', details: error.message }, { status: 500 });
    return NextResponse.json({ ok: true, profile: profileData });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || 'Promotion failed' }, { status: 500 });
  }
}
