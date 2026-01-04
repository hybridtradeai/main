import { Queue } from 'bullmq'

const connection = { url: process.env.REDIS_URL || 'redis://localhost:6379' }

let q: Queue | null = null

export function getBroadcastQueue() {
  // Disable on Vercel to prevent ECONNREFUSED
  if (process.env.VERCEL || process.env.DISABLE_REDIS === 'true') {
    return {
      add: async () => ({ id: 'mock', getState: async () => 'completed' }),
      getJob: async () => null,
    } as any
  }
  if (!q) q = new Queue('broadcast', { connection })
  return q
}

export const broadcastQueue = getBroadcastQueue()

export async function enqueueBroadcast(globalNotificationId: string, opts?: { delay?: number; attempts?: number; backoff?: number }) {
  const attempts = Math.max(1, Number(opts?.attempts ?? 3))
  const backoff = Math.max(0, Number(opts?.backoff ?? 5000))
  const delay = Math.max(0, Number(opts?.delay ?? 0))
  return broadcastQueue.add('broadcast', { globalNotificationId }, {
    attempts,
    backoff: { type: 'fixed', delay: backoff },
    delay,
    removeOnComplete: true,
    removeOnFail: false,
  })
}
