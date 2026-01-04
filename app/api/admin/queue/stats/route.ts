export const dynamic = "force-dynamic";

import { NextRequest } from 'next/server'
import { requireRole } from '@lib/requireRole'
import { broadcastQueue } from '@lib/queue/broadcastQueue'

export async function GET(req: NextRequest) {
  const { error } = await requireRole('ADMIN')
  if (error) return new Response(JSON.stringify({ error }), { status: error === 'unauthenticated' ? 401 : 403 })
  const counts = await broadcastQueue.getJobCounts('waiting', 'active', 'completed', 'failed', 'delayed', 'paused')
  return new Response(JSON.stringify({ counts }), { status: 200 })
}

