import { useEffect, useState } from 'react';
import AdminGuard from '../../components/AdminGuard';
import AdminNavbar from '../../components/AdminNavbar';
import AdminSidebar from '../../components/AdminSidebar';
import { supabase } from '../../lib/supabase';

type AdminProfile = { user_id: string; role?: string | null; is_admin?: boolean | null };

export default function AdminUsersPage() {
  const [admins, setAdmins] = useState<AdminProfile[]>([]);
  const [inviteEmail, setInviteEmail] = useState('');
  const [promoteUserId, setPromoteUserId] = useState('');
  const [msg, setMsg] = useState<string | null>(null);
  const [loadingInvite, setLoadingInvite] = useState(false);
  const [loadingPromote, setLoadingPromote] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const { data } = await supabase
          .from('profiles')
          .select('user_id,role,is_admin')
          .or('is_admin.eq.true,role.eq.admin');
        setAdmins((data as AdminProfile[]) || []);
      } catch (e) {
        // ignore
      }
    })();
  }, []);

  async function inviteAdmin() {
    setLoadingInvite(true);
    setMsg(null);
    try {
      const { data } = await supabase.auth.getSession();
      const token = data.session?.access_token;
      if (!token) throw new Error('Missing session token');
      const res = await fetch('/api/admin/users/invite-admin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify({ email: inviteEmail.trim() })
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error || 'Invite failed');
      setMsg(`Invited ${json.invited?.email || inviteEmail} and promoted to admin.`);
      setInviteEmail('');
    } catch (e: any) {
      setMsg(e?.message || 'Error inviting admin');
    } finally {
      setLoadingInvite(false);
    }
  }

  async function promoteAdmin() {
    setLoadingPromote(true);
    setMsg(null);
    try {
      const { data } = await supabase.auth.getSession();
      const token = data.session?.access_token;
      if (!token) throw new Error('Missing session token');
      const res = await fetch('/api/admin/users/promote', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify({ userId: promoteUserId.trim() })
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error || 'Promotion failed');
      setMsg(`Promoted user ${promoteUserId} to admin.`);
      setPromoteUserId('');
    } catch (e: any) {
      setMsg(e?.message || 'Error promoting admin');
    } finally {
      setLoadingPromote(false);
    }
  }

  return (
    <AdminGuard>
      <div className="grid md:grid-cols-[260px,1fr] gap-6 p-6">
        <div>
          <AdminSidebar />
        </div>
        <div className="space-y-6">
          <AdminNavbar />

          <div className="grid md:grid-cols-2 gap-6">
            <div className="card-neon">
              <h3 className="font-semibold text-foreground">Invite Admin by Email</h3>
              <p className="mt-2 text-sm text-muted-foreground">Sends an invite email and auto-promotes the user.</p>
              <div className="mt-3 flex gap-2">
                <input className="input-neon flex-1" placeholder="admin@example.com" value={inviteEmail} onChange={e => setInviteEmail(e.target.value)} />
                <button className="btn-neon" disabled={loadingInvite || !inviteEmail} onClick={inviteAdmin}>{loadingInvite ? 'Inviting...' : 'Invite'}</button>
              </div>
            </div>

            <div className="card-neon">
              <h3 className="font-semibold text-foreground">Promote Existing User</h3>
              <p className="mt-2 text-sm text-muted-foreground">Enter a user ID from Supabase Auth → Users.</p>
              <div className="mt-3 flex gap-2">
                <input className="input-neon flex-1" placeholder="UUID user ID" value={promoteUserId} onChange={e => setPromoteUserId(e.target.value)} />
                <button className="btn-neon" disabled={loadingPromote || !promoteUserId} onClick={promoteAdmin}>{loadingPromote ? 'Promoting...' : 'Promote'}</button>
              </div>
            </div>
          </div>

          <div className="card-neon">
            <h3 className="font-semibold text-foreground">Current Admins</h3>
            <p className="text-sm text-muted-foreground">Total: {admins.length}</p>
            <div className="mt-3 overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-muted-foreground">
                    <th className="py-2 pr-4">User ID</th>
                    <th className="py-2 pr-4">Role</th>
                    <th className="py-2">is_admin</th>
                  </tr>
                </thead>
                <tbody>
                  {admins.map(a => (
                    <tr key={a.user_id} className="border-t border-border">
                      <td className="py-2 pr-4 font-mono text-xs text-foreground">{a.user_id}</td>
                      <td className="py-2 pr-4 text-foreground">{a.role || '—'}</td>
                      <td className="py-2 text-foreground">{a.is_admin ? 'true' : 'false'}</td>
                    </tr>
                  ))}
                  {admins.length === 0 && (
                    <tr>
                      <td className="py-3 text-muted-foreground" colSpan={3}>No admins found.</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {msg && <p className="text-sm">{msg}</p>}
        </div>
      </div>
    </AdminGuard>
  );
}

