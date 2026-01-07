const pages = ['/', '/plans', '/faqs', '/privacy', '/terms', '/about', '/contact']
const langs = ['en', 'es', 'fr']

function urlFor(lang: string, path: string) {
  const base = process.env.NEXT_PUBLIC_SITE_URL || 'https://hybridtradeai.com'
  const prefix = lang === 'en' ? '' : `/${lang}`
  return `${base}${prefix}${path}`
}

export default function SiteMap() { return null }

export async function getServerSideProps({ res }: any) {
  res.setHeader('Content-Type', 'application/xml')
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">
${pages.map((p) => (
  langs.map((l) => (
    `  <url>
    <loc>${urlFor(l, p)}</loc>
${langs.filter((x) => x !== l).map((alt) => `    <xhtml:link rel="alternate" hreflang="${alt}" href="${urlFor(alt, p)}"/>`).join('\n')}
    <xhtml:link rel="alternate" hreflang="x-default" href="${urlFor('en', p)}"/>
  </url>`
  )).join('\n')
)).join('\n')}
</urlset>`
  res.write(xml)
  res.end()
  return { props: {} }
}
