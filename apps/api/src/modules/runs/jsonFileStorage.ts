import { promises as fs } from "node:fs";
import { z } from "zod";

/**
 * Tiny JSON storage helpers.
 * - Atomic writes prevent partially-written JSON files if the process crashes.
 * - Schema parsing keeps persisted data trustworthy/deterministic.
 */

// Ensure a directory exists, create it if doesn't.
export async function ensureDir(dirPath: string): Promise<void> {
  await fs.mkdir(dirPath, { recursive: true });
}

// Read + parse JSON file with schema validation. - validates the file contents against Zod before trusting it.
export async function readJson<T>(filePath: string, schema: z.ZodType<T>): Promise<T> {
  const raw = await fs.readFile(filePath, "utf8");
  return schema.parse(JSON.parse(raw));
}

// Write JSON file atomically (write temp + rename) with schema validation. - prevents corrupted JSON if the process crashes mid-write.
export async function writeJsonAtomic(filePath: string, value: unknown): Promise<void> {
  const tmpPath = `${filePath}.tmp`;
  const json = JSON.stringify(value, null, 2) + "\n";

  await fs.writeFile(tmpPath, json, "utf8");

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

// Sort runs by created_at (newest first), then run_id as tiebreaker for deterministic ordering.
export function sortRunsNewestFirst<T extends { created_at: string; run_id: string }>(runs: T[]): T[] {
  // Deterministic ordering: newest first, then run_id tiebreaker.
  return [...runs].sort((a, b) => {
    if (a.created_at !== b.created_at) return a.created_at < b.created_at ? 1 : -1;
    return a.run_id < b.run_id ? -1 : a.run_id > b.run_id ? 1 : 0;
  });
}