import { z } from "zod";
import {
  ArchitecturePackSchema,
  DecompositionPlanSchema,
  DecompositionStateSchema,
  PlannerRunInputSchema,
  RepoStateSchema,
  RunExecutionSchema,
  RunStatusSchema,
  RunStepSchema,
} from "@pass/shared";
import { generateDecompositionPlan } from "../providers/llmClient";

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

class PassApiClient {
  private readonly baseUrl: string;
  private readonly token: string;

  constructor(opts: { baseUrl: string; token: string }) {
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

  async updateRun(
    runId: string,
    patch: { status?: z.infer<typeof RunStatusSchema>; current_step?: z.infer<typeof RunStepSchema> }
  ) {
    await this.request("PATCH", `/runs/${runId}`, patch);
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
    const headers: Record<string, string> = { Accept: "application/json" };
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
      throw new Error(`PASS API ${method} ${path} failed with ${response.status}: ${text || response.statusText}`);
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

function renderSummary(plan: z.infer<typeof DecompositionPlanSchema>) {
  return [
    "# Decomposition Plan",
    "",
    plan.summary,
    "",
    `Work items: ${plan.work_items.length}`,
    "",
    ...plan.work_items.flatMap((item) => [
      `- ${item.id}: ${item.title} [${item.category}/${item.size}]`,
      `- Component: ${item.component}`,
      `- Summary: ${item.summary}`,
    ]),
    "",
  ].join("\n");
}

export async function runDecompositionAgent(runId: string): Promise<void> {
  const api = new PassApiClient({
    baseUrl: readRequiredEnv("PASS_API_BASE_URL"),
    token: readRequiredEnv("PASS_API_TOKEN"),
  });

  const githubRunId = process.env.GITHUB_RUN_ID ? Number(process.env.GITHUB_RUN_ID) : undefined;
  const githubRunUrl = process.env.GITHUB_RUN_URL;

  try {
    await api.updateExecution(runId, {
      status: "running",
      github_run_id: Number.isFinite(githubRunId) ? githubRunId : undefined,
      github_run_url: githubRunUrl,
    });

    const artifact = await api.getArtifact(runId, "architecture_pack");
    const pack = ArchitecturePackSchema.parse(artifact.payload);
    const plan = await generateDecompositionPlan({ pack });

    await api.uploadArtifact(runId, {
      name: "decomposition_plan",
      content_type: "application/json",
      payload: plan,
    });
    await api.uploadArtifact(runId, {
      name: "decomposition_plan_summary",
      content_type: "text/markdown",
      payload: renderSummary(plan),
    });
    await api.updateDecompositionState(runId, {
      status: "draft",
      artifact_name: "decomposition_plan",
      generated_at: plan.generated_at,
      work_item_count: plan.work_items.length,
    });
    await api.updateRun(runId, {
      status: "decomposition_generated",
      current_step: "decompose",
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
