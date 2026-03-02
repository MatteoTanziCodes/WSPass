import { createCipheriv, createDecipheriv, randomBytes, createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { ensureDir } from "../runs/jsonFileStorage";

const ALGORITHM = "aes-256-gcm";
const SECRETS_DIR = path.resolve(process.cwd(), "data/integrations/secrets");

function getDerivedKey(): Buffer {
  const raw = process.env.PASS_SECRET_STORE_KEY;
  if (!raw) {
    throw new Error("PASS_SECRET_STORE_KEY is not set. Generate with: node -e \"console.log(require('crypto').randomBytes(32).toString('base64'))\"");
  }
  const key = Buffer.from(raw, "base64");
  if (key.length !== 32) {
    throw new Error("PASS_SECRET_STORE_KEY must be exactly 32 bytes when base64-decoded.");
  }
  return key;
}

type EncryptedPayload = {
  ciphertext: string; // hex
  iv: string;         // hex
  tag: string;        // hex
};

export function encrypt(plaintext: string): EncryptedPayload {
  const key = getDerivedKey();
  const iv = randomBytes(12);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return {
    ciphertext: encrypted.toString("hex"),
    iv: iv.toString("hex"),
    tag: tag.toString("hex"),
  };
}

export function decrypt(payload: EncryptedPayload): string {
  const key = getDerivedKey();
  const decipher = createDecipheriv(
    ALGORITHM,
    key,
    Buffer.from(payload.iv, "hex")
  );
  decipher.setAuthTag(Buffer.from(payload.tag, "hex"));
  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(payload.ciphertext, "hex")),
    decipher.final(),
  ]);
  return decrypted.toString("utf8");
}

/** Last 4 chars of the token for display only — never the full value */
export function tokenHint(token: string): string {
  return `...${token.slice(-4)}`;
}

/** SHA-256 fingerprint so we can check if a token changed without storing it */
export function tokenFingerprint(token: string): string {
  return createHash("sha256").update(token).digest("hex").slice(0, 16);
}

export async function storeSecret(provider: string, token: string): Promise<void> {
  await ensureDir(SECRETS_DIR);
  const payload = encrypt(token);
  const filePath = path.join(SECRETS_DIR, `${provider}.enc.json`);
  const tmp = `${filePath}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(payload, null, 2), "utf8");
  try {
    await fs.rename(tmp, filePath);
  } catch (err: any) {
    if (err?.code === "EEXIST" || err?.code === "EPERM") {
      await fs.unlink(filePath).catch(() => undefined);
      await fs.rename(tmp, filePath);
      return;
    }
    throw err;
  }
}

export async function retrieveSecret(provider: string): Promise<string | null> {
  const filePath = path.join(SECRETS_DIR, `${provider}.enc.json`);
  try {
    const raw = await fs.readFile(filePath, "utf8");
    const payload = JSON.parse(raw) as EncryptedPayload;
    return decrypt(payload);
  } catch {
    return null;
  }
}

export async function deleteSecret(provider: string): Promise<void> {
  const filePath = path.join(SECRETS_DIR, `${provider}.enc.json`);
  await fs.unlink(filePath).catch(() => undefined);
}