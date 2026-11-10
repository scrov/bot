/**
 * Register the bot's slash commands with Discord.
 *
 *   bun run register              global commands (can take up to an hour to appear)
 *   bun run register <guild id>   one server only (appears immediately)
 *
 * Reads DISCORD_APPLICATION_ID and DISCORD_TOKEN from the environment or .env.
 */
import { commandDefinitions } from "../src/commands";

const applicationId = process.env.DISCORD_APPLICATION_ID;
const token = process.env.DISCORD_TOKEN;
const guildId = process.argv[2];

if (!applicationId || !token) {
	console.error("Set DISCORD_APPLICATION_ID and DISCORD_TOKEN first.");
	process.exit(1);
}

const scope = guildId ? `guilds/${guildId}/commands` : "commands";
const url = `https://discord.com/api/v10/applications/${applicationId}/${scope}`;

const response = await fetch(url, {
	method: "PUT",
	headers: {
		Authorization: `Bot ${token}`,
		"Content-Type": "application/json",
	},
	body: JSON.stringify(commandDefinitions()),
});

if (!response.ok) {
	console.error(`Discord returned ${response.status}: ${await response.text()}`);
	process.exit(1);
}

const registered = (await response.json()) as { name: string }[];
console.log(
	`Registered ${registered.length} commands${guildId ? ` in guild ${guildId}` : " globally"}: ${registered.map((c) => `/${c.name}`).join(", ")}`,
);
