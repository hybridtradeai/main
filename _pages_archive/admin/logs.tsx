import { useCallback, useEffect, useState } from 'react';
import AdminGuard from '../../components/AdminGuard';

type LogItem = { id: string; type: string; title?: string; message?: string; createdAt?: string };

export default function AdminLogs() {
  const [items, setItems] = useState<LogItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [scope, setScope] = useState<'personal'|'global'>('global');
  const [msg, setMsg] = useState('');

  const fetchLogs = useCallback(async function fetchLogs() {
    setLoading(true);
    try {
      const url = `/api/admin/notifications?scope=${scope}`;
      const res = await fetch(url);
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error || 'Failed');
      setItems((json.items as any) || []);
    } catch (e: any) {
      setMsg(e.message);
    } finally {
      setLoading(false);
    }
  }, [scope])

  useEffect(() => { fetchLogs() }, [fetchLogs]);

  return (
    <AdminGuard>
      <div className="max-w-5xl mx-auto p-6">
        <h1 className="text-2xl font-semibold mb-4 text-foreground">System Logs</h1>
        <div className="mb-3 flex items-center gap-2">
          <label className="text-sm text-foreground">Scope</label>
          <select className="border border-border rounded px-2 py-1 text-sm bg-background text-foreground" value={scope} onChange={(e) => setScope(e.target.value as any)}>
            <option value="global">Global</option>
            <option value="personal">My Admin</option>
          </select>
          <button className="text-sm bg-secondary text-secondary-foreground px-3 py-1 rounded hover:opacity-90 transition-opacity" onClick={fetchLogs}>Refresh</button>
        </div>
        {msg && <p className="mb-2 text-sm text-blue-500">{msg}</p>}
        {loading && <p className="text-sm text-muted-foreground">Loading…</p>}
        <div className="overflow-auto rounded-lg border border-border">
          <table className="min-w-full table-auto text-sm text-foreground">
            <thead>
              <tr className="bg-muted text-muted-foreground">
                <th className="px-2 py-1 text-left font-medium">Type</th>
                <th className="px-2 py-1 text-left font-medium">Title</th>
                <th className="px-2 py-1 text-left font-medium">Message</th>
                <th className="px-2 py-1 text-left font-medium">Created</th>
              </tr>
            </thead>
            <tbody>
              {items.map((it) => (
                <tr key={String((it as any).id || Math.random())} className="border-t border-border hover:bg-muted/50 transition-colors">
                  <td className="px-2 py-1">{String(it.type || '')}</td>
                  <td className="px-2 py-1">{String(it.title || '')}</td>
                  <td className="px-2 py-1">{String(it.message || '')}</td>
                  <td className="px-2 py-1">{it.createdAt ? new Date(it.createdAt).toLocaleString() : '-'}</td>
                </tr>
              ))}
              {items.length === 0 && (
                <tr>
                  <td className="px-2 py-4 text-center text-muted-foreground" colSpan={4}>No logs.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </AdminGuard>
  );
}
