export const dynamic = "force-dynamic";

import { NextRequest } from 'next/server'
import { requireRole } from '@lib/requireRole'
import { broadcastQueue } from '@lib/queue/broadcastQueue'

export async function GET(req: NextRequest) {
  const { error } = await requireRole('ADMIN')
  if (error) return new Response(JSON.stringify({ error }), { status: error === 'unauthenticated' ? 401 : 403 })
  const url = new URL(req.url)
  const status = String(url.searchParams.get('status') || 'waiting') as any
  const offset = Math.max(0, Number(url.searchParams.get('offset') || '0'))
  const limit = Math.max(1, Math.min(100, Number(url.searchParams.get('limit') || '20')))
  const jobs = await broadcastQueue.getJobs([status], offset, limit)
  const items = await Promise.all(
    jobs.map(async (job) => ({
      id: job.id,
      name: job.name,
      data: job.data,
      progress: job.progress,
      attemptsMade: job.attemptsMade,
      timestamp: job.timestamp,
      finishedOn: job.finishedOn,
      processedOn: job.processedOn,
      state: await job.getState(),
      failedReason: job.failedReason,
    }))
  )
  return new Response(JSON.stringify({ items }), { status: 200 })
}

