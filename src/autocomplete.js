import { api } from './api.js';

// ── Ticker autocomplete ───────────────────────────────────────────────────────
// Backed by the cached/deduped search endpoints, so rapid keystrokes are cheap.
// Defensive about response shape (array, {results}, or keyed object).

function normalizeSearch(data) {
  if (!data) return [];
  const arr = Array.isArray(data)         ? data
            : Array.isArray(data.results) ? data.results
            : Array.isArray(data.matches) ? data.matches
            : typeof data === 'object'    ? Object.entries(data).map(([k, v]) => ({ ticker: k, ...(v || {}) }))
            : [];
  return arr
    .map(r => ({
      ticker: String(r.ticker ?? r.symbol ?? r.pair ?? r.code ?? '').toUpperCase(),
      name:   r.name ?? r.fullName ?? r.displayName ?? '',
    }))
    .filter(r => r.ticker);
}

/** Respond to an autocomplete interaction with up to 25 ticker suggestions. */
export async function respondTickerAutocomplete(interaction, kind = 'stock') {
  const focused = String(interaction.options.getFocused() ?? '').trim();
  if (!focused) return interaction.respond([]);

  let results = [];
  try {
    const data = kind === 'crypto' ? await api.cryptoSearch(focused)
              : kind === 'forex'  ? await api.forexSearch(focused)
              :                     await api.search(focused);
    results = normalizeSearch(data);
  } catch {
    results = [];
  }

  const choices = results.slice(0, 25).map(r => ({
    name:  `${r.ticker}${r.name ? ` — ${r.name}` : ''}`.slice(0, 100),
    value: r.ticker.slice(0, 100),
  }));
  return interaction.respond(choices);
}
