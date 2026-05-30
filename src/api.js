const BASE         = 'https://polymart.co/api/v1';
const TTL          = 8_000;   // normal cache TTL — just under the 10 s tick
const FETCH_TIMEOUT = 8_000;  // abort individual requests after 8 s

// ── In-flight deduplication ───────────────────────────────────────────────────
// Same path requested concurrently returns one shared promise, not N HTTP calls.
const inFlight = new Map();

// ── Response cache ────────────────────────────────────────────────────────────
const cache = new Map();

// ── Local rate-budget mirror ──────────────────────────────────────────────────
// Polymart allows 400 tokens / 60 s; heavy routes cost 3.
// We track 380 (20-token safety margin) so we never actually hit the server limit.
const bucket = { tokens: 380, lastRefill: Date.now() };
const REFILL_PER_MS = 380 / 60_000;
const HEAVY_ENDPOINTS = new Set([
  '/getStocks', '/getHistory', '/getLeaderboard', '/forex/getCorrelations',
]);

function consumeTokens(path) {
  const now = Date.now();
  bucket.tokens = Math.min(380, bucket.tokens + (now - bucket.lastRefill) * REFILL_PER_MS);
  bucket.lastRefill = now;
  const cost = HEAVY_ENDPOINTS.has(path.split('?')[0]) ? 3 : 1;
  if (bucket.tokens < cost) {
    const waitSec = ((cost - bucket.tokens) / (REFILL_PER_MS * 1000)).toFixed(1);
    throw new ApiError(`Rate limit: try again in ~${waitSec}s.`);
  }
  bucket.tokens -= cost;
}

// ── Error types ───────────────────────────────────────────────────────────────
export class ApiError extends Error {
  constructor(msg) { super(msg); this.name = 'ApiError'; }
}

// ── Fetch with retry + exponential back-off ───────────────────────────────────
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function fetchWithRetry(path, attempt = 0) {
  const MAX_RETRIES = 3;
  let res;

  try {
    res = await fetch(`${BASE}${path}`, {
      signal:  AbortSignal.timeout(FETCH_TIMEOUT),
      headers: { 'Accept': 'application/json' },
    });
  } catch (err) {
    const isTimeout = err.name === 'TimeoutError' || err.name === 'AbortError';
    if (attempt < MAX_RETRIES) {
      await sleep(800 * 2 ** attempt);
      return fetchWithRetry(path, attempt + 1);
    }
    throw new ApiError(isTimeout
      ? `Polymart API timed out after ${FETCH_TIMEOUT / 1000}s.`
      : `Network error: ${err.message}`);
  }

  // 429 — respect Retry-After header
  if (res.status === 429) {
    if (attempt < MAX_RETRIES) {
      const retryAfter = parseInt(res.headers.get('Retry-After') ?? '5', 10);
      await sleep(retryAfter * 1000);
      return fetchWithRetry(path, attempt + 1);
    }
    throw new ApiError('Polymart rate limit reached. Try again in a few seconds.');
  }

  // 5xx — transient server error, retry
  if (res.status >= 500 && attempt < MAX_RETRIES) {
    await sleep(800 * 2 ** attempt);
    return fetchWithRetry(path, attempt + 1);
  }

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new ApiError(`Polymart API ${res.status}${body ? `: ${body.slice(0, 100)}` : ''}`);
  }

  const data = await res.json().catch(() => {
    throw new ApiError('Polymart returned malformed JSON.');
  });

  // Sanity-check: response must be an object (not null / array at top level for single-item endpoints)
  if (data === null || typeof data !== 'object') {
    throw new ApiError(`Unexpected response shape from ${path}`);
  }

  return data;
}

// ── Core fetch with cache + dedup ─────────────────────────────────────────────
async function apiFetch(path, { fresh = false } = {}) {
  const now = Date.now();

  // Serve from cache when fresh enough and caller didn't force a bypass
  if (!fresh) {
    const hit = cache.get(path);
    if (hit && now - hit.ts < TTL) return hit.data;
  }

  // Return existing in-flight promise for the same path (never double-fire)
  if (!fresh && inFlight.has(path)) return inFlight.get(path);

  consumeTokens(path);  // throws ApiError if local budget exhausted

  const promise = fetchWithRetry(path)
    .then(data => {
      cache.set(path, { data, ts: Date.now() });
      inFlight.delete(path);
      return data;
    })
    .catch(err => {
      inFlight.delete(path);
      throw err;
    });

  if (!fresh) inFlight.set(path, promise);
  return promise;
}

// ── Cache eviction ────────────────────────────────────────────────────────────
// Prune entries older than 2× TTL every minute so the cache doesn't grow without bound.
setInterval(() => {
  const cutoff = Date.now() - TTL * 2;
  for (const [key, val] of cache) {
    if (val.ts < cutoff) cache.delete(key);
  }
}, 60_000).unref();

// ── Cache inspection helpers ──────────────────────────────────────────────────
/** Age of the cached entry in ms, or null if not cached / expired. */
export function getCacheAgeMs(path) {
  const hit = cache.get(path);
  if (!hit) return null;
  const age = Date.now() - hit.ts;
  return age < TTL ? age : null;
}

/** Raw cached entry (data + ts), or null. */
export function getCachedEntry(path) {
  const hit = cache.get(path);
  return hit ?? null;
}

// ── Public API surface ────────────────────────────────────────────────────────
export const api = {
  market:          ()            => apiFetch('/getMarket'),
  stock:           (t)           => apiFetch(`/getStock?ticker=${t}`),
  stocks:          (s)           => apiFetch(s ? `/getStocks?sector=${s}` : '/getStocks'),
  sector:          (s)           => apiFetch(`/getSector?sector=${s}`),
  sectors:         ()            => apiFetch('/getSectors'),
  topMovers:       (n = 5)       => apiFetch(`/getTopMovers?limit=${n}`),
  leaderboard:     (by, dir, n)  => apiFetch(`/getLeaderboard?by=${by}&dir=${dir}&limit=${n}`),
  history:         (t, n)        => apiFetch(`/getHistory?ticker=${t}&limit=${n}`),
  search:          (q)           => apiFetch(`/search?q=${encodeURIComponent(q)}`),
  events:          (n)           => apiFetch(`/getEvents?limit=${n}`),
  macro:           ()            => apiFetch('/getMacro'),
  info:            (t)           => apiFetch(`/info?ticker=${t}`),

  forexPairs:      (cat)         => apiFetch(cat ? `/forex/getPairs?category=${cat}` : '/forex/getPairs'),
  forexPair:       (p)           => apiFetch(`/forex/getPair?pair=${p}`),
  forexHistory:    (p, n)        => apiFetch(`/forex/getHistory?pair=${p}&limit=${n}`),
  forexTop:        (n)           => apiFetch(`/forex/getTopMovers?limit=${n}`),
  forexOverview:   ()            => apiFetch('/forex/getMarketOverview'),
  forexSearch:     (q)           => apiFetch(`/forex/search?q=${encodeURIComponent(q)}`),

  cryptoCoins:     (cat)         => apiFetch(cat ? `/crypto/getCoins?category=${cat}` : '/crypto/getCoins'),
  cryptoCoin:      (s)           => apiFetch(`/crypto/getCoin?symbol=${s}`),
  cryptoHistory:   (s, n)        => apiFetch(`/crypto/getHistory?symbol=${s}&limit=${n}`),
  cryptoTop:       (n)           => apiFetch(`/crypto/getTopMovers?limit=${n}`),
  cryptoOverview:  ()            => apiFetch('/crypto/getMarketOverview'),
  cryptoSearch:    (q)           => apiFetch(`/crypto/search?q=${encodeURIComponent(q)}`),
  cryptoLeaderboard: (by, dir, n, cat) =>
    apiFetch(`/crypto/getLeaderboard?by=${by}&dir=${dir}&limit=${n}${cat ? `&category=${cat}` : ''}`),
};

// ── Asset-type detection ──────────────────────────────────────────────────────
export function detectAssetType(identifier) {
  if (/^[A-Z]{6}$/.test(identifier)) return 'forex';
  if (identifier.endsWith('X') && identifier.length <= 8) return 'crypto';
  return 'stock';
}

// ── Price helpers ─────────────────────────────────────────────────────────────

/** Cache-first price — fine for display commands. */
export async function getCurrentPrice(ticker, assetType) {
  if (assetType === 'forex')  { const p = await api.forexPair(ticker);  return p.price; }
  if (assetType === 'crypto') { const c = await api.cryptoCoin(ticker); return c.price; }
  const s = await api.stock(ticker);
  return s.price;
}

/**
 * Always-fresh price — bypasses cache entirely.
 * Use for every trade execution to get the authoritative market price.
 * Throws ApiError if the asset does not exist or returns invalid data.
 */
export async function getFreshPrice(ticker, assetType) {
  let data;
  if (assetType === 'forex')  data = await apiFetch(`/forex/getPair?pair=${ticker}`,   { fresh: true });
  else if (assetType === 'crypto') data = await apiFetch(`/crypto/getCoin?symbol=${ticker}`, { fresh: true });
  else                             data = await apiFetch(`/getStock?ticker=${ticker}`,        { fresh: true });

  if (typeof data.price !== 'number' || !Number.isFinite(data.price) || data.price <= 0) {
    throw new ApiError(`No valid price returned for ${ticker}.`);
  }
  return data.price;
}

/** Path builder — used externally to read cached prices before a fresh fetch. */
export function pricePath(ticker, assetType) {
  if (assetType === 'forex')  return `/forex/getPair?pair=${ticker}`;
  if (assetType === 'crypto') return `/crypto/getCoin?symbol=${ticker}`;
  return `/getStock?ticker=${ticker}`;
}
