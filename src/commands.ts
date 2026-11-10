/** https://discord.com/developers/docs/interactions/receiving-and-responding */
export const InteractionType = {
	Ping: 1,
	ApplicationCommand: 2,
} as const;

export const ResponseType = {
	Pong: 1,
	ChannelMessage: 4,
} as const;

/** Message flag: only the user who ran the command sees the reply. */
const EPHEMERAL = 64;

export interface Interaction {
	type: number;
	id?: string;
	data?: { name?: string };
	member?: { user?: { id: string; username: string } };
	user?: { id: string; username: string };
}

export interface InteractionResponse {
	type: number;
	data?: { content: string; flags?: number };
}

interface Command {
	name: string;
	description: string;
	run(interaction: Interaction): InteractionResponse;
}

const message = (content: string, flags?: number): InteractionResponse => ({
	type: ResponseType.ChannelMessage,
	data: flags === undefined ? { content } : { content, flags },
});

/** Discord snowflake IDs carry their creation time in the top 42 bits. */
const DISCORD_EPOCH = 1420070400000n;
export const snowflakeTime = (id: string): number =>
	Number((BigInt(id) >> 22n) + DISCORD_EPOCH);

export const commands: Command[] = [
	{
		name: "ping",
		description: "Check that the bot is alive",
		run: (interaction) => {
			if (!interaction.id) return message("pong");
			const latency = Date.now() - snowflakeTime(interaction.id);
			return message(`pong (${Math.max(0, latency)} ms)`);
		},
	},
	{
		name: "scrov",
		description: "Links to the scrov site and source",
		run: () =>
			message(
				[
					"**scrov** — a terminal-style portfolio and blog",
					"Site: <https://scrov.app>",
					"Source: <https://github.com/scrov/scrov>",
				].join("\n"),
			),
	},
	{
		name: "help",
		description: "List the bot's commands",
		run: () =>
			message(
				commands.map((c) => `\`/${c.name}\` — ${c.description}`).join("\n"),
				EPHEMERAL,
			),
	},
];

export function handleCommand(interaction: Interaction): InteractionResponse {
	const command = commands.find((c) => c.name === interaction.data?.name);
	if (!command) return message("Unknown command.", EPHEMERAL);
	return command.run(interaction);
}

/** Payload for Discord's bulk command registration endpoint. */
export const commandDefinitions = () =>
	commands.map(({ name, description }) => ({ name, description, type: 1 }));
