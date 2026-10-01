# Solana Signal — Fee Scanner

A React and Express dashboard that searches Reddit for zero-fee USDT/USDC withdrawals on Solana and, when your Google Cloud project has access, queries Google Custom Search. Results are deduplicated, sorted newest first, keyword-highlighted, and refreshed every 30 minutes.

## Setup

1. Install Node.js 18 or newer.
2. Copy `.env.example` to `.env`.
3. Add `REDDIT_CLIENT_ID` and `REDDIT_CLIENT_SECRET` from a confidential Reddit web/script app if Reddit blocks anonymous requests. The server uses Reddit app-only OAuth and caches the access token. Set `REDDIT_USER_AGENT` to identify your app.
4. Set `GOOGLE_API_KEY` and `GOOGLE_CSE_ID` only if you already have access to Custom Search JSON API.
5. Run `npm install`, then `npm run dev`. Open the Vite URL shown in the terminal (usually http://localhost:5173).

## Provider access

Reddit's public endpoint may reject anonymous requests with HTTP 403. When authorized credentials are configured, the backend obtains an app-only OAuth token and searches through `oauth.reddit.com`. Reddit may require API access approval; merely creating credentials might not grant access.

Google currently limits Custom Search JSON API to existing customers; Google says it is closed to new customers and scheduled to discontinue on January 1, 2027. The app makes one combined Google query per scan to keep the 30-minute schedule within the documented 100-query daily free quota. If Google returns an access error, the dashboard explains the limitation; an API key alone cannot grant access to a project that is not eligible.

## Production

Run `npm run build` then `npm start`. Set `NODE_ENV=production`; the Express server serves the generated frontend and the API on port 3001 (or `PORT`).

## Notes

Google results may not include a publication date, in which case cards show “Date unavailable.” Reddit and Google can return rate limits or access denials; errors are reported by source without hiding results from a source that succeeded.

