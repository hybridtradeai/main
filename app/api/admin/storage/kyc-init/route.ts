export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest, NextResponse } from 'next/server';
import { requireAdminApp } from '@/lib/adminAuth';
import { supabaseServer } from '@/lib/supabaseServer';

export async function GET(req: NextRequest) {
  if (!supabaseServer) return NextResponse.json({ error: 'server_configuration_error' }, { status: 500 })
  const supabase = supabaseServer
  const admin = await requireAdminApp(req)
  if (!admin.ok) return NextResponse.json({ error: admin.error || 'unauthorized' }, { status: 401 })

  try {
    const name = 'kyc'
    const existing = await (supabase.storage as any).getBucket?.(name)
    if (existing?.data?.name === name) {
      await (supabase.storage as any).updateBucket?.(name, {
        public: false,
        fileSizeLimit: '10MB',
        allowedMimeTypes: ['image/jpeg','image/png','application/pdf','application/json','text/plain']
      })
      return NextResponse.json({ ok: true, bucket: name, updated: true })
    }
    const created = await (supabase.storage as any).createBucket?.(name, {
      public: false,
      fileSizeLimit: '10MB',
      allowedMimeTypes: ['image/jpeg','image/png','application/pdf','application/json','text/plain']
    })
    if (created?.error) return NextResponse.json({ error: String(created.error.message || 'create_failed') }, { status: 500 })
    return NextResponse.json({ ok: true, bucket: name, created: true })
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || 'server_error' }, { status: 500 })
  }
}
