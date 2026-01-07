import type { NextApiRequest, NextApiResponse } from 'next'

type FeedSpec = { url: string; source: string }

function parseItems(xml: string, source: string) {
  const items: { title: string; link?: string; source: string }[] = []
  const itemRegex = /<item[\s\S]*?<\/item>/gi
  let m: RegExpExecArray | null
  while ((m = itemRegex.exec(xml)) && items.length < 30) {
    const block = m[0]
    const tMatch = block.match(/<title>([\s\S]*?)<\/title>/i)
    const lMatch = block.match(/<link>([\s\S]*?)<\/link>/i)
    const titleRaw = tMatch ? tMatch[1] : ''
    const title = String(titleRaw).replace(/<!\[CDATA\[(.*?)\]\]>/, '$1').trim()
    const linkRaw = lMatch ? lMatch[1] : ''
    const link = String(linkRaw).replace(/<!\[CDATA\[(.*?)\]\]>/, '$1').trim()
    if (title) items.push({ title, link: link || undefined, source })
  }
  return items
}

async function fetchRss(feed: FeedSpec) {
  try {
    const res = await fetch(feed.url, { cache: 'no-store' })
    if (!res.ok) return []
    const xml = await res.text()
    return parseItems(xml, feed.source)
  } catch {
    return []
  }
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    const cat = String(req.query.category || 'all').toLowerCase()
    const tech: FeedSpec[] = [
      { url: 'https://techcrunch.com/feed/', source: 'TechCrunch' },
      { url: 'https://www.theverge.com/rss/index.xml', source: 'The Verge' }
    ]
    const crypto: FeedSpec[] = [
      { url: 'https://www.coindesk.com/arc/outboundfeeds/rss/', source: 'CoinDesk' },
      { url: 'https://cointelegraph.com/rss', source: 'Cointelegraph' }
    ]
    const stocks: FeedSpec[] = [
      { url: 'https://finance.yahoo.com/rss/topstories', source: 'Yahoo Finance' },
      { url: 'https://feeds.reuters.com/reuters/businessNews', source: 'Reuters' }
    ]
    let feeds: FeedSpec[] = []
    if (cat === 'tech') feeds = tech
    else if (cat === 'crypto') feeds = crypto
    else if (cat === 'stocks') feeds = stocks
    else feeds = [...tech, ...crypto, ...stocks]
    const results = await Promise.all(feeds.map((f) => fetchRss(f)))
    const seen = new Set<string>()
    const flat: { title: string; link?: string; source: string }[] = []
    for (const list of results) {
      for (const item of list) {
        const key = `${item.source}:${item.title}`
        if (!seen.has(key)) {
          seen.add(key)
          flat.push(item)
        }
      }
    }
    const payload = flat.slice(0, 20)
    if (payload.length === 0) {
      return res.status(200).json({
        items: [
          { title: 'Markets mixed as tech leads gains', source: 'Desk' },
          { title: 'Crypto adoption rises amid regulatory clarity', source: 'Desk' },
          { title: 'AI infrastructure spending accelerates', source: 'Desk' },
          { title: 'Yield strategies diversify across staking and treasuries', source: 'Desk' },
          { title: 'Fintech platforms iterate on transparency features', source: 'Desk' }
        ]
      })
    }
    return res.status(200).json({ items: payload })
  } catch (e: any) {
    return res.status(500).json({ error: String(e?.message || 'server_error') })
  }
}

export const config = { api: { bodyParser: false } }
