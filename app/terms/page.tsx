'use client';

export const dynamic = "force-dynamic";

import { useI18n } from '../../hooks/useI18n'
import { usePathname } from 'next/navigation'

export default function Terms() {
  const { t } = useI18n()
  const pathname = usePathname()
  const langs = ['en','es','fr']
  const base = process.env.NEXT_PUBLIC_SITE_URL || ''
  const path = pathname || '/terms'
  const { lang } = useI18n() as any

  return (
    <div className="max-w-3xl mx-auto p-6 space-y-6">
      <h1 className="text-3xl font-bold text-foreground">{t('terms_title')}</h1>
      <div className="bg-card border border-border rounded-xl p-6 shadow-sm space-y-3 text-sm text-muted-foreground">
        <p>{t('terms_p1')}</p>
        <p>{t('terms_p2')}</p>
        <p>{t('terms_p3')}</p>
        <p>{t('terms_p4')}</p>
        <p>{t('terms_p5')}</p>
      </div>
    </div>
  );
}
