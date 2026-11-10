# bot

The scrov Discord bot. It answers slash commands over Discord's HTTP interactions
endpoint and runs as a Cloudflare Worker, so there is no gateway connection or
server to keep alive.

## Commands

| Command  | What it does                           |
| -------- | -------------------------------------- |
| `/ping`  | Checks that the bot is alive           |
| `/scrov` | Links to the scrov site and source     |
| `/help`  | Lists the commands (only you see it)   |

Add a command by appending to the `commands` array in `src/commands.ts`, then
register again.

## Setup

You need the three values from your application's page in the
[Discord Developer Portal](https://discord.com/developers/applications):
`DISCORD_APPLICATION_ID`, `DISCORD_PUBLIC_KEY` and `DISCORD_TOKEN`.

```sh
bun install

# 1. Deploy the Worker and give it the public key
bunx wrangler deploy
bunx wrangler secret put DISCORD_PUBLIC_KEY

# 2. Register the slash commands (reads .env, see .dev.vars.example)
bun run register              # globally, can take up to an hour to appear
bun run register <guild id>   # one server, appears immediately
```

3. In the Developer Portal, under **General Information**, set
   **Interactions Endpoint URL** to the Worker's URL. Discord sends a signed
   test request and only saves the URL if the bot answers it correctly.
4. Invite the bot with the `applications.commands` scope:
   `https://discord.com/oauth2/authorize?client_id=<DISCORD_APPLICATION_ID>&scope=applications.commands`

Only the Worker needs `DISCORD_PUBLIC_KEY`. The token is used by the register
script alone and never has to be uploaded to Cloudflare.

## Development

```sh
cp .dev.vars.example .dev.vars   # fill in DISCORD_PUBLIC_KEY
bun run dev                      # local Worker on http://localhost:8787
bun run check                    # typecheck + tests
```

## Layout

```
src/index.ts         Worker entry: verifies the signature, routes interactions
src/verify.ts        Ed25519 request verification (Web Crypto)
src/commands.ts      Command definitions and handlers
scripts/register.ts  Registers the commands with Discord
test/bot.test.ts     Signed-request tests
```
