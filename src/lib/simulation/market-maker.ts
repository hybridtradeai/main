import { supabaseServer } from '../../lib/supabaseServer'
import { v4 as uuidv4 } from 'uuid'

export type TradeLog = {
  id: string
  streamId: string
  symbol: string
  type: 'BUY' | 'SELL'
  entryPrice: number
  exitPrice?: number
  profitPct?: number
  status: 'OPEN' | 'CLOSED'
  simulatedAt: string
}

// Market Data Constants (Mocked for realism)
const MARKET_DATA = {
  BTC: { price: 65000, volatility: 0.02 },
  ETH: { price: 3200, volatility: 0.03 },
  SOL: { price: 145, volatility: 0.04 },
  SPX: { price: 5200, volatility: 0.01 },
  NDX: { price: 18000, volatility: 0.015 },
}

const STREAMS = {
  trading: ['BTC', 'ETH', 'SOL'],
  copy_trading: ['BTC', 'ETH'],
  ai: ['BTC', 'SPX', 'NDX'],
  staking_yield: ['ETH', 'SOL'],
  ads_tasks: [] // No market trades for this
}

export class MarketMaker {
  
  /**
   * Generates a batch of simulated trades for the given stream to match a target daily ROI.
   * @param streamId The revenue stream ID (e.g., 'trading')
   * @param targetDailyRoi The target ROI for the day (e.g., 0.5 for 0.5%)
   */
  static async generateDailyTrades(streamId: string, targetDailyRoi: number) {
    if (streamId === 'ads_tasks') return [] // No trades for ads

    const symbols = STREAMS[streamId as keyof typeof STREAMS] || ['BTC']
    const trades: TradeLog[] = []
    
    // We want the sum of profitPct to be roughly targetDailyRoi.
    // We'll generate 3-5 trades.
    const numTrades = Math.floor(Math.random() * 3) + 3
    let currentTotalRoi = 0
    
    for (let i = 0; i < numTrades; i++) {
      const isLast = i === numTrades - 1
      const symbol = symbols[Math.floor(Math.random() * symbols.length)]
      const basePrice = MARKET_DATA[symbol as keyof typeof MARKET_DATA].price
      
      // Randomize price slightly
      const entryPrice = basePrice * (1 + (Math.random() * 0.01 - 0.005))
      
      // Determine profit for this trade
      // If it's the last trade, try to bridge the gap to target, but keep it realistic.
      // Otherwise, random win/loss.
      let tradeRoi = 0
      if (isLast) {
        tradeRoi = targetDailyRoi - currentTotalRoi
      } else {
        // Random between -0.5% and +1.5%
        tradeRoi = (Math.random() * 2 - 0.5) 
      }
      
      // Cap outlier ROI to avoid unrealistic single candles (e.g. max 5% per trade)
      if (tradeRoi > 5) tradeRoi = 5
      if (tradeRoi < -2) tradeRoi = -2
      
      currentTotalRoi += tradeRoi
      
      const type = Math.random() > 0.5 ? 'BUY' : 'SELL'
      
      // Calculate exit price based on ROI
      // ROI = (Exit - Entry) / Entry * 100 (for BUY)
      // Exit = Entry * (1 + ROI/100)
      let exitPrice = 0
      if (type === 'BUY') {
        exitPrice = entryPrice * (1 + tradeRoi / 100)
      } else {
        // Short: ROI = (Entry - Exit) / Entry * 100
        // Exit = Entry * (1 - ROI/100)
        exitPrice = entryPrice * (1 - tradeRoi / 100)
      }

      trades.push({
        id: uuidv4(),
        streamId,
        symbol,
        type,
        entryPrice: Number(entryPrice.toFixed(2)),
        exitPrice: Number(exitPrice.toFixed(2)),
        profitPct: Number(tradeRoi.toFixed(4)),
        status: 'CLOSED',
        simulatedAt: new Date().toISOString()
      })
    }
    
    // Batch insert
    if (supabaseServer) {
      const { error } = await supabaseServer.from('TradeLog').insert(trades)
      
      if (error) {
        console.error('Failed to insert simulated trades:', error)
      }
    }
    
    return trades
  }
  
  static async getRecentTrades(limit = 20) {
    if (!supabaseServer) return []
    const { data, error } = await supabaseServer
      .from('TradeLog')
      .select('*')
      .order('simulatedAt', { ascending: false })
      .limit(limit)
      
    if (error) return []
    return data as TradeLog[]
  }
}
