import { z } from "zod";
import {
  ArchitecturePackSchema,
  ArchitectureChatStateSchema,
  BuildOrchestrationStateSchema,
  DecompositionPlanSchema,
  DecompositionReviewStateSchema,
  DecompositionStateSchema,
  ImplementationIssueStateCollectionSchema,
  PlannerRunInputSchema,
  RepoStateSchema,
  RunExecutionSchema,
  RunStatusSchema,
  RunStepSchema,
  type BuildOrchestrationState,
  type IssueExecutionState,
} from "@pass/shared";

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
    architecture_chat: ArchitectureChatStateSchema.optional(),
    decomposition_state: DecompositionStateSchema.optional(),
    decomposition_review_state: DecompositionReviewStateSchema.optional(),
    implementation_state: ImplementationIssueStateCollectionSchema.optional(),
    build_state: BuildOrchestrationStateSchema.optional(),
  })
  .strict();

const GetRunResponseSchema = z
  .object({
    run: RunDetailSchema,
    artifacts: z.array(
      z.object({
        name: z.string(),
        filename: z.string(),
        content_type: z.string(),
        created_at: z.string().datetime(),
      })
    ),
  })
  .strict();

const ArtifactResponseSchema = z
  .object({
    artifact: z.object({
      name: z.string(),
      filename: z.string(),
      content_type: z.string(),
      created_at: z.string().datetime(),
    }),
    payload: z.unknown(),
  })
  .strict();

function readRequiredEnv(name: string) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is required.`);
  }
  return value;
}

function normalizeLoopbackUrl(value: string) {
  try {
    const url = new URL(value);
    if (url.hostname === "localhost") {
      url.hostname = "127.0.0.1";
    }
    return url.toString().replace(/\/+$/, "");
  } catch {
    return value.replace(/\/+$/, "");
  }
}

export class BuildApiClient {
  private readonly baseUrl = normalizeLoopbackUrl(readRequiredEnv("PASS_API_BASE_URL"));
  private readonly token = readRequiredEnv("PASS_API_TOKEN");

  async getRun(runId: string) {
    const json = await this.request("GET", `/runs/${runId}`);
    return GetRunResponseSchema.parse(json);
  }

  async getArchitecturePack(runId: string) {
    const json = await this.request("GET", `/runs/${runId}/artifacts/architecture_pack`);
    return ArchitecturePackSchema.parse(ArtifactResponseSchema.parse(json).payload);
  }

  async getDecompositionPlan(runId: string) {
    const json = await this.request("GET", `/runs/${runId}/artifacts/decomposition_plan`);
    return DecompositionPlanSchema.parse(ArtifactResponseSchema.parse(json).payload);
  }

  async writeArtifact(
    runId: string,
    artifact: {
      name: string;
      content_type: "application/json" | "text/plain" | "text/markdown";
      payload: unknown;
    }
  ) {
    return this.request("POST", `/runs/${runId}/artifacts`, artifact);
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
    return this.request("PATCH", `/runs/${runId}/execution`, patch);
  }

  async updateRun(
    runId: string,
    patch: {
      status?: z.infer<typeof RunStatusSchema>;
      current_step?: z.infer<typeof RunStepSchema>;
    }
  ) {
    return this.request("PATCH", `/runs/${runId}`, patch, false);
  }

  async updateBuildState(runId: string, state: BuildOrchestrationState) {
    return this.request("PATCH", `/runs/${runId}/build-state`, state);
  }

  async updateIssueExecutionState(runId: string, issueId: string, state: IssueExecutionState) {
    return this.request("PATCH", `/runs/${runId}/issues/${issueId}/state`, state);
  }

  async dispatchWorkflow(
    runId: string,
    workflowName:
      | "phase3-build-orchestrator"
      | "phase3-issue-execution"
      | "phase3-pr-supervisor",
    issueId?: string
  ) {
    return this.request(
      "POST",
      `/runs/${runId}/dispatch/${workflowName}`,
      issueId ? { issue_id: issueId } : undefined
    );
  }

  async answerIssueRequirements(
    runId: string,
    issueId: string,
    requirements: Array<{ id: string; status: "open" | "provided" | "resolved"; resolved_at?: string }>
  ) {
    return this.request("PATCH", `/runs/${runId}/issues/${issueId}/requirements`, { requirements });
  }

  async answerIssueContextQuestions(
    runId: string,
    issueId: string,
    questions: Array<{ id: string; status: "open" | "answered" | "resolved"; answer?: string; answered_at?: string }>
  ) {
    return this.request("PATCH", `/runs/${runId}/issues/${issueId}/context-questions`, { questions });
  }

  private async request(method: string, path: string, body?: unknown, auth = true) {
    const response = await fetch(`${this.baseUrl}${path}`, {
      method,
      headers: {
        Accept: "application/json",
        ...(auth ? { Authorization: `Bearer ${this.token}` } : {}),
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      },
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
