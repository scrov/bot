# scrov bot

A Discord app on Cloudflare Workers with two faces:

- **An Activity**: a clipboard, notebook, snippet, bookmarklet and macro manager that opens inside Discord, built with the [Embedded App SDK](https://docs.discord.com/developers/developer-tools/embedded-app-sdk).
- **Slash commands** that use the same saved items from any channel.

It started from Discord's [Cloudflare Workers sample app](https://github.com/discord/cloudflare-sample-app), whose `/awwww` command is still here.

## What it does

The Activity has five sections. Every item has a title and text, can be pinned, searched, edited and deleted, and is copied to the clipboard with one click.

| Section      | For                                             | Besides copying                                                                                                |
| ------------ | ----------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| Clipboard    | Things you paste often                          | A box at the top saves a clip with Ctrl+Enter                                                                  |
| Notebook     | Longer text                                     |                                                                                                                |
| Snippets     | Code and commands, with a language label        |                                                                                                                |
| Bookmarklets | JavaScript you run from a browser bookmark      | "Copy as bookmark" gives the `javascript:` address to save as a bookmark. The code is never run or linked here |
| Macros       | Text with blanks, such as `Standup for {{day}}` | "Fill in and copy" asks for each blank. `{{date}}`, `{{time}}`, `{{datetime}}` and `{{user}}` fill themselves  |

Slash commands:

| Command     | What it does                                                                    |
| ----------- | ------------------------------------------------------------------------------- |
| `/notebook` | Opens the Activity                                                              |
| `/save`     | Saves text as a clip, note, snippet, bookmarklet or macro                       |
| `/paste`    | Posts a saved item in the channel, with suggestions as you type its title       |
| `/awwww`    | Posts something cute from r/aww                                                 |
| `/scrov`    | Links to the scrov site and source                                              |
| `/invite`   | Gives a link to add the bot to a server                                         |
| `/ping`     | Answers `pong`                                                                  |
| `/help`     | Lists the commands                                                              |

`/paste` posts snippets and bookmarklets as code blocks, fills in macros, cuts the text to Discord's 2000-character limit, and never pings anyone, whatever the saved text contains. Add `private: True` to show the item only to yourself.

## How it is built

```
├── client/                 -> the Activity's front end, bundled into public/assets/app.js
│   ├── main.js             -> entry point
│   ├── connect.js          -> signs in through the Embedded App SDK
│   ├── stores.js           -> where items are kept: the API, or this browser
│   └── ui.js               -> the interface
├── public/                 -> files served as they are
│   ├── index.html          -> the page Discord loads at the root address
│   └── app.css
├── src/
│   ├── index.js            -> Worker entry point
│   ├── server.js           -> routes: interactions, the API, and public/
│   ├── commands.js         -> slash command definitions
│   ├── items.js            -> rules for saved items, shared with the front end
│   ├── items-db.js         -> one person's items in SQLite
│   ├── store.js            -> the Durable Object that owns that database
│   ├── session.js          -> signed session tokens for the API
│   ├── discord.js          -> the two calls to Discord made at sign-in
│   ├── reddit.js           -> /awwww
│   └── register.js         -> registers the commands with Discord
├── test/
└── wrangler.toml
```

- **One Worker serves everything.** `POST /` receives Discord's interactions, `/api/*` is the Activity's API, and every other address is a file from `public/`. The root address is `public/index.html`, which is what Discord loads when the Activity starts.
- **Each person's items live in their own Durable Object**, named by their Discord user id, in that object's SQLite database. The Activity and the slash commands read and write the same one. A person can keep up to 500 items of up to 20,000 characters each.
- **Sign-in follows the SDK's flow.** The front end asks Discord for a code (`identify` scope only), the Worker trades it for an access token using the client secret and asks Discord whose it is, and then gives the front end a session token: the user id and an expiry, signed with HMAC-SHA256. API requests are checked against that signature without calling Discord again. Sessions last 12 hours; the Activity signs in every time it opens.
- **Opened outside Discord**, at the Worker's own address, the page works without an account and keeps items in that browser only. This is also the quickest way to try it.

## Setting it up

You need a [Discord app](https://discord.com/developers/applications) and a Cloudflare account.

### 1. Secrets

The Worker needs four values from the Developer Portal:

| Name                     | Where it is                               |
| ------------------------ | ----------------------------------------- |
| `DISCORD_APPLICATION_ID` | General Information → Application ID      |
| `DISCORD_PUBLIC_KEY`     | General Information → Public Key          |
| `DISCORD_TOKEN`          | Bot → Token                               |
| `DISCORD_CLIENT_SECRET`  | OAuth2 → Client Secret                    |

For local work, copy `example.dev.vars` to `.dev.vars` and fill it in. `.dev.vars` holds secrets and is ignored by git.

For the deployed Worker, store each one:

```
npx wrangler secret put DISCORD_APPLICATION_ID
npx wrangler secret put DISCORD_PUBLIC_KEY
npx wrangler secret put DISCORD_TOKEN
npx wrangler secret put DISCORD_CLIENT_SECRET
```

Without `DISCORD_CLIENT_SECRET` the slash commands still work, but nobody can sign in to the Activity.

### 2. Deploy

Pushing to `main` deploys the Worker (named `bot` in `wrangler.toml`) through the `Deploy` workflow in `.github/workflows/deploy.yml`. It needs two [repository secrets](https://docs.github.com/en/actions/security-guides/encrypted-secrets#creating-encrypted-secrets-for-a-repository):

- `CLOUDFLARE_API_TOKEN`: an API token created from the "Edit Cloudflare Workers" template
- `CLOUDFLARE_ACCOUNT_ID`: the account that owns the Worker

To deploy from your machine instead, run `npm run publish`.

The first deploy creates the Durable Object class from the migration in `wrangler.toml`. Nothing has to be created by hand.

### 3. Point Discord at the Worker

In the Developer Portal, with `bot.<your-subdomain>.workers.dev` standing for the Worker's address:

1. **General Information → Interactions Endpoint URL**: `https://bot.<your-subdomain>.workers.dev/`
2. **Activities → Settings**: enable Activities.
3. **Activities → URL Mappings**: map the root, `/`, to `bot.<your-subdomain>.workers.dev`.
4. **OAuth2 → Redirects**: add one. Discord requires a redirect to exist before the SDK may ask for a code; `https://127.0.0.1` is the placeholder its own guide uses.

Discord's guide to [building an Activity](https://docs.discord.com/developers/activities/building-an-activity) has screenshots of each of these pages.

### 4. Register the commands

```
npm run register
```

Run it again whenever `src/commands.js` changes. If Discord has created an Entry Point command for the Activity (the "Launch" entry in the App Launcher), the script sends it back unchanged, because Discord refuses an update that would remove it.

## Working on it

```
npm install
npm start          # the Worker on http://localhost:8787, front end rebuilt on change
npm test           # unit tests, with coverage
npm run lint
```

Open `http://localhost:8787/` to use the Activity in local mode.

To receive real interactions on your machine, `npm run ngrok` opens a tunnel; use its HTTPS address as the Interactions Endpoint URL while you test.

The tests run in Node. The storage layer (`src/items-db.js`) is tested on Node's built-in SQLite, which has the same SQL as the Durable Object's.
