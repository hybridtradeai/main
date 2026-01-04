import type { NextApiRequest, NextApiResponse } from 'next';
import { supabaseServer } from '../../../lib/supabaseServer';
import { z } from 'zod';
import { requireAdmin } from '../../../lib/adminAuth';
import crypto from 'crypto';

const RoiSchema = z.record(z.number().nonnegative());
const BodySchema = z.object({
  weekEnding: z.string().refine(s => !isNaN(Date.parse(s)), { message: 'Invalid date' }),
  streamRois: RoiSchema
});

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  if (!supabaseServer) return res.status(500).json({ error: 'server_configuration_error' });
  const supabase = supabaseServer;

  const admin = await requireAdmin(req);
  if (!admin.ok) return res.status(401).json({ error: admin.error || 'Unauthorized' });
  const parse = BodySchema.safeParse(req.body || {});
  if (!parse.success) return res.status(400).json({ error: 'Invalid payload', issues: parse.error.issues });
  const { weekEnding, streamRois } = parse.data;

  try {
    // Use camelCase column names matching Prisma schema
    const payload = { 
        weekEnding: weekEnding, 
        streamRois: streamRois,
        // Manual ID and timestamps are needed if DB defaults are missing
    };
    
    // Try upsert by weekEnding if unique constraint exists; otherwise fallback to insert
    let result: any = null;
    try {
      // First check if it exists in PascalCase
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
    } catch (e: any) {
       throw e;
    }

    return res.status(200).json({ ok: true, performance: result });
  } catch (err: any) {
    return res.status(500).json({ ok: false, error: err?.message || 'Failed to upsert performance' });
  }
}
