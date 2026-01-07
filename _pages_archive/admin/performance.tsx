import { useState } from 'react';
import AdminGuard from '../../components/AdminGuard';
import { supabase } from '../../lib/supabase';

const defaultStreams = { trading: 0, copy_trading: 0, staking_yield: 0, ads_tasks: 0, ai: 0 };

export default function AdminPerformance() {
  const [weekEnding, setWeekEnding] = useState<string>('');
  const [streams, setStreams] = useState<Record<string, number>>(defaultStreams);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');

  function updateStream(key: string, value: string) {
    setStreams(s => ({ ...s, [key]: Number(value) || 0 }));
  }

  async function submit() {
    setLoading(true);
    setMessage('');
    try {
      const { data } = await supabase.auth.getSession();
      const token = data.session?.access_token;
      if (!token) throw new Error('Missing session token. Please sign in again.');

      const res = await fetch('/api/admin/performance', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify({ weekEnding, streamRois: streams })
      });
      const payload = await res.json();
      if (!res.ok) throw new Error(payload?.error || 'Failed');
      setMessage('Saved performance for ' + weekEnding);
    } catch (e: any) {
      setMessage(e?.message || 'Error');
    } finally {
      setLoading(false);
    }
  }

  return (
    <AdminGuard>
    <div className="max-w-2xl mx-auto p-6">
      <h1 className="text-2xl font-semibold mb-4 text-foreground">Admin: Weekly Performance Streams</h1>
      <div className="mb-4">
        <label className="block text-sm font-medium mb-1 text-foreground">Week Ending</label>
        <input type="date" className="w-full border border-border rounded p-2 bg-background text-foreground" value={weekEnding} onChange={e => setWeekEnding(e.target.value)} />
      </div>
      <div className="grid grid-cols-1 gap-4">
        {Object.keys(streams).map(key => (
          <div key={key}>
            <label className="block text-sm font-medium mb-1 text-foreground">{(key.replace('_', ' ').toUpperCase())} ROI %</label>
            <input type="number" step="0.01" className="w-full border border-border rounded p-2 bg-background text-foreground" value={streams[key]}
              onChange={e => updateStream(key, e.target.value)} />
          </div>
        ))}
      </div>
      <button className="mt-6 bg-primary text-primary-foreground px-4 py-2 rounded hover:opacity-90 transition-opacity" disabled={loading || !weekEnding} onClick={submit}>
        {loading ? 'Saving...' : 'Save Performance'}
      </button>
      {message && <p className="mt-3 text-sm text-blue-500">{message}</p>}
      <div className="mt-8">
        <p className="text-xs text-muted-foreground">Streams: Trading, Copy-Trading, Staking/Yield, Ads & Tasks, AI. Enter weekly ROI percentages per stream. Then trigger profit distribution via POST /api/admin/distribute-profits.</p>
      </div>
    </div>
    </AdminGuard>
  );
}
