/**
 * Session tokens for the Activity's API.
 *
 * After someone signs in through Discord, the Worker hands the front end a
 * token that says which Discord user it is and until when, signed with
 * HMAC-SHA256. Later requests are checked against the signature alone, with no
 * call to Discord.
 *
 * Token: `v1.<user id>.<expiry, seconds since 1970>.<signature, base64url>`.
 */

/** How long a session lasts, in seconds. The Activity signs in on every launch. */
export const SESSION_TTL = 12 * 60 * 60;

const encoder = new TextEncoder();

const toBase64Url = (bytes) =>
  btoa(String.fromCharCode(...new Uint8Array(bytes)))
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replace(/=+$/, '');

function fromBase64Url(text) {
  if (!/^[A-Za-z0-9_-]+$/.test(text)) return null;
  try {
    const binary = atob(text.replaceAll('-', '+').replaceAll('_', '/'));
    return Uint8Array.from(binary, (char) => char.charCodeAt(0));
  } catch {
    return null;
  }
}

/** The signing key. The label keeps it apart from any other use of the secret. */
const importKey = (secret) =>
  crypto.subtle.importKey(
    'raw',
    encoder.encode(`scrov-bot session v1\n${secret}`),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify'],
  );

/** Make a session token for a Discord user. `now` is in milliseconds. */
export async function createSession(
  secret,
  userId,
  { ttl = SESSION_TTL, now = Date.now() } = {},
) {
  if (!/^\d{1,25}$/.test(String(userId))) {
    throw new Error('A Discord user id is all digits.');
  }
  const payload = `v1.${userId}.${Math.floor(now / 1000) + ttl}`;
  const signature = await crypto.subtle.sign(
    'HMAC',
    await importKey(secret),
    encoder.encode(payload),
  );
  return `${payload}.${toBase64Url(signature)}`;
}

/**
 * The Discord user id a token was issued to, or null if the token is
 * malformed, was not signed with this secret, or has expired.
 */
export async function verifySession(secret, token, { now = Date.now() } = {}) {
  if (!secret || typeof token !== 'string' || token.length > 200) return null;
  const parts = token.split('.');
  if (parts.length !== 4 || parts[0] !== 'v1') return null;
  const [, userId, expiry, signature] = parts;
  if (!/^\d{1,25}$/.test(userId) || !/^\d{1,12}$/.test(expiry)) return null;
  const bytes = fromBase64Url(signature);
  if (!bytes) return null;
  const valid = await crypto.subtle.verify(
    'HMAC',
    await importKey(secret),
    bytes,
    encoder.encode(`v1.${userId}.${expiry}`),
  );
  if (!valid || Number(expiry) * 1000 <= now) return null;
  return userId;
}
