import path from "node:path";
import { promises as fs } from "node:fs";
import { ZipFile } from "yazl";
import {
  deriveProjectKeyFromRun,
  deriveProjectLabelFromRun,
  type ProjectObservabilityBudget,
  type ProjectObservabilitySummary,
  type ProjectObservabilityRunSummary,
  type RunLlmObservability,
  RunLlmObservabilitySchema,
} from "@pass/shared";
import { RunConflictError, RunNotFoundError, type RunStore } from "../runs/runStore";
import { ensureDir, readJson, writeJsonAtomic } from "../runs/jsonFileStorage";
import {
  ProjectObservabilityBudgetSchema,
  ProjectObservabilityConfigIndexSchema,
} from "./projectObservability.schemas";

function createEmptyUsage() {
  return {
    input_tokens: 0,
    output_tokens: 0,
    cache_creation_input_tokens: 0,
    cache_read_input_tokens: 0,
    total_tokens: 0,
    estimated_cost_usd: null as number | null,
  };
}

function sumUsage(
  left: ReturnType<typeof createEmptyUsage>,
  right: ReturnType<typeof createEmptyUsage>
) {
  return {
    input_tokens: left.input_tokens + right.input_tokens,
    output_tokens: left.output_tokens + right.output_tokens,
    cache_creation_input_tokens:
      (left.cache_creation_input_tokens ?? 0) + (right.cache_creation_input_tokens ?? 0),
    cache_read_input_tokens:
      (left.cache_read_input_tokens ?? 0) + (right.cache_read_input_tokens ?? 0),
    total_tokens: left.total_tokens + right.total_tokens,
    estimated_cost_usd:
      left.estimated_cost_usd === null || right.estimated_cost_usd === null
        ? left.estimated_cost_usd === null && right.estimated_cost_usd === null
          ? null
          : (left.estimated_cost_usd ?? 0) + (right.estimated_cost_usd ?? 0)
        : left.estimated_cost_usd + right.estimated_cost_usd,
  };
}

function toUsageOnly(
  usage: {
    input_tokens: number;
    output_tokens: number;
    total_tokens: number;
    estimated_cost_usd: number | null;
    cache_creation_input_tokens?: number;
    cache_read_input_tokens?: number;
    request_count?: number;
  }
) {
  return {
    input_tokens: usage.input_tokens,
    output_tokens: usage.output_tokens,
    cache_creation_input_tokens: usage.cache_creation_input_tokens ?? 0,
    cache_read_input_tokens: usage.cache_read_input_tokens ?? 0,
    total_tokens: usage.total_tokens,
    estimated_cost_usd: usage.estimated_cost_usd ?? null,
  };
}

function toMarkdown(summary: ProjectObservabilitySummary) {
  return [
    `# Project Observability: ${summary.project_label}`,
    "",
    `Generated at: ${summary.generated_at}`,
    `Rolling window started: ${summary.rolling_window_started_at}`,
    `Budget state: ${summary.budget_state}`,
    "",
    "## Totals",
    `- Runs: ${summary.totals.run_count}`,
    `- Requests: ${summary.totals.request_count}`,
    `- Input tokens: ${summary.totals.input_tokens}`,
    `- Output tokens: ${summary.totals.output_tokens}`,
    `- Estimated cost USD: ${
      summary.totals.estimated_cost_usd === null
        ? "n/a"
        : summary.totals.estimated_cost_usd.toFixed(4)
    }`,
    "",
    "## Budget",
    summary.budget
      ? `- Warning: ${summary.budget.warning_usd ?? "n/a"} USD\n- Critical: ${summary.budget.critical_usd ?? "n/a"} USD`
      : "- No budget configured.",
    "",
    "## Runs",
    ...(summary.runs.length > 0
      ? summary.runs.flatMap((run) => [
          `- ${run.run_id}`,
          `  - workflow: ${run.latest_workflow_name ?? "n/a"}`,
          `  - status: ${run.latest_status}`,
          `  - requests: ${run.totals.request_count}`,
          `  - input tokens: ${run.totals.input_tokens}`,
          `  - output tokens: ${run.totals.output_tokens}`,
          `  - estimated cost usd: ${
            run.totals.estimated_cost_usd === null
              ? "n/a"
              : run.totals.estimated_cost_usd.toFixed(4)
          }`,
        ])
      : ["- No run-level observability data in the rolling window."]),
    "",
  ].join("\n");
}

function toRunSummary(
  run: Awaited<ReturnType<RunStore["getRun"]>>,
  observability: RunLlmObservability | null,
  availableLogFiles: string[]
): ProjectObservabilityRunSummary {
  const totals = observability?.totals ?? createEmptyUsage();
  return {
    run_id: run.run_id,
    latest_workflow_name: run.execution?.workflow_name,
    latest_status: run.execution?.status ?? run.status,
    last_updated_at: observability?.updated_at ?? run.last_updated_at,
    totals: {
      ...totals,
      request_count: observability?.sessions.reduce(
        (sum, session) => sum + session.request_count,
        0
      ) ?? 0,
    },
    sessions: observability?.sessions ?? [],
    available_log_files: availableLogFiles,
  };
}

function buildBudgetState(
  cost: number | null,
  budget: ProjectObservabilityBudget | null
): ProjectObservabilitySummary["budget_state"] {
  if (!budget || cost === null) {
    return "none";
  }
  if (budget.critical_usd !== null && cost >= budget.critical_usd) {
    return "red";
  }
  if (budget.warning_usd !== null && cost >= budget.warning_usd) {
    return "yellow";
  }
  return "green";
}

async function zipToBuffer(zipFile: ZipFile) {
  return new Promise<Buffer>((resolve, reject) => {
    const chunks: Buffer[] = [];
    zipFile.outputStream.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
    zipFile.outputStream.on("error", reject);
    zipFile.outputStream.on("end", () => resolve(Buffer.concat(chunks)));
    zipFile.end();
  });
}

export class ProjectObservabilityStore {
  private readonly runStore: RunStore;
  private readonly configDir: string;
  private readonly configPath: string;

  constructor(options: { runStore: RunStore }) {
    this.runStore = options.runStore;
    this.configDir = path.resolve(__dirname, "../../../data/project-observability");
    this.configPath = path.join(this.configDir, "index.json");
  }

  private async readConfigIndex() {
    try {
      return await readJson(this.configPath, ProjectObservabilityConfigIndexSchema);
    } catch {
      await ensureDir(this.configDir);
      const fresh = ProjectObservabilityConfigIndexSchema.parse({});
      await writeJsonAtomic(this.configPath, fresh);
      return fresh;
    }
  }

  async getBudget(projectKey: string) {
    const config = await this.readConfigIndex();
    return config[projectKey] ?? null;
  }

  async updateBudget(
    projectKey: string,
    patch: { warning_usd: number | null; critical_usd: number | null }
  ) {
    const config = await this.readConfigIndex();
    const budget = ProjectObservabilityBudgetSchema.parse({
      window_days: 30,
      warning_usd: patch.warning_usd,
      critical_usd: patch.critical_usd,
      updated_at: new Date().toISOString(),
    });
    const next = {
      ...config,
      [projectKey]: budget,
    };
    await writeJsonAtomic(this.configPath, ProjectObservabilityConfigIndexSchema.parse(next));
    return budget;
  }

  private async readRunObservability(runId: string) {
    try {
      const artifact = await this.runStore.readArtifact(runId, "llm_observability");
      return RunLlmObservabilitySchema.parse(artifact.payload);
    } catch (error) {
      if (error instanceof RunConflictError || error instanceof RunNotFoundError) {
        return null;
      }
      throw error;
    }
  }

  async getProjectSummary(projectKey: string): Promise<ProjectObservabilitySummary> {
    const runs = await this.runStore.listRunSummaries();
    const projectRuns = runs.filter((run) => deriveProjectKeyFromRun(run) === projectKey);
    const latestRun = projectRuns[0];
    if (!latestRun) {
      throw new RunNotFoundError(projectKey);
    }

    const rollingWindowStart = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const budget = await this.getBudget(projectKey);

    const runSummaries = await Promise.all(
      projectRuns.map(async (runRecord) => {
        const [run, observability, logs] = await Promise.all([
          this.runStore.getRun(runRecord.run_id),
          this.readRunObservability(runRecord.run_id),
          this.runStore.listLogs(runRecord.run_id),
        ]);

        const inWindow =
          observability?.updated_at
            ? new Date(observability.updated_at).getTime() >= rollingWindowStart.getTime()
            : new Date(run.last_updated_at).getTime() >= rollingWindowStart.getTime();

        if (!inWindow) {
          return null;
        }

        return toRunSummary(
          run,
          observability,
          logs.map((log) => log.name)
        );
      })
    );

    const filteredRuns = runSummaries
      .filter((run): run is ProjectObservabilityRunSummary => Boolean(run))
      .sort(
        (left, right) =>
          new Date(right.last_updated_at).getTime() - new Date(left.last_updated_at).getTime()
      );

    const totals = filteredRuns.reduce(
      (sum, run) => sumUsage(sum, toUsageOnly(run.totals)),
      createEmptyUsage()
    );

    return {
      project_key: projectKey,
      project_label: deriveProjectLabelFromRun(latestRun),
      rolling_window_started_at: rollingWindowStart.toISOString(),
      generated_at: new Date().toISOString(),
      totals: {
        ...totals,
        request_count: filteredRuns.reduce((sum, run) => sum + run.totals.request_count, 0),
        run_count: filteredRuns.length,
      },
      budget,
      budget_state: buildBudgetState(totals.estimated_cost_usd, budget),
      runs: filteredRuns,
    };
  }

  async exportProject(projectKey: string) {
    const summary = await this.getProjectSummary(projectKey);
    const zip = new ZipFile();

    zip.addBuffer(
      Buffer.from(JSON.stringify(summary, null, 2) + "\n"),
      "project-observability/summary.json"
    );
    zip.addBuffer(
      Buffer.from(toMarkdown(summary)),
      "project-observability/summary.md"
    );

    for (const run of summary.runs) {
      const observability = await this.readRunObservability(run.run_id);
      if (observability) {
        zip.addBuffer(
          Buffer.from(JSON.stringify(observability, null, 2) + "\n"),
          `project-observability/runs/${run.run_id}/llm_observability.json`
        );
      }

      for (const logName of run.available_log_files) {
        try {
          const log = await this.runStore.readLog(run.run_id, logName);
          zip.addBuffer(
            Buffer.from(log.payload),
            `project-observability/runs/${run.run_id}/logs/${log.name}`
          );
        } catch {
          // Ignore missing logs during export.
        }
      }
    }

    const buffer = await zipToBuffer(zip);
    return {
      filename: `${projectKey.replace(/[^a-z0-9._-]+/gi, "_")}_observability.zip`,
      buffer,
      summary,
    };
  }
}
