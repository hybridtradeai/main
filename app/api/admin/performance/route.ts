export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import crypto from 'crypto';
import { supabaseServer } from '@/lib/supabaseServer';
import { requireAdminApp } from '@/lib/adminAuth';

const RoiSchema = z.record(z.number().nonnegative());
const BodySchema = z.object({
  weekEnding: z.string().refine(s => !isNaN(Date.parse(s)), { message: 'Invalid date' }),
  streamRois: RoiSchema
});

export async function POST(req: NextRequest) {
  if (!supabaseServer) return NextResponse.json({ error: 'server_configuration_error' }, { status: 500 });
  const supabase = supabaseServer;

  const admin = await requireAdminApp(req);
  if (!admin.ok) return NextResponse.json({ error: admin.error || 'Unauthorized' }, { status: 401 });
  
  const body = await req.json().catch(() => ({}));
  const parse = BodySchema.safeParse(body);
  if (!parse.success) return NextResponse.json({ error: 'Invalid payload', issues: parse.error.issues }, { status: 400 });
  const { weekEnding, streamRois } = parse.data;

  try {
    let result: any = null;
    
    // Check if PascalCase exists
    const { data: existing, error: errExist } = await supabase
        .from('Performance')
        .select('*')
        .eq('weekEnding', weekEnding)
        .maybeSingle();

    let useLowercase = false;
    if (errExist && (errExist.message.includes('relation "public.Performance" does not exist') || errExist.code === '42P01')) {
        useLowercase = true;
    } else if (errExist) {
        throw errExist;
    }

    if (!useLowercase) {
          if (existing) {
            const { data, error } = await supabase
                .from('Performance')
                .update({ streamRois: streamRois })
                .eq('id', existing.id)
                .select()
                .single();
            if (error) throw error;
            result = data;
          } else {
             const { data, error } = await supabase
                .from('Performance')
                .insert({
                    id: crypto.randomUUID(),
                    weekEnding: weekEnding,
                    streamRois: streamRois,
                    createdAt: new Date().toISOString(),
                    updatedAt: new Date().toISOString()
                 })
                 .select()
                 .single();
            if (error) throw error;
            result = data;
          }
    } else {
          // Fallback to lowercase
          const { data: existingLower, error: errLower } = await supabase
            .from('performance')
            .select('*')
            .eq('week_ending', weekEnding)
            .maybeSingle();
          
          if (errLower && errLower.code !== 'PGRST116') throw errLower;

          if (existingLower) {
            const { data, error } = await supabase
                .from('performance')
                .update({ stream_rois: streamRois })
                .eq('id', existingLower.id)
                .select()
                .single();
            if (error) throw error;
            // Map back to camelCase
            result = { 
                ...data, 
                weekEnding: data.week_ending, 
                streamRois: data.stream_rois,
                createdAt: data.created_at,
                updatedAt: data.updated_at
            };
          } else {
             const { data, error } = await supabase
                .from('performance')
                .insert({
                    id: crypto.randomUUID(),
                    week_ending: weekEnding,
                    stream_rois: streamRois,
                    created_at: new Date().toISOString(),
                    updated_at: new Date().toISOString()
                 })
                 .select()
                 .single();
            if (error) throw error;
            // Map back to camelCase
             result = { 
                ...data, 
                weekEnding: data.week_ending, 
                streamRois: data.stream_rois,
                createdAt: data.created_at,
                updatedAt: data.updated_at
            };
          }
    }

    return NextResponse.json({ ok: true, performance: result });
  } catch (err: any) {
    return NextResponse.json({ ok: false, error: err?.message || 'Failed to upsert performance' }, { status: 500 });
  }
}
