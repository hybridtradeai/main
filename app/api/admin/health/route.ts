export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest, NextResponse } from 'next/server';
import { requireAdminApp } from '@/lib/adminAuth';
import { supabaseServer, supabaseServiceReady } from '@/lib/supabaseServer';

export async function GET(req: NextRequest) {
  const admin = await requireAdminApp(req)
  if (!admin.ok) return NextResponse.json({ ok: false, error: admin.error || 'unauthorized' }, { status: 401 })

  const status: { manualCreditsEnabled: boolean; serviceRoleConfigured: boolean; walletsTableReady: boolean; walletsTable?: string } = {
    manualCreditsEnabled: String(process.env.ENABLE_MANUAL_CREDITS || 'false').toLowerCase() === 'true',
    serviceRoleConfigured: supabaseServiceReady,
    walletsTableReady: false,
  }

  try {
    if (!supabaseServer) throw new Error('Supabase not configured')

    const { error: e1 } = await supabaseServer.from('Wallet').select('id').limit(1)
    
    if (!e1) {
        status.walletsTableReady = true
        status.walletsTable = 'Wallet'
    } else if (e1.message.includes('relation') || e1.code === '42P01') {
        const { error: e2 } = await supabaseServer.from('wallets').select('id').limit(1)
        if (!e2) {
            status.walletsTableReady = true
            status.walletsTable = 'wallets'
        }
    }
  } catch (e) {
    console.error('wallets api error', e)
    status.serviceRoleConfigured = false
  }

  return NextResponse.json({ ok: true, status })
}
