import dynamic from 'next/dynamic'
const Sidebar = dynamic(() => import('../components/Sidebar'))
const LivePerformance = dynamic(() => import('../components/LivePerformance'), { ssr: false })
const TradeFeed = dynamic(() => import('../components/TradeFeed'), { ssr: false })
const InvestmentAllocation = dynamic(() => import('../components/InvestmentAllocation'), { ssr: false })
const StrategyInsights = dynamic(() => import('../components/StrategyInsights'), { ssr: false })
const PnLMetrics = dynamic(() => import('../components/PnLMetrics'), { ssr: false })
const ROIGauge = dynamic(() => import('../components/ROIGauge'), { ssr: false })
const SentimentGauge = dynamic(() => import('../components/SentimentGauge'), { ssr: false })
const RecentActivity = dynamic(() => import('../components/RecentActivity'), { ssr: false })
const WorldMarketClock = dynamic(() => import('../components/WorldMarketClock'), { ssr: false })
const RiskRadar = dynamic(() => import('../components/RiskRadar'), { ssr: false })
const AssetHeatmap = dynamic(() => import('../components/AssetHeatmap'), { ssr: false })
const AIPredictionCard = dynamic(() => import('../components/AIPredictionCard'), { ssr: false })
import DashboardSkeleton from '../components/DashboardSkeleton'
import RequireAuth from '../components/RequireAuth';
import { useCurrency, supportedCurrencies } from '../hooks/useCurrency';
import { getCurrentUserId, getUserInvestments, getUserWallets } from '../lib/db';
import { useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from '../lib/supabase';
import { useUserNotifications } from '../src/hooks/useUserNotifications';
import { useI18n } from '../hooks/useI18n';
import Head from 'next/head'
import { useRouter } from 'next/router'
import { ArrowUpRight, Wallet, Activity, TrendingUp, MessageSquare, Award, PlusCircle, ArrowUpCircle, History, Layers, ArrowDownLeft, ArrowUpRight as ArrowUpRightIcon, Zap, Star, Crown, DollarSign, PieChart, BarChart3, Globe, Shield } from 'lucide-react'
import MarketTicker from '../components/MarketTicker'
import FuturisticBackground from '../components/ui/FuturisticBackground';
import { motion } from 'framer-motion';
import DashboardCard from '../components/DashboardCard';

export default function Dashboard() {
  const { t, lang } = useI18n();
  const router = useRouter()
  const langs = ['en','es','fr']
  const base = process.env.NEXT_PUBLIC_SITE_URL || ''
  const path = router?.pathname || '/dashboard'
  const { currency, setCurrency, format, convertToUSD } = useCurrency('USD');
  const [loading, setLoading] = useState(true);
  const [walletTotalUSD, setWalletTotalUSD] = useState(0);
  const [investedUSD, setInvestedUSD] = useState(0);
  const [refreshKey, setRefreshKey] = useState(0);
  const userIdRef = useRef<string | null>(null);
  const { items: notifications } = useUserNotifications();
  
  const [currentPlan, setCurrentPlan] = useState<'starter'|'pro'|'elite'|'none'>('none')
  const [activeApprox, setActiveApprox] = useState<number>(0)
  const [bestStream, setBestStream] = useState({ name: 'High Frequency Trading', roi: 12.5 }) // Mock/Default

  const [investmentsState, setInvestmentsState] = useState<any[]>([])
  const [walletsState, setWalletsState] = useState<any[]>([])
  const [cycleDay, setCycleDay] = useState<number>(0)
  const [nextCreditDate, setNextCreditDate] = useState<string>('')
  const [cyclePct, setCyclePct] = useState<number>(0)
  const [insightsTab, setInsightsTab] = useState<'performance'|'trades'>('performance')
  const [newsItems, setNewsItems] = useState<Array<{ title: string; link?: string; source?: string }>>([])
  const [newsCategory, setNewsCategory] = useState<'all'|'tech'|'crypto'|'stocks'>('all')

  // Notifications trigger refresh
  const latest = useMemo(() => notifications[0], [notifications]);
  useEffect(() => {
    if (!latest) return;
    const t = String((latest as any)?.type || '');
    if (t === 'manual_credit' || t === 'profit' || t === 'investment_status') {
      setRefreshKey((k) => k + 1);
    }
  }, [latest]);

  // Data Fetching
  useEffect(() => {
    async function fetchData() {
      const userId = await getCurrentUserId();
      if (!userId) return;
      userIdRef.current = userId;
      
      try {
        const { data: profile } = await supabase
          .from('profiles')
          .select('currency')
          .eq('user_id', userId)
          .maybeSingle();
        const preferred = (profile?.currency as any) || 'USD';
        setCurrency((prev) => prev || preferred);
      } catch {}

      const [wallets, investments] = await Promise.all([
        getUserWallets(userId),
        getUserInvestments(userId)
      ]);
      setInvestmentsState(investments)
      setWalletsState(wallets)

      const totalUSD = wallets.reduce((sum, w) => {
        const amt = Number(w.balance) || 0;
        return sum + convertToUSD(amt, w.currency as any);
      }, 0);
      setWalletTotalUSD(Number(totalUSD.toFixed(2)));

      const activeInvestments = investments.filter(i => i.status === 'active');
      const totalInvested = activeInvestments.reduce((sum, i) => sum + i.amount_usd, 0);
      setInvestedUSD(totalInvested);
      
      const planId = activeInvestments[0]?.plan_id || 'starter'
      setCurrentPlan((activeInvestments.length > 0 ? planId : 'none') as any)

      try {
        const createdRaw = activeInvestments[0]?.created_at || activeInvestments[0]?.createdAt
        if (createdRaw) {
          const start = new Date(String(createdRaw))
          const now = new Date()
          const diffMs = now.getTime() - start.getTime()
          const day = Math.max(1, Math.min(14, Math.floor(diffMs / (24*60*60*1000)) + 1))
          setCycleDay(day)
          setCyclePct(Math.min(100, Math.round((day / 14) * 100)))
          const nextCredit = new Date(start)
          nextCredit.setDate(start.getDate() + 7)
          setNextCreditDate(nextCredit.toLocaleDateString())
        } else {
          setCycleDay(0)
          setCyclePct(0)
          setNextCreditDate('')
        }
      } catch {}
      setLoading(false);
    }
    fetchData();
  }, [currency, refreshKey, convertToUSD, setCurrency]);

  // Presence / Active Traders
  useEffect(() => {
    const fetchPresence = async () => {
      try {
        const res = await fetch('/api/presence/simulated', { cache: 'no-store' })
        const json = await res.json()
        if (res.ok) setActiveApprox(Number(json?.activeTradersApprox || 0))
      } catch {}
    }
    fetchPresence()
    const id = setInterval(fetchPresence, 45000)
    return () => clearInterval(id)
  }, [])

  // Best Performing Stream (from simulation stats)
  useEffect(() => {
    let mounted = true
    ;(async () => {
      try {
        const res = await fetch('/api/simulation/stats', { cache: 'no-store' })
        const json = await res.json()
        if (!mounted || !res.ok) return
        const b = json?.best
        if (b && typeof b?.avg === 'number') {
          setBestStream({ name: String(b.name || 'Top Stream'), roi: Number((b.avg).toFixed(2)) })
        }
      } catch {
        // keep existing mock if API fails
      }
    })()
    return () => { mounted = false }
  }, [])

  const activeInvestments = investmentsState.filter(i => i.status === 'active');

  useEffect(() => {
    let mounted = true
    ;(async () => {
      try {
        const res = await fetch(`/api/news?category=${newsCategory}`, { cache: 'no-store' })
        const json = await res.json()
        if (!mounted || !res.ok) return
        const items = Array.isArray(json?.items) ? json.items : []
        setNewsItems(items.slice(0, 10))
      } catch {}
    })()
    return () => { mounted = false }
  }, [newsCategory])

  return (
    <RequireAuth>
      <FuturisticBackground />
      <div className="flex flex-col md:flex-row min-h-screen text-foreground relative z-10">
        <Sidebar />

        <main className="flex-1 p-6 md:p-8 space-y-6 overflow-y-auto relative">
          <Head>
            <title>{t('dashboard_title')}</title>
            <meta name="description" content="Advanced Fintech Trading Dashboard" />
          </Head>

          {loading ? <DashboardSkeleton /> : (
            <motion.div 
              initial={{ opacity: 0 }} 
              animate={{ opacity: 1 }} 
              transition={{ duration: 0.8 }}
              className="space-y-8"
            >
          {/* Header Section */}
          <div className="flex flex-col lg:flex-row justify-between items-start lg:items-center gap-6 bg-card/30 backdrop-blur-md p-6 rounded-3xl border border-white/5 shadow-2xl">
            <div>
              <h1 className="text-4xl font-extrabold tracking-tight bg-gradient-to-r from-white via-primary to-purple-400 bg-clip-text text-transparent drop-shadow-lg">
                Dashboard
              </h1>
              <div className="text-muted-foreground mt-2 flex items-center gap-3 text-sm font-medium">
                <span className="flex items-center gap-1.5 px-3 py-1 rounded-full bg-primary/10 text-primary border border-primary/20 shadow-[0_0_10px_rgba(0,229,255,0.2)]">
                    <span className="w-2 h-2 rounded-full bg-green-400 animate-pulse shadow-[0_0_8px_#4ade80]" />
                    {activeApprox.toLocaleString()} Active
                </span>
                <span className="text-white/20">•</span>
                <span className="font-mono text-white/60">{new Date().toLocaleDateString(undefined, { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}</span>
              </div>
            </div>
            
            <div className="flex flex-wrap items-center gap-4">
               <select
                  className="bg-black/40 border border-white/10 text-white text-sm py-2.5 px-4 rounded-xl focus:outline-none focus:ring-2 focus:ring-primary/50 backdrop-blur-sm transition-all"
                  value={currency}
                  onChange={(e) => setCurrency(e.target.value as any)}
                >
                  {supportedCurrencies.map(c => (
                    <option key={c} value={c} className="bg-gray-900">{c}</option>
                  ))}
                </select>

              <button onClick={() => router.push('/deposit')} className="relative group overflow-hidden bg-primary text-primary-foreground px-6 py-2.5 rounded-xl font-semibold shadow-[0_0_20px_rgba(0,229,255,0.4)] transition-all hover:scale-105 hover:shadow-[0_0_30px_rgba(0,229,255,0.6)]">
                <div className="absolute inset-0 bg-white/20 translate-y-full group-hover:translate-y-0 transition-transform duration-300" />
                <span className="relative flex items-center gap-2"><PlusCircle size={18} /> Deposit</span>
              </button>
              <button onClick={() => router.push('/withdraw')} className="flex items-center gap-2 px-6 py-2.5 rounded-xl font-semibold bg-white/5 border border-white/10 hover:bg-white/10 hover:border-white/20 transition-all backdrop-blur-md">
                <ArrowUpCircle size={18} /> Withdraw
              </button>
            </div>
          </div>

          {/* Stats Grid */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
            
            <DashboardCard 
              title="Total Balance" 
              value={format(walletTotalUSD)} 
              icon={<Wallet size={20} />}
              trend="up"
              trendValue="+2.4%"
            />

            <DashboardCard 
              title="Total Invested" 
              value={format(investedUSD)} 
              icon={<DollarSign size={20} />}
              sublabel="Active Assets"
              className="hover:border-purple-500/30"
            />

             <DashboardCard 
               title="Current Plan" 
               value={currentPlan === 'none' ? 'No Plan' : currentPlan.toUpperCase()}
               icon={currentPlan === 'elite' ? <Crown size={20} /> : currentPlan === 'pro' ? <Star size={20} /> : <Zap size={20} />}
               className="hover:border-yellow-500/30"
             >
                <div className="flex items-end justify-between mt-1">
                     <div className="text-sm font-medium text-muted-foreground">{cycleDay}/14 Days</div>
                     {currentPlan !== 'none' && (
                        <div className="w-20 h-1 bg-white/10 rounded-full overflow-hidden mb-1.5">
                            <div className="h-full bg-yellow-500" style={{ width: `${cyclePct}%` }} />
                        </div>
                     )}
                </div>
            </DashboardCard>

            <DashboardCard 
              title="Top Performer" 
              value={`+${bestStream.roi}%`} 
              icon={<Award size={20} />}
              sublabel={bestStream.name}
              trend="up"
              trendValue="High ROI"
              className="hover:border-pink-500/30"
            />

          </div>

          {/* Main Content Layout */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            
            {/* Left Column (Primary Content) */}
            <div className="lg:col-span-2 space-y-6">
                
                {/* Main Chart Card */}
                <div className="glass rounded-2xl border border-border/50 overflow-hidden">
                    <div className="p-4 border-b border-border/50 flex items-center justify-between">
                        <h3 className="font-semibold flex items-center gap-2">
                            <Activity size={18} className="text-primary" />
                            Live Market Performance
                        </h3>
                        <div className="flex bg-muted/20 rounded-lg p-1 gap-1">
                            <button 
                                onClick={() => setInsightsTab('performance')}
                                className={`px-3 py-1 rounded-md text-xs font-medium transition-all ${insightsTab === 'performance' ? 'bg-primary text-primary-foreground shadow' : 'text-muted-foreground hover:text-foreground'}`}
                            >
                                Chart
                            </button>
                            <button 
                                onClick={() => setInsightsTab('trades')}
                                className={`px-3 py-1 rounded-md text-xs font-medium transition-all ${insightsTab === 'trades' ? 'bg-primary text-primary-foreground shadow' : 'text-muted-foreground hover:text-foreground'}`}
                            >
                                Trades
                            </button>
                        </div>
                    </div>
                    <div className="p-4 h-[400px]">
                        {insightsTab === 'performance' ? <LivePerformance /> : <TradeFeed />}
                    </div>
                </div>

                {/* Portfolio & Heatmap Split */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    {/* Allocation */}
                    <div className="bg-card/20 backdrop-blur-md border border-white/10 shadow-lg rounded-3xl p-6 h-[350px] flex flex-col hover:border-blue-500/30 transition-colors">
                        <h3 className="font-semibold flex items-center gap-2 mb-4">
                            <PieChart size={18} className="text-blue-500" />
                            Asset Allocation
                        </h3>
                         {activeInvestments[0] ? (
                            <div className="flex-1">
                                <InvestmentAllocation 
                                planId={activeInvestments[0].plan?.slug || (activeInvestments[0] as any).planId || 'starter'} 
                                amount={activeInvestments[0].amount_usd} 
                                />
                            </div>
                        ) : (
                            <div className="flex-1 flex flex-col items-center justify-center text-center">
                                <div className="p-3 bg-muted/10 rounded-full mb-3">
                                    <PieChart size={24} className="text-muted-foreground" />
                                </div>
                                <p className="text-sm text-muted-foreground">No active allocation</p>
                            </div>
                        )}
                    </div>

                    {/* Heatmap */}
                    <div className="glass rounded-2xl border border-border/50 p-5 h-[350px] flex flex-col">
                        <h3 className="font-semibold flex items-center gap-2 mb-4">
                            <BarChart3 size={18} className="text-purple-500" />
                            Market Heatmap
                        </h3>
                        <div className="flex-1">
                            <AssetHeatmap />
                        </div>
                    </div>
                </div>

                {/* Strategy Insights */}
                <div className="glass rounded-2xl border border-border/50 p-5 h-[300px]">
                    <StrategyInsights />
                </div>

            </div>

            {/* Right Column (Sidebar Widgets) */}
            <div className="lg:col-span-1 space-y-6">
                
                {/* AI Prediction */}
                <div className="glass rounded-2xl border border-border/50 overflow-hidden">
                     <AIPredictionCard />
                </div>

                {/* Market Pulse Group */}
                <div className="grid grid-cols-2 gap-4">
                    <div className="glass rounded-xl border border-border/50 p-4 h-[160px]">
                        <SentimentGauge />
                    </div>
                    <div className="glass rounded-xl border border-border/50 p-4 h-[160px]">
                         <RiskRadar />
                    </div>
                </div>

                {/* World Clock */}
                <div className="glass rounded-2xl border border-border/50 p-4 h-[200px]">
                    <WorldMarketClock />
                </div>

                {/* Recent Activity */}
                <div className="bg-card/20 backdrop-blur-md border border-white/10 shadow-lg rounded-3xl p-6 min-h-[300px]">
                    <div className="flex items-center justify-between mb-4">
                        <h3 className="font-semibold flex items-center gap-2">
                            <History size={18} className="text-muted-foreground" />
                            Recent Activity
                        </h3>
                        <button onClick={() => router.push('/transactions')} className="text-xs text-primary hover:underline">View All</button>
                    </div>
                    <RecentActivity />
                </div>

                {/* News Feed */}
                <div className="bg-card/20 backdrop-blur-md border border-white/10 shadow-lg rounded-3xl p-6 h-[400px] flex flex-col">
                    <div className="flex items-center justify-between mb-4">
                        <h3 className="font-semibold flex items-center gap-2">
                            <Globe size={18} className="text-cyan-500" />
                            Market Intel
                        </h3>
                         <div className="flex gap-1">
                            {(['all','crypto'] as const).map((c) => (
                                <button key={c} onClick={() => setNewsCategory(c as any)} className={`text-[10px] px-2 py-0.5 rounded ${newsCategory === c ? 'bg-primary text-primary-foreground' : 'bg-muted/20 text-muted-foreground'}`}>
                                    {c.toUpperCase()}
                                </button>
                            ))}
                         </div>
                    </div>
                    <div className="space-y-3 overflow-y-auto pr-2 flex-1 scrollbar-thin scrollbar-thumb-muted/20">
                        {newsItems.map((n, i) => (
                        <div key={String(n.link || n.title)+i} className="flex flex-col gap-1 pb-3 border-b border-border/50 last:border-0 hover:bg-muted/5 p-2 rounded transition-colors cursor-pointer group">
                            <a href={n.link} target="_blank" rel="noreferrer" className="font-medium text-sm line-clamp-2 group-hover:text-primary transition-colors">{n.title}</a>
                            <div className="flex items-center justify-between text-xs text-muted-foreground">
                                <span>{n.source || 'News'}</span>
                                <span>{Math.floor(Math.random() * 12) + 1}h ago</span>
                            </div>
                        </div>
                        ))}
                    </div>
                </div>

            </div>

          </div>
          </motion.div>
          )}
        </main>
      </div>
    </RequireAuth>
  );
}
