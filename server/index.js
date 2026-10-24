import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import { isZeroFeeClaim, promoWindow } from './claims.js';
import { exchangeBlogSearch, blogScanReport } from './blogs.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
dotenv.config({ path: path.join(root, '.env') });
const app = express();
const port = Number(process.env.PORT || 3001);
const userAgent = 'SolanaFeeScanner/1.0';
// Promo-style wording ("0 withdrawal fees across all chains") is how exchanges announce these campaigns.
const queries = [
  'zero withdrawal fee USDT Solana',
  'free withdrawal USDC Solana',
  '"0 withdrawal fees" exchange',
  '"zero withdrawal fees" crypto exchange',
  'free withdrawals "all chains" exchange',
  'zero-fee withdrawal campaign crypto',
  'no withdrawal fee USDT exchange promotion',
];

// Exchanges, wallets and cards that could send USDT/USDC to a Solana wallet.
const knownApps = ['Bitpanda', 'KCEX', 'Kast', 'Fuse', 'MEXC', 'Bitget', 'Bybit', 'OKX', 'Binance', 'Gate', 'KuCoin', 'HTX', 'CoinEx', 'Crypto.com', 'Kraken', 'Coinbase', 'Backpack', 'Phantom', 'Solflare', 'Jupiter', 'BingX', 'LBank', 'Toobit', 'WEEX', 'BloFin', 'XT.com', 'Pionex', 'BitMart', 'Bitunix', 'Zoomex', 'Phemex', 'OSL', 'Bitkub', 'AscendEX', 'HitBTC', 'Coinone', 'Nexo', 'Revolut', 'Bleap', 'RedotPay', 'Trust Wallet', 'Exodus', 'Bitfinex', 'Poloniex', 'Ourbit', 'BTCC', 'Deepcoin', 'BYDFi', 'CoinW', 'Biconomy', 'Bitrue', 'ByBit Card', 'Tapbit', 'Hotcoin', 'Coins.ph', 'PDAX', 'Luno', 'Yellow Card', 'Quidax', 'Roqqu', 'Busha', 'Bitnob', 'Breet', 'Indodax', 'WazirX', 'CoinDCX', 'Bitso', 'Rain', 'BitOasis', 'Noones', 'Paxful'];
const appPatterns = knownApps.map((name) => ({ name, pattern: new RegExp(`(^|[^a-z0-9])${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([^a-z0-9]|$)`, 'i') }));
let redditToken = null;
let redditTokenExpiresAt = 0;
let redditTokenRequest = null;

function canonicalUrl(raw) {
  try {
    const url = new URL(raw);
    url.hash = '';
    for (const key of [...url.searchParams.keys()]) {
      if (/^(utm_|ref$|source$|gclid$)/i.test(key)) url.searchParams.delete(key);
    }
    return url.toString().replace(/\/$/, '');
  } catch { return raw; }
}

function decodeEntities(text = '') {
  return text
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;|&#x27;|&apos;/g, "'").replace(/&nbsp;/g, ' ')
    .replace(/&#(\d+);/g, (_m, n) => String.fromCodePoint(Number(n)))
    .replace(/&amp;/g, '&');
}
function stripTags(html = '') { return decodeEntities(html).replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim(); }
function rssTag(item, tag) {
  const match = item.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, 'i'));
  return match ? decodeEntities(match[1]).trim() : '';
}
async function fetchRssItems(url) {
  const response = await fetch(url, { headers: { 'User-Agent': userAgent }, signal: AbortSignal.timeout(12000) });
  if (!response.ok) throw new Error(`${new URL(url).hostname} returned ${response.status}`);
  const xml = await response.text();
  return xml.split(/<item>/i).slice(1);
}

// Keyless feeds: these are published for programmatic reading, so no API keys are needed.
async function googleNewsSearch(query) {
  const url = new URL('https://news.google.com/rss/search');
  url.searchParams.set('q', query);
  url.searchParams.set('hl', 'en-US');
  url.searchParams.set('gl', 'US');
  url.searchParams.set('ceid', 'US:en');
  return (await fetchRssItems(url)).map((item) => {
    const publisher = rssTag(item, 'source');
    const title = rssTag(item, 'title').replace(new RegExp(`\\s+-\\s+${publisher.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`), '');
    const link = rssTag(item, 'link');
    return { id: `gnews:${link}`, title, source: 'Google News', date: rssTag(item, 'pubDate') || null, snippet: publisher ? `Published by ${publisher}` : '', url: link };
  });
}

async function bingNewsSearch(query) {
  const url = new URL('https://www.bing.com/news/search');
  url.searchParams.set('q', query);
  url.searchParams.set('format', 'rss');
  return (await fetchRssItems(url)).map((item) => {
    const link = rssTag(item, 'link');
    let target = link;
    try { target = new URL(link).searchParams.get('url') || link; } catch { /* keep the Bing link */ }
    return { id: `bing:${target}`, title: rssTag(item, 'title'), source: 'Bing News', date: rssTag(item, 'pubDate') || null, snippet: stripTags(rssTag(item, 'description')), url: target };
  });
}

const blueskyQueries = ['zero withdrawal fees', '0 withdrawal fees', 'free withdrawals', 'free withdrawal usdt', 'free withdrawal usdc', 'solana withdrawal fee', 'no withdrawal fees'];
async function blueskySearch(query) {
  const url = new URL('https://api.bsky.app/xrpc/app.bsky.feed.searchPosts');
  url.searchParams.set('q', query);
  url.searchParams.set('sort', 'latest');
  url.searchParams.set('limit', '50');
  const response = await fetch(url, { headers: { 'User-Agent': userAgent }, signal: AbortSignal.timeout(12000) });
  if (!response.ok) throw new Error(`Bluesky returned ${response.status}`);
  const body = await response.json();
  return (body.posts || []).map((post) => {
    const handle = post.author?.handle || 'unknown';
    const postId = post.uri.split('/').pop();
    return { id: `bsky:${post.uri}`, title: `Post by @${handle}`, source: 'Bluesky', date: post.record?.createdAt || post.indexedAt || null, snippet: post.record?.text || '', url: `https://bsky.app/profile/${handle}/post/${postId}` };
  });
}

// Tags what a result claims, so promo posts like "0 withdrawal fees across all chains" rank above general fee articles.
function classify(item) {
  const text = `${item.title} ${item.snippet}`;
  const zeroFee = isZeroFeeClaim(text);
  const solana = /\b(solana|sol|spl)\b/i.test(text);
  const allChains = /\b(all|every|any)\s+(chains?|networks?|coins?|cryptos?|tokens?)\b/i.test(text);
  const stablecoin = /\b(usdt|usdc|stablecoins?)\b/i.test(text);
  const apps = appPatterns.filter(({ pattern }) => pattern.test(text)).map(({ name }) => name);
  if (item.app && !apps.includes(item.app)) apps.unshift(item.app);
  const promo = promoWindow(`${text} ${item.body || ''}`, item.date);
  const score = (zeroFee ? 3 : 0) + (solana ? 2 : allChains ? 1 : 0) + (stablecoin ? 1 : 0) + (apps.length ? 1 : 0) + (promo.ended ? -2 : 0);
  const strong = zeroFee && (solana || allChains) && apps.length > 0 && !promo.ended;
  const { body, ...rest } = item;
  return { ...rest, tags: { zeroFee, solana, allChains, stablecoin }, apps, score, strong, promo };
}

// Keeps crypto zero-fee claims, plus fee/withdrawal news that mentions Solana or a stablecoin.
function isRelevant(item) {
  // Blog posts were picked by URL slug; keep them only if the real title still reads as a zero-fee promo.
  if (item.source === 'Exchange blogs') return item.tags.zeroFee;
  const text = `${item.title} ${item.snippet}`.toLowerCase();
  const crypto = item.apps.length > 0 || /\b(crypto|exchanges?|cex|usdt|usdc|stablecoins?|solana|sol|bitcoin|btc|eth|tokens?|wallets?|defi|chains?)\b/.test(text);
  if (!crypto) return false;
  if (item.tags.zeroFee) return true;
  return (item.tags.solana || item.tags.stablecoin) && /(fee|free|withdraw)/.test(text);
}

// Live Solana-network withdrawal fees per exchange; the page allows crawling (robots.txt: Allow /).
async function feeBoard() {
  const url = 'https://withdrawalfees.com/chains/solana';
  const response = await fetch(url, { headers: { 'User-Agent': userAgent }, signal: AbortSignal.timeout(15000) });
  if (!response.ok) throw new Error(`withdrawalfees.com returned ${response.status}`);
  const html = await response.text();
  const rows = [];
  for (const row of html.split(/<tr>/i).slice(1)) {
    const coin = row.match(/class="symbol">\s*([^<\s]+)/)?.[1];
    const exchange = row.match(/class="exchangeName">[\s\S]*?alt="([^"]+)"/)?.[1];
    const feeCell = row.split(/<td class="text-right">/)[1] || '';
    if (!coin || !exchange || !['USDT', 'USDC', 'SOL'].includes(coin)) continue;
    const usd = feeCell.match(/class="usd">\s*\$([\d.,]+)/)?.[1];
    const free = /free/i.test(stripTags(feeCell));
    const feeUsd = free ? 0 : usd ? Number(usd.replace(/,/g, '')) : null;
    rows.push({ coin, exchange, feeUsd, feeText: stripTags(feeCell.match(/class="fee[^"]*">([\s\S]*?)<\/div>/)?.[1] || '') || (free ? 'Free' : 'Unknown') });
  }
  if (!rows.length) throw new Error('withdrawalfees.com layout changed; no fee rows found.');
  return { url, rows };
}

// Reddit stays disabled by default until the owner has approved Data API access.
async function getRedditToken() {
  if (redditToken && Date.now() < redditTokenExpiresAt) return redditToken;
  if (redditTokenRequest) return redditTokenRequest;
  const { REDDIT_CLIENT_ID, REDDIT_CLIENT_SECRET, REDDIT_USER_AGENT } = process.env;
  if (!REDDIT_CLIENT_ID || !REDDIT_CLIENT_SECRET) throw new Error('Reddit credentials are not configured.');
  redditTokenRequest = (async () => {
    const response = await fetch('https://www.reddit.com/api/v1/access_token', {
      method: 'POST',
      headers: {
        Authorization: `Basic ${Buffer.from(`${REDDIT_CLIENT_ID}:${REDDIT_CLIENT_SECRET}`).toString('base64')}`,
        'Content-Type': 'application/x-www-form-urlencoded',
        'User-Agent': REDDIT_USER_AGENT || 'SolanaFeeScanner/1.0',
      },
      body: new URLSearchParams({ grant_type: 'client_credentials' }),
      signal: AbortSignal.timeout(12000),
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok || !body.access_token) throw new Error(body.error_description || body.message || `Reddit OAuth returned ${response.status}`);
    redditToken = body.access_token;
    redditTokenExpiresAt = Date.now() + Math.max(60, (body.expires_in || 3600) - 60) * 1000;
    return redditToken;
  })();
  try { return await redditTokenRequest; }
  finally { redditTokenRequest = null; }
}

async function redditSearch(query) {
  const token = await getRedditToken();
  const url = new URL('https://oauth.reddit.com/search.json');
  url.searchParams.set('q', query);
  url.searchParams.set('sort', 'new');
  url.searchParams.set('t', 'all');
  url.searchParams.set('limit', '50');
  const response = await fetch(url, { headers: { Authorization: `Bearer ${token}`, 'User-Agent': process.env.REDDIT_USER_AGENT || 'SolanaFeeScanner/1.0' }, signal: AbortSignal.timeout(12000) });
  if (!response.ok) throw new Error(`Reddit OAuth returned ${response.status}`);
  const body = await response.json();
  return (body.data?.children || []).map(({ data }) => ({ id: `reddit:${data.id}`, title: data.title, source: 'Reddit', date: new Date(data.created_utc * 1000).toISOString(), snippet: data.selftext || `Posted in r/${data.subreddit}`, url: `https://www.reddit.com${data.permalink}` }));
}

// X bills per post read, so results are cached and only re-fetched every X_REFRESH_MINUTES (default 120).
let xCache = { at: 0, results: null };
async function xSearch() {
  const ttl = Number(process.env.X_REFRESH_MINUTES || 120) * 60000;
  if (xCache.results && Date.now() - xCache.at < ttl) return xCache.results;
  const results = await xSearchLive();
  xCache = { at: Date.now(), results };
  return results;
}

async function xSearchLive() {
  const bearerToken = process.env.X_API_BEARER_TOKEN;
  if (!bearerToken) throw new Error('X API is not configured. Add X_API_BEARER_TOKEN to .env; the token must have access to Recent Search.');
  const query = '("0 withdrawal fees" OR "zero withdrawal fees" OR "zero withdrawal fee" OR "free withdrawals" OR "no withdrawal fees" OR "zero-fee withdrawals") (Solana OR SOL OR USDT OR USDC OR "all chains") -is:retweet';
  const url = new URL('https://api.x.com/2/tweets/search/recent');
  url.searchParams.set('query', query);
  url.searchParams.set('max_results', process.env.X_MAX_RESULTS || '25');
  url.searchParams.set('tweet.fields', 'created_at,author_id');
  url.searchParams.set('expansions', 'author_id');
  url.searchParams.set('user.fields', 'username');
  const response = await fetch(url, { headers: { Authorization: `Bearer ${bearerToken}` }, signal: AbortSignal.timeout(15000) });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const detail = body.detail || body.title || body.errors?.[0]?.message || `X API returned ${response.status}`;
    if (response.status === 402 || /credits? (are )?(depleted|exhausted)|usage cap|monthly product cap/i.test(detail)) throw new Error(`X API credits are used up (${detail}). Add credits in the X developer portal (developer.x.com) under Billing; searching resumes automatically after that.`);
    if (response.status === 401) throw new Error(`X rejected the bearer token (401): ${detail}`);
    if (response.status === 403) throw new Error(`X denied Recent Search access (403): ${detail}. Check your X API plan and app permissions.`);
    if (response.status === 429) throw new Error('X rate limit or monthly usage cap reached (429).');
    throw new Error(detail);
  }
  const usernames = new Map((body.includes?.users || []).map((user) => [user.id, user.username]));
  return (body.data || []).map((post) => {
    const username = usernames.get(post.author_id) || 'i';
    return { id: `x:${post.id}`, title: `Post by @${username}`, source: 'X', date: post.created_at || null, snippet: post.text, url: `https://x.com/${username}/status/${post.id}` };
  });
}

async function googleSearch() {
  const { GOOGLE_API_KEY, GOOGLE_CSE_ID } = process.env;
  const query = '("zero withdrawal fee" OR "free withdrawal" OR "zero fee withdrawal" OR "no fee USDT withdrawal" OR "free USDC withdrawal") Solana (USDT OR USDC)';
  const url = new URL('https://www.googleapis.com/customsearch/v1');
  url.searchParams.set('key', GOOGLE_API_KEY);
  url.searchParams.set('cx', GOOGLE_CSE_ID);
  url.searchParams.set('q', query);
  url.searchParams.set('num', '10');
  const response = await fetch(url, { signal: AbortSignal.timeout(12000) });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const detail = body.error?.message || `Google returned ${response.status}`;
    if (/does not have the access|not been used|has not been enabled|access.*custom search/i.test(detail)) {
      throw new Error('This Google Cloud project cannot access Custom Search JSON API. Google closed the API to new customers; only existing API customers can use it through Jan 1, 2027. Use an already-enabled customer project or migrate to another search provider.');
    }
    if (response.status === 403) throw new Error(`Google denied the request (403): ${detail}. Check API enablement, key restrictions, and billing/quota settings.`);
    throw new Error(detail);
  }
  return (body.items || []).map((item) => ({ id: `google:${canonicalUrl(item.link)}`, title: item.title, source: 'Google', date: item.pagemap?.metatags?.[0]?.['article:published_time'] || item.pagemap?.metatags?.[0]?.['og:updated_time'] || null, snippet: item.snippet || item.htmlSnippet?.replace(/<[^>]*>/g, '') || '', url: item.link }));
}

app.get('/api/health', (_req, res) => res.json({ ok: true }));
// A source succeeds if at least one of its queries does; it only reports an error when every query fails.
async function runQueries(list, search) {
  const settled = await Promise.allSettled(list.map(search));
  const ok = settled.filter((entry) => entry.status === 'fulfilled');
  if (!ok.length) throw settled[0].reason;
  return ok.flatMap((entry) => entry.value);
}

app.get('/api/search', async (_req, res) => {
  const sources = [
    { name: 'Google News', run: () => runQueries(queries, googleNewsSearch) },
    { name: 'Bing News', run: () => runQueries(queries, bingNewsSearch) },
    { name: 'Bluesky', run: () => runQueries(blueskyQueries, blueskySearch) },
    { name: 'Exchange blogs', run: exchangeBlogSearch },
  ];
  // Google Custom Search is closed to new customers, so it is opt-in for projects that still have access.
  if (process.env.ENABLE_GOOGLE_API === 'true') sources.push({ name: 'Google', run: googleSearch });
  if (process.env.ENABLE_X === 'true') sources.push({ name: 'X', run: xSearch });
  if (process.env.ENABLE_REDDIT === 'true') sources.push({ name: 'Reddit', run: () => runQueries(queries, redditSearch) });

  const [settled, board] = await Promise.all([
    Promise.allSettled(sources.map((source) => source.run())),
    feeBoard().then((value) => ({ value }), (error) => ({ error })),
  ]);
  const results = [];
  const seen = new Set();
  const errors = [];
  if (board.error) errors.push({ source: 'Fee board', message: board.error.message });
  settled.forEach((entry, i) => {
    if (entry.status !== 'fulfilled') { errors.push({ source: sources[i].name, message: entry.reason.message }); return; }
    for (const raw of entry.value) {
      const item = classify(raw);
      const urlKey = canonicalUrl(item.url).toLowerCase();
      const titleKey = item.title.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
      if (seen.has(urlKey) || (item.source !== 'Bluesky' && seen.has(titleKey)) || !isRelevant(item)) continue;
      seen.add(urlKey);
      seen.add(titleKey);
      results.push(item);
    }
  });
  results.sort((a, b) => (Date.parse(b.date) || 0) - (Date.parse(a.date) || 0));
  res.json({ results, errors, feeBoard: board.value || null, blogs: blogScanReport(), checkedAt: new Date().toISOString(), queries, enabledSources: sources.map((source) => source.name) });
});

if (process.env.NODE_ENV === 'production' && !process.env.VERCEL) {
  const dist = path.join(root, 'dist');
  app.use(express.static(dist));
  app.get('*', (_req, res) => res.sendFile(path.join(dist, 'index.html')));
}

// On Vercel, api/index.js exports this app as a serverless function and the platform serves dist/.
if (!process.env.VERCEL) {
  app.listen(port, () => {
    console.log(`Solana Fee Scanner API listening on http://localhost:${port}`);
    exchangeBlogSearch().catch(() => {}); // warm the exchange blog scan so the first dashboard load has it sooner
  });
}

export default app;






