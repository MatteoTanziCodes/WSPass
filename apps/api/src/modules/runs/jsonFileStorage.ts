import { promises as fs } from "node:fs";
import { createHash } from "node:crypto";
import { z } from "zod";

/**
 * JSON storage helpers.
 * - Atomic writes prevent corrupted files if the process crashes mid-write.
 * - Schema parsing keeps persisted data trustworthy/deterministic.
 */

// Ensure a directory exists, creates it if doesn't.
export async function ensureDir(dirPath: string): Promise<void> {
  await fs.mkdir(dirPath, { recursive: true });
}

// Reads JSON from disk and validates it against the provided Zod schema.
export async function readJson<T>(filePath: string, schema: z.ZodType<T>): Promise<T> {
  const raw = await fs.readFile(filePath, "utf8");
  return schema.parse(JSON.parse(raw));
}

// Writes a file via temp + rename so updates are atomic (prevents partial writes).
async function atomicWriteFile(filePath: string, contents: string): Promise<void> {
  const tmpPath = `${filePath}.tmp`;
  await fs.writeFile(tmpPath, contents, "utf8");

  try {
    await fs.rename(tmpPath, filePath);
  } catch (err: any) {
    // Windows can fail renaming over an existing file.
    if (err?.code === "EEXIST" || err?.code === "EPERM" || err?.code === "EACCES") {
      await fs.unlink(filePath).catch(() => undefined);
      await fs.rename(tmpPath, filePath);
      return;
    }
    throw err;
  }
}

// Writes JSON to disk atomically to avoid partial/corrupted files on crash.
export async function writeJsonAtomic(filePath: string, value: unknown): Promise<void> {
  const json = JSON.stringify(value, null, 2) + "\n";
  await atomicWriteFile(filePath, json);
}

// Atomically writes plain text to disk (used for non-JSON artifacts like .md/.txt).
export async function writeTextAtomic(filePath: string, text: string): Promise<void> {
  // Writes plain text safely (used for .md/.txt artifacts).
  await atomicWriteFile(filePath, text);
}

// Computes a SHA-256 hex digest for content integrity checks and stable artifact fingerprints.
export function sha256Hex(input: string): string {
  return createHash("sha256").update(input, "utf8").digest("hex");
}

// Deterministically sorts runs by newest created_at first, then run_id as a tie-breaker.
export function sortRunsNewestFirst<T extends { created_at: string; run_id: string }>(runs: T[]): T[] {
  return [...runs].sort((a, b) => {
    if (a.created_at !== b.created_at) return a.created_at < b.created_at ? 1 : -1;
    return a.run_id < b.run_id ? -1 : a.run_id > b.run_id ? 1 : 0;
  });
}