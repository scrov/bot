import { expect } from 'chai';
import { describe, it, beforeEach, afterEach } from 'mocha';
import {
  InteractionResponseFlags,
  InteractionResponseType,
  InteractionType,
} from 'discord-interactions';
import sinon from 'sinon';
import {
  ALL_COMMANDS,
  NOTEBOOK_COMMAND,
  PASTE_COMMAND,
  SAVE_COMMAND,
} from '../src/commands.js';
import { KINDS } from '../src/items.js';
import server from '../src/server.js';
import { createSession } from '../src/session.js';
import { fakeUserStore } from './helpers.js';

const HOST = 'http://bot.example';
const SECRET = 'client-secret';
const ADA = { id: '111', username: 'ada', global_name: 'Ada' };
const BOB = { id: '222', username: 'bob' };

describe('Commands', () => {
  it('fit what Discord accepts', () => {
    const names = ALL_COMMANDS.map((command) => command.name);
    expect(new Set(names).size).to.equal(names.length);
    for (const command of ALL_COMMANDS) {
      expect(command.name).to.match(/^[a-z0-9_-]{1,32}$/);
      expect(command.description).to.have.length.within(1, 100);
      for (const option of command.options ?? []) {
        expect(option.name).to.match(/^[a-z0-9_-]{1,32}$/);
        expect(option.description).to.have.length.within(1, 100);
      }
    }
    const kinds = SAVE_COMMAND.options[0].choices.map((choice) => choice.value);
    expect(kinds).to.deep.equal(KINDS);
  });
});

describe('Notebook commands', () => {
  let env;

  beforeEach(() => {
    env = { USER_STORE: fakeUserStore() };
  });

  afterEach(() => sinon.restore());

  /** Send an interaction as Discord would, with its signature taken as good. */
  async function interact(interaction) {
    sinon.restore();
    sinon
      .stub(server, 'verifyDiscordRequest')
      .resolves({ isValid: true, interaction });
    const response = await server.fetch(
      { method: 'POST', url: new URL('/', HOST) },
      env,
    );
    return response.json();
  }

  const command = (name, options = {}, user = ADA) => ({
    type: InteractionType.APPLICATION_COMMAND,
    member: { user },
    data: {
      name,
      options: Object.entries(options).map(([key, value]) => ({
        name: key,
        value,
      })),
    },
  });

  const save = (options, user) =>
    interact(command(SAVE_COMMAND.name, options, user));
  const paste = (options, user) =>
    interact(command(PASTE_COMMAND.name, options, user));
  const firstItem = async (user = ADA) =>
    (await env.USER_STORE.get(user.id).list())[0];

  it('/notebook opens the Activity', async () => {
    const body = await interact(command(NOTEBOOK_COMMAND.name));
    expect(body).to.deep.equal({ type: 12 });
  });

  it('/save keeps the text and says so privately', async () => {
    const body = await save({ kind: 'snippet', text: 'ls -la', title: 'List' });
    expect(body.type).to.equal(
      InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
    );
    expect(body.data.flags).to.equal(InteractionResponseFlags.EPHEMERAL);
    expect(body.data.content).to.include('List').and.include('Snippets');
    expect(await firstItem()).to.include({
      kind: 'snippet',
      title: 'List',
      body: 'ls -la',
    });
  });

  it('/save explains a refusal', async () => {
    const body = await save({ kind: 'clip', text: '   ' });
    expect(body.data.flags).to.equal(InteractionResponseFlags.EPHEMERAL);
    expect(body.data.content).to.include('empty');
    expect(await firstItem()).to.equal(undefined);
  });

  it('/save works in a direct message, where the user is not in `member`', async () => {
    await interact({
      ...command(SAVE_COMMAND.name, { kind: 'clip', text: 'dm' }),
      member: undefined,
      user: BOB,
    });
    expect(await firstItem(BOB)).to.include({ body: 'dm' });
  });

  it('/paste posts the chosen item without pinging anyone', async () => {
    await save({ kind: 'clip', text: 'hello @everyone' });
    const { id } = await firstItem();
    const body = await paste({ item: id });
    expect(body.data.content).to.equal('hello @everyone');
    expect(body.data.allowed_mentions).to.deep.equal({ parse: [] });
    expect(body.data.flags).to.equal(undefined);
  });

  it('/paste can show the item only to its owner', async () => {
    await save({ kind: 'note', text: 'secret plan' });
    const body = await paste({ item: 'secret', private: true });
    expect(body.data.content).to.equal('secret plan');
    expect(body.data.flags).to.equal(InteractionResponseFlags.EPHEMERAL);
  });

  it('/paste treats typed text as a search', async () => {
    await save({ kind: 'snippet', text: 'git status', title: 'Status' });
    const body = await paste({ item: 'stat' });
    expect(body.data.content).to.equal('```\ngit status\n```');
  });

  it('/paste fills in a macro', async () => {
    await save({ kind: 'macro', text: 'Signed {{user}}, {{date}}' });
    const body = await paste({ item: 'signed' });
    expect(body.data.content).to.match(/^Signed Ada, \d{4}-\d{2}-\d{2}$/);
  });

  it('/paste says when nothing matches', async () => {
    const body = await paste({ item: 'nothing here' });
    expect(body.data.flags).to.equal(InteractionResponseFlags.EPHEMERAL);
    expect(body.data.content).to.include('nothing here');
  });

  it("keeps each person's items apart", async () => {
    await save({ kind: 'clip', text: 'mine' }, ADA);
    const body = await paste({ item: 'mine' }, BOB);
    expect(body.data.flags).to.equal(InteractionResponseFlags.EPHEMERAL);
    expect(body.data.content).to.not.equal('mine');
  });

  it('suggests saved items while typing', async () => {
    await save({ kind: 'clip', text: 'alpha' });
    await save({ kind: 'note', text: 'beta', title: 'Alphabet' });
    await save({ kind: 'note', text: 'gamma' });
    const body = await interact({
      type: InteractionType.APPLICATION_COMMAND_AUTOCOMPLETE,
      member: { user: ADA },
      data: {
        name: PASTE_COMMAND.name,
        options: [{ name: 'item', value: 'alph', focused: true }],
      },
    });
    expect(body.type).to.equal(
      InteractionResponseType.APPLICATION_COMMAND_AUTOCOMPLETE_RESULT,
    );
    const names = body.data.choices.map((choice) => choice.name);
    expect(names).to.have.members(['Clipboard: alpha', 'Notebook: Alphabet']);
    for (const choice of body.data.choices) {
      expect(await env.USER_STORE.get(ADA.id).get(choice.value)).to.not.equal(
        null,
      );
    }
  });

  it('answers politely when storage is not set up', async () => {
    env = {};
    const saved = await save({ kind: 'clip', text: 'x' });
    expect(saved.data.flags).to.equal(InteractionResponseFlags.EPHEMERAL);
    const pasted = await paste({ item: 'x' });
    expect(pasted.data.flags).to.equal(InteractionResponseFlags.EPHEMERAL);
  });
});

describe('Activity API', () => {
  let env;

  beforeEach(() => {
    env = {
      DISCORD_APPLICATION_ID: '999',
      DISCORD_CLIENT_SECRET: SECRET,
      DISCORD_API_BASE: 'http://discord.test/api',
      USER_STORE: fakeUserStore(),
    };
  });

  afterEach(() => sinon.restore());

  const call = (path, { method = 'GET', body, session, headers = {} } = {}) =>
    server.fetch(
      new Request(`${HOST}${path}`, {
        method,
        headers: {
          ...(session ? { Authorization: `Bearer ${session}` } : {}),
          ...headers,
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      }),
      env,
    );

  const sessionFor = (user) => createSession(SECRET, user.id);

  /** Stand in for Discord's token and user endpoints. */
  function stubDiscord({
    token = { status: 200 },
    user = { status: 200 },
  } = {}) {
    const stub = sinon.stub(globalThis, 'fetch');
    stub
      .withArgs('http://discord.test/api/oauth2/token')
      .callsFake(async () =>
        Response.json({ access_token: 'discord-token' }, token),
      );
    stub
      .withArgs('http://discord.test/api/users/@me')
      .callsFake(async () => Response.json(ADA, user));
    return stub;
  }

  describe('sign-in', () => {
    it('tells the front end the application id', async () => {
      const response = await call('/api/config');
      expect(await response.json()).to.deep.equal({ clientId: '999' });
      expect(response.headers.get('cache-control')).to.equal('no-store');
    });

    it('trades a code for a Discord token and a session', async () => {
      const discord = stubDiscord();
      const response = await call('/api/token', {
        method: 'POST',
        body: { code: 'abc' },
      });
      expect(response.status).to.equal(200);
      const body = await response.json();
      expect(body.access_token).to.equal('discord-token');
      expect(body.user).to.deep.equal({ id: '111', name: 'Ada' });

      const [, exchange] = discord.firstCall.args;
      expect(Object.fromEntries(exchange.body)).to.deep.equal({
        client_id: '999',
        client_secret: SECRET,
        grant_type: 'authorization_code',
        code: 'abc',
      });
      expect(discord.secondCall.args[1].headers.Authorization).to.equal(
        'Bearer discord-token',
      );

      const items = await call('/api/items', { session: body.session });
      expect(items.status).to.equal(200);
    });

    it('needs the client secret to be configured', async () => {
      delete env.DISCORD_CLIENT_SECRET;
      const response = await call('/api/token', {
        method: 'POST',
        body: { code: 'abc' },
      });
      expect(response.status).to.equal(503);
    });

    it('refuses a request without a usable code', async () => {
      const discord = stubDiscord();
      for (const body of [{}, { code: '' }, { code: 5 }, 'text', undefined]) {
        const response = await call('/api/token', { method: 'POST', body });
        expect(response.status, JSON.stringify(body)).to.equal(400);
      }
      expect(discord.called).to.equal(false);
    });

    it('reports a code Discord does not accept', async () => {
      stubDiscord({ token: { status: 400 } });
      const response = await call('/api/token', {
        method: 'POST',
        body: { code: 'stale' },
      });
      expect(response.status).to.equal(401);
    });

    it('reports when Discord does not say who signed in', async () => {
      stubDiscord({ user: { status: 401 } });
      const response = await call('/api/token', {
        method: 'POST',
        body: { code: 'abc' },
      });
      expect(response.status).to.equal(502);
    });
  });

  describe('items', () => {
    it('refuses requests without a valid session', async () => {
      const forged = await createSession('another secret', ADA.id);
      for (const session of [undefined, 'nonsense', forged]) {
        const response = await call('/api/items', { session });
        expect(response.status).to.equal(401);
      }
      const response = await call('/api/items', {
        headers: { Authorization: 'Basic abc' },
      });
      expect(response.status).to.equal(401);
    });

    it('creates, lists, changes and deletes', async () => {
      const session = await sessionFor(ADA);

      const created = await call('/api/items', {
        method: 'POST',
        session,
        body: { kind: 'note', title: 'Plan', body: 'Step one' },
      });
      expect(created.status).to.equal(201);
      const { item } = await created.json();
      expect(item).to.include({ kind: 'note', title: 'Plan', pinned: false });

      const listed = await (await call('/api/items', { session })).json();
      expect(listed.items).to.deep.equal([item]);

      const changed = await call(`/api/items/${item.id}`, {
        method: 'PUT',
        session,
        body: { pinned: true, body: 'Step two' },
      });
      expect((await changed.json()).item).to.include({
        pinned: true,
        body: 'Step two',
      });

      const removed = await call(`/api/items/${item.id}`, {
        method: 'DELETE',
        session,
      });
      expect(removed.status).to.equal(200);
      const again = await call(`/api/items/${item.id}`, {
        method: 'DELETE',
        session,
      });
      expect(again.status).to.equal(404);
    });

    it('explains what is wrong with an item', async () => {
      const session = await sessionFor(ADA);
      const invalid = await call('/api/items', {
        method: 'POST',
        session,
        body: { kind: 'note', body: '' },
      });
      expect(invalid.status).to.equal(400);
      expect((await invalid.json()).error).to.be.a('string');

      const notJson = await server.fetch(
        new Request(`${HOST}/api/items`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${session}` },
          body: '{',
        }),
        env,
      );
      expect(notJson.status).to.equal(400);

      const missing = await call('/api/items/nope', {
        method: 'PUT',
        session,
        body: { title: 'x' },
      });
      expect(missing.status).to.equal(404);
    });

    it("never shows one person another's items", async () => {
      await call('/api/items', {
        method: 'POST',
        session: await sessionFor(ADA),
        body: { kind: 'clip', body: 'for Ada only' },
      });
      const response = await call('/api/items', {
        session: await sessionFor(BOB),
      });
      expect((await response.json()).items).to.deep.equal([]);
    });

    it('shares one store between the API and the slash commands', async () => {
      await call('/api/items', {
        method: 'POST',
        session: await sessionFor(ADA),
        body: { kind: 'clip', body: 'from the app' },
      });
      sinon.stub(server, 'verifyDiscordRequest').resolves({
        isValid: true,
        interaction: {
          type: InteractionType.APPLICATION_COMMAND,
          member: { user: ADA },
          data: {
            name: PASTE_COMMAND.name,
            options: [{ name: 'item', value: 'from the app' }],
          },
        },
      });
      const response = await server.fetch(
        { method: 'POST', url: new URL('/', HOST) },
        env,
      );
      expect((await response.json()).data.content).to.equal('from the app');
    });
  });

  describe('everything else', () => {
    it('answers unknown API addresses in JSON', async () => {
      const response = await call('/api/nothing');
      expect(response.status).to.equal(404);
      expect(await response.json()).to.have.property('error');
    });

    it('serves files from public/', async () => {
      env.ASSETS = {
        fetch: async (request) =>
          new Response(
            request instanceof Request
              ? new URL(request.url).pathname
              : 'not a request',
          ),
      };
      const response = await call('/app.css');
      expect(await response.text()).to.equal('/app.css');
    });

    it('does not hand other methods to the files', async () => {
      env.ASSETS = { fetch: async () => new Response('file') };
      const response = await call('/app.css', { method: 'POST', body: {} });
      expect(response.status).to.equal(404);
    });
  });
});
