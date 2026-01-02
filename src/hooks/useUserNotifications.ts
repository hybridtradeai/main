import { useState, useRef, useMemo, useEffect } from 'react';
import { supabase } from '../../lib/supabase';
import { AuthChangeEvent, Session, AuthError } from '@supabase/supabase-js';

export type NotificationItem = {
  id: string;
  type: string;
  title: string;
  message: string;
  read: boolean;
  createdAt: string;
  [key: string]: any;
}

export function useUserNotifications(userId?: string) {
  const [items, setItems] = useState<NotificationItem[]>([]);
  const [connected, setConnected] = useState(false);
  const [authed, setAuthed] = useState(false);
  const bcRef = useRef<BroadcastChannel | null>(null);
  const leaderRef = useRef(false);
  const esRef = useRef<EventSource | null>(null);
  
  const lastIdKey = useMemo(() => (userId ? `notifications:lastId:${userId}` : 'notifications:lastId'), [userId]);

  // Auth State
  useEffect(() => {
    let mounted = true;
    supabase.auth.getSession().then((res: { data: { session: Session | null }, error: AuthError | null }) => { if (mounted) setAuthed(!!res?.data?.session); }).catch(() => { });
    const { data: sub } = supabase.auth.onAuthStateChange((_event: AuthChangeEvent, session: Session | null) => { if (mounted) setAuthed(!!session); });
    return () => { 
        sub?.subscription?.unsubscribe(); 
        mounted = false; 
    };
  }, []);

  useEffect(() => {
    if (!authed) {
        setConnected(false);
        return;
    }
    let mounted = true;
    const bc = new BroadcastChannel('notifications:user');
    bcRef.current = bc;

    function onEvent(data: any) {
        const id = String(data?.id || '');
        if (!id) return;
        setItems((prev) => {
            const exists = prev.some((p) => String(p.id) === id);
            return exists ? prev.map((p) => (String(p.id) === id ? { ...p, ...data } : p)) : [data, ...prev];
        });
        try { localStorage.setItem(lastIdKey, id); } catch {}
    }

    async function becomeLeader() {
        if (leaderRef.current) return;
        if (!mounted) return;
        leaderRef.current = true;
        
        const channel = bcRef.current ?? new BroadcastChannel('notifications:user');
        bcRef.current = channel;
        try { channel.postMessage({ t: 'leader' }); } catch {}

        const lastEventId = (() => { try { return localStorage.getItem(lastIdKey) || ''; } catch { return ''; } })();
        const { data: sessionRes } = await supabase.auth.getSession();
        const token = sessionRes?.session?.access_token || '';
        
        const qp = new URLSearchParams();
        if (lastEventId) qp.set('lastEventId', lastEventId);
        if (token) qp.set('token', token);
        
        const url = `/api/user/notifications/stream${qp.toString() ? `?${qp.toString()}` : ''}`;
        const es = new EventSource(url);
        esRef.current = es;
        
        es.onopen = () => { if (mounted) setConnected(true); };
        es.onmessage = (ev) => {
            try {
                const data = JSON.parse(ev.data);
                onEvent(data);
                bc.postMessage({ t: 'event', data });
            } catch {}
        };
        es.onerror = () => { };
    }

    let heardLeader = false;
    bc.onmessage = (ev) => {
        const msg = ev.data || {};
        if (!mounted) return;
        if (msg.t === 'leader') heardLeader = true;
        if (msg.t === 'event') onEvent(msg.data);
    };

    try { bc.postMessage({ t: 'who' }); } catch {}
    
    const leaderTimeout = setTimeout(() => { if (!heardLeader) becomeLeader(); }, 400);

    // Initial Fetch & Poll
    const fetchNotifications = async () => {
        try {
            const { data: sessionRes } = await supabase.auth.getSession();
            const token = sessionRes?.session?.access_token || '';
            const res = await fetch('/api/user/notifications?limit=50&unreadOnly=false', { headers: token ? { Authorization: `Bearer ${token}` } : undefined });
            const json = await res.json();
            if (!mounted) return;
            const list = Array.isArray(json?.items) ? json.items : [];
            setItems(list);
            
            // Synthetic KYC Check
            const uid = String(sessionRes?.session?.user?.id || '');
            if (uid) {
                 const { data: prof } = await supabase.from('profiles').select('kyc_status').eq('user_id', uid).maybeSingle();
                 const k = String(prof?.kyc_status || '');
                 const lastK = (() => { try { return localStorage.getItem('notifications:lastKyc') || ''; } catch { return ''; } })();
                 
                 if (k && k !== lastK) {
                    const synthetic = {
                        id: `synthetic:kyc:${Date.now()}`,
                        type: 'kyc_status',
                        title: k === 'approved' ? 'KYC Approved' : k === 'rejected' ? 'KYC Rejected' : 'KYC Updated',
                        message: k === 'approved' ? 'Your identity verification has been approved.' : k === 'rejected' ? 'Your KYC was rejected.' : 'Your KYC status was updated.',
                        read: false,
                        createdAt: new Date().toISOString(),
                    };
                    setItems((prev) => [synthetic, ...prev]);
                    try { localStorage.setItem('notifications:lastKyc', k); } catch {}
                 }
            }
        } catch {}
    };

    fetchNotifications();
    const poll = setInterval(fetchNotifications, 10000);

    return () => {
        mounted = false;
        try { bc.close(); } catch {}
        try { esRef.current?.close(); } catch {}
        try { clearTimeout(leaderTimeout); } catch {}
        try { clearInterval(poll); } catch {}
    };
  }, [authed, lastIdKey, userId]);

  const unreadCount = useMemo(() => items.filter((i) => !i.read).length, [items]);

  async function markRead(ids: string[]) {
    if (!ids?.length) return;
    const prev = items;
    setItems((curr) => curr.map((c) => (ids.includes(String(c.id)) ? { ...c, read: true } : c)));
    try {
        const { data: sessionRes } = await supabase.auth.getSession();
        const token = sessionRes?.session?.access_token || '';
        const headers: any = { 'Content-Type': 'application/json' };
        if (token) headers.Authorization = `Bearer ${token}`;
        const res = await fetch('/api/user/notifications/mark-read', { method: 'POST', headers, body: JSON.stringify({ ids }) });
        if (!res.ok) throw new Error('failed');
    } catch {
        setItems(prev);
    }
  }

  return { items, connected, unreadCount, markRead };
}

export function useUnreadCount() {
    const { unreadCount } = useUserNotifications();
    return unreadCount;
}
