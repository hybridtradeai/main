import { useEffect, useState } from 'react';
import AdminGuard from '../../components/AdminGuard';
import { supabase } from '../../lib/supabase';
import { MessageSquare, X, Send } from 'lucide-react';

type KycRecord = {
  user_id: string;
  email: string;
  kyc_status: 'pending' | 'approved' | 'rejected' | null;
  kyc_level?: number | null;
  kyc_submitted_at?: string | null;
  kyc_decision_at?: string | null;
  kyc_reject_reason?: string | null;
};

export default function AdminKyc() {
  const [list, setList] = useState<KycRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState('');
  const [active, setActive] = useState<string | null>(null);
  const [details, setDetails] = useState<any | null>(null);
  const [files, setFiles] = useState<{ idUrl?: string; neutralUrl?: string; smileUrl?: string; leftUrl?: string; rightUrl?: string } | null>(null);
  const [rejectReason, setRejectReason] = useState('');
  const [recordLevels, setRecordLevels] = useState<Record<string, number>>({});
  const [filterStatus, setFilterStatus] = useState<'all'|'pending'|'approved'|'rejected'>('all');
  const [query, setQuery] = useState('');
  
  // Messaging state
  const [showMsgModal, setShowMsgModal] = useState(false);
  const [msgBody, setMsgBody] = useState('');
  const [sendingMsg, setSendingMsg] = useState(false);

  async function fetchKyc() {
    setLoading(true);
    try {
      const { data: session } = await supabase.auth.getSession();
      const token = session.session?.access_token;
      if (!token) throw new Error('Session lost');
      const res = await fetch('/api/admin/kyc', { headers: { Authorization: `Bearer ${token}` } });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Failed to load');
      setList((json.items as any) || []);
    } catch (e: any) {
      setMsg(e.message);
    } finally {
      setLoading(false);
    }
  }

  async function viewDetails(userId: string) {
    setActive(userId);
    setDetails(null);
    setFiles(null);
    setRejectReason('');
    try {
      const { data: session } = await supabase.auth.getSession();
      const token = session.session?.access_token;
      if (!token) throw new Error('Session lost');
      const res = await fetch(`/api/admin/kyc?userId=${encodeURIComponent(userId)}&files=1`, { headers: { Authorization: `Bearer ${token}` } });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Failed');
      setFiles(json.files || null);
      setDetails(json.details || null);
    } catch (e: any) {
      setMsg(e.message);
    }
  }

  async function setStatus(userId: string, status: 'approved' | 'rejected', level?: number) {
    const { data: session } = await supabase.auth.getSession();
    const token = session.session?.access_token;
    if (!token) return setMsg('Session lost');
    try {
      const res = await fetch('/api/admin/kyc', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ userId, status, level, reason: status === 'rejected' ? rejectReason : undefined }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Failed');
      setMsg(`KYC ${status}`);
      fetchKyc();
    } catch (e: any) {
      setMsg(e.message);
    }
  }

  async function sendMessage() {
    if (!active || !msgBody.trim()) return;
    setSendingMsg(true);
    try {
      const { data: session } = await supabase.auth.getSession();
      const token = session.session?.access_token;
      if (!token) throw new Error('Session lost');
      
      const res = await fetch('/api/admin/support', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ 
          userId: active, 
          subject: 'KYC Verification Update', 
          body: msgBody 
        }),
      });
      
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Failed to send message');
      
      setMsg('Message sent successfully');
      setMsgBody('');
      setShowMsgModal(false);
    } catch (e: any) {
      setMsg(e.message);
    } finally {
      setSendingMsg(false);
    }
  }

  useEffect(() => {
    fetchKyc();
  }, []);

  return (
    <AdminGuard>
      <div className="max-w-6xl mx-auto p-6 space-y-4">
        <h1 className="text-2xl font-semibold mb-4 text-foreground">KYC Review & Messaging</h1>
        {msg && <div className="mb-2 p-2 text-sm bg-primary/10 text-primary rounded border border-primary/20">{msg}</div>}
        
        <div className="flex flex-wrap items-center gap-2 mb-3 bg-card p-3 rounded-lg border border-border shadow-sm">
          <button onClick={() => fetchKyc()} className="text-xs bg-primary text-primary-foreground px-3 py-1.5 rounded hover:opacity-90 transition-opacity">Refresh List</button>
          <div className="h-4 w-px bg-border mx-2"></div>
          <select 
            value={filterStatus} 
            onChange={e => setFilterStatus(e.target.value as any)} 
            className="text-xs border border-border rounded px-2 py-1.5 bg-background text-foreground focus:ring-1 focus:ring-primary"
          >
            <option value="all">All Status</option>
            <option value="pending">Pending</option>
            <option value="approved">Approved</option>
            <option value="rejected">Rejected</option>
          </select>
          <input 
            value={query} 
            onChange={e => setQuery(e.target.value)} 
            placeholder="Search by email..." 
            className="text-xs border border-border rounded px-3 py-1.5 bg-background text-foreground placeholder:text-muted-foreground w-64 focus:ring-1 focus:ring-primary outline-none" 
          />
          <div className="flex-grow"></div>
          <button
            onClick={async () => {
              try {
                const { data: session } = await supabase.auth.getSession();
                const token = session.session?.access_token;
                if (!token) throw new Error('Session lost');
                const res = await fetch('/api/admin/storage/kyc-init', { headers: { Authorization: `Bearer ${token}` } });
                const json = await res.json();
                if (!res.ok) throw new Error(json.error || 'Failed');
                setMsg('KYC storage ready');
              } catch (e: any) { setMsg(e.message); }
            }}
            className="text-xs bg-secondary text-secondary-foreground px-3 py-1.5 rounded hover:opacity-90"
          >Init Storage</button>
        </div>

        {loading && <div className="p-8 text-center text-muted-foreground animate-pulse">Loading KYC data...</div>}
        
        {!loading && (
          <div className="overflow-hidden rounded-lg border border-border shadow-sm bg-card">
            <table className="min-w-full table-auto text-sm">
              <thead className="bg-muted">
                <tr>
                  <th className="px-4 py-3 text-left font-medium text-muted-foreground">User / Email</th>
                  <th className="px-4 py-3 text-left font-medium text-muted-foreground">Level</th>
                  <th className="px-4 py-3 text-left font-medium text-muted-foreground">Status</th>
                  <th className="px-4 py-3 text-left font-medium text-muted-foreground">Submitted</th>
                  <th className="px-4 py-3 text-right font-medium text-muted-foreground">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {list
                  .filter(u => filterStatus === 'all' ? true : String(u.kyc_status || 'pending') === filterStatus)
                  .filter(u => query ? String(u.email || '').toLowerCase().includes(query.toLowerCase()) : true)
                  .map((u) => (
                  <tr key={u.user_id} className={`hover:bg-muted/30 transition-colors ${active === u.user_id ? 'bg-muted/50' : ''}`}>
                    <td className="px-4 py-3 text-foreground font-medium">{u.email}</td>
                    <td className="px-4 py-3 text-foreground">{(u as any).kyc_level ?? '-'}</td>
                    <td className="px-4 py-3">
                      <span
                        className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium capitalize ${
                          u.kyc_status === 'approved'
                            ? 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400'
                            : u.kyc_status === 'rejected'
                            ? 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400'
                            : 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400'
                        }`}
                      >
                        {u.kyc_status || 'pending'}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-muted-foreground text-xs">{u.kyc_submitted_at ? new Date(u.kyc_submitted_at).toLocaleString() : '-'}</td>
                    <td className="px-4 py-3 text-right">
                      <div className="flex justify-end items-center gap-2">
                        <button
                          onClick={() => viewDetails(u.user_id)}
                          className={`text-xs px-3 py-1.5 rounded border transition-colors ${active === u.user_id ? 'bg-primary text-primary-foreground border-primary' : 'bg-background border-border hover:bg-muted'}`}
                        >
                          {active === u.user_id ? 'Viewing' : 'Details'}
                        </button>
                        
                        {(String(u.kyc_status || '').toLowerCase() === 'pending' || !u.kyc_status) && (
                          <div className="flex items-center gap-1 bg-muted/50 p-1 rounded">
                            <select
                              value={recordLevels[u.user_id] ?? u.kyc_level ?? 1}
                              onChange={(e) => setRecordLevels((m) => ({ ...m, [u.user_id]: Number(e.target.value) }))}
                              className="text-xs border-none bg-transparent py-0 pl-1 pr-6 focus:ring-0 cursor-pointer"
                            >
                              {[1,2,3].map(l => <option key={l} value={l}>Lvl {l}</option>)}
                            </select>
                            <div className="h-3 w-px bg-border"></div>
                            <button
                              onClick={() => setStatus(u.user_id, 'approved', recordLevels[u.user_id] ?? u.kyc_level ?? 1)}
                              className="text-xs text-green-600 hover:text-green-700 font-medium px-2"
                              title="Approve"
                            >
                              <CheckCircleIcon className="w-4 h-4" />
                            </button>
                            <button
                              onClick={() => setStatus(u.user_id, 'rejected')}
                              className="text-xs text-red-600 hover:text-red-700 font-medium px-2"
                              title="Reject"
                            >
                              <XCircleIcon className="w-4 h-4" />
                            </button>
                          </div>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
                {list.length === 0 && (
                  <tr>
                    <td colSpan={5} className="px-4 py-8 text-center text-muted-foreground">No KYC records found matching criteria.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}

        {/* Detail View Panel */}
        {active && (
          <div className="mt-6 border border-border rounded-lg bg-card text-card-foreground shadow-sm overflow-hidden animate-in slide-in-from-bottom-2 fade-in duration-300">
            <div className="flex items-center justify-between p-4 border-b border-border bg-muted/30">
              <h2 className="text-lg font-semibold flex items-center gap-2">
                User Details 
                <span className="text-sm font-normal text-muted-foreground">({list.find(x => x.user_id === active)?.email})</span>
              </h2>
              <div className="flex gap-2">
                <button
                  onClick={() => { setShowMsgModal(true); setMsgBody(''); }}
                  className="flex items-center gap-1.5 text-xs bg-blue-600 text-white hover:bg-blue-700 px-3 py-1.5 rounded shadow-sm transition-colors"
                >
                  <MessageSquare className="w-3.5 h-3.5" />
                  Message User
                </button>
                <button 
                  onClick={() => setActive(null)}
                  className="text-muted-foreground hover:text-foreground p-1 rounded hover:bg-muted"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
            </div>
            
            <div className="p-6 grid grid-cols-1 lg:grid-cols-3 gap-6">
              {/* Left Column: Text Details */}
              <div className="space-y-4 lg:col-span-1">
                <div className="bg-muted/30 p-4 rounded-md space-y-3 border border-border/50">
                  <h3 className="text-sm font-medium text-foreground uppercase tracking-wider mb-2">Personal Info</h3>
                  {details ? (
                    <div className="text-sm space-y-2">
                      <DetailRow label="Full Name" value={details?.fullName} />
                      <DetailRow label="DOB" value={details?.dob} />
                      <DetailRow label="Address" value={details?.address} />
                      <DetailRow label="Country" value={details?.country || 'N/A'} />
                    </div>
                  ) : <div className="h-20 animate-pulse bg-muted rounded"></div>}
                </div>

                <div className="bg-muted/30 p-4 rounded-md space-y-3 border border-border/50">
                  <h3 className="text-sm font-medium text-foreground uppercase tracking-wider mb-2">ID Document</h3>
                  {details ? (
                    <div className="text-sm space-y-2">
                      <DetailRow label="Type" value={details?.idType} />
                      <DetailRow label="Number" value={details?.idNumber} />
                      <DetailRow label="Expiry" value={details?.idExpiry || 'N/A'} />
                      <DetailRow label="Current Level" value={String(details?.level || '1')} />
                    </div>
                  ) : <div className="h-20 animate-pulse bg-muted rounded"></div>}
                </div>

                {details?.livenessMetrics && (
                  <div className="bg-muted/30 p-4 rounded-md space-y-3 border border-border/50">
                    <h3 className="text-sm font-medium text-foreground uppercase tracking-wider mb-2">Liveness Checks</h3>
                    <div className="text-xs space-y-1 text-muted-foreground">
                      <p className="flex justify-between"><span>Smile vs Neutral:</span> <span className="font-mono text-foreground">{details.livenessMetrics.diff_smile_vs_neutral}%</span></p>
                      <p className="flex justify-between"><span>Left vs Neutral:</span> <span className="font-mono text-foreground">{details.livenessMetrics.diff_left_vs_neutral}%</span></p>
                      <p className="flex justify-between"><span>Right vs Neutral:</span> <span className="font-mono text-foreground">{details.livenessMetrics.diff_right_vs_neutral}%</span></p>
                    </div>
                  </div>
                )}
                
                <div className="bg-muted/30 p-4 rounded-md space-y-3 border border-border/50">
                   <h3 className="text-sm font-medium text-foreground uppercase tracking-wider mb-2">Review</h3>
                   {list.find((x) => x.user_id === active)?.kyc_reject_reason && (
                    <div className="text-sm p-2 bg-red-50 text-red-700 dark:bg-red-900/20 dark:text-red-300 rounded border border-red-200 dark:border-red-800">
                      <strong>Reject Reason:</strong> {String(list.find((x) => x.user_id === active)?.kyc_reject_reason || '')}
                    </div>
                   )}
                   <div className="space-y-2 pt-2">
                      <input
                        value={rejectReason}
                        onChange={(e) => setRejectReason(e.target.value)}
                        placeholder="Rejection reason..."
                        className="w-full text-sm border border-border rounded px-3 py-2 bg-background"
                      />
                      <div className="flex gap-2">
                        <button
                           onClick={() => setStatus(active, 'rejected')}
                           className="flex-1 bg-destructive text-destructive-foreground py-2 rounded text-sm font-medium hover:opacity-90"
                        >
                          Reject
                        </button>
                        <button
                           onClick={() => setStatus(active, 'approved', recordLevels[active] ?? 1)}
                           className="flex-1 bg-green-600 text-white py-2 rounded text-sm font-medium hover:bg-green-700"
                        >
                          Approve
                        </button>
                      </div>
                   </div>
                </div>
              </div>

              {/* Right Column: Images */}
              <div className="lg:col-span-2 space-y-4">
                 <h3 className="text-sm font-medium text-foreground uppercase tracking-wider">Document & Selfies</h3>
                 <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                    <ImageCard label="ID Document" url={files?.idUrl} />
                    <ImageCard label="Neutral Selfie" url={files?.neutralUrl} />
                    <ImageCard label="Smile Selfie" url={files?.smileUrl} />
                    <ImageCard label="Look Left" url={files?.leftUrl} />
                    <ImageCard label="Look Right" url={files?.rightUrl} />
                 </div>
              </div>
            </div>
          </div>
        )}

        {/* Message Modal */}
        {showMsgModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4 animate-in fade-in duration-200">
            <div className="bg-card w-full max-w-md rounded-lg shadow-lg border border-border flex flex-col max-h-[90vh]">
              <div className="flex items-center justify-between p-4 border-b border-border">
                <h3 className="text-lg font-semibold">Message User</h3>
                <button onClick={() => setShowMsgModal(false)} className="text-muted-foreground hover:text-foreground"><X className="w-5 h-5"/></button>
              </div>
              <div className="p-4 flex-grow overflow-y-auto">
                <p className="text-sm text-muted-foreground mb-3">
                  Send a message to <span className="font-medium text-foreground">{list.find(x => x.user_id === active)?.email}</span> regarding their KYC application.
                  They will receive a notification and a support ticket will be created.
                </p>
                <textarea
                  value={msgBody}
                  onChange={(e) => setMsgBody(e.target.value)}
                  placeholder="Type your message here (e.g., 'Please re-upload your ID, it is blurry')..."
                  className="w-full h-32 p-3 rounded-md border border-border bg-background text-sm resize-none focus:ring-2 focus:ring-primary focus:border-transparent outline-none"
                  autoFocus
                />
              </div>
              <div className="p-4 border-t border-border flex justify-end gap-3 bg-muted/20 rounded-b-lg">
                <button 
                  onClick={() => setShowMsgModal(false)}
                  className="px-4 py-2 text-sm font-medium text-muted-foreground hover:text-foreground hover:bg-muted rounded-md transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={sendMessage}
                  disabled={!msgBody.trim() || sendingMsg}
                  className="flex items-center gap-2 px-4 py-2 text-sm font-medium bg-primary text-primary-foreground rounded-md hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
                >
                  {sendingMsg ? 'Sending...' : <><Send className="w-4 h-4" /> Send Message</>}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </AdminGuard>
  );
}

function DetailRow({ label, value }: { label: string, value?: string }) {
  return (
    <div className="flex flex-col sm:flex-row sm:justify-between border-b border-border/50 pb-1 last:border-0">
      <span className="text-muted-foreground">{label}:</span>
      <span className="font-medium text-foreground text-right">{value || '-'}</span>
    </div>
  );
}

function ImageCard({ label, url }: { label: string, url?: string }) {
  if (!url) return (
    <div className="aspect-video bg-muted/50 rounded border border-border border-dashed flex items-center justify-center text-muted-foreground text-xs flex-col gap-1">
      <span className="opacity-50">No Image</span>
      <span className="font-medium">{label}</span>
    </div>
  );
  
  return (
    <div className="group relative aspect-video bg-black rounded overflow-hidden border border-border">
      <img src={url} alt={label} className="w-full h-full object-contain" />
      <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity flex items-end p-2">
        <div className="w-full flex justify-between items-center text-white text-xs">
          <span className="font-medium">{label}</span>
          <a href={url} target="_blank" rel="noreferrer" className="bg-white/20 hover:bg-white/40 px-2 py-1 rounded backdrop-blur-sm">Open</a>
        </div>
      </div>
    </div>
  );
}

// Simple icons for the table actions
function CheckCircleIcon({ className }: { className?: string }) {
  return <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>
}

function XCircleIcon({ className }: { className?: string }) {
  return <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>
}
