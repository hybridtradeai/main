import { supabaseServer } from '../supabaseServer';
import { SimulationEngine } from './engine';

export interface DailyPerformance {
  day: number;
  date: string;
  roi: number; // Daily percentage (e.g., 1.5 for 1.5%)
  amount: number; // Profit amount for this day
  status: 'actual' | 'projected';
  marketCondition: 'bull' | 'bear' | 'neutral' | 'volatile';
}

export class InvestmentRunner {
  private engine: SimulationEngine;

  constructor() {
    this.engine = new SimulationEngine();
  }

  /**
   * Generates a 14-day performance report for a specific investment.
   * Uses deterministic simulation for past dates to ensure consistency.
   */
  async runInvestmentSimulation(investmentId: string): Promise<DailyPerformance[]> {
    if (!supabaseServer) throw new Error('Supabase not configured');
    const supabase = supabaseServer;
    let investment: any = null;
    let plan: any = null;

    // Try PascalCase first
    const { data: invPascal, error: errPascal } = await supabase
      .from('Investment')
      .select('*, plan:InvestmentPlan(*)')
      .eq('id', investmentId)
      .single();

    if (!errPascal && invPascal) {
      investment = invPascal;
      plan = Array.isArray(invPascal.plan) ? invPascal.plan[0] : invPascal.plan;
    } else {
      // Fallback to lowercase
      const { data: invLower, error: errLower } = await supabase
        .from('investments')
        .select('*, plan:investment_plans(*)')
        .eq('id', investmentId)
        .single();

      if (errLower || !invLower) {
         // If join fails, try fetching separately or throw
         // Try fetching investment only first
         const { data: invLower2, error: errLower2 } = await supabase
            .from('investments')
            .select('*')
            .eq('id', investmentId)
            .single();
            
         if (errLower2 || !invLower2) throw new Error('Investment not found');
         
         investment = {
             ...invLower2,
             createdAt: invLower2.created_at,
             principal: invLower2.principal,
         };
         
         // Fetch plan separately
         if (invLower2.plan_id) {
             const { data: pLower } = await supabase
                .from('investment_plans')
                .select('*')
                .eq('id', invLower2.plan_id)
                .single();
             if (pLower) {
                 plan = {
                     ...pLower,
                     returnPercentage: pLower.return_percentage,
                     payoutFrequency: pLower.payout_frequency
                 };
             }
         }
      } else {
          // Join worked
          investment = {
             ...invLower,
             createdAt: invLower.created_at,
             principal: invLower.principal,
          };
          const p = Array.isArray(invLower.plan) ? invLower.plan[0] : invLower.plan;
          if (p) {
              plan = {
                  ...p,
                  returnPercentage: p.return_percentage,
                  payoutFrequency: p.payout_frequency
              };
          }
      }
    }

    if (!investment) throw new Error('Investment not found');

    const startDate = new Date(investment.createdAt);
    const amount = Number(investment.principal);
    
    const returnPct = Number(plan?.returnPercentage || 0);
    const payoutFrequency = plan?.payoutFrequency || 'WEEKLY';
    
    // Assume returnPercentage is per payout period (WEEKLY usually)
    // We convert to daily.
    // If payoutFrequency is WEEKLY, daily = returnPct / 7.
    // If MONTHLY, daily = returnPct / 30.
    
    let dailyBase = returnPct / 7; // Default to weekly assumption
    if (payoutFrequency === 'MONTHLY') dailyBase = returnPct / 30;
    if (payoutFrequency === 'DAILY') dailyBase = returnPct;

    // Create a synthetic range for simulation variance
    const dailyMin = dailyBase * 0.8;
    const dailyMax = dailyBase * 1.2;

    const days = 14;
    const results: DailyPerformance[] = [];
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    for (let i = 0; i < days; i++) {
      const date = new Date(startDate);
      date.setDate(startDate.getDate() + i);
      
      const isPast = date < today;
      const isToday = date.getTime() === today.getTime();
      
      // Deterministic Seed: investmentId + date string
      // This ensures that if the user refreshes, "Past" data remains identical.
      const seed = this.stringToHash(investment.id + date.toISOString().split('T')[0]);
      const rand = this.seededRandom(seed);

      // Market Condition Simulation
      // We map the random seed to a market state
      const marketRoll = rand;
      let condition: 'bull' | 'bear' | 'neutral' | 'volatile' = 'neutral';
      if (marketRoll > 0.8) condition = 'bull';
      else if (marketRoll < 0.2) condition = 'bear';
      else if (marketRoll > 0.6) condition = 'volatile';

      // ROI Calculation
      // Base: Average of min/max
      const base = (dailyMin + dailyMax) / 2;
      // Variance: +/- 20% of the base, influenced by condition
      let variance = (rand - 0.5) * (base * 0.4); 
      
      if (condition === 'bull') variance += base * 0.1;
      if (condition === 'bear') variance -= base * 0.1;
      
      // Clamp strictly to plan limits
      let dailyRoi = Math.max(dailyMin, Math.min(dailyMax, base + variance));
      
      // Round to 2 decimals
      dailyRoi = Math.round(dailyRoi * 100) / 100;

      const dailyProfit = amount * (dailyRoi / 100);

      results.push({
        day: i + 1,
        date: date.toISOString(),
        roi: dailyRoi,
        amount: dailyProfit,
        status: (isPast || isToday) ? 'actual' : 'projected',
        marketCondition: condition
      });
    }

    return results;
  }

  // Simple string hash for seeding
  private stringToHash(str: string): number {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // Convert to 32bit integer
    }
    return Math.abs(hash);
  }

  // Pseudo-random generator using seed (0-1)
  private seededRandom(seed: number): number {
    const x = Math.sin(seed++) * 10000;
    return x - Math.floor(x);
  }
}
