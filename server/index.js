import 'dotenv/config';
import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const app = express();
const port = Number(process.env.PORT || 3001);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const queries = [
  'zero withdrawal fee USDT Solana',
  'free withdrawal USDC Solana',
  'zero fee withdrawal Solana 2026',
  'no fee USDT withdrawal Solana',
  'free USDC withdrawal Solana',
];
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

async function getRedditToken() {
  if (redditToken && Date.now() < redditTokenExpiresAt) return redditToken;
  if (redditTokenRequest) return redditTokenRequest;
  const { REDDIT_CLIENT_ID, REDDIT_CLIENT_SECRET, REDDIT_USER_AGENT } = process.env;
  if (!REDDIT_CLIENT_ID || !REDDIT_CLIENT_SECRET) return null;
  redditTokenRequest = (async () => {
    const response = await fetch('https://www.reddit.com/api/v1/access_token', {
      method: 'POST',
      headers: {
        Authorization: `Basic ${Buffer.from(`${REDDIT_CLIENT_ID}:${REDDIT_CLIENT_SECRET}`).toString('base64')}`,
        'Content-Type': 'application/x-www-form-urlencoded',
        'User-Agent': REDDIT_USER_AGENT || 'SolanaFeeScanner/1.0 (public search)',
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
  const host = token ? 'https://oauth.reddit.com' : 'https://www.reddit.com';
  const url = new URL(`${host}/search.json`);
  url.searchParams.set('q', query);
  url.searchParams.set('sort', 'new');
  url.searchParams.set('t', 'all');
  url.searchParams.set('limit', '50');
  const response = await fetch(url, {
    headers: {
      'User-Agent': process.env.REDDIT_USER_AGENT || 'SolanaFeeScanner/1.0 (public search)',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    signal: AbortSignal.timeout(12000),
  });
  if (!response.ok) {
    if (response.status === 403 && !token) throw new Error('Reddit denied anonymous API access (403). Add credentials for a Reddit app that is authorized for Data API access; credentials alone may not grant access.');
    if (response.status === 403) throw new Error('Reddit denied this OAuth request (403). Check that your app credentials are valid and the app has API access.');
    if (response.status === 429) throw new Error('Reddit rate limited this search (429). Wait before refreshing.');
    throw new Error(`Reddit returned ${response.status}`);
  }
  const body = await response.json();
  return (body.data?.children || []).map(({ data }) => ({
    id: `reddit:${data.id}`,
    title: data.title,
    source: 'Reddit',
    date: new Date(data.created_utc * 1000).toISOString(),
    snippet: data.selftext || `Posted in r/${data.subreddit}`,
    url: `https://www.reddit.com${data.permalink}`,
  }));
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
  return (body.items || []).map((item) => ({
    id: `google:${canonicalUrl(item.link)}`,
    title: item.title,
    source: 'Google',
    date: item.pagemap?.metatags?.[0]?.['article:published_time'] || item.pagemap?.metatags?.[0]?.['og:updated_time'] || null,
    snippet: item.snippet || item.htmlSnippet?.replace(/<[^>]*>/g, '') || '',
    url: item.link,
  }));
}

app.get('/api/health', (_req, res) => res.json({ ok: true }));
app.get('/api/search', async (_req, res) => {
  const googleConfigured = Boolean(process.env.GOOGLE_API_KEY && process.env.GOOGLE_CSE_ID);
  const [redditResults, googleResults] = await Promise.allSettled([
    Promise.all(queries.map(redditSearch)).then((lists) => lists.flat()),
    googleConfigured ? googleSearch() : Promise.reject(new Error('Google Custom Search is not configured. Add GOOGLE_API_KEY and GOOGLE_CSE_ID to .env.')),
  ]);

  const results = [];
  const seen = new Set();
  for (const entry of [redditResults, googleResults]) {
    if (entry.status !== 'fulfilled') continue;
    for (const item of entry.value) {
      const key = canonicalUrl(item.url).toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      results.push(item);
    }
  }
  results.sort((a, b) => (Date.parse(b.date) || 0) - (Date.parse(a.date) || 0));
  const errors = [];
  if (redditResults.status === 'rejected') errors.push({ source: 'Reddit', message: redditResults.reason.message });
  if (googleResults.status === 'rejected') errors.push({ source: 'Google', message: googleResults.reason.message });
  res.json({ results, errors, checkedAt: new Date().toISOString(), queries });
});

if (process.env.NODE_ENV === 'production') {
  const dist = path.join(root, 'dist');
  app.use(express.static(dist));
  app.get('*', (_req, res) => res.sendFile(path.join(dist, 'index.html')));
}

app.listen(port, () => console.log(`Solana Fee Scanner API listening on http://localhost:${port}`));

