import {
	handleCommand,
	type Interaction,
	InteractionType,
	ResponseType,
} from "./commands";
import { verifyDiscordRequest } from "./verify";

export interface Env {
	DISCORD_PUBLIC_KEY: string;
}

export default {
	async fetch(request: Request, env: Env): Promise<Response> {
		if (request.method === "GET") {
			return new Response("scrov bot is running");
		}
		if (request.method !== "POST") {
			return new Response("Method not allowed", { status: 405 });
		}
		if (!env.DISCORD_PUBLIC_KEY) {
			console.error("DISCORD_PUBLIC_KEY is not set");
			return new Response("Bot is not configured", { status: 500 });
		}

		const body = await request.text();
		const valid = await verifyDiscordRequest(
			body,
			request.headers.get("X-Signature-Ed25519"),
			request.headers.get("X-Signature-Timestamp"),
			env.DISCORD_PUBLIC_KEY,
		);
		if (!valid) {
			return new Response("Bad request signature", { status: 401 });
		}

		let interaction: Interaction;
		try {
			interaction = JSON.parse(body) as Interaction;
		} catch {
			return new Response("Invalid JSON", { status: 400 });
		}

		if (interaction.type === InteractionType.Ping) {
			return Response.json({ type: ResponseType.Pong });
		}
		if (interaction.type === InteractionType.ApplicationCommand) {
			return Response.json(handleCommand(interaction));
		}
		return new Response("Unsupported interaction type", { status: 400 });
	},
} satisfies ExportedHandler<Env>;
