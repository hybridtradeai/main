export const dynamic = "force-dynamic";

import { NextRequest } from 'next/server'
import { supabaseServer } from '@lib/supabaseServer'
import { requireRole } from '@lib/requireRole'
import { createHash } from 'crypto'

function h(data: string) {
  return createHash('sha256').update(data).digest('hex')
}

function buildMerkle(leaves: string[]) {
  if (leaves.length === 0) return { root: h('empty'), layers: [] as string[][] }
  let layer = leaves.slice()
  const layers: string[][] = [layer]
  while (layer.length > 1) {
    const next: string[] = []
    for (let i = 0; i < layer.length; i += 2) {
      const a = layer[i]
      const b = i + 1 < layer.length ? layer[i + 1] : a
      next.push(h(a + b))
    }
    layers.push(next)
    layer = next
  }
  return { root: layer[0], layers }
}

export async function GET(req: NextRequest) {
  const { user, error } = await requireRole('USER', req)
  if (error) return new Response(JSON.stringify({ error }), { status: error === 'unauthenticated' ? 401 : 403 })
  
  if (!supabaseServer) return new Response(JSON.stringify({ error: 'server_configuration_error' }), { status: 500 })
  const supabase = supabaseServer

  try {
    // Fallback logic for wallets
    let wallets: any[] = []
    const { data: w1, error: e1 } = await supabase
      .from('Wallet')
      .select('userId, balance')
      .eq('currency', 'USD')
      .order('userId', { ascending: true })
    
    if (e1 && (e1.message.includes('relation') || e1.code === '42P01')) {
      const { data: w2 } = await supabase
        .from('wallets')
        .select('user_id, balance')
        .eq('currency', 'USD')
        .order('user_id', { ascending: true })
      
      if (w2) {
        wallets = w2.map((w: any) => ({
          userId: w.user_id,
          balance: w.balance
        }))
      }
    } else if (w1) {
      wallets = w1
    }

    const entries = wallets.map((w) => ({ userId: String(w.userId), balance: Number(w.balance) }))
    const leaves = entries.map((e) => h(`${e.userId}:${e.balance.toFixed(8)}`))
    const { root, layers } = buildMerkle(leaves)
    const idx = entries.findIndex((e) => String(e.userId) === String((user as any).id))
    if (idx < 0) return new Response(JSON.stringify({ error: 'no_wallet' }), { status: 404 })
    const leaf = leaves[idx]
    const path: { sibling: string; position: 'left'|'right' }[] = []
    let pos = idx
    for (let d = 0; d < layers.length - 1; d++) {
      const layer = layers[d]
      const isRight = pos % 2 === 1
      const sibIdx = isRight ? pos - 1 : pos + 1
      const sibling = layer[sibIdx] ?? layer[pos]
      path.push({ sibling, position: isRight ? 'left' : 'right' })
      pos = Math.floor(pos / 2)
    }
    return new Response(JSON.stringify({ root, leaf, path, currency: 'USD', amount: entries[idx].balance }), { status: 200 })
  } catch (e: any) {
    return new Response(JSON.stringify({ error: 'server_error', details: e?.message || 'error' }), { status: 500 })
  }
}
