'use client';

export const dynamic = "force-dynamic";

import { useI18n } from '../../hooks/useI18n'
import { usePathname } from 'next/navigation'

export default function Privacy() {
  const { t } = useI18n()
  const pathname = usePathname()
  const langs = ['en','es','fr']
  const base = process.env.NEXT_PUBLIC_SITE_URL || ''
  const path = pathname || '/privacy'
  const { lang } = useI18n() as any

  return (
    <div className="max-w-3xl mx-auto p-6 space-y-6">
      <h1 className="text-3xl font-bold text-foreground">{t('privacy_title')}</h1>
      <div className="bg-card border border-border rounded-xl p-6 shadow-sm space-y-3 text-sm text-muted-foreground">
        <p>{t('privacy_p1')}</p>
        <p>{t('privacy_p2')}</p>
        <p>{t('privacy_p3')}</p>
      </div>
      <div className="text-xs text-muted-foreground">{t('returns_variable_disclaimer')}</div>
    </div>
  )
}
