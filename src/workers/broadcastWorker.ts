import { Worker, Job } from 'bullmq'
import crypto from 'crypto'
// dynamic imports inside functions to avoid top-level crashes in tests/envs

const connection = { url: process.env.REDIS_URL || 'redis://localhost:6379' }
const CONCURRENCY = Math.max(1, Number(process.env.BROADCAST_WORKER_CONCURRENCY || '2'))

function logToRedis(client: any, jobId: string, entry: any) {
  try {
    if (client) {
      client.lpush(`job_logs:broadcast:${jobId}`, JSON.stringify(entry))
      client.ltrim(`job_logs:broadcast:${jobId}`, 0, 500)
    }
  } catch {}
}

async function processJob(job: Job) {
  const { createClient } = await import('../lib/redis')
  const client = createClient()
  const jobId = String(job.id)
  try {
    logToRedis(client, jobId, { ts: Date.now(), status: 'started', data: job.data })

    const globalNotificationId = job.data?.globalNotificationId
    if (!globalNotificationId) throw new Error('missing globalNotificationId')

    const { supabaseServer: _supabaseServer } = await import('../lib/supabaseServer')
    if (!_supabaseServer) throw new Error('Supabase not configured')
    const supabaseServer = _supabaseServer
    
    // 1. Fetch GlobalNotification
    let g: any = null
    const { data: g1, error: gErr1 } = await supabaseServer
      .from('GlobalNotification')
      .select('*')
      .eq('id', globalNotificationId)
      .maybeSingle()

    if (gErr1 && (gErr1.message.includes('relation') || gErr1.code === '42P01')) {
      const { data: g2 } = await supabaseServer
        .from('global_notifications')
        .select('*')
        .eq('id', globalNotificationId)
        .maybeSingle()
      if (g2) g = g2
    } else {
      g = g1
    }

    if (!g) throw new Error('global notification not found')

    const batchSize = 500
    let lastId: string | null = null
    let processed = 0

    while (true) {
      // 2. Fetch Users
      let users: { id: string }[] = []
      
      let q1 = supabaseServer
        .from('User')
        .select('id')
        .order('id', { ascending: true })
        .limit(batchSize)
      
      if (lastId) q1 = q1.gt('id', lastId)
      
      const { data: u1, error: uErr1 } = await q1

      let useLowercaseUsers = false
      if (uErr1 && (uErr1.message.includes('relation') || uErr1.code === '42P01')) {
        useLowercaseUsers = true
      } else if (u1) {
        users = u1
      }

      if (useLowercaseUsers) {
        let q2 = supabaseServer
          .from('users')
          .select('id')
          .order('id', { ascending: true })
          .limit(batchSize)
        
        if (lastId) q2 = q2.gt('id', lastId)
        
        const { data: u2 } = await q2
        if (u2) users = u2
      }

      if (!users.length) break

      const { publish } = await import('../lib/sse')
      
      for (const u of users) {
        // 3. Create Notification
        const noteData = { 
          userId: u.id, 
          type: g.type, 
          title: g.title, 
          message: g.message,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        }

        let note: any = null
        const { data: n1, error: nErr1 } = await supabaseServer
          .from('Notification')
          .insert(noteData)
          .select()
          .single()
        
        if (nErr1 && (nErr1.message.includes('relation') || nErr1.code === '42P01')) {
           const { data: n2 } = await supabaseServer
             .from('notifications')
             .insert({
               user_id: noteData.userId,
               type: noteData.type,
               title: noteData.title,
               message: noteData.message,
               created_at: noteData.createdAt,
               updated_at: noteData.updatedAt
             })
             .select()
             .single()
           
           if (n2) {
             note = { 
               id: n2.id, 
               userId: n2.user_id, 
               type: n2.type, 
               title: n2.title, 
               message: n2.message, 
               createdAt: n2.created_at 
             }
           }
        } else {
           note = n1
        }

        if (note) {
            // 4. Create NotificationDelivery
            const delData = { globalNotificationId: g.id, userId: u.id, deliveredAt: new Date().toISOString() }
            const { error: dErr1 } = await supabaseServer
              .from('NotificationDelivery')
              .insert(delData)
            
            if (dErr1 && (dErr1.message.includes('relation') || dErr1.code === '42P01')) {
               await supabaseServer
                 .from('notification_deliveries')
                 .insert({
                   global_notification_id: delData.globalNotificationId,
                   user_id: delData.userId,
                   delivered_at: delData.deliveredAt
                 })
            }

            await publish(`user:${u.id}`, { 
              id: note.id, 
              type: note.type, 
              title: note.title, 
              message: note.message, 
              createdAt: note.createdAt 
            })
        }

        processed += 1
        if (processed % 100 === 0) {
          logToRedis(client, jobId, { ts: Date.now(), status: 'progress', processed })
          try { await job.updateProgress(processed) } catch {}
        }
      }
      
      lastId = users[users.length - 1].id
      if (users.length < batchSize) break
    }

    logToRedis(client, jobId, { ts: Date.now(), status: 'completed', processed })
    if (client) client.disconnect()
    return { ok: true, processed }
  } catch (err) {
    logToRedis(client, jobId, { ts: Date.now(), status: 'failed', error: String(err) })
    try { if (client) client.disconnect() } catch {}
    throw err
  }
}

let worker: Worker | null = null

export function startBroadcastWorker() {
  if (worker) return worker
  if (process.env.NODE_ENV === 'test') return null as any
  
  // Disable on Vercel to prevent ECONNREFUSED
  if (process.env.VERCEL || process.env.DISABLE_REDIS === 'true') return null as any

  worker = new Worker('broadcast', async (job: Job) => processJob(job), { connection, concurrency: CONCURRENCY })
  worker.on('failed', (job, err) => console.error('broadcast job failed', job?.id, err))
  return worker
}

if (process.env.NODE_ENV !== 'test' && process.env.START_BROADCAST_WORKER === '1') {
  startBroadcastWorker()
}

export default startBroadcastWorker
