import Redis from 'ioredis'

// OPTION A: TEMPORARILY DISABLE REDIS ON VERCEL
// We assume if VERCEL env var is present, we are in build or production on Vercel.
// We also allow explicit disabling via DISABLE_REDIS.
const IS_VERCEL = !!process.env.VERCEL
const DISABLE_REDIS = IS_VERCEL || process.env.DISABLE_REDIS === 'true'

export const redisEnabled = !DISABLE_REDIS && (Boolean(process.env.REDIS_URL) || process.env.NODE_ENV !== 'production')

export function createClient(url = process.env.REDIS_URL || '') {
  if (DISABLE_REDIS) return null as unknown as Redis

  if (!url) {
    // If no URL and we are allowed to run (e.g. local dev without Redis?), return a stub or null.
    // Existing code returned a stub. We'll keep it consistent but null is safer for "disabled".
    // But since we have checks for redisEnabled, let's return null to force guards.
    return null as unknown as Redis
  }

  const tlsOpts = url.startsWith('rediss://') ? { tls: { rejectUnauthorized: false } } : {}
  try {
    const client = new Redis(url, {
      ...tlsOpts as any,
      lazyConnect: true,
      maxRetriesPerRequest: 0,
      enableOfflineQueue: true,
      retryStrategy: () => null,
    } as any)
    client.on('error', () => {})
    client.on('connect', () => {})
    client.on('ready', () => {})
    client.on('end', () => {})
    return client
  } catch (e) {
    return null as unknown as Redis
  }
}

export const redis = createClient()

export function duplicate(client: Redis | null) {
  if (!client) return null as unknown as Redis
  try {
    const dup = client.duplicate({
      lazyConnect: true,
      maxRetriesPerRequest: 0,
      enableOfflineQueue: false,
      retryStrategy: () => null,
    } as any)
    dup.on('error', () => {})
    dup.on('connect', () => {})
    dup.on('ready', () => {})
    dup.on('end', () => {})
    return dup
  } catch {
    return null as unknown as Redis
  }
}

export const pub = duplicate(redis)
export const sub = duplicate(redis)

export function createSubscriber(url = process.env.REDIS_URL || (process.env.NODE_ENV === 'production' ? '' : 'redis://localhost:6379')) {
  return duplicate(createClient(url))
}
