import { useEffect, useMemo, useState } from 'react';
import AdminGuard from '../../components/AdminGuard';

type Summary = {
  reserveBuffer: { currentAmount: number; totalAUM: number; updatedAt: string | null }
  aumUSD: number
  walletsUSDTotal: number
  currencyBreakdownUSD: { currency: string; total: number; usd: number }[]
  coveragePct: number
  generatedAt: string
}

export default function AdminProof() {
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState('');
  const [summary, setSummary] = useState<Summary | null>(null);

  async function fetchSummary() {
    setLoading(true);
    try {
      const res = await fetch('/api/transparency');
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Failed');
      setSummary(json as Summary);
    } catch (e: any) {
      setMsg(e.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { fetchSummary(); }, []);
  const rows = useMemo(() => Array.isArray(summary?.currencyBreakdownUSD) ? summary!.currencyBreakdownUSD : [], [summary]);

  return (
    <AdminGuard>
      <div className="p-6 space-y-6">
        <h1 className="text-2xl font-semibold text-foreground">Proof of Reserves</h1>
        {msg && <p className="text-sm text-destructive">{msg}</p>}
        {loading && <p className="text-sm text-muted-foreground">Loading…</p>}

        <div className="grid md:grid-cols-4 gap-4">
          <div className="bg-card text-card-foreground p-4 border border-border rounded-lg shadow-sm">
            <div className="text-sm text-muted-foreground">Reserve Buffer (USD)</div>
            <div className="text-2xl font-bold text-foreground">{Number(summary?.reserveBuffer?.currentAmount || 0).toLocaleString()}</div>
            <div className="text-xs text-muted-foreground">Updated {summary?.reserveBuffer?.updatedAt ? new Date(summary.reserveBuffer.updatedAt).toLocaleString() : '—'}</div>
          </div>
          <div className="bg-card text-card-foreground p-4 border border-border rounded-lg shadow-sm">
            <div className="text-sm text-muted-foreground">AUM (USD)</div>
            <div className="text-2xl font-bold text-foreground">{Number(summary?.aumUSD || 0).toLocaleString()}</div>
          </div>
          <div className="bg-card text-card-foreground p-4 border border-border rounded-lg shadow-sm">
            <div className="text-sm text-muted-foreground">Wallets Total (USD)</div>
            <div className="text-2xl font-bold text-foreground">{Number(summary?.walletsUSDTotal || 0).toLocaleString()}</div>
          </div>
          <div className="bg-card text-card-foreground p-4 border border-border rounded-lg shadow-sm">
            <div className="text-sm text-muted-foreground">Coverage</div>
            <div className="text-2xl font-bold text-foreground">{Number(summary?.coveragePct || 0).toFixed(2)}%</div>
          </div>
        </div>

        <div className="rounded-xl bg-card text-card-foreground border border-border overflow-x-auto shadow-sm">
          <table className="w-full text-sm text-foreground">
            <thead>
              <tr className="bg-muted text-muted-foreground">
                <th className="p-3 text-left font-medium">Currency</th>
                <th className="p-3 text-right font-medium">Total</th>
                <th className="p-3 text-right font-medium">USD Equivalent</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.currency} className="hover:bg-muted/50 border-t border-border transition-colors">
                  <td className="p-3">{row.currency}</td>
                  <td className="p-3 text-right">{Number(row.total).toLocaleString()}</td>
                  <td className="p-3 text-right">{Number(row.usd).toLocaleString()}</td>
                </tr>
              ))}
              {rows.length === 0 && (
                <tr>
                  <td className="p-3 text-muted-foreground text-center" colSpan={3}>No data</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <div className="flex items-center gap-3">
          <button onClick={fetchSummary} className="bg-primary text-primary-foreground px-4 py-2 rounded hover:opacity-90 transition-opacity">Refresh</button>
          <div className="text-xs text-muted-foreground">Generated {summary?.generatedAt ? new Date(summary.generatedAt).toLocaleString() : '—'}</div>
        </div>
      </div>
    </AdminGuard>
  );
}
