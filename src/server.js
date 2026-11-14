/**
 * The core server that runs on a Cloudflare worker.
 *
 * It answers three kinds of request:
 *  - Discord's interactions (slash commands), posted to `/`;
 *  - the Activity's API under `/api/`, used by the front end in `client/`;
 *  - everything else, which is a file from `public/` (the Activity itself).
 */

import { AutoRouter } from 'itty-router';
import {
  InteractionResponseFlags,
  InteractionResponseType,
  InteractionType,
  verifyKey,
} from 'discord-interactions';
import {
  ALL_COMMANDS,
  AWW_COMMAND,
  HELP_COMMAND,
  INVITE_COMMAND,
  NOTEBOOK_COMMAND,
  PASTE_COMMAND,
  PING_COMMAND,
  SAVE_COMMAND,
  SCROV_COMMAND,
} from './commands.js';
import { exchangeCode, fetchUser } from './discord.js';
import { KIND_LABELS, builtinValues, toMessage } from './items.js';
import { getCuteUrl } from './reddit.js';
import { createSession, verifySession } from './session.js';

/**
 * Interaction response that opens the app's Activity. The
 * discord-interactions package does not name it yet.
 */
const LAUNCH_ACTIVITY = 12;

/** Discord shows at most this many autocomplete choices. */
const MAX_CHOICES = 25;

/** Largest request body the API reads, in characters. */
const MAX_BODY = 64 * 1024;

class JsonResponse extends Response {
  constructor(body, init) {
    const jsonBody = JSON.stringify(body);
    init = init || {
      headers: {
        'content-type': 'application/json;charset=UTF-8',
      },
    };
    super(jsonBody, init);
  }
}

/** A JSON answer from the Activity's API. Never cached: it is per person. */
const apiResponse = (body, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json;charset=UTF-8',
      'cache-control': 'no-store',
    },
  });

const apiError = (error, status) => apiResponse({ error }, status);

/** A message only the person who ran the command can see. */
const ephemeral = (content) =>
  new JsonResponse({
    type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
    data: { content, flags: InteractionResponseFlags.EPHEMERAL },
  });

/** The saved items of one Discord user. */
const storeFor = (env, userId) =>
  env.USER_STORE.get(env.USER_STORE.idFromName(userId));

const router = AutoRouter();

/**
 * A file from `public/`. The root address is `public/index.html`, the page
 * Discord loads when the Activity starts.
 */
function serveAsset(request, env) {
  if (!env.ASSETS || !['GET', 'HEAD'].includes(request.method)) {
    return new Response('Not Found.', { status: 404 });
  }
  // The router hands its handlers a proxy of the request, which the assets
  // binding does not accept, so it gets a plain request for the same file.
  return env.ASSETS.fetch(
    new Request(request.url, {
      method: request.method,
      headers: request.headers,
    }),
  );
}

router.get('/', serveAsset);

/**
 * Main route for all requests sent from Discord.  All incoming messages will
 * include a JSON payload described here:
 * https://discord.com/developers/docs/interactions/receiving-and-responding#interaction-object
 */
router.post('/', async (request, env) => {
  const { isValid, interaction } = await server.verifyDiscordRequest(
    request,
    env,
  );
  if (!isValid || !interaction) {
    return new Response('Bad request signature.', { status: 401 });
  }

  if (interaction.type === InteractionType.PING) {
    // The `PING` message is used during the initial webhook handshake, and is
    // required to configure the webhook in the developer portal.
    return new JsonResponse({
      type: InteractionResponseType.PONG,
    });
  }

  if (interaction.type === InteractionType.APPLICATION_COMMAND_AUTOCOMPLETE) {
    return new JsonResponse({
      type: InteractionResponseType.APPLICATION_COMMAND_AUTOCOMPLETE_RESULT,
      data: { choices: await itemChoices(interaction, env) },
    });
  }

  if (interaction.type === InteractionType.APPLICATION_COMMAND) {
    // Most user commands will come as `APPLICATION_COMMAND`.
    switch (interaction.data.name.toLowerCase()) {
      case AWW_COMMAND.name.toLowerCase(): {
        const cuteUrl = await getCuteUrl();
        return new JsonResponse({
          type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
          data: {
            content: cuteUrl,
          },
        });
      }
      case INVITE_COMMAND.name.toLowerCase(): {
        const applicationId = env.DISCORD_APPLICATION_ID;
        const INVITE_URL = `https://discord.com/oauth2/authorize?client_id=${applicationId}&scope=applications.commands`;
        return new JsonResponse({
          type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
          data: {
            content: INVITE_URL,
            flags: InteractionResponseFlags.EPHEMERAL,
          },
        });
      }
      case PING_COMMAND.name.toLowerCase(): {
        return new JsonResponse({
          type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
          data: {
            content: 'pong',
          },
        });
      }
      case SCROV_COMMAND.name.toLowerCase(): {
        return new JsonResponse({
          type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
          data: {
            content: [
              '**scrov** — a terminal-style portfolio and blog',
              'Site: <https://scrov.app>',
              'Source: <https://github.com/scrov/scrov>',
            ].join('\n'),
          },
        });
      }
      case NOTEBOOK_COMMAND.name.toLowerCase(): {
        return new JsonResponse({ type: LAUNCH_ACTIVITY });
      }
      case SAVE_COMMAND.name.toLowerCase(): {
        return saveItem(interaction, env);
      }
      case PASTE_COMMAND.name.toLowerCase(): {
        return pasteItem(interaction, env);
      }
      case HELP_COMMAND.name.toLowerCase(): {
        return new JsonResponse({
          type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
          data: {
            content: ALL_COMMANDS.map(
              (command) => `\`/${command.name}\` — ${command.description}`,
            ).join('\n'),
            flags: InteractionResponseFlags.EPHEMERAL,
          },
        });
      }
      default:
        return new JsonResponse({ error: 'Unknown Type' }, { status: 400 });
    }
  }

  console.error('Unknown Type');
  return new JsonResponse({ error: 'Unknown Type' }, { status: 400 });
});

// ---------------------------------------------------------------------------
// Slash commands that use the saved items
// ---------------------------------------------------------------------------

/** Who ran the command. In a server the user is inside `member`. */
const interactionUser = (interaction) =>
  interaction.member?.user ?? interaction.user ?? null;

/** The command's options as `{ name: value }`. */
const optionValues = (interaction) =>
  Object.fromEntries(
    (interaction.data.options ?? []).map((option) => [
      option.name,
      option.value,
    ]),
  );

/** `/save`: keep a piece of text. */
async function saveItem(interaction, env) {
  const user = interactionUser(interaction);
  if (!user || !env.USER_STORE) {
    return ephemeral('Saving is not available here.');
  }
  const { kind, text, title } = optionValues(interaction);
  const { item, error } = await storeFor(env, user.id).create({
    kind,
    title,
    body: text,
  });
  if (error) return ephemeral(error);
  return ephemeral(
    `Saved “${item.title}” to ${KIND_LABELS[item.kind]}. Use \`/${PASTE_COMMAND.name}\` to post it, or \`/${NOTEBOOK_COMMAND.name}\` to see everything.`,
  );
}

/** `/paste`: post a saved item. */
async function pasteItem(interaction, env) {
  const user = interactionUser(interaction);
  if (!user || !env.USER_STORE) {
    return ephemeral('Your saved items are not available here.');
  }
  const { item: wanted = '', private: onlyMe = false } =
    optionValues(interaction);
  const store = storeFor(env, user.id);
  // Picking a suggestion sends the item's id; typing without picking sends
  // the text as typed, which is then treated as a search.
  const item =
    (await store.get(String(wanted))) ??
    (await store.list({ query: String(wanted), limit: 1 }))[0];
  if (!item) {
    return ephemeral(
      `Nothing you have saved matches “${wanted}”. Use \`/${NOTEBOOK_COMMAND.name}\` to see what you have.`,
    );
  }
  const content = toMessage(
    item,
    builtinValues({ user: user.global_name || user.username || '', utc: true }),
  );
  return new JsonResponse({
    type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
    data: {
      content,
      // Saved text must not ping anyone when it is posted.
      allowed_mentions: { parse: [] },
      ...(onlyMe ? { flags: InteractionResponseFlags.EPHEMERAL } : {}),
    },
  });
}

/** Suggestions for the `item` option of `/paste`, as the person types. */
async function itemChoices(interaction, env) {
  const user = interactionUser(interaction);
  if (!user || !env.USER_STORE) return [];
  const focused = (interaction.data.options ?? []).find(
    (option) => option.focused,
  );
  const items = await storeFor(env, user.id).list({
    query: String(focused?.value ?? ''),
    limit: MAX_CHOICES,
  });
  return items.map((item) => ({
    name: `${KIND_LABELS[item.kind]}: ${item.title}`.slice(0, 100),
    value: item.id,
  }));
}

// ---------------------------------------------------------------------------
// The Activity's API
// ---------------------------------------------------------------------------

/** The request body as JSON, or null if it is missing, too large or invalid. */
async function readJson(request) {
  try {
    const text = await request.text();
    return text.length > MAX_BODY ? null : JSON.parse(text);
  } catch {
    return null;
  }
}

/** The Discord user id the request's session token belongs to, or null. */
async function sessionUser(request, env) {
  const header = request.headers.get('authorization') ?? '';
  if (!header.startsWith('Bearer ')) return null;
  return verifySession(env.DISCORD_CLIENT_SECRET, header.slice(7));
}

/** Run a handler with the signed-in user's store, or refuse. */
const withStore = (handler) => async (request, env) => {
  const userId = await sessionUser(request, env);
  if (!userId) return apiError('Sign in through Discord first.', 401);
  if (!env.USER_STORE) return apiError('Storage is not set up.', 503);
  return handler(storeFor(env, userId), request);
};

/** What the front end needs before it can sign in. */
router.get('/api/config', (request, env) =>
  apiResponse({ clientId: env.DISCORD_APPLICATION_ID ?? null }),
);

/**
 * Sign-in. The front end sends the code it got from the Embedded App SDK's
 * `authorize` command; it gets back the Discord access token the SDK's
 * `authenticate` command needs, and a session token for this API.
 */
router.post('/api/token', async (request, env) => {
  if (!env.DISCORD_APPLICATION_ID || !env.DISCORD_CLIENT_SECRET) {
    return apiError(
      'Sign-in is not set up: the Worker has no DISCORD_CLIENT_SECRET.',
      503,
    );
  }
  const body = await readJson(request);
  const code = body?.code;
  if (typeof code !== 'string' || !code || code.length > 512) {
    return apiError('Expected the authorization code from Discord.', 400);
  }
  const accessToken = await exchangeCode(env, code);
  if (!accessToken) {
    return apiError('Discord did not accept the authorization code.', 401);
  }
  const user = await fetchUser(env, accessToken);
  if (!user) return apiError('Discord did not say who signed in.', 502);
  return apiResponse({
    access_token: accessToken,
    session: await createSession(env.DISCORD_CLIENT_SECRET, user.id),
    user,
  });
});

router.get(
  '/api/items',
  withStore(async (store) => apiResponse({ items: await store.list() })),
);

router.post(
  '/api/items',
  withStore(async (store, request) => {
    const input = await readJson(request);
    if (!input) return apiError('Expected an item as JSON.', 400);
    const { item, error, status } = await store.create(input);
    return error ? apiError(error, status) : apiResponse({ item }, 201);
  }),
);

router.put(
  '/api/items/:id',
  withStore(async (store, request) => {
    const patch = await readJson(request);
    if (!patch) return apiError('Expected the changes as JSON.', 400);
    const { item, error, status } = await store.update(
      request.params.id,
      patch,
    );
    return error ? apiError(error, status) : apiResponse({ item });
  }),
);

router.delete(
  '/api/items/:id',
  withStore(async (store, request) => {
    const removed = await store.remove(request.params.id);
    return removed
      ? apiResponse({ removed: true })
      : apiError('That item no longer exists.', 404);
  }),
);

router.all('/api/*', () => apiError('There is nothing at this address.', 404));

router.all('*', serveAsset);

async function verifyDiscordRequest(request, env) {
  const signature = request.headers.get('x-signature-ed25519');
  const timestamp = request.headers.get('x-signature-timestamp');
  const body = await request.text();
  const isValidRequest =
    signature &&
    timestamp &&
    (await verifyKey(body, signature, timestamp, env.DISCORD_PUBLIC_KEY));
  if (!isValidRequest) {
    return { isValid: false };
  }

  return { interaction: JSON.parse(body), isValid: true };
}

const server = {
  verifyDiscordRequest,
  fetch: router.fetch,
};

export default server;
