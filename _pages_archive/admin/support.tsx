import { useEffect, useRef, useState, useCallback } from 'react';
import AdminGuard from '../../components/AdminGuard';
import { authedJson } from '../../lib/supabase';
import { useAdminNotifications } from '../../src/hooks/useAdminNotifications'

type Ticket = {
  id: string;
  user_id: string;
  subject: string;
  status: 'open' | 'closed';
  created_at: string;
  profiles: { email: string } | null;
  replies: { id: string; body: string; is_admin: boolean; created_at: string }[];
};

export default function AdminSupport() {
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState('');
  const [active, setActive] = useState<string | null>(null);
  const [reply, setReply] = useState('');
  const [filter, setFilter] = useState<'all'|'open'|'closed'>('all')
  const [query, setQuery] = useState('')
  const [assignee, setAssignee] = useState('Unassigned')
  const [selected, setSelected] = useState<string[]>([])
  const [showShortcuts, setShowShortcuts] = useState(false)
  const queryInputRef = useRef<HTMLInputElement | null>(null)

  const fetchTickets = useCallback(async () => {
    setLoading(true);
    try {
      const json = await authedJson('/api/admin/support');
      setTickets((json.items as any) || []);
    } catch (e: any) {
      const errMsg = String(e?.message || e)
      if (errMsg.includes('schema cache') || errMsg.includes('SupportTicket')) {
        setMsg('Database setup incomplete: SupportTicket table missing. Please run the migration script.')
      } else {
        setMsg(errMsg);
      }
    } finally {
      setLoading(false);
    }
  }, [])

  async function sendReply() {
    if (!active || !reply.trim()) return;
    try {
      await authedJson('/api/admin/support', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ticketId: active, body: reply }),
      });
      setReply('');
      setMsg('Reply sent');
      fetchTickets();
    } catch (e: any) {
      setMsg(String(e?.message || e));
    }
  }

  const closeTicket = useCallback(async (id: string) => {
    try {
      await authedJson('/api/admin/support', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ticketId: id, status: 'closed' }),
      });
      setMsg('Ticket closed');
      fetchTickets();
    } catch (e: any) {
      setMsg(String(e?.message || e));
    }
  }, [fetchTickets])

  useEffect(() => { fetchTickets() }, [fetchTickets]);
  const { items: adminEvents } = useAdminNotifications();
  useEffect(() => {
    const hasSupportEvent = adminEvents.some((ev) => ev.type === 'support_ticket' || ev.type === 'support_reply')
    if (hasSupportEvent) fetchTickets()
  }, [adminEvents, fetchTickets])

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === '/') { e.preventDefault(); queryInputRef.current?.focus() }
      else if (e.key === '?') { e.preventDefault(); setShowShortcuts(true) }
      else if (e.key === 'j' || e.key === 'k') {
        const list = tickets.filter((t) => {
          const byStatus = filter === 'all' || t.status === filter
          const byQuery = !query.trim() || t.subject.toLowerCase().includes(query.toLowerCase()) || String(t.profiles?.email || '').toLowerCase().includes(query.toLowerCase())
          return byStatus && byQuery
        })
        if (!list.length) return
        e.preventDefault()
        const idx = Math.max(0, list.findIndex((t) => t.id === active))
        const next = e.key === 'j' ? Math.min(list.length - 1, idx + 1) : Math.max(0, idx - 1)
        setActive(list[next].id)
      } else if (e.key === 'c') {
        if (active) { e.preventDefault(); closeTicket(active) }
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [tickets, filter, query, active, closeTicket])

  const activeTicket = tickets.find((t) => t.id === active);
  const filtered = tickets.filter((t) => {
    const byStatus = filter === 'all' || t.status === filter
    const byQuery = !query.trim() || t.subject.toLowerCase().includes(query.toLowerCase()) || String(t.profiles?.email || '').toLowerCase().includes(query.toLowerCase())
    return byStatus && byQuery
  })

  function toggleSelected(id: string) {
    setSelected((prev) => prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id])
  }
  function selectAllFiltered(v: boolean) {
    setSelected(v ? filtered.map((t) => t.id) : [])
  }
  async function closeSelected() {
    const ids = [...selected]
    for (const id of ids) { await closeTicket(id) }
    setSelected([])
  }
  function clearSelection() { setSelected([]) }

  return (
    <AdminGuard>
      <div className="max-w-5xl mx-auto p-6">
        <h1 className="text-2xl font-semibold mb-4 text-foreground">Support Tickets</h1>
        {msg && <p className="mb-2 text-sm text-primary">{msg}</p>}
        {loading && <p className="text-sm text-muted-foreground">Loading…</p>}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="md:col-span-1">
            <div className="bg-card text-card-foreground p-3 mb-3 border border-border rounded-lg shadow-sm">
              <div className="flex items-center gap-2">
                <button className={`px-2 py-1 rounded text-xs transition-colors ${filter==='all'?'bg-primary text-primary-foreground':'bg-secondary text-secondary-foreground hover:bg-secondary/80'}`} onClick={() => setFilter('all')}>All</button>
                <button className={`px-2 py-1 rounded text-xs transition-colors ${filter==='open'?'bg-primary text-primary-foreground':'bg-secondary text-secondary-foreground hover:bg-secondary/80'}`} onClick={() => setFilter('open')}>Open</button>
                <button className={`px-2 py-1 rounded text-xs transition-colors ${filter==='closed'?'bg-primary text-primary-foreground':'bg-secondary text-secondary-foreground hover:bg-secondary/80'}`} onClick={() => setFilter('closed')}>Closed</button>
              </div>
              <div className="mt-2">
                <input ref={queryInputRef} className="w-full border border-border rounded px-2 py-1 text-sm bg-background text-foreground" placeholder="Search subject or email…" value={query} onChange={(e) => setQuery(e.target.value)} />
              </div>
              {selected.length > 0 && (
                <div className="mt-3 flex items-center gap-2 text-xs">
                  <button onClick={closeSelected} className="bg-destructive text-destructive-foreground px-2 py-1 rounded hover:opacity-90">Close selected ({selected.length})</button>
                  <button onClick={clearSelection} className="bg-secondary text-secondary-foreground px-2 py-1 rounded hover:opacity-90">Clear</button>
                </div>
              )}
            </div>
            <div className="overflow-auto max-h-96 border border-border rounded-lg">
              <table className="min-w-full table-auto text-sm text-foreground">
                <thead>
                  <tr className="bg-muted text-muted-foreground">
                    <th className="px-2 py-1 text-left"><input className="checkbox-neon" type="checkbox" aria-label="Select all" onChange={(e) => selectAllFiltered(e.target.checked)} checked={selected.length>0 && selected.length===filtered.length} /></th>
                    <th className="px-2 py-1 text-left font-medium">Subject</th>
                    <th className="px-2 py-1 text-left font-medium">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((t) => (
                    <tr
                      key={t.id}
                      className={`border-t border-border cursor-pointer transition-colors ${active === t.id ? 'bg-muted' : 'hover:bg-muted/50'}`}
                      onClick={() => setActive(t.id)}
                    >
                      <td className="px-2 py-1"><input className="checkbox-neon" type="checkbox" aria-label={`Select ${t.subject}`} onChange={() => toggleSelected(t.id)} checked={selected.includes(t.id)} /></td>
                      <td className="px-2 py-1">{t.subject}</td>
                      <td className="px-2 py-1">
                        <span
                          className={`inline-block px-2 rounded text-xs ${
                            t.status === 'open'
                              ? 'bg-success/10 text-success'
                              : 'bg-muted text-muted-foreground'
                          }`}
                        >
                          {t.status}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="md:col-span-2">
            {activeTicket ? (
              <div className="border border-border rounded-lg p-4 bg-card text-card-foreground shadow-sm">
                <div className="flex justify-between items-center mb-2">
                  <h2 className="font-medium text-foreground">{activeTicket.subject}</h2>
                  {activeTicket.status === 'open' && (
                    <button
                      onClick={() => closeTicket(activeTicket.id)}
                      className="text-xs bg-destructive text-destructive-foreground px-2 py-1 rounded hover:opacity-90 transition-opacity"
                    >
                      Close
                    </button>
                  )}
                </div>
                <div className="flex items-center gap-3 mb-3">
                  <div className="text-xs text-muted-foreground">User: {activeTicket.profiles?.email || activeTicket.user_id}</div>
                  <div className="inline-flex items-center gap-2 text-xs text-muted-foreground">
                    <span className="px-2 py-0.5 rounded bg-secondary text-secondary-foreground">Priority: Normal</span>
                    <label className="inline-flex items-center gap-1">Assign:
                      <select className="ml-1 bg-background border border-border rounded px-1 py-0.5 text-xs text-foreground" value={assignee} onChange={(e) => setAssignee(e.target.value)}>
                        <option>Unassigned</option>
                        <option>Ada</option>
                        <option>Alex</option>
                        <option>Sam</option>
                      </select>
                    </label>
                  </div>
                </div>
                <div className="space-y-2 max-h-64 overflow-auto">
                  {activeTicket.replies.map((r) => (
                    <div key={r.id} className={`p-2 rounded text-sm ${r.is_admin ? 'bg-primary/10 text-primary-foreground' : 'bg-muted text-muted-foreground'}`}>
                      <div className="font-medium text-xs text-muted-foreground">{r.is_admin ? 'Admin' : activeTicket.profiles?.email}</div>
                      <div className="text-foreground">{r.body}</div>
                      <div className="text-xs text-muted-foreground">{new Date(r.created_at).toLocaleString()}</div>
                    </div>
                  ))}
                </div>
                {activeTicket.status === 'open' && (
                  <div className="mt-3">
                    <textarea
                      className="w-full border border-border rounded p-2 text-sm bg-background text-foreground"
                      rows={3}
                      value={reply}
                      onChange={(e) => setReply(e.target.value)}
                      placeholder="Your reply…"
                    />
                    <button
                      onClick={sendReply}
                      disabled={!reply.trim()}
                      className={`mt-2 px-3 py-1 rounded text-sm text-primary-foreground transition-opacity ${!reply.trim() ? 'bg-primary/50 cursor-not-allowed' : 'bg-primary hover:opacity-90'}`}
                    >
                      Send
                    </button>
                  </div>
                )}
              </div>
            ) : (
              <p className="text-muted-foreground text-sm">Select a ticket to view details</p>
            )}
          </div>
        </div>
      </div>
      {showShortcuts && (
        <div className="fixed inset-0 z-50 bg-background/80 backdrop-blur-sm flex items-center justify-center">
          <div className="bg-card text-card-foreground border border-border rounded-2xl p-6 w-[600px] max-w-[90%] shadow-lg">
            <div className="text-lg font-semibold mb-2 text-foreground">Keyboard Shortcuts</div>
            <ul className="text-sm space-y-2 text-muted-foreground">
              <li><span className="font-semibold text-foreground">/</span> Focus search</li>
              <li><span className="font-semibold text-foreground">j / k</span> Next / previous ticket</li>
              <li><span className="font-semibold text-foreground">Enter</span> Open selected ticket</li>
              <li><span className="font-semibold text-foreground">c</span> Close selected ticket</li>
              <li><span className="font-semibold text-foreground">?</span> Toggle this help</li>
            </ul>
            <div className="mt-4 text-right">
              <button className="bg-secondary text-secondary-foreground px-3 py-1 rounded hover:opacity-90" onClick={() => setShowShortcuts(false)}>Close</button>
            </div>
          </div>
        </div>
      )}
    </AdminGuard>
  );
}
