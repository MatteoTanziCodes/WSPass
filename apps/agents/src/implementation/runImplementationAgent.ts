import { z } from "zod";
import {
  DecompositionPlanSchema,
  DecompositionStateSchema,
  ImplementationIssueStateCollectionSchema,
  PlannerRunInputSchema,
  RepoStateSchema,
  RunExecutionSchema,
  RunStatusSchema,
  RunStepSchema,
} from "@pass/shared";
import { GitHubIssuesClient } from "./githubIssuesClient";

const RunDetailSchema = z
  .object({
    run_id: z.uuid(),
    created_at: z.string().datetime(),
    status: RunStatusSchema,
    current_step: RunStepSchema,
    last_updated_at: z.string().datetime(),
    step_timestamps: z.record(z.string(), z.string().datetime()),
    input: PlannerRunInputSchema.optional(),
    execution: RunExecutionSchema.optional(),
    repo_state: RepoStateSchema.optional(),
    decomposition_state: DecompositionStateSchema.optional(),
    implementation_state: ImplementationIssueStateCollectionSchema.optional(),
  })
  .strict();

const GetRunResponseSchema = z
  .object({
    run: RunDetailSchema,
    artifacts: z.array(z.unknown()),
  })
  .strict();

const GetArtifactResponseSchema = z
  .object({
    artifact: z.object({
      name: z.string().min(1),
      filename: z.string().min(1),
      content_type: z.enum(["application/json", "text/plain", "text/markdown"]),
      created_at: z.string().datetime(),
      sha256: z.string().optional(),
    }),
    payload: z.unknown(),
  })
  .strict();

type PassApiClientOptions = {
  baseUrl: string;
  token: string;
};

class PassApiClient {
  private readonly baseUrl: string;
  private readonly token: string;

  constructor(opts: PassApiClientOptions) {
    this.baseUrl = opts.baseUrl.replace(/\/+$/, "");
    this.token = opts.token;
  }

  async getRun(runId: string) {
    const response = await this.request("GET", `/runs/${runId}`);
    return GetRunResponseSchema.parse(response).run;
  }

  async getArtifact(runId: string, artifactName: string) {
    const response = await this.request("GET", `/runs/${runId}/artifacts/${artifactName}`);
    return GetArtifactResponseSchema.parse(response);
  }

  async updateExecution(
    runId: string,
    patch: {
      status: "running" | "succeeded" | "failed";
      github_run_id?: number;
      github_run_url?: string;
      error_message?: string;
    }
  ) {
    await this.request("PATCH", `/runs/${runId}/execution`, patch, true);
  }

  async updateImplementationState(runId: string, payload: z.infer<typeof ImplementationIssueStateCollectionSchema>) {
    await this.request("PATCH", `/runs/${runId}/implementation-state`, payload, true);
  }

  async updateDecompositionState(runId: string, payload: z.infer<typeof DecompositionStateSchema>) {
    await this.request("PATCH", `/runs/${runId}/decomposition-state`, payload, true);
  }

  async uploadArtifact(
    runId: string,
    artifact: {
      name: string;
      content_type: "application/json" | "text/plain" | "text/markdown";
      payload: unknown;
    }
  ) {
    await this.request("POST", `/runs/${runId}/artifacts`, artifact, true);
  }

  private async request(method: string, path: string, body?: unknown, authenticated = false) {
    const headers: Record<string, string> = {
      Accept: "application/json",
    };

    if (body !== undefined) {
      headers["Content-Type"] = "application/json";
    }
    if (authenticated) {
      headers.Authorization = `Bearer ${this.token}`;
    }

    const response = await fetch(`${this.baseUrl}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });

    const text = await response.text();
    const json = text ? JSON.parse(text) : undefined;

    if (!response.ok) {
      throw new Error(
        `PASS API ${method} ${path} failed with ${response.status}: ${text || response.statusText}`
      );
    }

    return json;
  }
}

function readRequiredEnv(name: string) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is required.`);
  }
  return value;
}

function buildFailureMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function renderIssueSummary(
  implementationState: z.infer<typeof ImplementationIssueStateCollectionSchema>
) {
  return [
    "# Implementation Issue Sync",
    "",
    `Synced At: ${implementationState.synced_at}`,
    "",
    ...implementationState.issues.flatMap((issue) => [
      `- ${issue.plan_item_id}: ${issue.title}`,
      `- Sync Status: ${issue.sync_status}`,
      `- Issue Number: ${issue.issue_number ?? "n/a"}`,
      `- Issue URL: ${issue.issue_url ?? "n/a"}`,
      `- GitHub State: ${issue.github_state ?? "n/a"}`,
      ...(issue.last_error ? [`- Error: ${issue.last_error}`] : []),
    ]),
    "",
  ].join("\n");
}

export async function runImplementationAgent(runId: string): Promise<void> {
  const api = new PassApiClient({
    baseUrl: readRequiredEnv("PASS_API_BASE_URL"),
    token: readRequiredEnv("PASS_API_TOKEN"),
  });

  const githubRunId = process.env.GITHUB_RUN_ID ? Number(process.env.GITHUB_RUN_ID) : undefined;
  const githubRunUrl = process.env.GITHUB_RUN_URL;

  try {
    const run = await api.getRun(runId);
    if (!run.repo_state) {
      throw new Error("Target repository has not been resolved for this run.");
    }

    await api.updateExecution(runId, {
      status: "running",
      github_run_id: Number.isFinite(githubRunId) ? githubRunId : undefined,
      github_run_url: githubRunUrl,
    });

    if (!run.decomposition_state || !["approved", "synced"].includes(run.decomposition_state.status)) {
      throw new Error("Decomposition must be approved before implementation issue sync can run.");
    }

    const artifactName = run.decomposition_state.artifact_name || "decomposition_plan";
    const artifactResponse = await api.getArtifact(runId, artifactName);
    const plan = DecompositionPlanSchema.parse(artifactResponse.payload);
    const issuesClient = new GitHubIssuesClient({
      owner: run.repo_state.owner,
      repo: run.repo_state.name,
    });
    const synced = await issuesClient.syncIssues({
      runId,
      items: plan.work_items.map((item) => ({
        id: item.id,
        title: item.title,
        summary: item.summary,
        body: [
          "Summary:",
          item.summary,
          "",
          `Component: ${item.component}`,
          `Category: ${item.category}`,
          `Size: ${item.size}`,
          "",
          "Acceptance Criteria:",
          ...(item.acceptance_criteria.length > 0
            ? item.acceptance_criteria.map((value) => `- ${value}`)
            : ["- Validate against the approved decomposition work item."]),
        ].join("\n"),
        labels: item.labels,
        acceptance_criteria: item.acceptance_criteria,
      })),
    });

    const normalizedState = ImplementationIssueStateCollectionSchema.parse({
      synced_at: new Date().toISOString(),
      issues: plan.work_items.map((item) => {
        const selected = synced.find((issue) => issue.planItemId === item.id);
        return {
          plan_item_id: item.id,
          title: item.title,
          issue_number: selected?.issueNumber,
          issue_url: selected?.issueUrl,
          github_state: selected?.githubState,
          sync_status: selected?.syncStatus ?? "failed",
          labels: selected?.labels ?? item.labels,
          last_synced_at: new Date().toISOString(),
        };
      }),
    });

    await api.updateImplementationState(runId, normalizedState);
    await api.uploadArtifact(runId, {
      name: "implementation_issue_state",
      content_type: "application/json",
      payload: normalizedState,
    });
    await api.uploadArtifact(runId, {
      name: "implementation_issue_state_summary",
      content_type: "text/markdown",
      payload: renderIssueSummary(normalizedState),
    });
    await api.updateDecompositionState(runId, {
      ...run.decomposition_state,
      status: "synced",
      artifact_name: artifactName,
      work_item_count: plan.work_items.length,
    });

    await api.updateExecution(runId, {
      status: "succeeded",
      github_run_id: Number.isFinite(githubRunId) ? githubRunId : undefined,
      github_run_url: githubRunUrl,
    });
  } catch (error) {
    const message = buildFailureMessage(error);
    try {
      await api.updateExecution(runId, {
        status: "failed",
        github_run_id: Number.isFinite(githubRunId) ? githubRunId : undefined,
        github_run_url: githubRunUrl,
        error_message: message,
      });
    } catch {
      // Preserve the original failure.
    }

    throw error;
  }
}
