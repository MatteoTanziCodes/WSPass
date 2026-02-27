import path from "node:path";
import { randomUUID } from "node:crypto";

import { ArtifactsIndexSchema, ArtifactMetadataSchema, RunDetailSchema, RunsIndexSchema } from "./runs.schemas";
import type { ArtifactMetadata, RunDetail, RunRecord } from "./runs.schemas";
import { ensureDir, readJson, sha256Hex, sortRunsNewestFirst, writeJsonAtomic, writeTextAtomic } from "./jsonFileStorage";


/**
 * RunStore (filesystem MVP) - Business layer for runs.
 * Owns run persistence and deterministic indexing on disk (no DB).
 *
 * Repo-root folder model:
 * - runs/index.json (run history)
 * - runs/<runId>/run.json (per-run metadata + timestamps)
 * - runs/<runId>/artifacts/ (generated outputs + artifacts/index.json)
 */

// Error thrown when a requested run_id doesn't exist on disk (maps to 404 at the API layer).
export class RunNotFoundError extends Error {
  constructor(runId: string) {
    super(`Run not found: ${runId}`);
    this.name = "RunNotFoundError";
  }
}

// Partial update payload for a run: only fields allowed to change via PATCH.
type UpdateRunPatch = {
  status?: RunRecord["status"];
  current_step?: RunRecord["current_step"];
};

// Convert artifact names into safe, deterministic filenames.
function toSafeFilename(name: string): string {
  return name.trim().toLowerCase().replace(/[^a-z0-9._-]+/g, "_");
}


export class RunStore {
  private readonly runsDir: string;  // runs directory, defaults to WSPASS/runs but can be overridden by env var (RUNS_DIR)
  private readonly indexPath: string;  // path to runs index file (runs/index.json)

  constructor(opts?: { runsDir?: string }) {
    // Repo-root anchored output so the runs location doesn't depend on where the server is started.
    const defaultRunsDir = path.resolve(__dirname, "../../../../../runs");  
    this.runsDir = opts?.runsDir ?? process.env.RUNS_DIR ?? defaultRunsDir;
    this.indexPath = path.join(this.runsDir, "index.json");
  }

  // Creates a new run + updates the run index. and returns the created run record.
  async createRun(): Promise<RunDetail> {
    await ensureDir(this.runsDir);  // Ensure runs directory exists before writing.

    // Create a new run record 
    const now = new Date().toISOString();
    const run: RunDetail = RunDetailSchema.parse({
      run_id: randomUUID(),
      created_at: now,
      status: "created",
      current_step: "created",
      last_updated_at: now,
      step_timestamps: { created: now },
    });

    const runDir = this.getRunDir(run.run_id);
    await ensureDir(path.join(runDir, "artifacts"));  // Ensure the per-run artifacts folder exists

    // Persist run.json first (so index never points to a non-existent run).
    await writeJsonAtomic(this.getRunPath(run.run_id), run);

    // Load or initialize runs/index.json, then upsert this run into the run history list.
    const index = await this.readOrInitIndex();
    const nextRuns = sortRunsNewestFirst([
      ...index.runs.filter((r) => r.run_id !== run.run_id),
      this.toRunRecord(run),
    ]);

    // Write the updated index back to disk atomically to keep run history consistent.
    await writeJsonAtomic(this.indexPath, RunsIndexSchema.parse({ version: 1, runs: nextRuns }));
    return run;
  }

  // Returns run history from runs/index.json (newest-first).
  async listRuns(): Promise<RunRecord[]> {
    const index = await this.readOrInitIndex();
    return sortRunsNewestFirst(index.runs);
  }

  // Loads and validates a run's run.json by runId (throws RunNotFoundError if missing/invalid).
  async getRun(runId: string): Promise<RunDetail> {
    try {
      return await readJson(this.getRunPath(runId), RunDetailSchema);
    } catch {
      throw new RunNotFoundError(runId);
    }
  }

  // Applies a validated status/step patch to a run, updates timestamps, persists run.json, and syncs runs/index.json.
  async updateRun(runId: string, patch: UpdateRunPatch): Promise<RunDetail> {
    
    // Load the current run state from disk (404 if it doesn't exist).
    const existing = await this.getRun(runId);
    const now = new Date().toISOString();

    // Merge the patch and refresh last_updated_at while preserving prior step timestamps.
    const next: RunDetail = {
      ...existing,
      ...patch,
      last_updated_at: now,
      step_timestamps: { ...(existing.step_timestamps ?? {}) },
    };

    // Only set the timestamp the first time we reach a step.
    if (patch.current_step) {
      next.step_timestamps[patch.current_step] ??= now;
    }
    // Validate then persist the updated run.json atomically.
    const validated = RunDetailSchema.parse(next);
    await writeJsonAtomic(this.getRunPath(runId), validated);

    // Sync runs/index.json to reflect the updated run summary (deterministic ordering).
    const index = await this.readOrInitIndex();
    const nextRuns = sortRunsNewestFirst([
      ...index.runs.filter((r) => r.run_id !== runId),
      this.toRunRecord(validated),
    ]);
    await writeJsonAtomic(this.indexPath, RunsIndexSchema.parse({ version: 1, runs: nextRuns }));

    return validated;
  }

  // Writes an artifact file under runs/<runId>/artifacts and updates artifacts/index.json with its metadata.
  async writeArtifact(
    runId: string,
    name: string,
    payload: unknown,
    contentType: "application/json" | "text/plain" | "text/markdown" = "application/json"
  ): Promise<ArtifactMetadata> {
    await this.getRun(runId); // Ensures run exists before writing artifacts.

    const artifactsDir = this.getArtifactsDir(runId);
    await ensureDir(artifactsDir);  // Ensure the artifacts directory exists

    // Normalize the artifact name
    const safe = toSafeFilename(name) || "artifact";  // Fallback if name sanitizes to empty.
    const createdAt = new Date().toISOString();

    let filename: string;
    let sha: string | undefined;

    // Serialize payload to text, compute sha256, and write the artifact file atomically.
    if (contentType === "application/json") {
      filename = `${safe}.json`;
      const text = JSON.stringify(payload, null, 2) + "\n";
      sha = sha256Hex(text);
      await writeTextAtomic(path.join(artifactsDir, filename), text);
    } 
    else {
      filename = contentType === "text/markdown" ? `${safe}.md` : `${safe}.txt`;
      const text = typeof payload === "string" ? payload : String(payload);
      sha = sha256Hex(text);
      await writeTextAtomic(path.join(artifactsDir, filename), text);
    }

    // Upsert the artifact in the manifest and keep the list deterministically ordered.
    const meta: ArtifactMetadata = ArtifactMetadataSchema.parse({
      name,
      filename,
      content_type: contentType,
      sha256: sha,
      created_at: createdAt,
    });

    const index = await this.readOrInitArtifactsIndex(runId);
    const nextArtifacts = [
      ...index.artifacts.filter((a) => a.name !== name),
      meta,
    ].sort((a, b) => (a.created_at !== b.created_at ? (a.created_at < b.created_at ? 1 : -1) : (a.name < b.name ? -1 : a.name > b.name ? 1 : 0)));

    // Persist the updated artifacts manifest atomically so the partial JSON is never seen.
    await writeJsonAtomic(this.getArtifactsIndexPath(runId), ArtifactsIndexSchema.parse({ version: 1, artifacts: nextArtifacts }));
    return meta;
  }

  // Returns the artifact manifest (artifacts/index.json) for a run without scanning the directory.
  async listArtifacts(runId: string): Promise<ArtifactMetadata[]> {
    await this.getRun(runId); // 404 if run doesn't exist.

    // Load the artifact manifest for the run.
    const index = await this.readOrInitArtifactsIndex(runId);
    return index.artifacts;
  }

  // Converts a full run record into a lightweight one to be stored in runs/index.json.
  private toRunRecord(run: RunDetail): RunRecord {

    // Strip run detail fields so runs/index.json stays small and stable.
    const { run_id, created_at, status, current_step, last_updated_at } = run;
    return { run_id, created_at, status, current_step, last_updated_at };
  }

  // Load and validate runs/index.json; if missing/invalid, initialize an empty index on disk and return it.
  private async readOrInitIndex() {
    try {
      return await readJson(this.indexPath, RunsIndexSchema);
    } catch {
      await ensureDir(this.runsDir);
      const fresh = RunsIndexSchema.parse({ version: 1, runs: [] });
      await writeJsonAtomic(this.indexPath, fresh);
      return fresh;
    }
  }

  // Loads and validates artifacts/index.json for a run; if missing/invalid, initializes an empty manifest and returns it.
  private async readOrInitArtifactsIndex(runId: string) {
    const idxPath = this.getArtifactsIndexPath(runId);
    try {
      return await readJson(idxPath, ArtifactsIndexSchema);
    } catch {
      await ensureDir(this.getArtifactsDir(runId));
      const fresh = ArtifactsIndexSchema.parse({ version: 1, artifacts: [] });
      await writeJsonAtomic(idxPath, fresh);
      return fresh;
    }
  }


  // Helpers to construct file paths for runs and artifacts.
  private getRunDir(runId: string) {
    return path.join(this.runsDir, runId);
  }
  private getRunPath(runId: string) {
    return path.join(this.getRunDir(runId), "run.json");
  }
  private getArtifactsDir(runId: string) {
    return path.join(this.getRunDir(runId), "artifacts");
  }
  private getArtifactsIndexPath(runId: string) {
    return path.join(this.getArtifactsDir(runId), "index.json");
  }

}