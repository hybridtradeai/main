import Link from 'next/link'
import { motion } from 'framer-motion'
import { getCurrentUserId } from '../lib/db'
import { supabase } from '../lib/supabase'
import { useI18n } from '../hooks/useI18n'
import Head from 'next/head'
import { useRouter } from 'next/router'
import FuturisticBackground from '../components/ui/FuturisticBackground'
import { ArrowLeft, CheckCircle2, Shield, Zap, Star, Crown } from 'lucide-react'

export default function Plans() {
  const { t } = useI18n()
  function track(event: string, payload: any) {
    try { console.log('analytics', event, payload) } catch {}
  }
  const invest = async (planId: string, amount: number) => {
    try {
      const userId = await getCurrentUserId();
      if (!userId) {
        alert(t('please_login_first'));
        return;
      }
      const { data: session } = await supabase.auth.getSession()
      const token = session.session?.access_token
      if (!token) {
        alert(t('please_login_first'));
        return;
      }
      const headers = {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      }
      const res = await fetch('/api/user/invest', {
        method: 'POST',
        headers,
        body: JSON.stringify({ amount, currency: 'USD', planId })
      });
      let data: any = null;
      try { data = await res.json(); } catch {}
      
      if (res.status === 401) {
        alert(t('please_login_first'));
        return;
      }
      if (data?.message === 'insufficient_funds') {
        const promptText = t('insufficient_funds_deposit_prompt')
        const finalPrompt = promptText && promptText !== 'insufficient_funds_deposit_prompt'
          ? promptText
          : 'Insufficient funds. Would you like to deposit now?'
        if (confirm(finalPrompt)) {
            router.push(`/deposit?plan=${planId}&amount=${amount}`)
        }
        return;
      }
      if (res.ok) {
        alert(String((data && data.message) || t('deposit_recorded')));
        track('plan_select', { planId, amount })
        router.push('/dashboard') 
        return;
      }

      const errorMsg = data?.error || data?.details || 'Investment failed. Please try again.';
      if (errorMsg === 'amount_out_of_range') {
        alert(`Amount must be between ${data?.details || 'min and max'}`);
      } else {
        alert(`Error: ${errorMsg}`);
      }
    } catch (e: any) {
      console.error('Investment error:', e);
      alert('An unexpected error occurred. Please check your connection and try again.');
    }
  };

  const router = useRouter()
  const langs = ['en','es','fr']
  const base = process.env.NEXT_PUBLIC_SITE_URL || ''
  const path = router?.pathname || '/plans'
  const { lang } = useI18n() as any

  return (
    <>
      <Head>
        <title>{t('plans_title')} | HybridTrade AI</title>
        <meta name="description" content={t('plans_intro')} />
        <link rel="canonical" href={`${base}${lang==='en'?'':'/'+lang}${path}`} />
        {langs.filter((l) => l!==lang).map((l) => (
          <link key={l} rel="alternate" hrefLang={l} href={`${base}${l==='en'?'':'/'+l}${path}`} />
        ))}
        <link rel="alternate" hrefLang="x-default" href={`${base}${path}`} />
      </Head>
      <FuturisticBackground />
      
      <div className="relative min-h-screen pt-24 pb-12 px-4 sm:px-6">
        <div className="max-w-6xl mx-auto space-y-12">
          
          <motion.div 
            initial={{ opacity: 0, x: -20 }}
            animate={{ opacity: 1, x: 0 }}
            className="flex items-center gap-4"
          >
            <Link href="/dashboard" className="p-2 rounded-xl bg-black/40 border border-white/10 hover:bg-white/10 transition-all text-muted-foreground hover:text-white backdrop-blur-md group">
              <ArrowLeft size={20} className="group-hover:-translate-x-1 transition-transform" />
            </Link>
            <div>
              <h1 className="text-3xl md:text-4xl font-bold bg-gradient-to-r from-white via-cyan-200 to-blue-400 bg-clip-text text-transparent">
                {t('plans_title')}
              </h1>
              <p className="text-muted-foreground mt-1">{t('plans_intro')}</p>
            </div>
          </motion.div>

          <div className="grid md:grid-cols-3 gap-8">
            {/* Starter Plan */}
            <motion.div 
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ delay: 0.1 }}
              className="bg-black/40 backdrop-blur-xl border border-white/10 rounded-3xl p-8 shadow-[0_0_40px_rgba(0,0,0,0.2)] flex flex-col hover:border-cyan-500/30 transition-all duration-300 group"
            >
              <div className="flex items-center justify-between mb-6">
                <div className="p-3 rounded-2xl bg-cyan-500/10 text-cyan-400 group-hover:scale-110 transition-transform duration-300">
                  <Zap size={28} />
                </div>
                <div className="px-3 py-1 rounded-full bg-white/5 border border-white/10 text-xs font-medium text-gray-400 uppercase tracking-wider">
                  Entry Level
                </div>
              </div>
              
              <h3 className="text-2xl font-bold text-white mb-2">{t('plan_starter_title')}</h3>
              <div className="text-3xl font-mono text-cyan-400 mb-6">$100 <span className="text-sm text-gray-500 font-sans font-normal">min deposit</span></div>
              
              <div className="space-y-4 text-sm text-gray-300 flex-1">
                <div className="space-y-2">
                  <div className="font-semibold text-white">{t('allocation_label')}</div>
                  <ul className="space-y-1">
                    <li className="flex items-start gap-2"><div className="w-1.5 h-1.5 rounded-full bg-cyan-500 mt-1.5" /> 70% Ads & Tasks</li>
                    <li className="flex items-start gap-2"><div className="w-1.5 h-1.5 rounded-full bg-cyan-500 mt-1.5" /> 30% Basic Algorithmic Trading</li>
                  </ul>
                </div>
                
                <div className="space-y-2 pt-4 border-t border-white/5">
                  <div className="font-semibold text-white">{t('expected_weekly_label')}</div>
                  <div className="text-lg font-bold text-green-400">{t('projected_weekly_range', { range: '10–20%' })}</div>
                </div>

                <div className="pt-4 border-t border-white/5">
                  <div className="font-semibold text-white mb-1">{t('benefits_label')}</div>
                  <p className="text-xs text-gray-400 leading-relaxed">Low volatility, quick onboarding, educational tasks, low minimum entry.</p>
                </div>
              </div>

              <button 
                onClick={() => invest('starter', 100)}
                className="w-full mt-8 bg-white/5 hover:bg-cyan-500/10 border border-white/10 hover:border-cyan-500/50 text-white hover:text-cyan-400 font-semibold py-3 rounded-xl transition-all"
              >
                {t('invest_with_plan')}
              </button>
            </motion.div>

            {/* Pro Plan */}
            <motion.div 
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ delay: 0.2 }}
              className="relative bg-gradient-to-b from-cyan-900/20 to-black/40 backdrop-blur-xl border border-cyan-500/30 rounded-3xl p-8 shadow-[0_0_60px_rgba(6,182,212,0.15)] flex flex-col scale-105 z-10"
            >
              <div className="absolute top-0 left-1/2 -translate-x-1/2 -translate-y-1/2 px-4 py-1 bg-cyan-500 text-black text-xs font-bold uppercase tracking-wider rounded-full shadow-[0_0_20px_rgba(6,182,212,0.4)]">
                Most Popular
              </div>

              <div className="flex items-center justify-between mb-6">
                <div className="p-3 rounded-2xl bg-cyan-500 text-black group-hover:scale-110 transition-transform duration-300 shadow-[0_0_20px_rgba(6,182,212,0.3)]">
                  <Star size={28} fill="currentColor" />
                </div>
                <div className="px-3 py-1 rounded-full bg-cyan-500/10 border border-cyan-500/20 text-xs font-medium text-cyan-400 uppercase tracking-wider">
                  Advanced
                </div>
              </div>
              
              <h3 className="text-2xl font-bold text-white mb-2">{t('plan_pro_title')}</h3>
              <div className="text-3xl font-mono text-cyan-400 mb-6">$501 <span className="text-sm text-gray-500 font-sans font-normal">min deposit</span></div>
              
              <div className="space-y-4 text-sm text-gray-300 flex-1">
                <div className="space-y-2">
                  <div className="font-semibold text-white">{t('allocation_label')}</div>
                  <ul className="space-y-1">
                    <li className="flex items-start gap-2"><div className="w-1.5 h-1.5 rounded-full bg-cyan-400 mt-1.5" /> 60% Algorithmic Trading</li>
                    <li className="flex items-start gap-2"><div className="w-1.5 h-1.5 rounded-full bg-cyan-400 mt-1.5" /> 25% Copy‑Trading</li>
                    <li className="flex items-start gap-2"><div className="w-1.5 h-1.5 rounded-full bg-cyan-400 mt-1.5" /> 15% Ads & Tasks</li>
                  </ul>
                </div>
                
                <div className="space-y-2 pt-4 border-t border-white/5">
                  <div className="font-semibold text-white">{t('expected_weekly_label')}</div>
                  <div className="text-lg font-bold text-green-400">{t('projected_weekly_range', { range: '15–30%' })}</div>
                </div>

                <div className="pt-4 border-t border-white/5">
                  <div className="font-semibold text-white mb-1">{t('benefits_label')}</div>
                  <p className="text-xs text-gray-400 leading-relaxed">Balanced risk, access to verified traders, higher potential returns.</p>
                </div>
              </div>

              <button 
                onClick={() => invest('pro', 501)}
                className="w-full mt-8 bg-gradient-to-r from-cyan-600 to-blue-600 hover:from-cyan-500 hover:to-blue-500 text-white font-semibold py-4 rounded-xl transition-all shadow-lg shadow-cyan-500/20 hover:shadow-cyan-500/40 hover:scale-[1.02]"
              >
                {t('invest_with_plan')}
              </button>
            </motion.div>

            {/* Elite Plan */}
            <motion.div 
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ delay: 0.3 }}
              className="bg-black/40 backdrop-blur-xl border border-white/10 rounded-3xl p-8 shadow-[0_0_40px_rgba(0,0,0,0.2)] flex flex-col hover:border-purple-500/30 transition-all duration-300 group"
            >
              <div className="flex items-center justify-between mb-6">
                <div className="p-3 rounded-2xl bg-purple-500/10 text-purple-400 group-hover:scale-110 transition-transform duration-300">
                  <Crown size={28} />
                </div>
                <div className="px-3 py-1 rounded-full bg-white/5 border border-white/10 text-xs font-medium text-gray-400 uppercase tracking-wider">
                  Professional
                </div>
              </div>
              
              <h3 className="text-2xl font-bold text-white mb-2">{t('plan_elite_title')}</h3>
              <div className="text-3xl font-mono text-purple-400 mb-6">$2,001 <span className="text-sm text-gray-500 font-sans font-normal">min deposit</span></div>
              
              <div className="space-y-4 text-sm text-gray-300 flex-1">
                <div className="space-y-2">
                  <div className="font-semibold text-white">{t('allocation_label')}</div>
                  <ul className="space-y-1">
                    <li className="flex items-start gap-2"><div className="w-1.5 h-1.5 rounded-full bg-purple-500 mt-1.5" /> 50% Algorithmic Trading</li>
                    <li className="flex items-start gap-2"><div className="w-1.5 h-1.5 rounded-full bg-purple-500 mt-1.5" /> 30% Crypto Staking & Yield</li>
                    <li className="flex items-start gap-2"><div className="w-1.5 h-1.5 rounded-full bg-purple-500 mt-1.5" /> 20% AI Allocator & Copy‑Trading</li>
                  </ul>
                </div>
                
                <div className="space-y-2 pt-4 border-t border-white/5">
                  <div className="font-semibold text-white">{t('expected_weekly_label')}</div>
                  <div className="text-lg font-bold text-green-400">{t('projected_weekly_range', { range: '25–45%' })}</div>
                </div>

                <div className="pt-4 border-t border-white/5">
                  <div className="font-semibold text-white mb-1">{t('benefits_label')}</div>
                  <p className="text-xs text-gray-400 leading-relaxed">Highest return potential, premium support, monthly audit summaries, tailored allocations.</p>
                </div>
              </div>

              <button 
                onClick={() => invest('elite', 2001)}
                className="w-full mt-8 bg-white/5 hover:bg-purple-500/10 border border-white/10 hover:border-purple-500/50 text-white hover:text-purple-400 font-semibold py-3 rounded-xl transition-all"
              >
                {t('invest_with_plan')}
              </button>
            </motion.div>
          </div>

          <div className="text-center text-xs text-gray-500 max-w-2xl mx-auto">
            {t('returns_variable_disclaimer')}
          </div>
        </div>
      </div>
    </>
  );
}
