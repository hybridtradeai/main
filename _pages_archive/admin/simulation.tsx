import { useState, useEffect } from 'react';
import AdminGuard from '../../components/AdminGuard';
import { motion } from 'framer-motion';
import { SimulationResult, MarketTicker, ScenarioOutcome } from '../../src/lib/market-data/types';

export default function AdminSimulation() {
  const [result, setResult] = useState<SimulationResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const runSimulation = async () => {
    setLoading(true);
    setError('');
    try {
      const res = await fetch('/api/simulation/run');
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to run simulation');
      setResult(data);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    runSimulation();
  }, []);

  return (
    <AdminGuard>
      <div className="max-w-6xl mx-auto p-6 min-h-screen">
        <div className="flex justify-between items-center mb-8">
          <h1 className="text-3xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-blue-600 to-purple-600 dark:from-neon-blue dark:to-neon-purple">
            Financial Simulation System
          </h1>
          <button
            onClick={runSimulation}
            disabled={loading}
            className="bg-primary hover:bg-primary/90 text-primary-foreground px-6 py-2 rounded-lg font-medium transition-all"
          >
            {loading ? 'Running Simulation...' : 'Refresh Simulation'}
          </button>
        </div>

        {error && <div className="bg-destructive/10 border border-destructive p-4 rounded mb-6 text-destructive">{error}</div>}

        {result && (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
            {/* Market Data Panel */}
            <div className="bg-card text-card-foreground p-6 rounded-xl border border-border shadow-sm">
              <h2 className="text-xl font-semibold mb-4 text-primary">Live Market Data</h2>
              <div className="overflow-x-auto">
                <table className="w-full text-sm text-foreground">
                  <thead>
                    <tr className="text-left text-muted-foreground border-b border-border">
                      <th className="pb-2">Symbol</th>
                      <th className="pb-2">Price</th>
                      <th className="pb-2">24h Change</th>
                      <th className="pb-2">Volatility</th>
                    </tr>
                  </thead>
                  <tbody>
                    {result.marketData.map((ticker: MarketTicker) => (
                      <tr key={ticker.symbol} className="border-b border-border last:border-0">
                        <td className="py-3 font-mono">{ticker.symbol}</td>
                        <td className="py-3">${ticker.price.toLocaleString(undefined, { maximumFractionDigits: 2 })}</td>
                        <td className={`py-3 ${ticker.change24h >= 0 ? 'text-success' : 'text-destructive'}`}>
                          {ticker.change24h > 0 ? '+' : ''}{ticker.change24h.toFixed(2)}%
                        </td>
                        <td className="py-3">{(ticker.volatility * 100).toFixed(1)}%</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Simulation Scenarios */}
            <div className="bg-card text-card-foreground p-6 rounded-xl border border-border shadow-sm">
              <h2 className="text-xl font-semibold mb-4 text-purple-600 dark:text-purple-400">Projected Performance Scenarios</h2>
              <div className="space-y-6">
                <ScenarioCard title="Real-Time Projection" outcome={result.scenarios.realtime} color="blue" />
                <ScenarioCard title="Bull Case" outcome={result.scenarios.bull} color="green" />
                <ScenarioCard title="Bear Case" outcome={result.scenarios.bear} color="red" />
              </div>
            </div>

            {/* Revenue Breakdown (Real-time) */}
            <div className="bg-card text-card-foreground p-6 rounded-xl border border-border shadow-sm lg:col-span-2">
              <h2 className="text-xl font-semibold mb-6 text-foreground">Revenue Stream Analysis (Real-Time)</h2>
              <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
                {Object.entries(result.scenarios.realtime.revenueBreakdown).map(([stream, roi]) => (
                  <div key={stream} className="bg-muted p-4 rounded-lg">
                    <div className="text-xs text-muted-foreground uppercase tracking-wider mb-1">
                      {stream.replace('_', ' ')}
                    </div>
                    <div className="text-2xl font-bold text-foreground mb-2">
                      {(roi * 100).toFixed(2)}%
                    </div>
                    <div className="h-1.5 w-full bg-background rounded-full overflow-hidden">
                      <motion.div 
                        initial={{ width: 0 }}
                        animate={{ width: `${Math.min(100, Math.max(0, roi * 1000))}%` }} 
                        className={`h-full ${roi >= 0 ? 'bg-success' : 'bg-destructive'}`}
                      />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>
    </AdminGuard>
  );
}

function ScenarioCard({ title, outcome, color }: { title: string, outcome: ScenarioOutcome, color: string }) {
  const colorClass = color === 'green' ? 'text-success' : color === 'red' ? 'text-destructive' : 'text-primary';
  const bgClass = color === 'green' ? 'bg-success/10' : color === 'red' ? 'bg-destructive/10' : 'bg-primary/10';

  return (
    <div className="flex items-center justify-between p-4 bg-muted/50 rounded-lg">
      <div>
        <div className="font-medium text-foreground">{title}</div>
        <div className="text-xs text-muted-foreground mt-1">Risk Score: {outcome.riskScore.toFixed(0)}/100</div>
      </div>
      <div className="text-right">
        <div className={`text-2xl font-bold ${colorClass}`}>
          {(outcome.projectedRoi * 100).toFixed(2)}%
        </div>
        <div className={`text-xs px-2 py-0.5 rounded inline-block mt-1 ${bgClass} text-foreground/80`}>
          Proj. Annual ROI
        </div>
      </div>
    </div>
  );
}
