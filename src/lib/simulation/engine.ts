import { supabaseServer } from '../supabaseServer';
import { MarketDataService } from '../market-data/service';
import { MarketTicker, RevenueStream, SimulationResult, ScenarioOutcome } from '../market-data/types';

// Define revenue streams and their correlation to market data
const REVENUE_STREAMS: RevenueStream[] = [
  { 
    id: 'trading', 
    name: 'High Frequency Trading', 
    correlatedTickers: ['BTC', 'ETH'], 
    baseYield: 0.15, // 15% APY base
    volatilityMultiplier: 1.2 
  },
  { 
    id: 'copy_trading', 
    name: 'Copy Trading', 
    correlatedTickers: ['BTC', 'ETH'], 
    baseYield: 0.10, 
    volatilityMultiplier: 0.8 
  },
  { 
    id: 'staking_yield', 
    name: 'Staking & Yield Farming', 
    correlatedTickers: ['ETH', 'US10Y'], 
    baseYield: 0.05, 
    volatilityMultiplier: 0.2 
  },
  { 
    id: 'ads_tasks', 
    name: 'Ads & Tasks Platform', 
    correlatedTickers: [], // Uncorrelated
    baseYield: 0.20, 
    volatilityMultiplier: 0.1 
  },
  { 
    id: 'ai', 
    name: 'AI Arbitrage', 
    correlatedTickers: ['BTC', 'SPX', 'NDX'], 
    baseYield: 0.12, 
    volatilityMultiplier: 0.5 
  }
];

const PLAN_ALLOCATIONS: Record<string, Record<string, number>> = {
  starter: { ads_tasks: 70, trading: 30 },
  pro: { trading: 60, copy_trading: 25, ads_tasks: 15 },
  elite: { trading: 50, staking_yield: 30, ai: 20 }
};

export class SimulationEngine {
  private marketService: MarketDataService;

  constructor() {
    this.marketService = new MarketDataService();
  }

  async runFullSimulation(): Promise<SimulationResult> {
    const marketData = await this.marketService.getMarketData();
    
    // Fetch active investments for weighted analysis
    let activeInvestments: any[] = [];
    try {
        if (supabaseServer) {
            const supabase = supabaseServer
            const { data: i1, error: e1 } = await supabase.from('Investment').select('*, plan:InvestmentPlan(*)').eq('status', 'ACTIVE');
            
            if (!e1 && i1) {
                activeInvestments = i1;
            } else if (e1 && (e1.message.includes('relation') || e1.code === '42P01')) {
                 const { data: i2 } = await supabase.from('investments').select('*, plan:investment_plans(*)').eq('status', 'ACTIVE');
                 if (i2) {
                     activeInvestments = i2.map((inv: any) => ({
                         ...inv,
                         userId: inv.user_id,
                         planId: inv.plan_id,
                         plan: Array.isArray(inv.plan) ? inv.plan[0] : inv.plan
                     }));
                 }
            }
        }
    } catch (e) {
      console.warn('Simulation: Could not fetch active investments, using defaults.', e);
    }

    return {
      timestamp: new Date().toISOString(),
      marketData,
      scenarios: {
        realtime: this.calculateScenario(marketData, 'realtime', activeInvestments),
        bull: this.calculateScenario(marketData, 'bull', activeInvestments),
        bear: this.calculateScenario(marketData, 'bear', activeInvestments),
        neutral: this.calculateScenario(marketData, 'neutral', activeInvestments)
      }
    };
  }

  private calculateScenario(marketData: MarketTicker[], type: 'realtime' | 'bull' | 'bear' | 'neutral', investments: any[]): ScenarioOutcome {
    const revenueBreakdown: Record<string, number> = {};
    
    // Adjust market data based on scenario
    const adjustedData = this.applyScenarioAdjustments(marketData, type);

    // 1. Calculate raw performance per stream
    const streamPerformance: Record<string, number> = {};
    for (const stream of REVENUE_STREAMS) {
      let performance = stream.baseYield;

      if (stream.correlatedTickers.length > 0) {
        const tickers = adjustedData.filter(t => stream.correlatedTickers.includes(t.symbol));
        if (tickers.length > 0) {
          const avgChange = tickers.reduce((sum, t) => sum + t.change24h, 0) / tickers.length;
          const annualizedImpact = (avgChange / 100) * 365 * 0.1; 
          performance += annualizedImpact * stream.volatilityMultiplier;
        }
      }
      
      // Clamp annual ROI
      streamPerformance[stream.id] = Math.max(-0.2, Math.min(0.8, performance));
      revenueBreakdown[stream.id] = streamPerformance[stream.id];
    }

    // 2. Calculate Weighted Portfolio ROI
    let totalWeightedRoi = 0;
    let totalAum = 0;

    if (investments.length > 0) {
      for (const inv of investments) {
        const amount = Number(inv.principal);
        // Map plan name to allocation key (fallback to starter)
        const planName = inv.plan?.name?.toLowerCase() || 'starter';
        let planSlug = 'starter';
        if (planName.includes('pro')) planSlug = 'pro';
        if (planName.includes('elite') || planName.includes('vip')) planSlug = 'elite';
        
        const allocations = PLAN_ALLOCATIONS[planSlug] || PLAN_ALLOCATIONS['starter'];

        let invRoi = 0;
        for (const [streamId, pct] of Object.entries(allocations)) {
          const streamRoi = streamPerformance[streamId] || 0;
          invRoi += streamRoi * (pct / 100);
        }

        totalWeightedRoi += invRoi * amount;
        totalAum += amount;
      }
    }

    // If no investments, use a balanced mix (Pro plan equivalent)
    const avgRoi = totalAum > 0 
      ? totalWeightedRoi / totalAum 
      : (
          (streamPerformance['trading'] || 0) * 0.6 + 
          (streamPerformance['copy_trading'] || 0) * 0.25 + 
          (streamPerformance['ads_tasks'] || 0) * 0.15
        );

    // Risk score calculation
    const marketVol = adjustedData.reduce((sum, t) => sum + t.volatility, 0) / adjustedData.length;
    const riskScore = Math.min(100, Math.max(0, marketVol * 100 * (type === 'bear' ? 1.5 : 1.0)));

    return {
      projectedRoi: avgRoi,
      riskScore,
      revenueBreakdown
    };
  }

  private applyScenarioAdjustments(data: MarketTicker[], type: string): MarketTicker[] {
    return data.map(ticker => {
      let mod = 0;
      if (type === 'bull') mod = 2.0; // +2% daily bump
      if (type === 'bear') mod = -2.0; // -2% daily drop
      if (type === 'neutral') mod = 0;
      if (type === 'realtime') return ticker; // No change

      return {
        ...ticker,
        change24h: ticker.change24h + mod
      };
    });
  }
}
