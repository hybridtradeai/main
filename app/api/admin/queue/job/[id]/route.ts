export const dynamic = "force-dynamic";

import { NextRequest } from 'next/server'
import { requireRole } from '@lib/requireRole'
import { broadcastQueue } from '@lib/queue/broadcastQueue'
import { redis } from '@lib/redis'

export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { error } = await requireRole('ADMIN')
  if (error) return new Response(JSON.stringify({ error }), { status: error === 'unauthenticated' ? 401 : 403 })
  const p = await ctx.params
  const id = String(p.id || '')
  if (!id) return new Response(JSON.stringify({ error: 'invalid' }), { status: 400 })
  const job = await broadcastQueue.getJob(id)
  if (!job) return new Response(JSON.stringify({ error: 'not_found' }), { status: 404 })
  const state = await job.getState()
  const logsKey = `job_logs:broadcast:${job.id}`
  let logs: any[] = []
  try {
    if (redis) {
      const entries = await redis.lrange(logsKey, 0, 100)
      logs = entries.map((e: string) => {
        try { return JSON.parse(e) } catch { return { raw: e } }
      })
    }
  } catch {}
  const payload = {
    id: job.id,
    name: job.name,
    data: job.data,
    progress: job.progress,
    attemptsMade: job.attemptsMade,
    timestamp: job.timestamp,
    finishedOn: job.finishedOn,
    processedOn: job.processedOn,
    state,
    failedReason: job.failedReason,
    stacktrace: job.stacktrace,
    logs,
  }
  return new Response(JSON.stringify(payload), { status: 200 })
}

export async function DELETE(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { error } = await requireRole('ADMIN')
  if (error) return new Response(JSON.stringify({ error }), { status: error === 'unauthenticated' ? 401 : 403 })
  const p = await ctx.params
  const id = String(p.id || '')
  if (!id) return new Response(JSON.stringify({ error: 'invalid' }), { status: 400 })
  const job = await broadcastQueue.getJob(id)
  if (!job) return new Response(JSON.stringify({ error: 'not_found' }), { status: 404 })
  await job.remove()
  return new Response(JSON.stringify({ ok: true }), { status: 200 })
}
