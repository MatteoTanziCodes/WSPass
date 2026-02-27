import path from "node:path";
import { randomUUID } from "node:crypto";

import { RunsIndexSchema, type RunRecord, RunRecordSchema } from "./runs.schemas";
import { ensureDir, readJson, sortRunsNewestFirst, writeJsonAtomic } from "./jsonFileStorage";

/**
 * RunStore (filesystem MVP).
 * Business layer for runs
 *
 * Repo-root folder model:
 * - runs/index.json
 * - runs/<runId>/run.json
 * - runs/<runId>/artifacts/
 */

type CreateRunParams = {
  // Not used in Step 2, but reserved for Step 3 input wiring.
  prdText?: string;
  orgYaml?: string;
};

export class RunStore {
  private readonly runsDir: string;  // runs directory, defaults to WSPASS/runs but can be overridden by env var (RUNS_DIR)
  private readonly indexPath: string;  // path to runs index file (runs/index.json)

  constructor(opts?: { runsDir?: string }) {
    // Default: <repoRoot>/runs if you run the server from repo root (recommended).
    // Override with RUNS_DIR if needed.
    this.runsDir = opts?.runsDir ?? process.env.RUNS_DIR ?? path.resolve(process.cwd(), "runs");
    this.indexPath = path.join(this.runsDir, "index.json");
  }

  // Create a new run with "created" status, persist it, and add to index.
  async createRun(_params: CreateRunParams = {}): Promise<RunRecord> {
    await ensureDir(this.runsDir);

    const now = new Date().toISOString();
    const run: RunRecord = {
      run_id: randomUUID(),
      created_at: now,
      status: "created",
      current_step: "created",
      last_updated_at: now,
    };

    const runDir = path.join(this.runsDir, run.run_id);
    await ensureDir(path.join(runDir, "artifacts"));

    // Persist run.json first (so index never points to a non-existent run).
    await writeJsonAtomic(path.join(runDir, "run.json"), RunRecordSchema.parse(run));

    const index = await this.readOrInitIndex();
    const nextRuns = sortRunsNewestFirst([
      ...index.runs.filter((r) => r.run_id !== run.run_id),
      run,
    ]);

    await writeJsonAtomic(this.indexPath, RunsIndexSchema.parse({ version: 1, runs: nextRuns }));
    return run;
  }

  // List all runs sorted by created_at (newest first).
  async listRuns(): Promise<RunRecord[]> {
    const index = await this.readOrInitIndex();
    return sortRunsNewestFirst(index.runs);
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
}