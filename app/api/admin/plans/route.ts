export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest, NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabaseServer';
import { requireAdminApp } from '@/lib/adminAuth';

export async function PATCH(req: NextRequest) {
  if (!supabaseServer) return NextResponse.json({ error: 'server_configuration_error' }, { status: 500 });
  const supabase = supabaseServer;

  try {
    const admin = await requireAdminApp(req);
    if (!admin.ok) return NextResponse.json({ error: admin.error || 'Unauthorized' }, { status: 401 });

    const body = await req.json().catch(() => ({}));
    const { id, returnPercentage, minAmount, maxAmount, duration, active } = body;

    if (!id) {
      return NextResponse.json({ error: 'Missing plan ID' }, { status: 400 });
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
               return NextResponse.json({ error: errorLower.message }, { status: 500 });
           }
           
           const mapped = {
               ...dataLower,
               returnPercentage: dataLower.return_percentage,
               minAmount: dataLower.min_amount,
               maxAmount: dataLower.max_amount,
               updatedAt: dataLower.updated_at
           };
           return NextResponse.json({ ok: true, plan: mapped });
      }

      console.error('Error updating plan:', error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ ok: true, plan: data });
  } catch (err: any) {
    console.error('API Error:', err);
    return NextResponse.json({ error: err.message || 'Internal server error' }, { status: 500 });
  }
}
