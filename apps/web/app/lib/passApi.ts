import "server-only";
import {
  ArchitectureChatStateSchema,
  ArchitecturePackSchema,
  DecompositionPlanSchema,
  DecompositionStateSchema,
  PlannerRunInputSchema,
  RunExecutionSchema,
} from "@pass/shared";
import { z } from "zod";
import { readServerEnv } from "./env";

const RunListSchema = z.object({
  total: z.number().int().nonnegative(),
  runs: z.array(
    z.object({
      run_id: z.uuid(),
      created_at: z.string().datetime(),
      status: z.string(),
      current_step: z.string(),
      last_updated_at: z.string().datetime(),
    })
  ),
});

const RunResourceSchema = z.object({
  run_id: z.uuid(),
  created_at: z.string().datetime(),
  status: z.string(),
  current_step: z.string(),
  last_updated_at: z.string().datetime(),
  step_timestamps: z.record(z.string(), z.string().datetime()),
  input: PlannerRunInputSchema.optional(),
  execution: RunExecutionSchema.optional(),
  repo_state: z
    .object({
      repository: z.string(),
      html_url: z.string().url(),
      visibility: z.enum(["private", "public"]).optional(),
    })
    .optional(),
  architecture_chat: ArchitectureChatStateSchema.optional(),
  decomposition_state: DecompositionStateSchema.optional(),
  implementation_state: z
    .object({
      synced_at: z.string().datetime(),
      issues: z.array(
        z.object({
          plan_item_id: z.string(),
          title: z.string(),
          issue_number: z.number().int().positive().optional(),
          issue_url: z.string().url().optional(),
          sync_status: z.string(),
        })
      ),
    })
    .optional(),
});

const RunDetailSchema = z.object({
  run: RunResourceSchema,
  artifacts: z.array(
    z.object({
      name: z.string(),
      filename: z.string(),
      content_type: z.string(),
      created_at: z.string().datetime(),
    })
  ),
});

const ArtifactResponseSchema = z.object({
  artifact: z.object({
    name: z.string(),
    filename: z.string(),
    content_type: z.enum(["application/json", "text/plain", "text/markdown"]),
    created_at: z.string().datetime(),
  }),
  payload: z.unknown(),
});

function getBaseUrl() {
  return readServerEnv("PASS_API_BASE_URL").replace(/\/+$/, "");
}

function getAuthHeaders() {
  return {
    Accept: "application/json",
    Authorization: `Bearer ${readServerEnv("PASS_API_TOKEN")}`,
  };
}

function getJsonAuthHeaders() {
  return {
    ...getAuthHeaders(),
    "Content-Type": "application/json",
  };
}

export async function listRuns() {
  const response = await fetch(`${getBaseUrl()}/runs`, {
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error(`Failed to list runs: ${response.status}`);
  }

  return RunListSchema.parse(await response.json()).runs;
}

export async function getRun(runId: string): Promise<z.infer<typeof RunDetailSchema> | null> {
  const response = await fetch(`${getBaseUrl()}/runs/${runId}`, {
    cache: "no-store",
  });

  if (!response.ok) {
    return null;
  }

  return RunDetailSchema.parse(await response.json());
}

export async function getArchitecturePack(runId: string) {
  const response = await fetch(`${getBaseUrl()}/runs/${runId}/artifacts/architecture_pack`, {
    cache: "no-store",
  });
  if (!response.ok) {
    return null;
  }

  const artifact = ArtifactResponseSchema.parse(await response.json());
  return ArchitecturePackSchema.parse(artifact.payload);
}

export async function getDecompositionPlan(runId: string) {
  const response = await fetch(`${getBaseUrl()}/runs/${runId}/artifacts/decomposition_plan`, {
    cache: "no-store",
  });
  if (!response.ok) {
    return null;
  }

  const artifact = ArtifactResponseSchema.parse(await response.json());
  return DecompositionPlanSchema.parse(artifact.payload);
}

export async function createRun(
  input: z.infer<typeof PlannerRunInputSchema>
): Promise<z.infer<typeof RunResourceSchema>> {
  const response = await fetch(`${getBaseUrl()}/runs`, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(input),
  });

  if (!response.ok) {
    throw new Error(`Failed to create run: ${response.status}`);
  }

  const payload = z.object({ run: RunResourceSchema }).parse(await response.json());
  return payload.run;
}

export async function dispatchWorkflow(
  runId: string,
  workflowName:
    | "phase1-planner"
    | "phase1-architecture-refinement"
    | "phase2-repo-provision"
    | "phase2-decomposition"
    | "phase2-implementation"
) {
  const response = await fetch(`${getBaseUrl()}/runs/${runId}/dispatch/${workflowName}`, {
    method: "POST",
    headers: getAuthHeaders(),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Failed to dispatch ${workflowName}: ${response.status} ${text}`);
  }
}

export async function updateArchitectureChat(runId: string, messages: z.infer<typeof ArchitectureChatStateSchema>) {
  const response = await fetch(`${getBaseUrl()}/runs/${runId}/architecture-chat`, {
    method: "PATCH",
    headers: getJsonAuthHeaders(),
    body: JSON.stringify(messages),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Failed to update architecture chat: ${response.status} ${text}`);
  }

  await fetch(`${getBaseUrl()}/runs/${runId}/artifacts`, {
    method: "POST",
    headers: getJsonAuthHeaders(),
    body: JSON.stringify({
      name: "architecture_chat",
      content_type: "application/json",
      payload: messages,
    }),
  });
}

export async function approveDecomposition(runId: string, approvedBy: string) {
  const now = new Date().toISOString();
  const run = await getRun(runId);
  const workItemCount = run?.run.decomposition_state?.work_item_count ?? 0;

  const decompositionResponse = await fetch(`${getBaseUrl()}/runs/${runId}/decomposition-state`, {
    method: "PATCH",
    headers: getJsonAuthHeaders(),
    body: JSON.stringify({
      status: "approved",
      artifact_name: "decomposition_plan",
      generated_at: run?.run.decomposition_state?.generated_at,
      approved_at: now,
      approved_by: approvedBy,
      work_item_count: workItemCount,
    }),
  });

  if (!decompositionResponse.ok) {
    const text = await decompositionResponse.text();
    throw new Error(`Failed to approve decomposition: ${decompositionResponse.status} ${text}`);
  }

  const runResponse = await fetch(`${getBaseUrl()}/runs/${runId}`, {
    method: "PATCH",
    headers: getJsonAuthHeaders(),
    body: JSON.stringify({
      status: "approved",
      current_step: "approve",
    }),
  });

  if (!runResponse.ok) {
    const text = await runResponse.text();
    throw new Error(`Failed to update run approval status: ${runResponse.status} ${text}`);
  }
}
