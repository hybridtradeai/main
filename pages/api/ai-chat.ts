import type { NextApiRequest, NextApiResponse } from 'next'
import OpenAI from 'openai'
import { supabaseServer } from '../../lib/supabaseServer'

function n(s: string) { return String(s || '').toLowerCase().replace(/\s+/g, ' ').trim() }

function intent(p: string) {
  const s = n(p)
  if (!s) return 'greeting'
  if (/(help|support|agent|human|talk)/.test(s)) return 'support'
  if (/(plan|starter|pro|elite|roi|returns)/.test(s)) return 'plans'
  if (/(withdraw|payout|bank|account|vba)/.test(s)) return 'withdraw'
  if (/(deposit|fund|top up|paystack|card)/.test(s)) return 'deposit'
  if (/(kyc|verify|identity|documents|approval)/.test(s)) return 'kyc'
  if (/(company|about|how it works|model|revenue|streams)/.test(s)) return 'company'
  if (/(transparency|proof|reserve|coverage|merkle)/.test(s)) return 'transparency'
  if (/(fees|pricing|charges|cost)/.test(s)) return 'fees'
  if (/(risk|security|compliance|controls)/.test(s)) return 'risk'
  if (/(tip|advice|strategy|dca|diversif)/.test(s)) return 'tips'
  return 'generic'
}

const KB: Record<string, string> = {
  plans: 'Plans: Starter, Pro, Elite. Compare benefits and ROI targets at /plans. Returns are variable; see disclosures.',
  deposit: 'Deposits: local and card methods via providers (e.g., Paystack in test/dev). Manage top-ups at /deposit.',
  withdraw: 'Withdrawals require KYC approval. Manage bank details and request payouts at /withdraw. Processing times vary.',
  kyc: 'KYC: identity verification unlocks withdrawals and advanced features. Start and track status at /kyc.',
  support: 'Support: open a ticket or continue an existing thread at /support. FAQs cover common steps at /faqs.',
  company: 'Company: HybridTradeAI uses hybrid revenue streams and AI signals. See overview at /about.',
  transparency: 'Transparency: reserve buffer and coverage metrics; user proof at /transparency; admin summary at /admin/transparency.',
  fees: 'Fees: vary by methods and plan. Review pricing at /plans and payment provider details at /faqs.',
  risk: 'Risk: investing involves risk; controls and compliance active. Read disclosures at /about and /faqs.',
  tips: 'Tips: diversify across plans, maintain reserves, use DCA, avoid overexposure. See guidance at /faqs.'
}

function fallback(kind: string) {
  if (kind === 'greeting') return 'Hello! I can help with plans, withdrawals, deposits, KYC, transparency and more. Try: [Browse plans](/plans) or [Open Support](/support).'
  const t = KB[kind] || KB.generic
  const map: Record<string, string> = {
    support: 'You can open a support ticket or continue an existing one at [Support](/support). For immediate answers, check [FAQs](/faqs).',
    plans: 'Compare [Plans](/plans) and pick what fits. Returns are variable; see disclosures.',
    withdraw: 'Withdrawals after KYC approval at [Withdraw](/withdraw). Steps in [FAQs](/faqs).',
    deposit: 'Top up at [Deposit](/deposit).',
    kyc: 'Verify identity at [KYC](/kyc).',
    company: 'Learn more at [About](/about).',
    transparency: 'See user proof at [Proof](/transparency) and admin summary at [/admin/transparency].',
    fees: 'Review pricing in [Plans](/plans).',
    risk: 'Read disclosures at [About](/about) and [FAQs](/faqs).',
    tips: 'Diversify, keep reserves, consider DCA. See [FAQs](/faqs).',
  }
  return map[kind] || 'I can help with plans, deposits, withdrawals, KYC, transparency, and support. Try: [Plans](/plans), [Deposit](/deposit), [Withdraw](/withdraw), [Support](/support).'
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (!supabaseServer) return res.status(500).json({ error: 'server_configuration_error' })
  const supabase = supabaseServer

  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })
  const { prompt } = req.body || {}
  const kind = intent(String(prompt || ''))
  const apiKey = process.env.OPENAI_API_KEY || ''
  // Optional personalization via Supabase profile
  let userCtx = ''
  try {
    const auth = String(req.headers.authorization || '')
    const token = auth.startsWith('Bearer ') ? auth.slice(7) : ''
    if (token) {
      const { data, error } = await supabase.auth.getUser(token)
      const uid = !error && data?.user?.id ? String(data.user.id) : ''
      if (uid) {
        const { data: prof } = await supabase.from('profiles').select('kyc_status').eq('user_id', uid).maybeSingle()
        const kyc = String((prof as any)?.kyc_status || '')
        if (kyc) userCtx = `UserKyc:${kyc}`
      }
    }
  } catch {}
  if (!apiKey) {
    const message = fallback(kind)
    const confidence = kind === 'generic' ? 0.45 : 0.6
    const escalate = confidence < 0.5
    return res.status(200).json({ ok: true, message, intent: kind, confidence, escalate })
  }
  try {
    const openai = new OpenAI({ apiKey })
    const system = [
      'You are HybridTradeAI assistant. Be concise, link to on-site pages using markdown like [Plans](/plans).',
      'Never promise fixed returns; include risk context where relevant. Do not perform transactions. Suggest safe CTAs.',
      'Prefer platform-specific guidance grounded in provided context; avoid external claims.',
    ].join(' ')
    const ctx = [KB[kind] || '', userCtx].filter(Boolean).join('\n')
    const user = `Question: ${String(prompt || '')}\nContext: ${ctx}`
    const resp = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
      temperature: 0.3,
    })
    const message = String(resp.choices?.[0]?.message?.content || fallback(kind))
    const confidence = (resp.choices?.[0]?.message?.content ? (kind === 'generic' ? 0.65 : 0.85) : (kind === 'generic' ? 0.45 : 0.6))
    const escalate = confidence < 0.5
    return res.status(200).json({ ok: true, message, intent: kind, confidence, escalate })
  } catch (e) {
    const message = fallback(kind)
    const confidence = kind === 'generic' ? 0.45 : 0.6
    const escalate = confidence < 0.5
    return res.status(200).json({ ok: true, message, intent: kind, confidence, escalate })
  }
}
