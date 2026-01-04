export const dynamic = "force-dynamic";

import { NextRequest } from 'next/server'
import { requireRole } from '@lib/requireRole'
import { broadcastQueue } from '@lib/queue/broadcastQueue'

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { error } = await requireRole('ADMIN')
  if (error) return new Response(JSON.stringify({ error }), { status: error === 'unauthenticated' ? 401 : 403 })
  const p = await ctx.params
  const id = String(p.id || '')
  if (!id) return new Response(JSON.stringify({ error: 'invalid' }), { status: 400 })
  const job = await broadcastQueue.getJob(id)
  if (!job) return new Response(JSON.stringify({ error: 'not_found' }), { status: 404 })
  await job.retry()
  return new Response(JSON.stringify({ ok: true }), { status: 200 })
}
