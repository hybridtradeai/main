import { useEffect, useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import AdminGuard from '../../components/AdminGuard';
import { supabase, authedJson } from '../../lib/supabase';
import { useI18n } from '../../hooks/useI18n';
import FuturisticBackground from '../../components/ui/FuturisticBackground';
import Head from 'next/head';
import { Download, Filter, RefreshCw, CheckCircle2, XCircle, Clock } from 'lucide-react';

type Withdrawal = {
  id: string;
  user_id: string;
  type?: string;
  amount?: number;
  amount_usd?: number;
  currency: string;
  status: 'pending' | 'confirmed' | 'rejected';
  to_address?: string;
  created_at: string;
  profiles: { email: string } | null;
};

export default function AdminWithdrawals() {
  const { t, df, nf } = useI18n()
  const [rows, setRows] = useState<Withdrawal[]>([]);
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all'|'pending'|'confirmed'|'rejected'>('all')
  const [currencyFilter, setCurrencyFilter] = useState<string>('all')
  const [fromDate, setFromDate] = useState<string>('')
  const [toDate, setToDate] = useState<string>('')
  const [page, setPage] = useState(0)
  const pageSize = 20

  async function fetchWithdrawals() {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      params.set('type', 'withdrawal');
      params.set('page', '1');
      params.set('limit', '100');
      const payload = await authedJson(`/api/admin/transactions?${params.toString()}`);
      const items = Array.isArray(payload.items) ? payload.items : [];
      // Map optional withdrawal metadata to to_address if present
      const mapped = items.map((it: any) => {
        const toAddr =
          (it.to_address as string) ||
          (typeof it.meta?.destinationAddress === 'string' ? it.meta.destinationAddress : undefined);
        return { ...it, to_address: toAddr };
      });
      setRows(mapped as Withdrawal[]);
    } catch (e) {
      // Fallback: query Supabase Transaction table directly if admin API fails
      try {
        const { data, error } = await supabase
          .from('Transaction')
          .select('id,userId,type,amount,amountUsd,currency,status,createdAt')
          .in('type', ['withdrawal', 'WITHDRAWAL'])
          .order('createdAt', { ascending: false })
        if (!error && Array.isArray(data)) {
          const mapped = (data as any[]).map((t) => ({
            id: String(t.id),
            user_id: String(t.userId || ''),
            type: String(t.type || '').toLowerCase(),
            amount: typeof t.amount === 'number' ? t.amount : undefined,
            amount_usd: typeof t.amountUsd === 'number' ? t.amountUsd : undefined,
            currency: String(t.currency || ''),
            status: String(t.status || '').toLowerCase(),
            to_address: undefined,
            created_at: String(t.createdAt || new Date().toISOString()),
            profiles: null,
          }))
          setRows(mapped as Withdrawal[])
        } else {
          console.error(e)
          setRows([])
        }
      } catch (err) {
        console.error(err)
        setRows([])
      }
    } finally {
      setLoading(false);
    }
  }

  async function setStatus(id: string, status: 'confirmed' | 'rejected') {
    try {
      await authedJson('/api/admin/transactions', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, status }),
      });
      setMsg(status === 'confirmed' ? t('withdrawal_status_confirmed') : t('withdrawal_status_rejected'));
      fetchWithdrawals();
    } catch (e: any) {
      setMsg(e.message);
    }
  }

  useEffect(() => {
    fetchWithdrawals();
  }, []);

  const currencies = useMemo(() => {
    const set = new Set<string>()
    rows.forEach(r => { if (r.currency) set.add(r.currency.toUpperCase()) })
    return ['all', ...Array.from(set).sort()]
  }, [rows])

  const filtered = useMemo(() => {
    const fromTs = fromDate ? Date.parse(fromDate) : 0
    const toTs = toDate ? Date.parse(toDate) : 0
    return rows.filter((w) => {
      if (statusFilter !== 'all' && w.status !== statusFilter) return false
      if (currencyFilter !== 'all' && w.currency.toUpperCase() !== currencyFilter.toUpperCase()) return false
      const ts = Date.parse(w.created_at)
      if (fromTs && ts < fromTs) return false
      if (toTs && ts > (toTs + 24*60*60*1000 - 1)) return false
      return true
    })
  }, [rows, statusFilter, currencyFilter, fromDate, toDate])

  function exportCsv() {
    const header = ['id','email','amount','currency','status','to_address','created_at']
    const lines = filtered.map(w => [w.id, (w.profiles?.email || w.user_id), String((w as any).amount ?? (w as any).amount_usd ?? 0), w.currency, w.status, (w.to_address || ''), w.created_at].map(v => String(v).replace(/"/g, '""')))
    const csv = [header.join(','), ...lines.map(cols => cols.map(v => `"${v}"`).join(','))].join('\n')
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `withdrawals_${new Date().toISOString().slice(0,10)}.csv`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  }

  return (
    <AdminGuard>
      <Head>
        <title>Withdrawal Management | Admin</title>
      </Head>
      <FuturisticBackground />
      
      <div className="relative min-h-screen pt-24 pb-12 px-4 sm:px-6">
        <div className="max-w-7xl mx-auto space-y-6">
          <motion.div 
            initial={{ opacity: 0, y: -20 }}
            animate={{ opacity: 1, y: 0 }}
            className="flex flex-col md:flex-row md:items-center justify-between gap-4"
          >
            <div>
              <h1 className="text-3xl font-bold bg-gradient-to-r from-white via-cyan-200 to-blue-400 bg-clip-text text-transparent">
                {t('admin_withdrawals_title')}
              </h1>
              <p className="text-muted-foreground text-sm mt-1">Manage and approve withdrawal requests</p>
            </div>
            
            <button 
              onClick={fetchWithdrawals}
              className="flex items-center gap-2 px-4 py-2 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 transition-colors text-sm"
            >
              <RefreshCw size={16} className={loading ? "animate-spin" : ""} />
              Refresh Data
            </button>
          </motion.div>

          {msg && (
            <motion.div 
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              className="p-4 rounded-xl bg-blue-500/10 border border-blue-500/20 text-blue-200 text-sm"
            >
              {msg}
            </motion.div>
          )}

          <motion.div 
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1 }}
            className="bg-black/40 backdrop-blur-xl border border-white/10 rounded-2xl p-6 shadow-[0_0_40px_rgba(0,0,0,0.2)]"
          >
            {/* Filters */}
            <div className="flex flex-wrap items-center gap-4 mb-6 pb-6 border-b border-white/5">
              <div className="flex items-center gap-2 text-sm text-gray-400">
                <Filter size={16} />
                Filters:
              </div>
              
              <select 
                className="bg-black/20 border border-white/10 rounded-lg px-3 py-2 text-sm text-white focus:border-cyan-500/50 outline-none transition-colors" 
                value={statusFilter} 
                onChange={(e) => { setStatusFilter(e.target.value as any); setPage(0) }}
              >
                {['all','pending','confirmed','rejected'].map((s) => (<option key={s} value={s} className="bg-gray-900">{s.charAt(0).toUpperCase() + s.slice(1)}</option>))}
              </select>

              <select 
                className="bg-black/20 border border-white/10 rounded-lg px-3 py-2 text-sm text-white focus:border-cyan-500/50 outline-none transition-colors" 
                value={currencyFilter} 
                onChange={(e) => { setCurrencyFilter(e.target.value); setPage(0) }}
              >
                {currencies.map((c) => (<option key={c} value={c} className="bg-gray-900">{c === 'all' ? 'All Currencies' : c}</option>))}
              </select>

              <div className="flex items-center gap-2 bg-black/20 border border-white/10 rounded-lg px-3 py-2">
                <span className="text-xs text-gray-500">From</span>
                <input 
                  className="bg-transparent text-sm text-white outline-none w-32 [&::-webkit-calendar-picker-indicator]:invert" 
                  type="date" 
                  value={fromDate} 
                  onChange={(e) => { setFromDate(e.target.value); setPage(0) }} 
                />
              </div>

              <div className="flex items-center gap-2 bg-black/20 border border-white/10 rounded-lg px-3 py-2">
                <span className="text-xs text-gray-500">To</span>
                <input 
                  className="bg-transparent text-sm text-white outline-none w-32 [&::-webkit-calendar-picker-indicator]:invert" 
                  type="date" 
                  value={toDate} 
                  onChange={(e) => { setToDate(e.target.value); setPage(0) }} 
                />
              </div>

              <button 
                className="ml-auto flex items-center gap-2 px-4 py-2 rounded-lg bg-cyan-500/10 text-cyan-400 hover:bg-cyan-500/20 border border-cyan-500/20 transition-all text-sm font-medium" 
                onClick={exportCsv}
              >
                <Download size={16} />
                {t('export_csv')}
              </button>
            </div>

            {/* Table */}
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-white/10">
                    <th className="px-4 py-3 text-left font-medium text-gray-400">{t('table_user')}</th>
                    <th className="px-4 py-3 text-left font-medium text-gray-400">{t('table_amount')}</th>
                    <th className="px-4 py-3 text-left font-medium text-gray-400">{t('table_currency')}</th>
                    <th className="px-4 py-3 text-left font-medium text-gray-400">{t('table_to_address')}</th>
                    <th className="px-4 py-3 text-left font-medium text-gray-400">{t('table_status')}</th>
                    <th className="px-4 py-3 text-left font-medium text-gray-400">{t('table_created')}</th>
                    <th className="px-4 py-3 text-right font-medium text-gray-400">{t('table_actions')}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/5">
                  {loading && (
                    Array.from({ length: 5 }).map((_, i) => (
                      <tr key={`sk_${i}`} className="animate-pulse">
                        <td className="px-4 py-4"><div className="h-4 w-32 bg-white/5 rounded" /></td>
                        <td className="px-4 py-4"><div className="h-4 w-20 bg-white/5 rounded" /></td>
                        <td className="px-4 py-4"><div className="h-4 w-12 bg-white/5 rounded" /></td>
                        <td className="px-4 py-4"><div className="h-4 w-24 bg-white/5 rounded" /></td>
                        <td className="px-4 py-4"><div className="h-4 w-16 bg-white/5 rounded" /></td>
                        <td className="px-4 py-4"><div className="h-4 w-24 bg-white/5 rounded" /></td>
                        <td className="px-4 py-4"><div className="h-8 w-16 bg-white/5 rounded ml-auto" /></td>
                      </tr>
                    ))
                  )}
                  {!loading && (filtered.slice(page*pageSize, (page+1)*pageSize)).map((w, idx) => (
                    <motion.tr 
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: idx * 0.05 }}
                      key={w.id} 
                      className="hover:bg-white/5 transition-colors group"
                    >
                      <td className="px-4 py-4 text-white font-medium">{w.profiles?.email || w.user_id}</td>
                      <td className="px-4 py-4 text-white font-mono">{nf(Number((w as any).amount ?? (w as any).amount_usd ?? 0), { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                      <td className="px-4 py-4">
                        <span className="px-2 py-1 rounded bg-white/5 border border-white/10 text-xs font-medium text-gray-300 uppercase">
                          {w.currency}
                        </span>
                      </td>
                      <td className="px-4 py-4 text-xs text-gray-400 font-mono">
                        {w.to_address ? (
                          <span className="bg-black/20 px-2 py-1 rounded border border-white/5">
                            {w.to_address.slice(0, 8)}...{w.to_address.slice(-6)}
                          </span>
                        ) : '-'}
                      </td>
                      <td className="px-4 py-4">
                        <span
                          className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium border ${
                            w.status === 'confirmed'
                              ? 'bg-green-500/10 border-green-500/20 text-green-400'
                              : w.status === 'rejected'
                              ? 'bg-red-500/10 border-red-500/20 text-red-400'
                              : 'bg-yellow-500/10 border-yellow-500/20 text-yellow-400'
                          }`}
                        >
                          {w.status === 'confirmed' && <CheckCircle2 size={12} />}
                          {w.status === 'rejected' && <XCircle size={12} />}
                          {w.status === 'pending' && <Clock size={12} />}
                          {w.status.charAt(0).toUpperCase() + w.status.slice(1)}
                        </span>
                      </td>
                      <td className="px-4 py-4 text-gray-400 text-xs">{df(new Date(w.created_at))}</td>
                      <td className="px-4 py-4 text-right">
                        {w.status === 'pending' && (
                          <div className="flex items-center justify-end gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                            <button
                              onClick={() => setStatus(w.id, 'confirmed')}
                              className="text-xs bg-green-500/20 text-green-400 border border-green-500/30 px-3 py-1.5 rounded-lg hover:bg-green-500/30 transition-colors"
                            >
                              {t('confirm')}
                            </button>
                            <button
                              onClick={() => setStatus(w.id, 'rejected')}
                              className="text-xs bg-red-500/20 text-red-400 border border-red-500/30 px-3 py-1.5 rounded-lg hover:bg-red-500/30 transition-colors"
                            >
                              {t('reject')}
                            </button>
                          </div>
                        )}
                      </td>
                    </motion.tr>
                  ))}
                  {!loading && filtered.length === 0 && (
                    <tr>
                      <td className="px-4 py-12 text-center text-gray-500" colSpan={7}>
                        <div className="flex flex-col items-center gap-2">
                          <Filter size={24} className="opacity-20" />
                          <p>{t('empty_rows')}</p>
                        </div>
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            {/* Pagination */}
            <div className="mt-6 flex items-center justify-between border-t border-white/5 pt-4">
              <button 
                className="px-4 py-2 rounded-lg bg-white/5 text-gray-300 hover:bg-white/10 hover:text-white disabled:opacity-30 disabled:hover:bg-white/5 transition-colors text-sm" 
                disabled={page<=0} 
                onClick={() => setPage((p) => Math.max(0, p-1))}
              >
                {t('prev')}
              </button>
              <div className="text-xs text-gray-500 font-mono">
                Page {page+1} of {Math.max(1, Math.ceil(filtered.length / pageSize))}
              </div>
              <button 
                className="px-4 py-2 rounded-lg bg-white/5 text-gray-300 hover:bg-white/10 hover:text-white disabled:opacity-30 disabled:hover:bg-white/5 transition-colors text-sm" 
                disabled={(page+1)>=Math.ceil(filtered.length / pageSize)} 
                onClick={() => setPage((p) => Math.min(p+1, Math.max(0, Math.ceil(filtered.length / pageSize)-1)))}
              >
                {t('next')}
              </button>
            </div>
          </motion.div>
        </div>
      </div>
    </AdminGuard>
  );
}
