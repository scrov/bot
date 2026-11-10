const hexToBytes = (hex: string): Uint8Array | null => {
	if (hex.length % 2 !== 0 || !/^[0-9a-f]*$/i.test(hex)) return null;
	const bytes = new Uint8Array(hex.length / 2);
	for (let i = 0; i < bytes.length; i++) {
		bytes[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
	}
	return bytes;
};

/**
 * Check the Ed25519 signature Discord puts on every interaction request.
 * Discord signs `timestamp + body` with the application's key pair.
 */
export async function verifyDiscordRequest(
	body: string,
	signature: string | null,
	timestamp: string | null,
	publicKey: string,
): Promise<boolean> {
	if (!signature || !timestamp) return false;
	const signatureBytes = hexToBytes(signature);
	const keyBytes = hexToBytes(publicKey);
	if (signatureBytes?.length !== 64 || keyBytes?.length !== 32) return false;

	try {
		const key = await crypto.subtle.importKey(
			"raw",
			keyBytes,
			{ name: "Ed25519" },
			false,
			["verify"],
		);
		return await crypto.subtle.verify(
			{ name: "Ed25519" },
			key,
			signatureBytes,
			new TextEncoder().encode(timestamp + body),
		);
	} catch {
		return false;
	}
}
