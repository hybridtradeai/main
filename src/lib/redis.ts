import type { Redis as RedisType } from 'ioredis'

// OPTION A: TEMPORARILY DISABLE REDIS ON VERCEL
// We assume if VERCEL env var is present, we are in build or production on Vercel.
// We also allow explicit disabling via DISABLE_REDIS.
const IS_VERCEL = !!process.env.VERCEL
const DISABLE_REDIS = IS_VERCEL || process.env.DISABLE_REDIS === 'true'

export const redisEnabled = !DISABLE_REDIS && (Boolean(process.env.REDIS_URL) || process.env.NODE_ENV !== 'production')

let client: RedisType | null = null

if (!DISABLE_REDIS) {
  try {
    const Redis = require('ioredis')
    const url = process.env.REDIS_URL
    const tlsOpts = url && url.startsWith('rediss://') ? { tls: { rejectUnauthorized: false } } : {}
    
    // Default to localhost if no URL, but respect disable flag
    if (url) {
      client = new Redis(url, {
        ...tlsOpts,
        lazyConnect: true,
        maxRetriesPerRequest: 0,
        enableOfflineQueue: true,
        retryStrategy: () => null,
      })
    } else {
      client = new Redis({
        lazyConnect: true,
        maxRetriesPerRequest: 0,
        enableOfflineQueue: true,
        retryStrategy: () => null,
      })
    }
    
    if (client) {
      client.on('error', (err: any) => {
        // Suppress errors to prevent crash
      })
    }
  } catch (e) {
    // If ioredis is not installed or fails, just ignore
  }
}

export const redis = client

export function createClient(url = process.env.REDIS_URL || '') {
  if (DISABLE_REDIS) return null as unknown as RedisType
  try {
    const Redis = require('ioredis')
    const tlsOpts = url && url.startsWith('rediss://') ? { tls: { rejectUnauthorized: false } } : {}
    const c = url 
      ? new Redis(url, { ...tlsOpts, lazyConnect: true, maxRetriesPerRequest: 0, enableOfflineQueue: true, retryStrategy: () => null })
      : new Redis({ lazyConnect: true, maxRetriesPerRequest: 0, enableOfflineQueue: true, retryStrategy: () => null })
    
    c.on('error', () => {})
    return c
  } catch {
    return null as unknown as RedisType
  }
}

export function duplicate(client: RedisType | null) {
  if (!client || DISABLE_REDIS) return null as unknown as RedisType
  try {
    const dup = client.duplicate({
      lazyConnect: true,
      maxRetriesPerRequest: 0,
      enableOfflineQueue: false,
      retryStrategy: () => null,
    })
    dup.on('error', () => {})
    return dup
  } catch {
    return null as unknown as RedisType
  }
}

export const pub = duplicate(redis)
export const sub = duplicate(redis)

export function createSubscriber(url = process.env.REDIS_URL || (process.env.NODE_ENV === 'production' ? '' : 'redis://localhost:6379')) {
  return duplicate(createClient(url))
}
