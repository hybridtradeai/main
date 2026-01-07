import { useEffect, useRef, useState } from 'react'
import { motion } from 'framer-motion'
import RequireAuth from '../components/RequireAuth'
import { useCurrency } from '../hooks/useCurrency'
import { supabase } from '../lib/supabase'
import { useI18n } from '../hooks/useI18n'
import { ArrowLeft, Wallet, ShieldCheck, AlertCircle, Clock, CheckCircle2 } from 'lucide-react'
import Link from 'next/link'
import { getUserWallets } from '../lib/db'
import { getCurrentUserId } from '../lib/db'
import FuturisticBackground from '../components/ui/FuturisticBackground'
import Head from 'next/head'

export default function WithdrawPage() {
  const { t } = useI18n()
  const { currency } = useCurrency('USD')
  const [amount, setAmount] = useState('')
  const [destinationAddress, setDestinationAddress] = useState('')
  const [network, setNetwork] = useState('TRC20')
  const [msg, setMsg] = useState('')
  const [err, setErr] = useState('')
  const [available, setAvailable] = useState(0)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    fetchBalance()
  }, [])

  async function fetchBalance() {
    const uid = await getCurrentUserId()
    if (!uid) return
    const wallets = await getUserWallets(uid)
    const usdWallet = wallets.find(w => w.currency === 'USD')
    if (usdWallet) setAvailable(usdWallet.balance || 0)
  }

  async function submit() {
    setErr(''); setMsg('')
    const amt = Number(amount)
    if (!amt || amt <= 0) { setErr(t('invalid_amount') || 'Invalid amount'); return }
    if (amt > available) { setErr(t('insufficient_funds') || 'Insufficient funds'); return }
    if (!destinationAddress) { setErr('Please enter a destination address'); return }
    
    setLoading(true)
    try {
      const { data: session } = await supabase.auth.getSession()
      const token = session.session?.access_token
      if (!token) { setErr(t('please_login_first')); setLoading(false); return }

      const res = await fetch('/api/user/transactions', { 
        method: 'POST', 
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        }, 
        body: JSON.stringify({ 
          amount: amt, 
          currency, 
          kind: 'withdraw',
          destinationAddress,
          network
        }) 
      })
      
      const text = await res.text()
      let json
      try {
        json = JSON.parse(text)
      } catch (e) {
        console.error('JSON Parse Error:', text)
        setErr(`Server Error: ${res.status} ${res.statusText}`)
        setLoading(false)
        return
      }

      if (!res.ok) { 
        if (json?.error === 'kyc_required') {
           setErr('Identity Verification Required: Please complete your KYC verification to withdraw funds.')
        } else {
           setErr(String(json?.details || json?.error || 'Failed')) 
        }
        setLoading(false); return 
      }
      setMsg(String(json?.message || t('withdraw_success')))
      setAmount('')
      setDestinationAddress('')
      fetchBalance() // Refresh balance
    } catch (e: any) { setErr(String(e?.message || 'Error')) }
    setLoading(false)
  }

  return (
    <RequireAuth>
      <Head>
        <title>Withdraw Funds | HybridTrade AI</title>
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
            <div>
              <h1 className="text-3xl font-bold bg-gradient-to-r from-white via-cyan-200 to-blue-400 bg-clip-text text-transparent">
                Withdraw Funds
              </h1>
              <p className="text-muted-foreground text-sm">Securely transfer your assets to external wallets</p>
            </div>
          </motion.div>

          <div className="grid md:grid-cols-[1.6fr,1fr] gap-8">
            {/* Main Withdrawal Form */}
            <motion.div 
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.1 }}
              className="relative overflow-hidden rounded-3xl bg-black/40 backdrop-blur-xl border border-white/10 shadow-[0_0_40px_rgba(0,229,255,0.05)] p-8"
            >
              {/* Background decoration */}
              <div className="absolute top-0 right-0 w-64 h-64 bg-cyan-500/10 rounded-full blur-[100px] pointer-events-none -mr-32 -mt-32"></div>

              <div className="relative z-10">
                <div className="mb-8 p-6 rounded-2xl bg-gradient-to-br from-white/5 to-transparent border border-white/5">
                   <div className="text-sm text-cyan-400 mb-2 flex items-center gap-2 font-medium">
                     <Wallet size={16} />
                     Available Balance
                   </div>
                   <div className="text-5xl font-bold tracking-tight text-white drop-shadow-[0_0_15px_rgba(255,255,255,0.3)]">
                     ${available.toLocaleString(undefined, {minimumFractionDigits: 2})}
                   </div>
                </div>

                {msg && (
                  <motion.div 
                    initial={{ opacity: 0, scale: 0.95 }}
                    animate={{ opacity: 1, scale: 1 }}
                    className="bg-green-500/10 border border-green-500/20 text-green-200 p-4 rounded-xl mb-6 text-sm flex items-start gap-3"
                  >
                    <CheckCircle2 size={18} className="mt-0.5 shrink-0 text-green-400"/>
                    <span className="flex-1">
                      {msg}{' '}
                      <Link href="/transactions" className="underline decoration-green-500/30 hover:text-green-300 transition-colors">View history</Link>
                    </span>
                  </motion.div>
                )}
                {err && (
                  <motion.div 
                    initial={{ opacity: 0, scale: 0.95 }}
                    animate={{ opacity: 1, scale: 1 }}
                    className="bg-red-500/10 border border-red-500/20 text-red-200 p-4 rounded-xl mb-6 text-sm flex items-start gap-3"
                  >
                    <AlertCircle size={18} className="mt-0.5 shrink-0 text-red-400"/> 
                    <span>{err}</span>
                  </motion.div>
                )}

                <div className="space-y-6">
                  <div>
                    <label className="block text-sm text-gray-400 mb-2 ml-1">Amount to withdraw (USD)</label>
                    <div className="relative group">
                      <span className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400 group-focus-within:text-cyan-400 transition-colors">$</span>
                      <input 
                        type="number" 
                        value={amount}
                        onChange={(e) => setAmount(e.target.value)}
                        className="w-full bg-black/20 border border-white/10 rounded-xl pl-8 pr-4 py-4 text-xl text-white placeholder:text-gray-600 focus:border-cyan-500/50 focus:ring-1 focus:ring-cyan-500/50 transition-all outline-none"
                        placeholder="0.00"
                      />
                    </div>
                    {amount && Number(amount) > 0 && (
                        <motion.div 
                          initial={{ opacity: 0 }}
                          animate={{ opacity: 1 }}
                          className="mt-3 text-xs flex justify-between px-1"
                        >
                            <span className="text-gray-400">Fee (1%): <span className="text-gray-300">${(Number(amount) * 0.01).toFixed(2)}</span></span>
                            <span className="text-cyan-400 font-medium">You receive: ${(Number(amount) * 0.99).toFixed(2)}</span>
                        </motion.div>
                    )}
                  </div>

                  <div>
                    <label className="block text-sm text-gray-400 mb-2 ml-1">Network</label>
                    <div className="relative">
                      <select 
                        value={network}
                        onChange={(e) => setNetwork(e.target.value)}
                        className="w-full bg-black/20 border border-white/10 rounded-xl px-4 py-4 text-white appearance-none focus:border-cyan-500/50 focus:ring-1 focus:ring-cyan-500/50 transition-all outline-none cursor-pointer"
                      >
                        <option value="TRC20" className="bg-gray-900">USDT (TRC20)</option>
                        <option value="ERC20" className="bg-gray-900">USDT (ERC20)</option>
                        <option value="BTC" className="bg-gray-900">Bitcoin</option>
                      </select>
                      <div className="absolute right-4 top-1/2 -translate-y-1/2 pointer-events-none text-gray-400">
                        <svg width="12" height="12" viewBox="0 0 12 12" fill="none" xmlns="http://www.w3.org/2000/svg">
                          <path d="M2.5 4.5L6 8L9.5 4.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                        </svg>
                      </div>
                    </div>
                  </div>

                  <div>
                    <label className="block text-sm text-gray-400 mb-2 ml-1">Destination Address</label>
                    <input 
                      type="text" 
                      value={destinationAddress}
                      onChange={(e) => setDestinationAddress(e.target.value)}
                      className="w-full bg-black/20 border border-white/10 rounded-xl px-4 py-4 text-white placeholder:text-gray-600 focus:border-cyan-500/50 focus:ring-1 focus:ring-cyan-500/50 transition-all outline-none font-mono text-sm"
                      placeholder="Enter wallet address"
                    />
                  </div>
                  
                  <button 
                    onClick={submit}
                    disabled={loading || available <= 0}
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
                        <>
                          Request Withdrawal
                          <ArrowLeft className="rotate-180" size={20} />
                        </>
                      )}
                    </span>
                  </button>
                </div>
              </div>
            </motion.div>

            {/* Info Sidebar */}
            <div className="space-y-4">
              <motion.div 
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: 0.2 }}
                className="bg-black/40 backdrop-blur-xl border border-white/10 rounded-2xl p-6"
              >
                <div className="flex items-center gap-2 mb-4 text-white font-medium">
                  <ShieldCheck size={20} className="text-cyan-400" />
                  Security Check
                </div>
                <p className="text-sm text-gray-400 leading-relaxed">
                  For your security, all withdrawals are processed manually. Requests over $10,000 may require additional identity verification steps to ensure compliance and safety.
                </p>
              </motion.div>

              <motion.div 
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: 0.3 }}
                className="bg-black/40 backdrop-blur-xl border border-white/10 rounded-2xl p-6"
              >
                <div className="flex items-center gap-2 mb-4 text-white font-medium">
                  <Clock size={20} className="text-blue-400" />
                  Processing Times
                </div>
                <div className="space-y-3">
                  <div className="flex justify-between items-center p-3 rounded-xl bg-white/5 border border-white/5">
                    <span className="text-sm text-gray-400">Standard</span>
                    <span className="text-sm font-medium text-white">24-48 hours</span>
                  </div>
                  <div className="flex justify-between items-center p-3 rounded-xl bg-gradient-to-r from-cyan-500/10 to-blue-500/10 border border-cyan-500/20">
                    <span className="text-sm text-gray-400">Priority</span>
                    <span className="text-sm font-medium text-cyan-300">Instant - 4 hours</span>
                  </div>
                </div>
              </motion.div>
            </div>
          </div>
        </div>
      </div>
    </RequireAuth>
  )
}
