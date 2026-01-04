import type { NextApiRequest, NextApiResponse } from 'next'
import { createRateLimiter } from '../../../lib/rateLimit'
import { supabaseServer } from '../../../lib/supabaseServer'

const limiter = createRateLimiter({ windowMs: 60_000, max: 20 })

function parseDataUrl(dataUrl: string): { mime: string; buffer: Buffer } {
  const m = /^data:(.+);base64,(.*)$/.exec(dataUrl || '')
  if (!m) throw new Error('invalid_data_url')
  const mime = m[1]
  const b64 = m[2]
  const buffer = Buffer.from(b64, 'base64')
  return { mime, buffer }
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (!supabaseServer) return res.status(500).json({ error: 'server_configuration_error' })
  const supabase = supabaseServer

  if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' })
  if (!(await limiter(req, res, 'kyc-upload'))) return

  try {
    const auth = String(req.headers.authorization || '')
    const token = auth.startsWith('Bearer ') ? auth.slice(7) : ''
    if (!token) return res.status(401).json({ error: 'unauthorized' })
    const { data: userData, error: userErr } = await supabase.auth.getUser(token)
    if (userErr || !userData?.user?.id) return res.status(401).json({ error: 'invalid_token' })
    const userId = String(userData.user.id)

    const body = req.body as any
    const idDataUrl = String(body?.idFileDataUrl || '')
    const selfieNeutralDataUrl = String(body?.selfieNeutralDataUrl || '')
    const selfieSmileDataUrl = String(body?.selfieSmileDataUrl || '')
    const selfieLeftDataUrl = String(body?.selfieLeftDataUrl || '')
    const selfieRightDataUrl = String(body?.selfieRightDataUrl || '')
    const payload = body?.payload || {}

    if (!idDataUrl || !selfieNeutralDataUrl || !selfieSmileDataUrl || !selfieLeftDataUrl || !selfieRightDataUrl) {
      return res.status(400).json({ error: 'missing_files' })
    }

    const bucketName = 'kyc'
    try {
      const info: any = await (supabase.storage as any).getBucket?.(bucketName)
      const exists = Boolean(info?.data?.name === bucketName)
      if (!exists) {
        await (supabase.storage as any).createBucket?.(bucketName, {
          public: false,
          fileSizeLimit: '10MB',
          allowedMimeTypes: ['image/jpeg','image/png','application/pdf','application/json','text/plain'],
        })
      } else {
        await (supabase.storage as any).updateBucket?.(bucketName, {
          public: false,
          fileSizeLimit: '10MB',
          allowedMimeTypes: ['image/jpeg','image/png','application/pdf','application/json','text/plain'],
        })
      }
    } catch {}
    const bucket = supabase.storage.from(bucketName)

    const { mime: idMime, buffer: idBuf } = parseDataUrl(idDataUrl)
    const { mime: nMime, buffer: nBuf } = parseDataUrl(selfieNeutralDataUrl)
    const { mime: sMime, buffer: sBuf } = parseDataUrl(selfieSmileDataUrl)
    const { mime: lMime, buffer: lBuf } = parseDataUrl(selfieLeftDataUrl)
    const { mime: rMime, buffer: rBuf } = parseDataUrl(selfieRightDataUrl)

    const idExt = idMime.includes('pdf') ? 'pdf' : (idMime.includes('png') ? 'png' : 'jpg')
    const selfieExt = (m: string) => (m.includes('png') ? 'png' : 'jpg')

    const idPath = `${userId}/id.${idExt}`
    const nPath = `${userId}/selfie_neutral.${selfieExt(nMime)}`
    const sPath = `${userId}/selfie_smile.${selfieExt(sMime)}`
    const lPath = `${userId}/selfie_left.${selfieExt(lMime)}`
    const rPath = `${userId}/selfie_right.${selfieExt(rMime)}`
    const jsonPath = `${userId}/data.json`

    const idUp = await bucket.upload(idPath, idBuf, { upsert: true, contentType: idMime })
    if (idUp.error) return res.status(500).json({ error: `id_upload_failed:${idUp.error.message}` })
    const nUp = await bucket.upload(nPath, nBuf, { upsert: true, contentType: nMime })
    if (nUp.error) return res.status(500).json({ error: `selfie_neutral_upload_failed:${nUp.error.message}` })
    const sUp = await bucket.upload(sPath, sBuf, { upsert: true, contentType: sMime })
    if (sUp.error) return res.status(500).json({ error: `selfie_smile_upload_failed:${sUp.error.message}` })
    const lUp = await bucket.upload(lPath, lBuf, { upsert: true, contentType: lMime })
    if (lUp.error) return res.status(500).json({ error: `selfie_left_upload_failed:${lUp.error.message}` })
    const rUp = await bucket.upload(rPath, rBuf, { upsert: true, contentType: rMime })
    if (rUp.error) return res.status(500).json({ error: `selfie_right_upload_failed:${rUp.error.message}` })

    const payloadBlob = Buffer.from(JSON.stringify({ ...payload }), 'utf8')
    const jsonUp = await bucket.upload(jsonPath, payloadBlob, { upsert: true, contentType: 'application/json' })
    if (jsonUp.error) {
      const jsonUpFallback = await bucket.upload(jsonPath, payloadBlob, { upsert: true, contentType: 'text/plain' })
      if (jsonUpFallback.error) return res.status(500).json({ error: `data_upload_failed:${jsonUpFallback.error.message}` })
    }

    return res.json({ ok: true })
  } catch (e: any) {
    return res.status(500).json({ error: e?.message || 'server_error' })
  }
}

export const config = { api: { bodyParser: { sizeLimit: '25mb' } } }
