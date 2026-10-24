// Text heuristics shared by every source: does a post claim free withdrawals, and when does the promo run?

// "Zero Fees on USDT Withdrawals", "0 withdrawal fees", "withdrawals are free", "zero gas fees on USDT".
export function isZeroFeeClaim(text) {
  if (/(\bzero|\b0|\bno|\bfree|fee-free|\bwaived?)[\s-]+([a-z$&]+[\s-]+){0,4}withdraw/i.test(text)) return true;
  if (/withdraw\w*[\s-]+([a-z]+[\s-]+){0,3}(free|waived|0 fees?|zero fees?)/i.test(text)) return true;
  // Gas/network fee wording, as long as it is about moving stablecoins rather than trading them.
  return /(\bzero|\b0|\bno|\bfree)[\s-]+(gas[\s-]+|network[\s-]+|transfer[\s-]+)?fees?\b/i.test(text)
    && /\b(usdt|usdc)\b/i.test(text)
    && !/\b(trading|spot|futures|maker|taker)\b/i.test(text);
}

const months = 'jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?';
const datePattern = `(${months})\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?(?:,?\\s+(\\d{4}))?`;

function parseDate(match, fallbackYear, publishedAt) {
  const year = match[3] || fallbackYear;
  if (!year) return null;
  const parsed = Date.parse(`${match[1].slice(0, 3)} ${match[2]} ${year} 23:59:59 UTC`);
  if (Number.isNaN(parsed)) return null;
  // "Holiday promo until January 5" posted in December means the following year.
  if (!match[3] && publishedAt && parsed < publishedAt - 86400000) return Date.parse(`${match[1].slice(0, 3)} ${match[2]} ${Number(year) + 1} 23:59:59 UTC`);
  return parsed;
}

// Finds an end date ("until Sept 5, 2024", "from August 5 to September 5, 2024", "ends Oct 31").
// Without one, a post older than 45 days is marked stale: these promos rarely last longer.
export function promoWindow(text, published) {
  const publishedAt = Date.parse(published) || null;
  const fallbackYear = String(new Date(publishedAt || Date.now()).getUTCFullYear());
  const range = new RegExp(`${datePattern}\\s*(?:to|until|till|through|–|—|-)\\s*${datePattern}`, 'i').exec(text);
  const until = new RegExp(`(?:until|till|through|ends?(?:\\s+on)?|valid\\s+(?:until|till|through)|expires?(?:\\s+on)?)\\s+${datePattern}`, 'i').exec(text);
  let endsAt = null;
  if (range) endsAt = parseDate([null, range[4], range[5], range[6] || range[3]], fallbackYear, publishedAt);
  else if (until) endsAt = parseDate(until, fallbackYear, publishedAt);
  const now = Date.now();
  if (endsAt) return { endsAt: new Date(endsAt).toISOString(), ended: endsAt < now, stale: false };
  return { endsAt: null, ended: false, stale: Boolean(publishedAt && now - publishedAt > 45 * 86400000) };
}
