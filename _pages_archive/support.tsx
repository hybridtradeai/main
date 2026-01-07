import { useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import RequireAuth from '../components/RequireAuth'
import { supabase } from '../lib/supabase'
import { useUserNotifications } from '../src/hooks/useUserNotifications'

type Ticket = { id: string; subject: string; status: 'open'|'closed'; created_at: string; replies: { id: string; body: string; is_admin: boolean; created_at: string }[] }

export default function SupportPage() {
  const [tickets, setTickets] = useState<Ticket[]>([])
  const [loading, setLoading] = useState(true)
  const [msg, setMsg] = useState('')
  const [subject, setSubject] = useState('')
  const [message, setMessage] = useState('')
  const [active, setActive] = useState<string | null>(null)
  const [replyText, setReplyText] = useState('')
  const [userName, setUserName] = useState('')
  const [kbQuery, setKbQuery] = useState('')
  const suggestions = [
    { title: 'How do withdrawals work?', href: '/faqs' },
    { title: 'How do deposits work?', href: '/faqs' },
    { title: 'How can I add or change my payout method?', href: '/faqs' },
    { title: 'Which payment providers and currencies are supported?', href: '/faqs' },
    { title: 'How can I contact support?', href: '/faqs' },
  ]

  async function fetchTickets() {
    setLoading(true)
    try {
      const { data: session } = await supabase.auth.getSession()
      const token = session.session?.access_token
      const nm = String(session.session?.user?.user_metadata?.name || session.session?.user?.email || '')
      if (nm) setUserName(nm)
      const res = await fetch('/api/user/support', { headers: token ? { Authorization: `Bearer ${token}` } : undefined })
      const json = await res.json()
      if (!res.ok) {
        const err = typeof json.error === 'string' ? json.error : (json?.error?.message || 'Failed')
        throw new Error(err)
      }
      const items = (json.items as any) || []
      setTickets(items)
    } catch (e: any) { setMsg(String(e?.message || e)) }
    finally { setLoading(false) }
  }

  async function createTicket() {
    setMsg('')
    try {
      const { data: session } = await supabase.auth.getSession()
      const token = session.session?.access_token
      if (!token) throw new Error('Please login again')
      const res = await fetch('/api/user/support', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify({ subject, message }) })
      const json = await res.json()
      if (!res.ok) {
        const err = typeof json.error === 'string' ? json.error : (json?.error?.message || 'Failed')
        throw new Error(err)
      }
      setSubject(''); setMessage('')
      fetchTickets()
      setMsg('Ticket submitted')
    } catch (e: any) { setMsg(String(e?.message || e)) }
  }

  useEffect(() => {
    fetchTickets()
  }, [])

  const { items: userEvents } = useUserNotifications()
  const lastEventIdRef = useRef<string>('')
  const [toast, setToast] = useState('')
  useEffect(() => {
    const hasSupportEvent = userEvents.some((ev) => ev.type === 'support_reply' || ev.type === 'support_status' || ev.type === 'support_ticket')
    if (hasSupportEvent) fetchTickets()
    const latest = userEvents[0]
    if (latest && latest.id !== lastEventIdRef.current && (latest.type === 'support_reply' || latest.type === 'support_status')) {
      lastEventIdRef.current = String(latest.id)
      setToast(latest.type === 'support_reply' ? 'New reply from admin' : 'Support ticket updated')
      setTimeout(() => setToast(''), 4000)
    }
  }, [userEvents])

  const activeTicket = tickets.find((t) => t.id === active)
  const recentTickets = useMemo(() => {
    const sorted = [...tickets].sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
    return sorted.slice(0, 5)
  }, [tickets])
  const supportUnread = useMemo(() => userEvents.filter((ev) => !ev.read && (ev.type === 'support_reply' || ev.type === 'support_status')).length, [userEvents])
  const latestTicket = useMemo(() => {
    return [...tickets].sort((a,b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())[0] || null
  }, [tickets])

  return (
    <RequireAuth>
      <div className="max-w-5xl mx-auto p-6 space-y-6">
        <h1 className="text-2xl font-semibold mb-4 text-foreground">Support {supportUnread > 0 && (<span className="ml-2 inline-flex items-center px-2 py-0.5 rounded-full text-xs bg-primary text-primary-foreground">{supportUnread}</span>)}</h1>
        {toast && <div className="mb-2 text-sm bg-primary text-primary-foreground px-3 py-2 rounded">{toast}</div>}
        {msg && <p className="mb-2 text-sm text-primary">{msg}</p>}
        {/* Greeting + Continue + KB search */}
        <section className="bg-card border border-border rounded-xl p-6 shadow-sm">
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="text-lg font-semibold text-foreground">Hi {userName || 'there'} 👋</div>
              <div className="text-sm text-muted-foreground">Welcome to Support. Ask us anything — we’re here to help.</div>
            </div>
            <button className="px-4 py-2 rounded-lg bg-muted text-muted-foreground hover:bg-accent hover:text-accent-foreground transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary" onClick={() => setActive(latestTicket?.id || null)}>Continue</button>
          </div>
          {latestTicket && (
            <div className="mt-3 glass rounded-xl p-4 flex items-center justify-between border border-border">
              <div>
                <div className="text-sm font-medium text-foreground">Continue the conversation</div>
                <div className="text-xs text-muted-foreground">{new Date(latestTicket.created_at).toLocaleString()}</div>
              </div>
              <button className="px-4 py-2 rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary" onClick={() => setActive(latestTicket.id)}>Open</button>
            </div>
          )}
          <div className="mt-4">
            <label className="block text-sm font-medium mb-1 text-foreground">Search for help</label>
            <div className="flex items-center gap-2">
              <input
                className="flex-1 bg-background border border-input rounded-lg px-4 py-2 text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
                placeholder="Search articles…"
                value={kbQuery}
                onChange={(e) => setKbQuery(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') window.location.href = '/faqs' }}
              />
              <Link className="px-4 py-2 rounded-lg bg-muted text-muted-foreground hover:bg-accent hover:text-accent-foreground transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary" href="/faqs">Go</Link>
            </div>
          </div>
          <div className="mt-4 grid gap-3">
            {suggestions.map((s, i) => (
              <Link key={i} href={s.href} className="glass rounded-xl p-4 block hover:bg-accent/50 transition border border-border">
                <div className="font-medium text-sm text-foreground">{s.title}</div>
              </Link>
            ))}
            <Link href="/faqs" className="glass rounded-xl p-4 inline-flex items-center gap-2 text-sm text-foreground border border-border hover:bg-accent/50 transition"><span className="underline">More in the Help Center</span></Link>
            <div className="flex gap-2 mt-2">
              <button className="px-4 py-2 rounded-lg bg-muted text-muted-foreground hover:bg-accent hover:text-accent-foreground transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary" onClick={() => setMsg('Glad that helped!')}>That answered my question 👍</button>
              <button className="px-4 py-2 rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary" onClick={() => setActive(latestTicket?.id || null)}>Talk to a person 🧑‍💼</button>
            </div>
          </div>
        </section>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="md:col-span-1">
            <div className="bg-card border border-border rounded-xl p-4 shadow-sm">
              <h3 className="font-semibold text-foreground">Open a Ticket</h3>
              <label className="block text-sm font-medium mb-1 text-foreground">Subject</label>
              <input className="bg-background border border-input rounded px-3 py-2 w-full text-foreground focus:outline-none focus:ring-2 focus:ring-primary" value={subject} onChange={(e) => setSubject(e.target.value)} />
              <label className="block text-sm font-medium mb-1 mt-2 text-foreground">Message</label>
              <textarea className="bg-background border border-input rounded px-3 py-2 w-full text-foreground focus:outline-none focus:ring-2 focus:ring-primary" rows={3} value={message} onChange={(e) => setMessage(e.target.value)} />
              <button onClick={createTicket} className="mt-2 w-full bg-primary hover:bg-primary/90 text-primary-foreground px-3 py-2 rounded text-sm transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary" disabled={!subject || !message}>Submit</button>
            </div>
            <div className="mt-4 p-4 border border-border rounded bg-card">
              <h3 className="font-semibold mb-2 text-foreground">Recent Tickets</h3>
              {recentTickets.length === 0 ? (
                <p className="text-sm text-muted-foreground">No tickets yet.</p>
              ) : (
                <ul className="space-y-2">
                  {recentTickets.map((t) => (
                    <li key={t.id} className={`flex items-center justify-between text-sm rounded px-2 py-1 ${active===t.id?'bg-accent text-accent-foreground':'text-muted-foreground hover:bg-accent/50'}`}>
                      <button className="text-left truncate focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary rounded-md flex-1" onClick={() => setActive(t.id)}>{t.subject}</button>
                      <span className={`ml-2 inline-block px-2 rounded text-xs ${t.status==='open'?'bg-emerald-500/10 text-emerald-500':'bg-muted text-muted-foreground'}`}>{t.status}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <div className="mt-4 overflow-auto max-h-96 border border-border rounded bg-card">
              <table className="min-w-full table-auto text-sm">
                <thead>
                  <tr className="bg-muted text-muted-foreground border-b border-border">
                    <th className="px-3 py-2 text-left font-medium">Subject</th>
                    <th className="px-3 py-2 text-left font-medium">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {tickets.map((t) => (
                    <tr key={t.id} className={`border-b border-border last:border-0 cursor-pointer hover:bg-accent/50 ${active===t.id?'bg-accent/50':''}`} onClick={() => setActive(t.id)}>
                      <td className="px-3 py-2 text-foreground">{t.subject}</td>
                      <td className="px-3 py-2">
                        <span className={`inline-block px-2 rounded text-xs ${t.status==='open'?'bg-emerald-500/10 text-emerald-500':'bg-muted text-muted-foreground'}`}>{t.status}</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="md:col-span-2">
            {activeTicket ? (
              <div className="border border-border rounded-xl p-4 bg-card h-full flex flex-col">
                <h2 className="font-medium text-lg text-foreground mb-4">{activeTicket.subject}</h2>
                <div className="space-y-3 flex-1 overflow-auto p-2">
                  {activeTicket.replies.map((r) => (
                    <div key={r.id} className={`p-3 rounded-lg text-sm max-w-[85%] ${r.is_admin ? 'bg-muted/50 ml-auto' : 'bg-primary/10 mr-auto'}`}>
                      <div className="font-medium text-xs mb-1 text-muted-foreground">{r.is_admin ? 'Admin' : 'You'}</div>
                      <div className="text-foreground whitespace-pre-wrap">{r.body}</div>
                      <div className="text-xs text-muted-foreground mt-1 text-right">{new Date(r.created_at).toLocaleString()}</div>
                    </div>
                  ))}
                  {activeTicket.replies.length === 0 && <div className="text-sm text-muted-foreground text-center py-8">No replies yet.</div>}
                </div>
                {activeTicket.status === 'open' && (
                  <div className="mt-4 pt-4 border-t border-border">
                    <label className="block text-sm font-medium mb-2 text-foreground">Your Reply</label>
                    <textarea className="bg-background border border-input rounded px-3 py-2 w-full text-foreground focus:outline-none focus:ring-2 focus:ring-primary" rows={3} value={replyText} onChange={(e) => setReplyText(e.target.value)} />
                    <button
                      onClick={async () => {
                        setMsg('')
                        try {
                          const { data: session } = await supabase.auth.getSession()
                          const token = session.session?.access_token
                          if (!token || !active) throw new Error('Please login again')
                          const res = await fetch('/api/user/support', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify({ ticketId: active, body: replyText }) })
                          const json = await res.json()
                          if (!res.ok) {
                            const err = typeof json.error === 'string' ? json.error : (json?.error?.message || 'Failed')
                            throw new Error(err)
                          }
                          setReplyText('')
                          setMsg('Reply sent')
                          fetchTickets()
                        } catch (e: any) { setMsg(String(e?.message || e)) }
                      }}
                      className="mt-2 bg-primary hover:bg-primary/90 text-primary-foreground px-4 py-2 rounded text-sm transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:opacity-50 disabled:cursor-not-allowed"
                      disabled={!replyText.trim()}
                    >Send Reply</button>
                  </div>
                )}
              </div>
            ) : (
              <div className="h-full flex items-center justify-center border border-border rounded-xl bg-muted/20 p-8">
                <p className="text-muted-foreground text-sm">Select a ticket to view details</p>
              </div>
            )}
          </div>
        </div>
      </div>
    </RequireAuth>
  )
}
