// Encrypts EA sessions before they're stored. AES-256-GCM.
// Key: EA_TOKEN_KEY env var, 32 random bytes in base64
// (generate with: node -e "console.log(require('crypto').randomBytes(32).toString('base64'))").
// Format: base64(iv[12] | tag[16] | ciphertext). The sync worker uses the same code.

import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

function key(): Buffer {
  const k = process.env.EA_TOKEN_KEY;
  if (!k) throw new Error("EA_TOKEN_KEY is not set.");
  const buf = Buffer.from(k, "base64");
  if (buf.length !== 32) throw new Error("EA_TOKEN_KEY must be 32 bytes, base64-encoded.");
  return buf;
}

export function encryptJson(value: unknown): string {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", key(), iv);
  const ct = Buffer.concat([c.update(JSON.stringify(value), "utf8"), c.final()]);
  return Buffer.concat([iv, c.getAuthTag(), ct]).toString("base64");
}

export function decryptJson<T>(blob: string): T {
  const raw = Buffer.from(blob, "base64");
  const d = createDecipheriv("aes-256-gcm", key(), raw.subarray(0, 12));
  d.setAuthTag(raw.subarray(12, 28));
  const pt = Buffer.concat([d.update(raw.subarray(28)), d.final()]);
  return JSON.parse(pt.toString("utf8")) as T;
}
