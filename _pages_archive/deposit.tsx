import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/router'
import RequireAuth from '../components/RequireAuth'
import { useCurrency } from '../hooks/useCurrency'
import { getCurrentUserId } from '../lib/db'
import { supabase } from '../lib/supabase'
import { useI18n } from '../hooks/useI18n'
import { ArrowLeft, CreditCard, Bitcoin, ShieldCheck, AlertCircle, CheckCircle2, TrendingUp, Info } from 'lucide-react'
import Link from 'next/link'
import { motion, AnimatePresence } from 'framer-motion'
import FuturisticBackground from '../components/ui/FuturisticBackground'
import Head from 'next/head'

export default function DepositPage() {
  const { t } = useI18n()
  const router = useRouter()
  const { currency } = useCurrency('USD')
  const uidRef = useRef<string | null>(null)
  const [amount, setAmount] = useState('')
  const [provider, setProvider] = useState('paystack')
  const [plan, setPlan] = useState<'starter'|'pro'|'elite'>('starter')

  useEffect(() => {
    if (router.isReady) {
      const qPlan = router.query.plan as string
      const qAmount = router.query.amount as string
      if (qPlan && ['starter', 'pro', 'elite'].includes(qPlan)) {
        setPlan(qPlan as any)
      }
      if (qAmount && !isNaN(Number(qAmount))) {
        setAmount(qAmount)
      }
    }
  }, [router.isReady, router.query])
  const [msg, setMsg] = useState('')
  const [err, setErr] = useState('')
  const [kycStatus, setKycStatus] = useState<'pending'|'approved'|'rejected'|''>('')
  const [kycLevel, setKycLevel] = useState<number | null>(null)
  const [cryptoCurrency, setCryptoCurrency] = useState<'usdt'|'btc'|'eth'>('usdt')
  const [loading, setLoading] = useState(false)

  const ranges: Record<'starter'|'pro'|'elite', { min: number; max: number; label: string }> = {
    starter: { min: 100, max: 500, label: 'Starter — $100 to $500' },
    pro: { min: 501, max: 2000, label: 'Pro — $501 to $2,000' },
    elite: { min: 2001, max: 10000, label: 'Elite — $2,001 to $10,000' },
  }

  useEffect(() => {
    (async () => {
      uidRef.current = await getCurrentUserId()
      try {
        const { data: sessionRes } = await supabase.auth.getSession()
        const uid = String(sessionRes?.session?.user?.id || '')
        if (!uid) return
        const { data: prof } = await supabase
          .from('profiles')
          .select('kyc_status,kyc_level')
          .eq('user_id', uid)
          .maybeSingle()
        const k = String((prof as any)?.kyc_status || '')
        setKycStatus((k === 'approved' || k === 'rejected' || k === 'pending') ? k : '')
        const lvl = (prof as any)?.kyc_level
        if (typeof lvl === 'number') setKycLevel(lvl)
      } catch {}
    })()
  }, [])

  async function submit() {
    setErr(''); setMsg('')
    let uid = uidRef.current
    if (!uid) {
      try { uid = await getCurrentUserId() || '' } catch {}
      if (uid) uidRef.current = uid
    }

    if (!uid) { setErr(t('please_login_first')); return }
    const amt = Number(amount)
    if (!amt || amt <= 0) { setErr(t('invalid_deposit')); return }

    // Enforce per-plan amount ranges (USD-equivalent assumptions)
    const r = ranges[plan]
    if (amt < r.min || amt > r.max) {
      setErr(t('plan_amount_out_of_range'))
      return
    }

    // Enforce KYC before allowing deposits/investment
    if (kycStatus !== 'approved') {
      setErr(t('kyc_required_for_deposits'))
      return
    }
    if (kycLevel && amt > 0) {
      // Minimum level per plan
      const minLevelForPlan: Record<'starter'|'pro'|'elite', number> = {
        starter: 1,
        pro: 2,
        elite: 3,
      }
      const requiredLevel = minLevelForPlan[plan]
      if (kycLevel < requiredLevel) {
        setErr(t('kyc_level_too_low_for_plan'))
        return
      }
      // Simple per-level deposit caps (can be tuned or moved to config)
      const limits: Record<number, number> = {
        1: 1000,
        2: 10000,
        3: 100000,
      }
      const max = limits[kycLevel] ?? limits[1]
      if (amt > max) {
        setErr(t('kyc_level_too_low_for_amount'))
        return
      }
    }
    
    setLoading(true)
    try {
      // Get authentication token
      const { data: session } = await supabase.auth.getSession()
      const token = session.session?.access_token
      if (!token) { setErr(t('please_login_first')); setLoading(false); return }
      
      const headers = {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      }
      
      const useCrypto = provider === 'crypto' || (provider === 'paystack' && currency !== 'NGN')
      if (provider === 'paystack' || useCrypto) {
        const body: any = { amount: amt, currency, planId: plan, autoActivate: true }
        if (useCrypto) {
          body.provider = 'nowpayments'
          body.cryptoCurrency = cryptoCurrency
        }
        const res = await fetch('/api/user/deposit', { 
          method: 'POST', 
          headers, 
          body: JSON.stringify(body),
        })
        let json: any = null
        try { json = await res.json() } catch {}
        if (!res.ok) { setErr(String(json?.details || json?.error || 'Failed')); setLoading(false); return }
        const url = String(json?.authorizationUrl || json?.invoiceUrl || json?.pay_url || '')
        if (url) { window.location.href = url; return }
      }
      
      const res = await fetch('/api/user/invest', { 
        method: 'POST', 
        headers, 
        body: JSON.stringify({ amount: amt, currency, planId: plan }) 
      })
      let json: any = null
      try { json = await res.json() } catch {}
      if (!res.ok) { setErr(String(json?.details || json?.error || 'Failed')); setLoading(false); return }
      setMsg(String(json?.message || t('deposit_recorded')))
      setAmount('')
    } catch (e: any) { setErr(String(e?.message || 'Error')) }
    setLoading(false)
  }

  return (
    <RequireAuth>
      <Head>
        <title>Deploy Capital | HybridTrade AI</title>
      </Head>
      <FuturisticBackground />
      
      <div className="relative min-h-screen pt-24 pb-12 px-4 sm:px-6">
        <div className="max-w-5xl mx-auto">
          <motion.div 
            initial={{ opacity: 0, x: -20 }}
            animate={{ opacity: 1, x: 0 }}
            className="mb-8 flex items-center gap-4"
          >
            <Link href="/dashboard" className="p-2 rounded-xl bg-black/40 border border-white/10 hover:bg-white/10 transition-all text-muted-foreground hover:text-white backdrop-blur-md group">
              <ArrowLeft size={20} className="group-hover:-translate-x-1 transition-transform" />
            </Link>
            <div className="flex-1">
               <h1 className="text-3xl font-bold bg-gradient-to-r from-white via-cyan-200 to-blue-400 bg-clip-text text-transparent">Deploy Capital</h1>
               <p className="text-sm text-gray-400">Fund your wallet and activate a strategy in one step</p>
            </div>
            {kycStatus && (
              <motion.div 
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                className={`px-4 py-2 rounded-xl border text-xs font-semibold flex items-center gap-2 backdrop-blur-md ${kycStatus === 'approved' ? 'bg-green-500/10 border-green-500/20 text-green-400' : 'bg-yellow-500/10 border-yellow-500/20 text-yellow-400'}`}
              >
                 <ShieldCheck size={14} />
                 {kycStatus === 'approved' ? `KYC Verified • Level ${kycLevel || 1}` : `KYC ${kycStatus.toUpperCase()}`}
              </motion.div>
            )}
          </motion.div>

          <div className="grid md:grid-cols-[1.8fr,1fr] gap-8">
            {/* Main Form */}
            <motion.div 
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.1 }}
              className="space-y-6"
            >
               {/* Plan Selection */}
               <div className="bg-black/40 backdrop-blur-xl border border-white/10 rounded-3xl p-6 shadow-[0_0_40px_rgba(0,0,0,0.2)]">
                 <div className="text-sm text-cyan-400 mb-4 font-medium uppercase tracking-wider flex items-center gap-2">
                   <span className="w-6 h-6 rounded-full bg-cyan-500/10 flex items-center justify-center text-xs border border-cyan-500/20">1</span>
                   Select Strategy Tier
                 </div>
                 <div className="grid grid-cols-3 gap-3">
                   {['starter', 'pro', 'elite'].map((p) => (
                     <button 
                       key={p}
                       onClick={() => setPlan(p as any)}
                       className={`relative p-4 rounded-xl border text-left transition-all duration-300 group overflow-hidden ${plan === p ? 'bg-cyan-500/10 border-cyan-500 shadow-[0_0_20px_rgba(6,182,212,0.15)]' : 'bg-white/5 border-white/10 hover:border-white/20 hover:bg-white/10'}`}
                     >
                       <div className={`absolute inset-0 bg-gradient-to-br from-cyan-500/0 via-cyan-500/0 to-cyan-500/5 transition-opacity ${plan === p ? 'opacity-100' : 'opacity-0'}`} />
                       <div className={`font-bold capitalize mb-1 relative z-10 ${plan === p ? 'text-cyan-400' : 'text-gray-300 group-hover:text-white'}`}>{p}</div>
                       <div className="text-xs text-gray-500 relative z-10 group-hover:text-gray-400 transition-colors">${ranges[p as keyof typeof ranges].min.toLocaleString()} - ${ranges[p as keyof typeof ranges].max.toLocaleString()}</div>
                       {plan === p && <motion.div layoutId="check" className="absolute top-2 right-2 text-cyan-400"><CheckCircle2 size={16} /></motion.div>}
                     </button>
                   ))}
                 </div>
               </div>

               {/* Amount Input */}
               <div className="bg-black/40 backdrop-blur-xl border border-white/10 rounded-3xl p-6 shadow-[0_0_40px_rgba(0,0,0,0.2)]">
                 <div className="text-sm text-cyan-400 mb-4 font-medium uppercase tracking-wider flex items-center gap-2">
                   <span className="w-6 h-6 rounded-full bg-cyan-500/10 flex items-center justify-center text-xs border border-cyan-500/20">2</span>
                   Enter Amount
                 </div>
                 <div className="relative group">
                    <span className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-500 group-focus-within:text-cyan-400 transition-colors">$</span>
                    <input 
                      type="number" 
                      value={amount}
                      onChange={(e) => setAmount(e.target.value)}
                      className="w-full bg-black/20 border border-white/10 rounded-xl pl-8 pr-4 py-4 text-white focus:border-cyan-500/50 focus:bg-cyan-950/10 focus:outline-none transition-all text-xl placeholder-gray-600 shadow-inner"
                      placeholder={`Min $${ranges[plan].min}`}
                    />
                 </div>
                 <AnimatePresence>
                   {amount && (Number(amount) < ranges[plan].min || Number(amount) > ranges[plan].max) && (
                     <motion.div 
                       initial={{ opacity: 0, height: 0 }}
                       animate={{ opacity: 1, height: 'auto' }}
                       exit={{ opacity: 0, height: 0 }}
                       className="mt-2 text-xs text-red-400 flex items-center gap-1"
                     >
                       <AlertCircle size={12} />
                       Amount must be between ${ranges[plan].min} and ${ranges[plan].max} for {plan} plan
                     </motion.div>
                   )}
                 </AnimatePresence>
               </div>

               {/* Payment Method */}
               <div className="bg-black/40 backdrop-blur-xl border border-white/10 rounded-3xl p-6 shadow-[0_0_40px_rgba(0,0,0,0.2)]">
                 <div className="text-sm text-cyan-400 mb-4 font-medium uppercase tracking-wider flex items-center gap-2">
                   <span className="w-6 h-6 rounded-full bg-cyan-500/10 flex items-center justify-center text-xs border border-cyan-500/20">3</span>
                   Choose Payment Method
                 </div>
                 <div className="grid md:grid-cols-2 gap-4">
                    <button 
                      onClick={() => setProvider('paystack')}
                      className={`p-4 rounded-xl border flex items-center gap-3 transition-all duration-300 relative overflow-hidden group ${provider === 'paystack' ? 'bg-cyan-500/10 border-cyan-500 shadow-[0_0_20px_rgba(6,182,212,0.15)]' : 'bg-white/5 border-white/10 hover:border-white/20 hover:bg-white/10'}`}
                    >
                      <div className={`p-2 rounded-lg transition-colors ${provider === 'paystack' ? 'bg-cyan-500/20 text-cyan-400' : 'bg-white/5 text-gray-400 group-hover:text-white'}`}><CreditCard size={20} /></div>
                      <div className="text-left relative z-10">
                        <div className={`font-medium transition-colors ${provider === 'paystack' ? 'text-white' : 'text-gray-300 group-hover:text-white'}`}>Card / Bank</div>
                        <div className="text-xs text-gray-500">Instant deposit</div>
                      </div>
                      {provider === 'paystack' && <div className="absolute inset-0 bg-gradient-to-br from-cyan-500/0 via-cyan-500/0 to-cyan-500/5" />}
                    </button>

                    <button 
                      onClick={() => setProvider('crypto')}
                      className={`p-4 rounded-xl border flex items-center gap-3 transition-all duration-300 relative overflow-hidden group ${provider === 'crypto' ? 'bg-cyan-500/10 border-cyan-500 shadow-[0_0_20px_rgba(6,182,212,0.15)]' : 'bg-white/5 border-white/10 hover:border-white/20 hover:bg-white/10'}`}
                    >
                      <div className={`p-2 rounded-lg transition-colors ${provider === 'crypto' ? 'bg-cyan-500/20 text-cyan-400' : 'bg-white/5 text-gray-400 group-hover:text-white'}`}><Bitcoin size={20} /></div>
                      <div className="text-left relative z-10">
                        <div className={`font-medium transition-colors ${provider === 'crypto' ? 'text-white' : 'text-gray-300 group-hover:text-white'}`}>Crypto</div>
                        <div className="text-xs text-gray-500">USDT, BTC, ETH</div>
                      </div>
                      {provider === 'crypto' && <div className="absolute inset-0 bg-gradient-to-br from-cyan-500/0 via-cyan-500/0 to-cyan-500/5" />}
                    </button>
                 </div>

                 <AnimatePresence>
                   {provider === 'crypto' && (
                     <motion.div 
                       initial={{ opacity: 0, height: 0, marginTop: 0 }}
                       animate={{ opacity: 1, height: 'auto', marginTop: 16 }}
                       exit={{ opacity: 0, height: 0, marginTop: 0 }}
                       className="pt-4 border-t border-white/10 overflow-hidden"
                     >
                       <label className="block text-sm text-gray-400 mb-3">Select Asset</label>
                       <div className="flex gap-3">
                         {['usdt', 'btc', 'eth'].map(c => (
                           <button
                             key={c}
                             onClick={() => setCryptoCurrency(c as any)}
                             className={`px-4 py-2 rounded-lg border text-sm uppercase transition-all ${cryptoCurrency === c ? 'bg-cyan-500/20 border-cyan-500 text-cyan-400 shadow-[0_0_15px_rgba(6,182,212,0.2)]' : 'bg-white/5 border-white/10 text-gray-400 hover:text-white hover:border-white/20'}`}
                           >
                             {c}
                           </button>
                         ))}
                       </div>
                     </motion.div>
                   )}
                 </AnimatePresence>
               </div>

               <AnimatePresence>
                 {msg && (
                   <motion.div 
                     initial={{ opacity: 0, y: -10 }}
                     animate={{ opacity: 1, y: 0 }}
                     exit={{ opacity: 0, y: -10 }}
                     className="bg-green-500/10 border border-green-500/20 text-green-400 p-4 rounded-xl text-sm flex items-start gap-3 backdrop-blur-md"
                   >
                     <CheckCircle2 size={18} className="mt-0.5 shrink-0"/> <span>{msg}</span>
                   </motion.div>
                 )}
                 {err && (
                   <motion.div 
                     initial={{ opacity: 0, y: -10 }}
                     animate={{ opacity: 1, y: 0 }}
                     exit={{ opacity: 0, y: -10 }}
                     className="bg-red-500/10 border border-red-500/20 text-red-400 p-4 rounded-xl text-sm flex items-start gap-3 backdrop-blur-md"
                   >
                     <AlertCircle size={18} className="mt-0.5 shrink-0"/> <span>{err}</span>
                   </motion.div>
                 )}
               </AnimatePresence>

               <button 
                 onClick={submit}
                 disabled={loading}
                 className={`w-full relative group overflow-hidden bg-gradient-to-r from-cyan-600 to-blue-600 hover:from-cyan-500 hover:to-blue-500 text-white font-semibold py-4 text-lg rounded-xl transition-all shadow-lg shadow-cyan-500/20 hover:shadow-cyan-500/40 hover:scale-[1.02] active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:scale-100 mt-4`}
               >
                 <div className="absolute inset-0 bg-white/20 translate-y-full group-hover:translate-y-0 transition-transform duration-300" />
                 <span className="relative flex items-center justify-center gap-2">
                   {loading ? (
                     <>
                       <span className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                       Processing...
                     </>
                   ) : (
                     `Deploy $${amount || '0'} Capital`
                   )}
                 </span>
               </button>
            </motion.div>

            {/* Sidebar Info */}
            <motion.div 
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: 0.2 }}
              className="space-y-4"
            >
              <div className="bg-black/40 backdrop-blur-xl border border-white/10 rounded-3xl p-6 shadow-[0_0_40px_rgba(0,0,0,0.2)]">
                <div className="flex items-center gap-2 mb-6 text-white font-medium">
                  <div className="p-2 rounded-lg bg-cyan-500/10 text-cyan-400">
                    <TrendingUp size={18} />
                  </div>
                  Selected Strategy: <span className="capitalize text-cyan-400 ml-auto bg-cyan-500/10 px-3 py-1 rounded-full text-xs">{plan}</span>
                </div>
                
                <div className="space-y-4 text-sm">
                  <div className="flex justify-between py-2 border-b border-white/5">
                    <span className="text-gray-400">Min Deposit</span>
                    <span className="text-white font-mono">${ranges[plan].min.toLocaleString()}</span>
                  </div>
                  <div className="flex justify-between py-2 border-b border-white/5">
                    <span className="text-gray-400">Max Deposit</span>
                    <span className="text-white font-mono">${ranges[plan].max.toLocaleString()}</span>
                  </div>
                  <div className="flex justify-between py-2 border-b border-white/5">
                    <span className="text-gray-400">Capital Lock</span>
                    <span className="text-white">14 Days</span>
                  </div>
                  <div className="flex justify-between py-2">
                    <span className="text-gray-400">Management Fee</span>
                    <span className="text-white">{plan === 'elite' ? '15%' : plan === 'pro' ? '20%' : '25%'}</span>
                  </div>
                </div>
              </div>

              <div className="bg-black/40 backdrop-blur-xl border border-white/10 rounded-3xl p-6 shadow-[0_0_40px_rgba(0,0,0,0.2)]">
                 <div className="flex items-center gap-2 mb-4 text-white font-medium">
                   <Info size={18} className="text-gray-400" />
                   Important Notes
                 </div>
                 <ul className="text-xs text-gray-400 space-y-3 list-disc list-inside leading-relaxed">
                   <li>Capital is deployed immediately upon confirmation.</li>
                   <li>Crypto deposits require network confirmation (usually 10-30 mins).</li>
                   <li>KYC Level {kycLevel || 1} limits apply.</li>
                 </ul>
              </div>
            </motion.div>
          </div>
        </div>
      </div>
    </RequireAuth>
  )
}
