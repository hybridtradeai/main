import Link from 'next/link'
import Head from 'next/head'
import { useI18n } from '../hooks/useI18n'
import { useRouter } from 'next/router'

export default function FAQs() {
  const { t } = useI18n()
  const router = useRouter()
  const langs = ['en','es','fr']
  const base = process.env.NEXT_PUBLIC_SITE_URL || ''
  const path = router?.pathname || '/faqs'
  const { lang } = useI18n() as any
  return (
    <div className="max-w-3xl mx-auto p-6 space-y-6">
      <Head>
        <title>{t('faqs_title')}</title>
        <meta name="description" content={t('faqs_q1_body')} />
        <link rel="canonical" href={`${base}${lang==='en'?'':'/'+lang}${path}`} />
        {langs.filter((l) => l!==lang).map((l) => (
          <link key={l} rel="alternate" hrefLang={l} href={`${base}${l==='en'?'':'/'+l}${path}`} />
        ))}
        <link rel="alternate" hrefLang="x-default" href={`${base}${path}`} />
      </Head>
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
