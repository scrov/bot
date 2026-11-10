import { beforeAll, describe, expect, test } from "bun:test";
import { commandDefinitions, snowflakeTime } from "../src/commands";
import worker from "../src/index";

const toHex = (bytes: ArrayBuffer | Uint8Array): string =>
	Buffer.from(bytes as ArrayBuffer).toString("hex");

let keys: CryptoKeyPair;
let publicKey: string;

beforeAll(async () => {
	keys = (await crypto.subtle.generateKey({ name: "Ed25519" }, true, [
		"sign",
		"verify",
	])) as CryptoKeyPair;
	publicKey = toHex(
		(await crypto.subtle.exportKey("raw", keys.publicKey)) as ArrayBuffer,
	);
});

async function send(
	payload: unknown,
	options: { tamper?: boolean; unsigned?: boolean } = {},
): Promise<Response> {
	const body = JSON.stringify(payload);
	const timestamp = String(Math.floor(Date.now() / 1000));
	const signature = toHex(
		await crypto.subtle.sign(
			{ name: "Ed25519" },
			keys.privateKey,
			new TextEncoder().encode(timestamp + body),
		),
	);
	const headers: Record<string, string> = options.unsigned
		? {}
		: { "X-Signature-Ed25519": signature, "X-Signature-Timestamp": timestamp };
	const request = new Request("https://bot.example/", {
		method: "POST",
		headers,
		body: options.tamper ? `${body} ` : body,
	});
	return worker.fetch(request, { DISCORD_PUBLIC_KEY: publicKey });
}

const command = (name: string) => ({
	type: 2,
	id: "1300000000000000000",
	data: { name },
});

describe("request verification", () => {
	test("answers Discord's PING with PONG", async () => {
		const response = await send({ type: 1 });
		expect(response.status).toBe(200);
		expect(await response.json()).toEqual({ type: 1 });
	});

	test("rejects unsigned requests", async () => {
		expect((await send({ type: 1 }, { unsigned: true })).status).toBe(401);
	});

	test("rejects a body that does not match its signature", async () => {
		expect((await send({ type: 1 }, { tamper: true })).status).toBe(401);
	});

	test("reports a missing public key", async () => {
		const request = new Request("https://bot.example/", {
			method: "POST",
			body: "{}",
		});
		const response = await worker.fetch(request, { DISCORD_PUBLIC_KEY: "" });
		expect(response.status).toBe(500);
	});
});

describe("commands", () => {
	test("/ping replies with pong", async () => {
		const reply = (await (await send(command("ping"))).json()) as {
			type: number;
			data: { content: string };
		};
		expect(reply.type).toBe(4);
		expect(reply.data.content).toStartWith("pong");
	});

	test("/scrov links to the site", async () => {
		const reply = (await (await send(command("scrov"))).json()) as {
			data: { content: string };
		};
		expect(reply.data.content).toContain("https://scrov.app");
	});

	test("/help lists every command, only to the caller", async () => {
		const reply = (await (await send(command("help"))).json()) as {
			data: { content: string; flags: number };
		};
		for (const { name } of commandDefinitions()) {
			expect(reply.data.content).toContain(`/${name}`);
		}
		expect(reply.data.flags).toBe(64);
	});

	test("unknown commands get an ephemeral error", async () => {
		const reply = (await (await send(command("nope"))).json()) as {
			data: { content: string; flags: number };
		};
		expect(reply.data.content).toBe("Unknown command.");
		expect(reply.data.flags).toBe(64);
	});

	test("definitions satisfy Discord's naming rules", () => {
		for (const { name, description } of commandDefinitions()) {
			expect(name).toMatch(/^[a-z0-9_-]{1,32}$/);
			expect(description.length).toBeGreaterThan(0);
			expect(description.length).toBeLessThanOrEqual(100);
		}
	});

	test("snowflake timestamps decode", () => {
		expect(snowflakeTime("175928847299117063")).toBe(1462015105796);
	});
});

test("GET shows a health message", async () => {
	const response = await worker.fetch(new Request("https://bot.example/"), {
		DISCORD_PUBLIC_KEY: publicKey,
	});
	expect(await response.text()).toBe("scrov bot is running");
});
