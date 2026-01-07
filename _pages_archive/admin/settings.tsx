import { useCallback, useEffect, useMemo, useState } from 'react';
import AdminGuard from '../../components/AdminGuard';
import { supabase } from '../../lib/supabase';

type Setting = { key: string; value: string };

export default function AdminSettings() {
  const [settings, setSettings] = useState<Setting[]>([]);
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState('');
  const [saving, setSaving] = useState(false);
  const [mmValue, setMmValue] = useState('false');
  const [noticeValue, setNoticeValue] = useState('');

  const keys = useMemo(() => ['maintenance_mode', 'global_notice'], []);

  const fetchSettings = useCallback(async () => {
    setLoading(true);
    // Try PascalCase first
    let { data, error } = await supabase.from('Setting').select('key,value').in('key', keys);
    
    if (error) {
         // Fallback to lowercase
         const { data: data2, error: error2 } = await supabase.from('settings').select('key,value').in('key', keys);
         if (error2) console.error(error2);
         else data = data2;
    }
    
    if (data) setSettings((data as any) || []);
    setLoading(false);
  }, [keys]);

  async function save(key: string, value: string) {
    setSaving(true);
    const { data: session } = await supabase.auth.getSession();
    const token = session.session?.access_token;
    if (!token && process.env.NODE_ENV === 'production') { setSaving(false); return setMsg('Session lost'); }
    try {
      const res = await fetch('/api/admin/settings', {
        method: 'POST',
        headers: token ? { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` } : { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key, value }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Failed');
      setMsg(`${key} saved`);
      const next = settings.filter((s) => s.key !== key).concat([{ key, value }]);
      setSettings(next);
    } catch (e: any) {
      setMsg(e.message);
    } finally {
      setSaving(false);
    }
  }

  useEffect(() => {
    fetchSettings();
  }, [fetchSettings]);

  useEffect(() => {
    const mm = settings.find((s) => s.key === 'maintenance_mode')?.value || 'false'
    const notice = settings.find((s) => s.key === 'global_notice')?.value || ''
    setMmValue(mm)
    setNoticeValue(notice)
  }, [settings]);

  return (
    <AdminGuard>
      <div className="max-w-3xl mx-auto p-6">
        <h1 className="text-2xl font-semibold mb-4 text-foreground">Settings</h1>
        {msg && <p className="mb-2 text-sm text-blue-500">{msg}</p>}
        {loading && <p className="text-sm text-muted-foreground">Loading…</p>}
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium mb-1 text-foreground">Maintenance Mode</label>
            <div className="flex items-center gap-2">
              <select
                className="select-neon flex-1"
                value={mmValue}
                onChange={(e) => setMmValue(e.target.value)}
              >
                <option value="false">Off</option>
                <option value="true">On</option>
              </select>
              <button className="px-3 py-2 rounded bg-secondary text-secondary-foreground hover:opacity-90 transition-opacity" disabled={saving} onClick={() => save('maintenance_mode', mmValue)}>Save</button>
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium mb-1 text-foreground">Global Notice (Markdown supported)</label>
            <textarea
              className="input-neon w-full"
              rows={4}
              value={noticeValue}
              onChange={(e) => setNoticeValue(e.target.value)}
              placeholder="Leave empty to hide"
            />
            <div className="mt-2 flex items-center gap-2">
              <button className="px-3 py-2 rounded bg-secondary text-secondary-foreground hover:opacity-90 transition-opacity" disabled={saving} onClick={() => save('global_notice', noticeValue)}>Save</button>
              <span className="text-xs text-muted-foreground">Use basic Markdown</span>
            </div>
          </div>
        </div>
      </div>
    </AdminGuard>
  );
}
