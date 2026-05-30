const BASE = process.env.POLYMART_BASE_URL ?? 'https://polymart.co/api/v1';

/**
 * Authenticated request to Polymart's bot-specific endpoints.
 * Reads BOT_API_KEY at call time so a bot restart always picks up the current value.
 * Throws with a descriptive message on non-2xx responses or a missing key.
 */
export async function botApi(method, path, body) {
  const key = process.env.BOT_API_KEY;
  if (!key) {
    throw new Error('BOT_API_KEY is not set in .env — cannot reach Polymart bot endpoints.');
  }

  const res = await fetch(`${BASE}/bot${path}`, {
    method,
    headers: {
      'Content-Type':  'application/json',
      'Authorization': `Bearer ${key}`,
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });

  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error?.message ?? json.error ?? `Bot API error ${res.status}`);
  return json.data ?? json;
}
