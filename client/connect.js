/**
 * Decide where items are kept, signing in through Discord when the page is
 * running inside it as an Activity.
 */

import { DiscordSDK } from '@discord/embedded-app-sdk';
import { localStore, remoteStore } from './stores.js';

/** How long to wait for Discord before giving up, in milliseconds. */
const DISCORD_TIMEOUT = 15000;

/**
 * Inside Discord the page is served from Discord's proxy, which forwards
 * anything under `/.proxy/` to the Worker. Opened directly, the API is on the
 * same host as the page.
 */
const PROXIED_API = '/.proxy/api';

/** Discord adds these to the address of every Activity it opens. */
const insideDiscord = () =>
  new URLSearchParams(window.location.search).has('frame_id');

function withTimeout(promise, what) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(
      () => reject(new Error(`${what} did not answer`)),
      DISCORD_TIMEOUT,
    );
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

async function readJson(response) {
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.error ?? `the server answered ${response.status}`);
  }
  return data;
}

/**
 * The Embedded App SDK's sign-in: ask Discord for a code, trade it at the
 * Worker for tokens, then tell Discord which token this Activity is using.
 */
async function signIn(api) {
  const config = await readJson(await fetch(`${api}/config`));
  // The proxy's host name starts with the application id, if the Worker has
  // not been told it.
  const clientId = config.clientId ?? window.location.hostname.split('.')[0];

  const sdk = new DiscordSDK(clientId);
  await withTimeout(sdk.ready(), 'Discord');

  const { code } = await sdk.commands.authorize({
    client_id: clientId,
    response_type: 'code',
    state: '',
    prompt: 'none',
    scope: ['identify'],
  });

  const tokens = await readJson(
    await fetch(`${api}/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code }),
    }),
  );

  // Nothing here uses further SDK commands, so a failure at this step does
  // not stop the app: the Worker has already confirmed who signed in.
  await sdk.commands
    .authenticate({ access_token: tokens.access_token })
    .catch((error) => console.warn('Discord authenticate failed', error));

  return tokens;
}

/**
 * Returns `{ store, message, name }`: the store to use, a sentence saying
 * where items are kept, and the person's name when they signed in.
 */
export async function connect() {
  if (!insideDiscord()) {
    const store = localStore();
    return {
      store,
      message: store.lasting
        ? 'Saved in this browser only. Open the app inside Discord to keep items with your account.'
        : 'This browser is not letting the page save anything: items last until you close it.',
    };
  }

  try {
    const { session, user } = await signIn(PROXIED_API);
    return {
      store: remoteStore(PROXIED_API, session),
      name: user.name,
      message: `Signed in as ${user.name}. Items are saved to your Discord account.`,
    };
  } catch (error) {
    return {
      store: localStore(),
      message: `Could not sign in through Discord: ${error.message.replace(/\.$/, '')}. Items are saved on this device only.`,
    };
  }
}
