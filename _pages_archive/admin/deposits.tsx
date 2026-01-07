import { useEffect, useState } from 'react';
import AdminGuard from '../../components/AdminGuard';
import { supabase } from '../../lib/supabase';
import { motion, AnimatePresence } from 'framer-motion';
import FuturisticBackground from '../../components/ui/FuturisticBackground';
import { Filter, RefreshCw, CheckCircle2, XCircle, Clock, Search, MoreHorizontal, X } from 'lucide-react';

type Deposit = {
  id: string;
  user_id: string;
  amount: number;
  currency: string;
  provider: string;
  status: 'pending' | 'confirmed' | 'cancelled';
  tx_hash?: string;
  created_at: string;
  profiles: { email: string } | null;
  metadata?: any;
};

export default function AdminDeposits() {
  const [rows, setRows] = useState<Deposit[]>([]);
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState('');
  const [filterStatus, setFilterStatus] = useState<'all'|'pending'|'confirmed'|'cancelled'>('all');
  const [filterProvider, setFilterProvider] = useState<string>('');
  const [selected, setSelected] = useState<Deposit | null>(null);

  async function fetchDeposits() {
    setLoading(true);
    const { data, error } = await supabase
      .from('Transaction') // PascalCase to match DB
      .select(`
        id,userId,amount,status,createdAt,reference,currency,provider,
        user:User(email)
      `)
      .eq('type', 'DEPOSIT')
      .order('createdAt', { ascending: false });
    
    if (error) console.error(error);
    else {
        const mapped = (data as any[]).map(d => {
            const meta = d.reference && (d.reference.startsWith('{') || d.reference.startsWith('[')) 
                ? JSON.parse(d.reference) 
                : { reference: d.reference };
            
            return {
                id: d.id,
                user_id: d.userId,
                amount: d.amount,
                currency: d.currency || meta.currency || 'USD',
                provider: d.provider || meta.provider || '-',
                status: d.status,
                tx_hash: meta.txHash || meta.hash || meta.paymentId || '',
                created_at: d.createdAt,
                profiles: d.user ? { email: d.user.email } : null,
                metadata: meta
            }
        })
        setRows(mapped);
    }
    setLoading(false);
  }

  async function setStatus(id: string, status: 'confirmed' | 'cancelled') {
    const { data: session } = await supabase.auth.getSession();
    const token = session.session?.access_token;
    if (!token) return setMsg('Session lost');
    try {
      const res = await fetch('/api/admin/transactions', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ id, status }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Failed');
      setMsg(`Deposit ${status}`);
      fetchDeposits();
    } catch (e: any) {
      setMsg(e.message);
    }
  }

  useEffect(() => {
    fetchDeposits();
  }, []);

  const filtered = rows.filter((d) => {
    const okStatus = filterStatus === 'all' ? true : d.status === filterStatus;
    const provider = String(d.provider || '').toLowerCase();
    const okProvider = filterProvider ? provider === filterProvider : true;
    return okStatus && okProvider;
  });

  const providers = Array.from(new Set(rows.map(r => String(r.provider || '').toLowerCase()).filter(Boolean)));

  return (
    <AdminGuard>
      <FuturisticBackground />
      <div className="relative min-h-screen p-6 sm:p-12">
        <div className="max-w-7xl mx-auto space-y-8">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
            <div>
              <h1 className="text-3xl font-bold bg-gradient-to-r from-white via-cyan-200 to-blue-400 bg-clip-text text-transparent">
                Deposit Management
              </h1>
              <p className="text-gray-400 text-sm mt-1">Monitor and manage user deposits</p>
            </div>
            
            <div className="flex items-center gap-3">
              <div className="px-4 py-2 rounded-xl bg-white/5 border border-white/10 text-sm text-gray-300">
                Total: <span className="text-white font-mono ml-2">{rows.length}</span>
              </div>
              <button
                className="flex items-center gap-2 px-4 py-2 rounded-xl bg-cyan-500/10 text-cyan-400 border border-cyan-500/20 hover:bg-cyan-500/20 transition-colors text-sm"
                onClick={() => fetchDeposits()}
              >
                <RefreshCw size={16} className={loading ? "animate-spin" : ""} />
                Refresh
              </button>
            </div>
          </div>

          <AnimatePresence>
            {msg && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                exit={{ opacity: 0, height: 0 }}
                className="bg-blue-500/10 border border-blue-500/20 text-blue-300 px-4 py-3 rounded-xl text-sm flex items-center gap-2"
              >
                <div className="w-2 h-2 rounded-full bg-blue-400 animate-pulse" />
                {msg}
              </motion.div>
            )}
          </AnimatePresence>

          <motion.div 
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="bg-black/40 backdrop-blur-xl border border-white/10 rounded-3xl overflow-hidden shadow-[0_0_40px_rgba(0,0,0,0.2)]"
          >
            {/* Filters */}
            <div className="p-6 border-b border-white/5 flex flex-wrap items-center gap-4">
              <div className="flex items-center gap-2 text-sm text-gray-400">
                <Filter size={16} />
                Filters:
              </div>
              
              <select
                className="bg-black/20 border border-white/10 rounded-lg px-3 py-2 text-sm text-white focus:border-cyan-500/50 outline-none transition-colors"
                value={filterStatus}
                onChange={(e) => setFilterStatus(e.target.value as any)}
              >
                <option value="all" className="bg-gray-900">All Statuses</option>
                <option value="pending" className="bg-gray-900">Pending</option>
                <option value="confirmed" className="bg-gray-900">Confirmed</option>
                <option value="cancelled" className="bg-gray-900">Cancelled</option>
              </select>

              <select
                className="bg-black/20 border border-white/10 rounded-lg px-3 py-2 text-sm text-white focus:border-cyan-500/50 outline-none transition-colors capitalize"
                value={filterProvider}
                onChange={(e) => setFilterProvider(e.target.value)}
              >
                <option value="" className="bg-gray-900">All Providers</option>
                {providers.map((p) => (
                  <option key={p} value={p} className="bg-gray-900">{p.toUpperCase()}</option>
                ))}
              </select>
            </div>

            {/* Table */}
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-white/10 bg-white/5">
                    <th className="px-6 py-4 text-left font-medium text-gray-400">User</th>
                    <th className="px-6 py-4 text-left font-medium text-gray-400">Amount</th>
                    <th className="px-6 py-4 text-left font-medium text-gray-400">Currency</th>
                    <th className="px-6 py-4 text-left font-medium text-gray-400">Provider</th>
                    <th className="px-6 py-4 text-left font-medium text-gray-400">Plan</th>
                    <th className="px-6 py-4 text-left font-medium text-gray-400">Status</th>
                    <th className="px-6 py-4 text-left font-medium text-gray-400">Created</th>
                    <th className="px-6 py-4 text-right font-medium text-gray-400">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/5">
                  {filtered.map((d, idx) => (
                    <motion.tr 
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: idx * 0.05 }}
                      key={d.id} 
                      className="hover:bg-white/5 transition-colors cursor-pointer group"
                      onClick={() => setSelected(d)}
                    >
                      <td className="px-6 py-4 text-white font-medium">{d.profiles?.email || d.user_id}</td>
                      <td className="px-6 py-4 text-white font-mono">{d.amount}</td>
                      <td className="px-6 py-4">
                        <span className="px-2 py-1 rounded bg-white/5 border border-white/10 text-xs font-medium text-gray-300 uppercase">
                          {d.currency}
                        </span>
                      </td>
                      <td className="px-6 py-4 text-gray-400 text-xs uppercase">{String(d.provider || '-')}</td>
                      <td className="px-6 py-4 text-gray-400 text-xs uppercase">{String(d.metadata?.planId || '-')}</td>
                      <td className="px-6 py-4">
                        <span
                          className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium border ${
                            d.status === 'confirmed'
                              ? 'bg-green-500/10 border-green-500/20 text-green-400'
                              : d.status === 'cancelled'
                              ? 'bg-red-500/10 border-red-500/20 text-red-400'
                              : 'bg-yellow-500/10 border-yellow-500/20 text-yellow-400'
                          }`}
                        >
                          {d.status === 'confirmed' && <CheckCircle2 size={12} />}
                          {d.status === 'cancelled' && <XCircle size={12} />}
                          {d.status === 'pending' && <Clock size={12} />}
                          {d.status.charAt(0).toUpperCase() + d.status.slice(1)}
                        </span>
                      </td>
                      <td className="px-6 py-4 text-gray-500 text-xs font-mono">{new Date(d.created_at).toLocaleString()}</td>
                      <td className="px-6 py-4 text-right">
                        {d.status === 'pending' ? (
                          <div className="flex items-center justify-end gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                            <button
                              onClick={(e) => { e.stopPropagation(); setStatus(d.id, 'confirmed'); }}
                              className="p-1.5 rounded-lg bg-green-500/10 text-green-400 hover:bg-green-500/20 border border-green-500/20 transition-colors"
                              title="Confirm"
                            >
                              <CheckCircle2 size={16} />
                            </button>
                            <button
                              onClick={(e) => { e.stopPropagation(); setStatus(d.id, 'cancelled'); }}
                              className="p-1.5 rounded-lg bg-red-500/10 text-red-400 hover:bg-red-500/20 border border-red-500/20 transition-colors"
                              title="Cancel"
                            >
                              <XCircle size={16} />
                            </button>
                          </div>
                        ) : (
                          <div className="text-gray-600 text-xs italic">Completed</div>
                        )}
                      </td>
                    </motion.tr>
                  ))}
                  {!filtered.length && !loading && (
                    <tr>
                      <td colSpan={8} className="px-6 py-12 text-center text-gray-500">
                        <div className="flex flex-col items-center gap-2">
                          <div className="p-3 rounded-full bg-white/5">
                            <Search size={24} className="opacity-20" />
                          </div>
                          <p>No deposits found matching criteria</p>
                        </div>
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </motion.div>
        </div>

        {/* Modal */}
        <AnimatePresence>
          {selected && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm"
              onClick={() => setSelected(null)}
            >
              <motion.div
                initial={{ scale: 0.95, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                exit={{ scale: 0.95, opacity: 0 }}
                className="w-full max-w-lg bg-gray-900 border border-white/10 rounded-2xl shadow-2xl overflow-hidden"
                onClick={(e) => e.stopPropagation()}
              >
                <div className="p-6 border-b border-white/10 flex items-center justify-between bg-white/5">
                  <h2 className="text-lg font-bold text-white flex items-center gap-2">
                    <div className="p-1.5 rounded bg-cyan-500/10 text-cyan-400">
                      <MoreHorizontal size={16} />
                    </div>
                    Deposit Details
                  </h2>
                  <button onClick={() => setSelected(null)} className="text-gray-400 hover:text-white transition-colors">
                    <X size={20} />
                  </button>
                </div>
                
                <div className="p-6 space-y-4 text-sm">
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <span className="block text-gray-500 text-xs uppercase mb-1">User</span>
                      <span className="text-white font-medium break-all">{selected.profiles?.email || selected.user_id}</span>
                    </div>
                    <div>
                      <span className="block text-gray-500 text-xs uppercase mb-1">Amount</span>
                      <span className="text-white font-medium text-lg">{selected.amount} <span className="text-sm text-gray-400">{selected.currency}</span></span>
                    </div>
                    <div>
                      <span className="block text-gray-500 text-xs uppercase mb-1">Status</span>
                      <span className={`inline-block px-2 py-0.5 rounded text-xs border ${
                        selected.status === 'confirmed' ? 'bg-green-500/10 border-green-500/20 text-green-400' : 
                        selected.status === 'cancelled' ? 'bg-red-500/10 border-red-500/20 text-red-400' : 
                        'bg-yellow-500/10 border-yellow-500/20 text-yellow-400'
                      }`}>{selected.status.toUpperCase()}</span>
                    </div>
                    <div>
                      <span className="block text-gray-500 text-xs uppercase mb-1">Provider</span>
                      <span className="text-white capitalize">{String(selected.provider || '-')}</span>
                    </div>
                    <div>
                      <span className="block text-gray-500 text-xs uppercase mb-1">Plan ID</span>
                      <span className="text-white capitalize">{String(selected.metadata?.planId || '-')}</span>
                    </div>
                    <div>
                      <span className="block text-gray-500 text-xs uppercase mb-1">Created At</span>
                      <span className="text-gray-300">{new Date(selected.created_at).toLocaleString()}</span>
                    </div>
                  </div>

                  {selected.metadata?.invoiceUrl && (
                    <div className="p-3 rounded-lg bg-blue-500/10 border border-blue-500/20">
                      <span className="block text-blue-300 text-xs uppercase mb-1">Invoice URL</span>
                      <a className="text-blue-400 hover:text-blue-300 underline break-all" href={selected.metadata.invoiceUrl} target="_blank" rel="noreferrer">
                        {selected.metadata.invoiceUrl}
                      </a>
                    </div>
                  )}

                  {selected.tx_hash && (
                    <div className="p-3 rounded-lg bg-white/5 border border-white/10">
                      <span className="block text-gray-500 text-xs uppercase mb-1">Transaction Hash</span>
                      <span className="text-gray-300 font-mono text-xs break-all">{selected.tx_hash}</span>
                    </div>
                  )}

                  {selected.metadata && (
                    <div className="mt-4">
                      <span className="block text-gray-500 text-xs uppercase mb-2">Raw Metadata</span>
                      <pre className="text-xs bg-black/50 text-gray-400 rounded-lg p-3 overflow-auto max-h-32 border border-white/5 font-mono">
                        {JSON.stringify(selected.metadata, null, 2)}
                      </pre>
                    </div>
                  )}
                </div>

                <div className="p-4 border-t border-white/10 bg-white/5 flex justify-end gap-2">
                  <button
                    className="px-4 py-2 rounded-lg bg-white/5 text-gray-300 hover:bg-white/10 border border-white/10 transition-colors text-xs font-medium"
                    onClick={() => {
                      try { navigator.clipboard.writeText(JSON.stringify(selected, null, 2)); } catch {}
                    }}
                  >
                    Copy JSON
                  </button>
                  <button
                    className="px-4 py-2 rounded-lg bg-white/10 text-white hover:bg-white/20 border border-white/10 transition-colors text-xs font-medium"
                    onClick={() => setSelected(null)}
                  >
                    Close
                  </button>
                </div>
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </AdminGuard>
  );
}
