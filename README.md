# Solana Signal — Fee Scanner

A React and Express dashboard that scans news and social feeds for zero-fee or free USDT/USDC withdrawals on Solana. Results are filtered for relevance, deduplicated, sorted newest first, keyword-highlighted, and refreshed every 30 minutes.

## Sources

Active by default, no API keys needed:

- **Google News** (RSS search feed)
- **Bing News** (RSS search feed)
- **Bluesky** (public `searchPosts` API)
- **Exchange blogs**: reads the sitemaps exchanges publish for crawlers (Coins.ph, HTX, PDAX, Bybit, Bitget, OKX, CoinEx, BingX, LBank, KuCoin, Luno, Yellow Card, Bitpanda, Kast, Fuse; see `server/blogs.js`). Posts whose URL reads like a zero-fee withdrawal promo (e.g. `zero-fees-on-usdt-via-solana`) are opened to read the title and promo dates. Runs in the background every 6 hours (`BLOG_REFRESH_MINUTES`), retrying failed sites after 15 minutes. Add an exchange by adding its sitemap to `watchlist`.
- **Live fee board**: current Solana-network USDT/USDC withdrawal fees per exchange from withdrawalfees.com.

Each result is tagged with what it claims (zero-fee, Solana or all chains, which app) and, when the text gives one, the promo end date, so ended promos are marked and "Live promos only" hides them. The detection rules live in `server/claims.js`.

Optional, off by default:

- **Google Custom Search**: set `ENABLE_GOOGLE_API=true` plus `GOOGLE_API_KEY` and `GOOGLE_CSE_ID`. Google closed this API to new customers and plans to discontinue it on January 1, 2027, so it only works for projects that already have access.
- **X**: set `ENABLE_X=true` and `X_API_BEARER_TOKEN`. Uses X v2 Recent Search (last 7 days), which needs API credits; a `402 credits depleted` error means the account must be topped up. X bills per post read, so results are cached for `X_REFRESH_MINUTES` (default 120) and capped at `X_MAX_RESULTS` (default 25) per search.
- **Reddit**: set `ENABLE_REDDIT=true` with `REDDIT_CLIENT_ID` and `REDDIT_CLIENT_SECRET`. Reddit may require Data API access approval; credentials alone might not grant access.

## Setup

1. Install Node.js 18 or newer.
2. Copy `.env.example` to `.env` (only needed for the optional sources or a custom `PORT`).
3. Run `npm install`, then `npm run dev`. Open the Vite URL shown in the terminal (usually http://localhost:5173).

## Production

Run `npm run build` then `npm start`. Set `NODE_ENV=production`; the Express server serves the generated frontend and the API on port 3001 (or `PORT`).

## Notes

A source only shows an error when all of its queries fail; failures are reported per source without hiding results from sources that succeeded. Google News links open through news.google.com, which redirects to the publisher.
