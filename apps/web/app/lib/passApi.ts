import "server-only";
import {
  ArchitectureChatStateSchema,
  ArchitecturePackSchema,
  BuildOrchestrationStateSchema,
  IssueContextQuestionSchema,
  IssueExecutionStateSchema,
  DecompositionPlanSchema,
  DecompositionReviewArtifactSchema,
  DecompositionReviewQuestionAnswerRequestSchema,
  DecompositionReviewStateSchema,
  DecompositionStateSchema,
  ImplementationIssueStateCollectionSchema,
  PlannerRunInputSchema,
  ProjectBuildConfigSchema,
  ProjectObservabilityBudgetSchema,
  ProjectObservabilitySummarySchema,
  RepoStateSchema,
  RunExecutionSchema,
  ProjectSecretRequirementSchema,
} from "@pass/shared";
import { z } from "zod";
import { readServerEnv } from "./env";

export class ApiRequestError extends Error {
  status: number;
  body: string;

  constructor(message: string, status: number, body: string) {
    super(message);
    this.name = "ApiRequestError";
    this.status = status;
    this.body = body;
  }
}

const RunListItemSchema = z.object({
  run_id: z.uuid(),
  created_at: z.string().datetime(),
  status: z.string(),
  current_step: z.string(),
  last_updated_at: z.string().datetime(),
  input: PlannerRunInputSchema.optional(),
  execution: RunExecutionSchema.optional(),
  repo_state: RepoStateSchema.optional(),
  decomposition_state: DecompositionStateSchema.optional(),
  decomposition_review_state: DecompositionReviewStateSchema.optional(),
  build_state: BuildOrchestrationStateSchema.optional(),
});

const RunListSchema = z.object({
  total: z.number().int().nonnegative(),
  runs: z.array(RunListItemSchema),
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
  repo_state: RepoStateSchema.optional(),
  architecture_chat: ArchitectureChatStateSchema.optional(),
  decomposition_state: DecompositionStateSchema.optional(),
  decomposition_review_state: DecompositionReviewStateSchema.optional(),
  implementation_state: ImplementationIssueStateCollectionSchema.optional(),
  build_state: BuildOrchestrationStateSchema.optional(),
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

const RunLogListSchema = z.object({
  logs: z.array(
    z.object({
      name: z.string().min(1),
      size_bytes: z.number().int().nonnegative(),
      updated_at: z.string().datetime(),
    })
  ),
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

export async function getDecompositionReview(runId: string) {
  const response = await fetch(`${getBaseUrl()}/runs/${runId}/artifacts/decomposition_review`, {
    cache: "no-store",
  });
  if (!response.ok) {
    return null;
  }

  const artifact = ArtifactResponseSchema.parse(await response.json());
  return DecompositionReviewArtifactSchema.parse(artifact.payload);
}

export async function getArtifact(runId: string, artifactName: string) {
  const response = await fetch(`${getBaseUrl()}/runs/${runId}/artifacts/${artifactName}`, {
    cache: "no-store",
  });
  if (!response.ok) {
    return null;
  }

  return ArtifactResponseSchema.parse(await response.json());
}

export async function listRunLogs(runId: string) {
  const response = await fetch(`${getBaseUrl()}/runs/${runId}/logs`, {
    cache: "no-store",
    headers: getAuthHeaders(),
  });

  if (!response.ok) {
    if (response.status === 404) {
      return [];
    }
    const text = await response.text();
    throw new Error(`Failed to list run logs: ${response.status} ${text}`);
  }

  return RunLogListSchema.parse(await response.json()).logs;
}

export async function getRunLog(runId: string, logName: string) {
  const response = await fetch(`${getBaseUrl()}/runs/${runId}/logs/${encodeURIComponent(logName)}`, {
    cache: "no-store",
    headers: getAuthHeaders(),
  });

  if (!response.ok) {
    if (response.status === 404) {
      return null;
    }
    const text = await response.text();
    throw new Error(`Failed to fetch run log: ${response.status} ${text}`);
  }

  return response.text();
}

export async function getProjectObservability(projectKey: string) {
  const response = await fetch(
    `${getBaseUrl()}/project-observability?project_key=${encodeURIComponent(projectKey)}`,
    {
      cache: "no-store",
      headers: getAuthHeaders(),
    }
  );

  if (!response.ok) {
    if (response.status === 404) {
      return null;
    }
    const text = await response.text();
    throw new Error(`Failed to fetch project observability: ${response.status} ${text}`);
  }

  return ProjectObservabilitySummarySchema.parse(await response.json());
}

export async function updateProjectObservabilityBudget(
  projectKey: string,
  payload: {
    warning_usd: number | null;
    critical_usd: number | null;
  }
) {
  const response = await fetch(
    `${getBaseUrl()}/project-observability/config?project_key=${encodeURIComponent(projectKey)}`,
    {
      method: "PATCH",
      headers: getJsonAuthHeaders(),
      body: JSON.stringify(payload),
    }
  );

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Failed to update project observability budget: ${response.status} ${text}`);
  }

  const parsed = z
    .object({
      budget: ProjectObservabilityBudgetSchema,
    })
    .parse(await response.json());

  return parsed.budget;
}

export function getProjectObservabilityExportPath(projectKey: string) {
  return `/api/project-observability/export?project_key=${encodeURIComponent(projectKey)}`;
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
    | "phase2-decomposition-iterator"
    | "phase2-implementation"
    | "phase3-build-orchestrator"
    | "phase3-issue-execution"
    | "phase3-pr-supervisor",
  options?: { issueId?: string }
) {
  const response = await fetch(`${getBaseUrl()}/runs/${runId}/dispatch/${workflowName}`, {
    method: "POST",
    headers: options?.issueId ? getJsonAuthHeaders() : getAuthHeaders(),
    body: options?.issueId ? JSON.stringify({ issue_id: options.issueId }) : undefined,
  });

  if (!response.ok) {
    const text = await response.text();
    throw new ApiRequestError(
      `Failed to dispatch ${workflowName}: ${response.status} ${text}`,
      response.status,
      text
    );
  }
}

export async function updateIssueExecutionState(
  runId: string,
  issueId: string,
  payload: z.infer<typeof IssueExecutionStateSchema>
) {
  const response = await fetch(`${getBaseUrl()}/runs/${runId}/issues/${issueId}/state`, {
    method: "PATCH",
    headers: getJsonAuthHeaders(),
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Failed to update issue execution state: ${response.status} ${text}`);
  }
}

export async function updateIssueRequirements(
  runId: string,
  issueId: string,
  requirements: Array<Pick<z.infer<typeof ProjectSecretRequirementSchema>, "id" | "status" | "resolved_at">>
) {
  const response = await fetch(`${getBaseUrl()}/runs/${runId}/issues/${issueId}/requirements`, {
    method: "PATCH",
    headers: getJsonAuthHeaders(),
    body: JSON.stringify({ requirements }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Failed to update issue requirements: ${response.status} ${text}`);
  }
}

export async function updateIssueContextQuestions(
  runId: string,
  issueId: string,
  questions: Array<
    Pick<
      z.infer<typeof IssueContextQuestionSchema>,
      "id" | "status" | "answer" | "answered_at"
    >
  >
) {
  const response = await fetch(`${getBaseUrl()}/runs/${runId}/issues/${issueId}/context-questions`, {
    method: "PATCH",
    headers: getJsonAuthHeaders(),
    body: JSON.stringify({ questions }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Failed to update issue context questions: ${response.status} ${text}`);
  }
}

const ProjectSecretMetadataSchema = z.object({
  name: z.string().min(1),
  kind: z.enum(["integration", "project_secret", "project_variable"]),
  provider: z.enum(["github", "anthropic", "stripe", "sentry", "other"]).optional(),
  updated_at: z.string().datetime(),
  hint: z.string().min(1).optional(),
});

export async function getProjectBuildConfig(projectKey: string) {
  const response = await fetch(
    `${getBaseUrl()}/project-build/config?project_key=${encodeURIComponent(projectKey)}`,
    {
      cache: "no-store",
      headers: getAuthHeaders(),
    }
  );

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Failed to fetch project build config: ${response.status} ${text}`);
  }

  return z.object({ config: ProjectBuildConfigSchema }).parse(await response.json()).config;
}

export async function updateProjectBuildConfig(
  projectKey: string,
  payload: {
    quality_commands?: Partial<z.infer<typeof ProjectBuildConfigSchema>["quality_commands"]>;
    warning_defaults?: string[];
    critical_defaults?: string[];
  }
) {
  const response = await fetch(
    `${getBaseUrl()}/project-build/config?project_key=${encodeURIComponent(projectKey)}`,
    {
      method: "PATCH",
      headers: getJsonAuthHeaders(),
      body: JSON.stringify(payload),
    }
  );

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Failed to update project build config: ${response.status} ${text}`);
  }

  return z.object({ config: ProjectBuildConfigSchema }).parse(await response.json()).config;
}

export async function listProjectBuildSecrets(projectKey: string) {
  const response = await fetch(
    `${getBaseUrl()}/project-build/secrets?project_key=${encodeURIComponent(projectKey)}`,
    {
      cache: "no-store",
      headers: getAuthHeaders(),
    }
  );

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Failed to list project build secrets: ${response.status} ${text}`);
  }

  return z.object({ secrets: z.array(ProjectSecretMetadataSchema) }).parse(await response.json()).secrets;
}

export async function putProjectBuildSecret(
  projectKey: string,
  payload: {
    name: string;
    value: string;
    kind: "integration" | "project_secret" | "project_variable";
    provider?: "github" | "anthropic" | "stripe" | "sentry" | "other";
  }
) {
  const response = await fetch(
    `${getBaseUrl()}/project-build/secrets?project_key=${encodeURIComponent(projectKey)}`,
    {
      method: "PUT",
      headers: getJsonAuthHeaders(),
      body: JSON.stringify(payload),
    }
  );

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Failed to save project build secret: ${response.status} ${text}`);
  }
}

export async function deleteProjectBuildSecret(projectKey: string, name: string) {
  const response = await fetch(
    `${getBaseUrl()}/project-build/secrets?project_key=${encodeURIComponent(projectKey)}&name=${encodeURIComponent(name)}`,
    {
      method: "DELETE",
      headers: getAuthHeaders(),
    }
  );

  if (!response.ok && response.status !== 204) {
    const text = await response.text();
    throw new Error(`Failed to delete project build secret: ${response.status} ${text}`);
  }
}

export async function deleteRun(runId: string) {
  const response = await fetch(`${getBaseUrl()}/runs/${runId}`, {
    method: "DELETE",
    headers: getAuthHeaders(),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Failed to delete run ${runId}: ${response.status} ${text}`);
  }
}

export async function answerDecompositionReviewQuestion(
  runId: string,
  payload: z.infer<typeof DecompositionReviewQuestionAnswerRequestSchema>
) {
  const response = await fetch(`${getBaseUrl()}/runs/${runId}/decomposition-review-questions`, {
    method: "PATCH",
    headers: getJsonAuthHeaders(),
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(
      `Failed to answer decomposition review question: ${response.status} ${text}`
    );
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
