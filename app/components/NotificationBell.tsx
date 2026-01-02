"use client"
import { Bell } from 'lucide-react'
import { useState } from 'react'
import { useUserNotifications, useUnreadCount } from '../../src/hooks/useUserNotifications'
import NotificationCenter from './NotificationCenter'
import { useI18n } from '../../hooks/useI18n'

type Props = { variant?: 'user' | 'admin' }

export default function NotificationBell({ variant = 'user' }: Props) {
  const { t } = useI18n()
  const unread = useUnreadCount()
  const { connected } = useUserNotifications()
  const [open, setOpen] = useState(false)

  return (
    <div className="relative">
      <button title={t('notifications_bell')} className="relative inline-flex items-center justify-center w-10 h-10 rounded-full bg-white/10 hover:bg-white/20 transition-colors" onClick={() => setOpen((v) => !v)}>
        <Bell className="w-5 h-5 text-neon-blue" />
      </button>
      {unread > 0 && (
        <span aria-label={t('notifications_unread_count')} className="absolute -top-1 -right-1 min-w-[20px] h-5 px-1.5 rounded-full bg-neon-pink text-white text-xs flex items-center justify-center animate-pulse">
          {unread}
        </span>
      )}
      {open && (
        <div className="absolute right-0 mt-2 w-[360px] max-h-[60vh] overflow-auto rounded-xl bg-[#0a0f1b]/90 border border-white/10 shadow-xl p-3">
          <NotificationCenter />
        </div>
      )}
    </div>
  )
}
