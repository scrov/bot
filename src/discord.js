/**
 * The two calls the Worker makes to Discord when someone signs in to the
 * Activity: trading the authorization code for an access token, and asking
 * whose token it is.
 */

const DISCORD_API = 'https://discord.com/api/v10';

/** Discord's API address. DISCORD_API_BASE replaces it in tests. */
const apiBase = (env) => env.DISCORD_API_BASE || DISCORD_API;

/**
 * Trade the code from the Embedded App SDK's `authorize` command for an access
 * token. Returns the access token, or null if Discord refuses the code.
 */
export async function exchangeCode(env, code) {
  const response = await fetch(`${apiBase(env)}/oauth2/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: env.DISCORD_APPLICATION_ID,
      client_secret: env.DISCORD_CLIENT_SECRET,
      grant_type: 'authorization_code',
      code,
    }),
  });
  if (!response.ok) {
    console.error(`Discord refused the authorization code: ${response.status}`);
    return null;
  }
  const { access_token: accessToken } = await response.json();
  return typeof accessToken === 'string' && accessToken ? accessToken : null;
}

/**
 * The Discord user an access token belongs to, as `{ id, name }`, or null.
 */
export async function fetchUser(env, accessToken) {
  const response = await fetch(`${apiBase(env)}/users/@me`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!response.ok) {
    console.error(`Discord did not return the user: ${response.status}`);
    return null;
  }
  const user = await response.json();
  if (typeof user?.id !== 'string' || !/^\d{1,25}$/.test(user.id)) return null;
  return { id: user.id, name: user.global_name || user.username || user.id };
}
