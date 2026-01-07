import { useI18n } from '../hooks/useI18n'
import Head from 'next/head'
import { useRouter } from 'next/router'

export default function Privacy() {
  const { t } = useI18n()
  const router = useRouter()
  const langs = ['en','es','fr']
  const base = process.env.NEXT_PUBLIC_SITE_URL || ''
  const path = router?.pathname || '/privacy'
  const { lang } = useI18n() as any
  return (
    <div className="max-w-3xl mx-auto p-6 space-y-6">
      <Head>
        <title>{t('privacy_title')}</title>
        <meta name="description" content={t('privacy_p1')} />
        <link rel="canonical" href={`${base}${lang==='en'?'':'/'+lang}${path}`} />
        {langs.filter((l) => l!==lang).map((l) => (
          <link key={l} rel="alternate" hrefLang={l} href={`${base}${l==='en'?'':'/'+l}${path}`} />
        ))}
        <link rel="alternate" hrefLang="x-default" href={`${base}${path}`} />
      </Head>
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
