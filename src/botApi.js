const BASE = process.env.POLYMART_BASE_URL ?? 'https://polymart.co/api/v1';
const KEY  = process.env.BOT_API_KEY;

/**
 * Authenticated request to Polymart's bot-specific endpoints.
 * Throws with a descriptive message on non-2xx responses.
 */
export async function botApi(method, path, body) {
  const res = await fetch(`${BASE}/bot${path}`, {
    method,
    headers: {
      'Content-Type':  'application/json',
      'Authorization': `Bearer ${KEY}`,
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });

  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error?.message ?? json.error ?? `Bot API error ${res.status}`);
  return json.data ?? json;
}
