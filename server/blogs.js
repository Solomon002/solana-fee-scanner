import { waitUntil } from '@vercel/functions';
import { isZeroFeeClaim } from './claims.js';

// Exchange blogs and announcement pages, read through the sitemaps they publish for crawlers.
// A post's URL slug ("zero-fees-on-usdt-via-solana") is enough to spot a zero-fee promo; only
// those few posts are then opened to read the title, description and promo dates.
// `match` narrows a sitemap index to the child sitemaps that hold posts/announcements.
export const watchlist = [
  { app: 'Coins.ph', sitemap: 'https://www.coins.ph/en-ph/blog/sitemap-posts.xml' },
  { app: 'HTX', sitemap: 'https://www.htx.com/news/sitemap.xml' },
  { app: 'HTX', sitemap: 'https://www.htx.com/activitys/sitemap.xml' },
  { app: 'PDAX', sitemap: 'https://pdax.ph/news-sitemap.xml' },
  { app: 'Bybit', sitemap: 'https://www.bybit.com/sitemap.xml', match: /announc|news|blog|promo/i },
  { app: 'Bitget', sitemap: 'https://www.bitget.com/all-sitemap.xml', match: /announc|support|news|blog|event/i },
  { app: 'OKX', sitemap: 'https://www.okx.com/help-center-index.xml', match: /announc|help/i },
  { app: 'CoinEx', sitemap: 'https://www.coinex.com/sitemap.xml', match: /announc|support|blog|news/i },
  { app: 'BingX', sitemap: 'https://bingx.com/sitemap.xml', match: /announc|support|blog|news|activity/i },
  { app: 'LBank', sitemap: 'https://www.lbank.com/sitemap.xml', match: /announc|support|blog|news/i },
  { app: 'KuCoin', sitemap: 'https://www.kucoin.com/site-map.xml', match: /announc|news|blog/i },
  { app: 'Luno', sitemap: 'https://www.luno.com/sitemap.xml', match: /blog|news|help/i },
  { app: 'Yellow Card', sitemap: 'https://yellowcard.io/sitemap.xml', match: /blog|news|post/i },
  { app: 'Bitpanda', sitemap: 'https://www.bitpanda.com/sitemap.xml', match: /blog|news|academy|help/i },
  { app: 'Kast', sitemap: 'https://www.kast.xyz/sitemap.xml' },
  { app: 'Fuse', sitemap: 'https://www.fuse.io/sitemap.xml' },
];

const userAgent = 'SolanaFeeScanner/1.0';
const maxChildren = 12;
const maxBytes = 15 * 1024 * 1024;
const maxPostsPerSite = 12;
const cacheMinutes = Number(process.env.BLOG_REFRESH_MINUTES || 360);
// Non-English locale segments; the same post is usually listed once per language.
const foreignLocale = /\/(zh|zh-[a-z]+|ja|ko|ru|es|es-[a-z]+|pt|pt-[a-z]+|fr|de|tr|vi|id|th|ar|it|pl|uk|fa|nl|ro|cs|hu|bn|ur|hi|ms|fil-ph|tw|cn|jp|kr|br|mx|la)(\/|$)/i;

let cache = { at: 0, results: null };
const pageCache = new Map();

async function fetchText(url) {
  const response = await fetch(url, { headers: { 'User-Agent': userAgent }, signal: AbortSignal.timeout(20000), redirect: 'follow' })
    .catch((error) => { throw new Error(`${new URL(url).hostname}: ${error.cause?.code || error.cause?.message || error.message}`); });
  if (!response.ok) throw new Error(`${new URL(url).hostname} returned ${response.status}`);
  const length = Number(response.headers.get('content-length') || 0);
  if (length > maxBytes) throw new Error(`${url} is too large (${length} bytes)`);
  return response.text();
}

function decode(text) {
  return text.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;|&#x27;/g, "'").trim();
}

function parseSitemap(xml) {
  const blocks = (tag) => xml.split(new RegExp(`<${tag}[\\s>]`, 'i')).slice(1);
  const read = (block, tag) => decode(block.match(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`, 'i'))?.[1] || '');
  const entry = (block) => ({ loc: read(block, 'loc'), lastmod: read(block, 'lastmod') || read(block, 'news:publication_date') || null, title: read(block, 'news:title') || null });
  return { children: blocks('sitemap').map(entry), urls: blocks('url').map(entry) };
}

function slugText(url) {
  try {
    const slug = new URL(url).pathname.split('/').filter(Boolean).pop() || '';
    return decodeURIComponent(slug).replace(/\.[a-z]+$/i, '').replace(/[-_]+/g, ' ').replace(/\b\d{6,}\b/g, '').trim();
  } catch { return ''; }
}

// Walks one sitemap (following index files) and returns URLs whose slug reads like a zero-fee promo.
async function scanSitemap(site) {
  const hits = [];
  const queue = [site.sitemap];
  let visited = 0;
  while (queue.length && visited < maxChildren) {
    const url = queue.shift();
    visited += 1;
    let xml;
    try { xml = await fetchText(url); } catch (error) {
      if (url === site.sitemap) throw error;
      continue; // one broken child sitemap should not hide the rest of the site
    }
    const { children, urls } = parseSitemap(xml);
    for (const child of children) {
      if (foreignLocale.test(child.loc)) continue;
      if (!site.match || site.match.test(child.loc)) queue.push(child.loc);
    }
    for (const entry of urls) {
      if (foreignLocale.test(entry.loc)) continue;
      const text = entry.title || slugText(entry.loc);
      if (isZeroFeeClaim(text)) hits.push({ ...entry, text });
    }
  }
  // The same post is often listed once per regional path (/help/x, /en-br/help/x), so dedupe on the slug.
  const seen = new Set();
  return hits
    .filter((hit) => { const key = slugText(hit.loc).toLowerCase(); return !seen.has(key) && seen.add(key); })
    .sort((a, b) => (Date.parse(b.lastmod) || 0) - (Date.parse(a.lastmod) || 0))
    .slice(0, maxPostsPerSite);
}

// Opens one matching post for its real title, description and body text (used to find promo dates).
async function readPost(url) {
  if (pageCache.has(url)) return pageCache.get(url);
  const html = await fetchText(url);
  const meta = (name) => decode(html.match(new RegExp(`<meta[^>]+(?:name|property)=["']${name}["'][^>]+content=["']([^"']*)`, 'i'))?.[1] || '');
  const title = meta('og:title') || decode(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || '');
  const body = decode(html.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').slice(0, 20000);
  // Some blogs (Coins.ph) publish article:published_time as a Unix timestamp instead of ISO text.
  const rawPublished = meta('article:published_time');
  const published = /^\d{9,13}$/.test(rawPublished)
    ? new Date(Number(rawPublished) * (rawPublished.length > 11 ? 1 : 1000)).toISOString()
    : rawPublished || null;
  const post = { title, description: meta('og:description') || meta('description'), published, body };
  pageCache.set(url, post);
  return post;
}

async function scanSite(site) {
  const hits = await scanSitemap(site);
  return Promise.all(hits.map(async (hit) => {
      const post = await readPost(hit.loc).catch(() => null);
      return {
        id: `blog:${hit.loc}`,
        title: post?.title || hit.text.replace(/\b\w/g, (c) => c.toUpperCase()),
        source: 'Exchange blogs',
        app: site.app,
        date: post?.published || hit.lastmod || null,
        snippet: post?.description || `${site.app} · ${hit.text}`,
        body: post?.body || '',
        url: hit.loc,
      };
  }));
}

// Scans run in the background (a full pass takes about a minute), a few sites at a time.
// A site that fails keeps its last good results, and a pass with failures is retried after 15 minutes.
let running = null;
const lastGood = new Map();
async function scanAll() {
  const settled = [];
  for (let i = 0; i < watchlist.length; i += 4) {
    settled.push(...await Promise.allSettled(watchlist.slice(i, i + 4).map(scanSite)));
  }
  settled.forEach((entry, i) => { if (entry.status === 'fulfilled') lastGood.set(watchlist[i].sitemap, entry.value); });
  const results = watchlist.flatMap((site) => lastGood.get(site.sitemap) || []);
  const failed = settled.map((entry, i) => entry.status === 'rejected' ? `${watchlist[i].app}: ${entry.reason.message}` : null).filter(Boolean);
  cache = { at: Date.now(), results, failed };
}

function refreshInBackground() {
  const ttl = (cache.failed?.length ? 15 : cacheMinutes) * 60000;
  if (running || (cache.at && Date.now() - cache.at < ttl)) return;
  running = scanAll().catch((error) => console.error('Exchange blog scan failed:', error)).finally(() => { running = null; });
  // On Vercel the function would freeze once the response is sent; this keeps it alive until the scan ends.
  waitUntil(running);
}

// Returns the last completed scan immediately and starts a new one when it is older than BLOG_REFRESH_MINUTES.
export async function exchangeBlogSearch() {
  refreshInBackground();
  if (!cache.results && cache.failed?.length === watchlist.length) throw new Error(`No exchange sitemap could be read (${cache.failed[0]}).`);
  return cache.results || [];
}

export function blogScanReport() {
  return { checkedAt: cache.at ? new Date(cache.at).toISOString() : null, scanning: Boolean(running), sites: watchlist.length, failed: cache.failed || [] };
}
