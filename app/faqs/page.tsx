'use client';

export const dynamic = "force-dynamic";

import Link from 'next/link'
import { useI18n } from '../../hooks/useI18n'
import { usePathname } from 'next/navigation'

export default function FAQs() {
  const { t } = useI18n()
  const pathname = usePathname()
  const langs = ['en','es','fr']
  const base = process.env.NEXT_PUBLIC_SITE_URL || ''
  const path = pathname || '/faqs'
  const { lang } = useI18n() as any
  
  return (
    <div className="max-w-3xl mx-auto p-6 space-y-6">
      <h1 className="text-3xl font-bold text-foreground">{t('faqs_title')}</h1>
      <div className="bg-card border border-border rounded-xl p-6 shadow-sm space-y-4 text-sm text-muted-foreground">
        <div>
          <div className="font-semibold text-foreground">{t('faqs_q1_title')}</div>
          <div>{t('faqs_q1_body')}</div>
        </div>
        <div>
          <div className="font-semibold text-foreground">{t('faqs_q2_title')}</div>
          <div>{t('faqs_q2_body')}</div>
        </div>
        <div>
          <div className="font-semibold text-foreground">{t('faqs_q3_title')}</div>
          <div>{t('faqs_q3_body')}</div>
        </div>
        <div>
          <div className="font-semibold text-foreground">{t('faqs_q4_title')}</div>
          <div>{t('faqs_q4_body')}</div>
        </div>
        <div>
          <div className="font-semibold text-foreground">{t('faqs_q5_title')}</div>
          <div>{t('faqs_q5_body')} <Link href="/proof-of-reserves" className="text-primary hover:underline">Proof‑of‑Reserves</Link></div>
        </div>
      </div>
      <div className="text-xs text-muted-foreground">{t('returns_variable_disclaimer')}</div>
    </div>
  )
}
