import { useEffect, useState } from 'react';
import AdminGuard from '../../components/AdminGuard';
import { supabase } from '../../lib/supabase';

type Tx = {
  id: string;
  user_id: string;
  type: string;
  amount?: number;
  amount_usd?: number;
  currency: string;
  status: string;
  tx_hash?: string;
  created_at: string;
  profiles: { email: string } | null;
};

export default function AdminTransactions() {
  const [rows, setRows] = useState<Tx[]>([]);
  const [loading, setLoading] = useState(true);
  const [typeFilter, setTypeFilter] = useState<string>('');
  const [statusFilter, setStatusFilter] = useState<string>('');
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(25);
  const [total, setTotal] = useState(0);
  const [msg, setMsg] = useState<string>('');

  async function fetchTx() {
    setLoading(true);
    setMsg('');
    try {
      const { data: session } = await supabase.auth.getSession();
      const token = session.session?.access_token;
      const params = new URLSearchParams();
      if (typeFilter) params.set('type', typeFilter);
      if (statusFilter) params.set('status', statusFilter);
      params.set('page', String(page));
      params.set('limit', String(limit));
      const res = await fetch(`/api/admin/transactions?${params.toString()}`, {
        headers: token ? { Authorization: `Bearer ${token}` } : undefined,
      });
      const payload = await res.json();
      if (!res.ok) throw new Error(payload?.error || 'Failed to load transactions');
      setRows(Array.isArray(payload.items) ? payload.items : []);
      setTotal(Number(payload.total || 0));
    } catch (e: any) {
      setMsg(e?.message || 'Failed to load transactions');
      setRows([]);
      setTotal(0);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    fetchTx();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [typeFilter, statusFilter, page, limit]);

  async function updateStatus(id: string, status: 'confirmed' | 'rejected') {
    setMsg('');
    try {
      const { data: session } = await supabase.auth.getSession();
      const token = session.session?.access_token;
      const res = await fetch('/api/admin/transactions', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({ id, status }),
      });
      const payload = await res.json();
      if (!res.ok) throw new Error(payload?.error || 'Update failed');
      fetchTx();
    } catch (e: any) {
      setMsg(e?.message || 'Update failed');
    }
  }

  return (
    <AdminGuard>
      <div className="max-w-7xl mx-auto p-6 space-y-4">
        <h1 className="text-2xl font-semibold mb-4 text-foreground">Transactions</h1>
        <div className="flex flex-wrap gap-3 mb-4 items-center">
          <select
            className="border border-border rounded px-2 py-1 text-sm bg-background text-foreground"
            value={typeFilter}
            onChange={(e) => setTypeFilter(e.target.value)}
          >
            <option value="">All types</option>
            <option value="deposit">Deposit</option>
            <option value="withdrawal">Withdrawal</option>
            <option value="profit">Profit</option>
            <option value="referral">Referral</option>
          </select>
          <select
            className="border border-border rounded px-2 py-1 text-sm bg-background text-foreground"
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
          >
            <option value="">All statuses</option>
            <option value="pending">Pending</option>
            <option value="confirmed">Confirmed</option>
            <option value="cancelled">Cancelled</option>
            <option value="failed">Failed</option>
            <option value="rejected">Rejected</option>
          </select>
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <label>Page</label>
            <input 
              type="number" 
              min={1} 
              value={page} 
              onChange={(e) => setPage(Math.max(1, Number(e.target.value || 1)))} 
              className="border border-border rounded px-2 py-1 w-20 bg-background text-foreground" 
            />
            <button
              className="border border-border rounded px-2 py-1 bg-secondary text-secondary-foreground hover:bg-secondary/80"
              onClick={() => setPage((p) => Math.max(1, p - 1))}
            >
              Prev
            </button>
            <button
              className="border border-border rounded px-2 py-1 bg-secondary text-secondary-foreground hover:bg-secondary/80"
              onClick={() => setPage((p) => p + 1)}
            >
              Next
            </button>
            <label>Limit</label>
            <input 
              type="number" 
              min={1} 
              max={100} 
              value={limit} 
              onChange={(e) => setLimit(Math.min(100, Math.max(1, Number(e.target.value || 25))))} 
              className="border border-border rounded px-2 py-1 w-20 bg-background text-foreground" 
            />
            <span className="opacity-70">Total: {total}</span>
          </div>
        </div>
        {msg && <p className={`text-sm ${msg ? 'text-destructive' : ''}`}>{msg}</p>}
        {loading && <p className="text-sm text-muted-foreground">Loading…</p>}
        <div className="overflow-auto rounded-md border border-border">
          <table className="min-w-full table-auto text-sm">
            <thead>
              <tr className="bg-muted text-muted-foreground">
                <th className="px-2 py-1 text-left font-medium">User</th>
                <th className="px-2 py-1 text-left font-medium">Type</th>
                <th className="px-2 py-1 text-left font-medium">Amount</th>
                <th className="px-2 py-1 text-left font-medium">Currency</th>
                <th className="px-2 py-1 text-left font-medium">Status</th>
                <th className="px-2 py-1 text-left font-medium">Tx Hash</th>
                <th className="px-2 py-1 text-left font-medium">Action</th>
                <th className="px-2 py-1 text-left font-medium">Created</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((tx) => (
                <tr key={tx.id} className="border-t border-border hover:bg-muted/50 transition-colors">
                  <td className="px-2 py-1 text-foreground">{tx.profiles?.email || tx.user_id}</td>
                  <td className="px-2 py-1 text-foreground">{tx.type}</td>
                  <td className="px-2 py-1 text-foreground">{typeof tx.amount_usd === 'number' ? tx.amount_usd : tx.amount}</td>
                  <td className="px-2 py-1 uppercase text-foreground">{tx.currency}</td>
                  <td className="px-2 py-1">
                    <span
                      className={`inline-block px-2 rounded text-xs ${
                        tx.status === 'confirmed'
                          ? 'bg-success/10 text-success'
                          : tx.status === 'cancelled' || tx.status === 'failed' || tx.status === 'rejected'
                          ? 'bg-destructive/10 text-destructive'
                          : 'bg-warning/10 text-warning'
                      }`}
                    >
                      {tx.status}
                    </span>
                  </td>
                  <td className="px-2 py-1 text-xs text-muted-foreground">{tx.tx_hash ? `${tx.tx_hash.slice(0, 8)}…${tx.tx_hash.slice(-6)}` : '-'}</td>
                  <td className="px-2 py-1">
                    {tx.type === 'withdrawal' && tx.status === 'pending' && (
                      <div className="flex gap-2">
                        <button className="bg-primary text-primary-foreground rounded px-2 py-1 hover:opacity-90" onClick={() => updateStatus(tx.id, 'confirmed')}>Approve</button>
                        <button className="bg-destructive text-destructive-foreground rounded px-2 py-1 hover:opacity-90" onClick={() => updateStatus(tx.id, 'rejected')}>Reject</button>
                      </div>
                    )}
                  </td>
                  <td className="px-2 py-1 text-muted-foreground">{new Date(tx.created_at).toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </AdminGuard>
  );
}
