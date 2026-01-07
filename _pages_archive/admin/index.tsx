import { useEffect, useState } from 'react';
import Link from 'next/link';
import AdminGuard from '../../components/AdminGuard';
import { supabase } from '../../lib/supabase';
import AdminNavbar from '../../components/AdminNavbar';
import AdminSidebar from '../../components/AdminSidebar';
import KpiCard from '../../components/KpiCard';

type Metrics = {
  latestWeek?: string | null;
  activeInvestments?: number;
};

export default function AdminDashboard() {
  const [metrics, setMetrics] = useState<Metrics>({});
  const [message, setMessage] = useState('');
  const [loadingRunCycle, setLoadingRunCycle] = useState(false);
  const [loadingDistribute, setLoadingDistribute] = useState(false);
  const [dryRun, setDryRun] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        // Pull latest performance week and active investment count if tables exist
        const { data: perf, error: errPerf } = await supabase
          .from('Performance')
          .select('weekEnding')
          .order('weekEnding', { ascending: false })
          .limit(1);
        
        let latestWeek = perf?.[0]?.weekEnding ?? null;
        if (errPerf && (errPerf.message.includes('relation "public.Performance" does not exist') || errPerf.code === '42P01')) {
            // Fallback to lowercase
             const { data: perf2 } = await supabase.from('performance').select('week_ending').order('week_ending', { ascending: false }).limit(1);
             latestWeek = perf2?.[0]?.week_ending ?? null;
        }

        const { data: invs, error: errInv } = await supabase
          .from('Investment')
          .select('id,status')
          .eq('status', 'ACTIVE');
        
        let activeInvestments = (invs || []).length;
        if (errInv && (errInv.message.includes('relation "public.Investment" does not exist') || errInv.code === '42P01')) {
             // Fallback to lowercase/plural
             const { data: invs2 } = await supabase.from('investments').select('id,status').eq('status', 'active');
             activeInvestments = (invs2 || []).length;
        }

        setMetrics({ latestWeek, activeInvestments });
      } catch (e) {
        // ignore if tables are not present
      }
    })();
  }, []);

  async function runCycle() {
    setLoadingRunCycle(true);
    setMessage('');
    try {
      const { data } = await supabase.auth.getSession();
      const token = data.session?.access_token;
      if (!token) throw new Error('Missing session token.');

      const res = await fetch('/api/admin/run-cycle', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify({})
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error || 'Failed');
      setMessage('Run cycle executed successfully.');
    } catch (e: any) {
      setMessage(e?.message || 'Error running cycle');
    } finally {
      setLoadingRunCycle(false);
    }
  }

  async function distributeProfits() {
    setLoadingDistribute(true);
    setMessage('');
    try {
      const { data } = await supabase.auth.getSession();
      const token = data.session?.access_token;
      if (!token) throw new Error('Missing session token.');

      const url = `/api/admin/distribute-profits${dryRun ? '?dryRun=true' : ''}`;
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify({})
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error || 'Failed');
      setMessage(dryRun ? 'Dry run completed. Check logs/output.' : 'Profit distribution executed successfully.');
    } catch (e: any) {
      setMessage(e?.message || 'Error distributing profits');
    } finally {
      setLoadingDistribute(false);
    }
  }

  return (
    <AdminGuard>
      <div className="grid md:grid-cols-[260px,1fr] gap-6 p-6">
        <div>
          <AdminSidebar />
        </div>
        <div className="space-y-6">
          <AdminNavbar onQuickRun={distributeProfits} />

          <div className="grid md:grid-cols-3 gap-6">
            <KpiCard title="Latest Performance Week" value={metrics.latestWeek || '—'} />
            <KpiCard title="Active Investments" value={metrics.activeInvestments ?? '—'} />
            <KpiCard title="Dry Run" value={dryRun ? 'On' : 'Off'} />
          </div>

          <div className="grid md:grid-cols-2 gap-6">
            <div className="card-neon">
              <h3 className="font-semibold text-foreground">Distribute Weekly Profits</h3>
              <p className="mt-2 text-sm text-muted-foreground">Requires performance data for the latest week.</p>
              <label className="mt-3 inline-flex items-center gap-2 text-sm text-foreground">
                <input type="checkbox" checked={dryRun} onChange={e => setDryRun(e.target.checked)} /> Dry run
              </label>
              <button className="btn-neon mt-4" onClick={distributeProfits} disabled={loadingDistribute}>
                {loadingDistribute ? 'Processing...' : dryRun ? 'Simulate Distribution' : 'Execute Distribution'}
              </button>
            </div>
            <div className="card-neon">
              <h3 className="font-semibold text-foreground">Run Cycle</h3>
              <p className="mt-2 text-sm text-muted-foreground">Handles day 7 ROI crediting and day 14 principal release.</p>
              <button className="btn-neon mt-4" onClick={runCycle} disabled={loadingRunCycle}>
                {loadingRunCycle ? 'Running...' : 'Run Cycle Now'}
              </button>
            </div>
          </div>

          {message && <p className="text-sm mt-2 text-muted-foreground">{message}</p>}
        </div>
      </div>
    </AdminGuard>
  );
}
