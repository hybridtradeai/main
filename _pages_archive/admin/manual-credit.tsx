import { useCallback, useEffect, useState } from 'react'
import AdminGuard from '../../components/AdminGuard'
import { supabase, supabaseReady } from '../../lib/supabase'

type Action = {
  id: string
  adminId: string
  userId: string
  amount: string
  action: 'MANUAL_CREDIT' | 'APPROVE_CREDIT'
  note?: string | null
  status: 'PENDING' | 'COMPLETED' | 'REJECTED'
  createdAt: string
}

export default function ManualCreditPage() {
  const [userId, setUserId] = useState('')
  const [amount, setAmount] = useState('')
  const [currency, setCurrency] = useState('USD')
  const [description, setDescription] = useState('')
  const [loading, setLoading] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [errorCode, setErrorCode] = useState<string | null>(null)
  const [history, setHistory] = useState<Action[]>([])
  const [page, setPage] = useState(1)
  const [limit, setLimit] = useState(25)
  const [total, setTotal] = useState(0)
  const [health, setHealth] = useState<{ manualCreditsEnabled?: boolean; prismaReady?: boolean; walletsTableReady?: boolean; serviceRoleConfigured?: boolean; prismaError?: string; prismaOptional?: boolean } | null>(null)
  const [healthMsg, setHealthMsg] = useState<string>('')

  const loadHistoryCb = useCallback(async function loadHistory() {
    try {
      const { data: session } = await supabase.auth.getSession()
      const token = session.session?.access_token
      if (!token) {
        setMessage('Sign in as admin to view history')
        setHistory([])
        return
      }
      const res = await fetch(`/api/admin/credit-user?page=${page}&limit=${limit}` , {
        headers: token ? { 'Authorization': `Bearer ${token}` } : undefined,
      })
      const data = await res.json()
      if (!res.ok) {
        setMessage(data.error || 'Failed to load admin credits')
        setHistory([])
      } else {
        setHistory((data.actions ?? []) as Action[])
        setTotal(Number(data.total || 0))
        setPage(Number(data.page || page))
        setLimit(Number(data.limit || limit))
      }
    } catch (e: any) {
      setMessage(e?.message || 'Failed to load admin credits')
    }
  }, [page, limit])

  const loadHealthCb = useCallback(async function loadHealth() {
    try {
      const { data: session } = await supabase.auth.getSession()
      const token = session.session?.access_token
      if (!token) {
        setHealthMsg('Sign in as admin to view health status')
        setHealth(null)
        return
      }
      const res = await fetch('/api/admin/health', { headers: token ? { Authorization: `Bearer ${token}` } : undefined })
      const payload = await res.json()
      if (!res.ok) {
        setHealthMsg(payload.error || 'Health check failed')
      } else {
        setHealth(payload.status || null)
      }
    } catch (e: any) {
      setHealthMsg(e?.message || 'Health check failed')
    }
  }, [])

  useEffect(() => {
    loadHistoryCb()
    loadHealthCb()
  }, [loadHistoryCb, loadHealthCb])

  async function submit() {
    setMessage(null)
    setErrorCode(null)
    setLoading(true)
    try {
      const idTrim = userId.trim()
      const amt = Number(amount)
      if (!idTrim || !amt || amt <= 0) {
        setMessage('Enter a valid user identifier (email or UUID) and amount > 0')
        return
      }
      const { data: session } = await supabase.auth.getSession()
      const token = session.session?.access_token
      const res = await fetch('/api/admin/credit-user', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(token ? { 'Authorization': `Bearer ${token}` } : {}) },
        body: JSON.stringify({
          // Send email if provided, otherwise assume UUID/cuid
          ...(idTrim.includes('@') ? { email: idTrim } : { userId: idTrim }),
          amount: amt,
          currency: currency.trim() || 'USD',
          description: description.trim()
        }),
      })
      const payload = await res.json()
      if (!res.ok) {
        const code = String(payload.error || '')
        setErrorCode(code || null)
        setMessage(
          code === 'manual_credits_disabled' ? 'Manual credits are disabled by configuration.' :
          code === 'service_role_not_configured' ? 'Supabase service role is not configured.' :
          code === 'invalid_user_identifier' ? 'User not found. Check email or UUID.' :
          code.startsWith('wallet_select_failed') ? 'Could not read wallet; check Supabase permissions.' :
          code.startsWith('wallet_create_failed') ? 'Could not create wallet; check Supabase schema.' :
          code.startsWith('wallet_update_failed') ? 'Could not update wallet; check Supabase RLS.' :
          code.startsWith('transactions_insert_failed') ? 'Could not insert transaction; check Supabase schema.' :
          payload.error || 'Credit failed'
        )
      } else if (payload.status === 'pending') {
        setMessage('Credit logged as pending approval')
      } else {
        setMessage(`Credited. New balance: ${payload.balance}`)
        // Reset the form after a successful transaction
        setUserId('')
        setAmount('')
        setDescription('')
      }
      loadHistoryCb()
    } catch (e: any) {
      setMessage(e?.message || 'Request failed')
    } finally {
      setLoading(false)
    }
  }

  return (
    <AdminGuard>
    <div className="max-w-2xl mx-auto p-4">
      <h1 className="text-2xl font-semibold mb-4 text-foreground">Manual Credit</h1>
      {health && (
        <div className="mb-4 text-sm text-foreground">
          <p>Manual Credits Enabled: {String(health.manualCreditsEnabled ?? false)}</p>
          <p>Service Role Configured: {String(health.serviceRoleConfigured ?? false)}</p>
          <p>Prisma Ready: {String(health.prismaReady ?? false)}</p>
          <p>Wallets Table Ready: {String(health.walletsTableReady ?? false)}</p>
          {!health.prismaReady && health.prismaError && health.prismaOptional !== true && (
            <div className="mt-2 rounded px-3 py-2 bg-destructive/10 text-destructive">
              Prisma error: {health.prismaError}
            </div>
          )}
          <div className={`mt-2 rounded px-3 py-2 ${health.manualCreditsEnabled && health.serviceRoleConfigured ? 'bg-success/10 text-success' : 'bg-warning/10 text-warning'}`}>
            {(!health.manualCreditsEnabled) && <span>Manual credits are disabled. Enable in environment config.</span>}
            {(health.manualCreditsEnabled && !health.serviceRoleConfigured) && <span>Supabase service role is not configured. Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.</span>}
            {(health.manualCreditsEnabled && health.serviceRoleConfigured) && <span>Manual credit is ready.</span>}
          </div>
        </div>
      )}
      {healthMsg && <p className="text-sm text-red-600 mb-2">{healthMsg}</p>}
      <div className="bg-card text-card-foreground shadow border border-border rounded p-4 space-y-3">
        <div>
          <label className="block text-sm font-medium text-foreground">User Identifier</label>
          <input
            value={userId}
            onChange={e => setUserId(e.target.value)}
            className="mt-1 w-full border border-border rounded px-3 py-2 bg-background text-foreground"
            placeholder="Enter user email or Supabase UUID"
          />
          <p className="mt-1 text-xs text-muted-foreground">You can paste the user&apos;s email, Supabase user UUID, or a Prisma cuid; emails are recommended.</p>
        </div>
        <div>
          <label className="block text-sm font-medium text-foreground">Amount</label>
          <input value={amount} onChange={e => setAmount(e.target.value)} className="mt-1 w-full border border-border rounded px-3 py-2 bg-background text-foreground" type="number" step="0.01" placeholder="e.g., 100" />
        </div>
        <div>
          <label className="block text-sm font-medium text-foreground">Currency</label>
          <input value={currency} onChange={e => setCurrency(e.target.value)} className="mt-1 w-full border border-border rounded px-3 py-2 bg-background text-foreground" placeholder="e.g., USD, NGN" />
        </div>
        <div>
          <label className="block text-sm font-medium text-foreground">Description (optional)</label>
          <input value={description} onChange={e => setDescription(e.target.value)} className="mt-1 w-full border border-border rounded px-3 py-2 bg-background text-foreground" placeholder="Reason" />
        </div>
        <button disabled={loading || Boolean(health && (!health.manualCreditsEnabled || !health.serviceRoleConfigured))} onClick={submit} className="bg-primary text-primary-foreground rounded px-4 py-2 disabled:opacity-50 hover:opacity-90 transition-opacity">
          {loading ? 'Processing...' : 'Credit User'}
        </button>
      {message && (
        <div className={`mt-2 text-sm ${errorCode ? 'text-destructive' : 'text-success'}`}>
          {message}
          {errorCode && <span className="ml-2">({errorCode})</span>}
        </div>
      )}
      </div>

      <h2 className="text-xl font-semibold mt-6 mb-2 text-foreground">Recent Admin Credits</h2>
      <div className="overflow-x-auto border border-border rounded-lg">
        <table className="min-w-full text-sm text-foreground">
          <thead>
            <tr className="text-left bg-muted text-muted-foreground">
              <th className="px-3 py-2 font-medium">Date</th>
              <th className="px-3 py-2 font-medium">Admin</th>
              <th className="px-3 py-2 font-medium">User</th>
              <th className="px-3 py-2 font-medium">Amount</th>
              <th className="px-3 py-2 font-medium">Status</th>
              <th className="px-3 py-2 font-medium">Note</th>
            </tr>
          </thead>
          <tbody>
            {history.map(h => (
              <tr key={h.id} className="border-t border-border hover:bg-muted/50 transition-colors">
                <td className="px-3 py-2">{new Date(h.createdAt).toLocaleString()}</td>
                <td className="px-3 py-2">{h.adminId}</td>
                <td className="px-3 py-2">{h.userId}</td>
                <td className="px-3 py-2">{h.amount}</td>
                <td className="px-3 py-2">{h.status}</td>
                <td className="px-3 py-2">{h.note ?? ''}</td>
              </tr>
            ))}
            {history.length === 0 && (
              <tr>
                <td colSpan={6} className="px-3 py-4 text-center text-muted-foreground">No recent credits found.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <div className="flex items-center justify-between mt-3">
        <div className="flex items-center gap-2">
          <button
            className="bg-secondary text-secondary-foreground rounded px-3 py-1 disabled:opacity-50 hover:opacity-90 transition-opacity"
            disabled={page <= 1}
            onClick={() => setPage(p => Math.max(1, p - 1))}
          >Prev</button>
          <button
            className="bg-secondary text-secondary-foreground rounded px-3 py-1 disabled:opacity-50 hover:opacity-90 transition-opacity"
            disabled={page * limit >= total}
            onClick={() => setPage(p => p + 1)}
          >Next</button>
        </div>
        <div className="text-sm text-muted-foreground">
          Page {page} • Showing {history.length} of {total}
          <select
            className="border border-border rounded px-2 py-1 ml-3 bg-background text-foreground"
            value={limit}
            onChange={(e) => setLimit(Number(e.target.value))}
          >
            {[10,25,50,100].map(l => <option key={l} value={l}>{l}/page</option>)}
          </select>
        </div>
      </div>
    </div>
    </AdminGuard>
  )
}
