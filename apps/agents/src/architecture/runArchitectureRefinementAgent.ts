import { z } from "zod";
import {
  ArchitectureChatStateSchema,
  ArchitecturePackSchema,
  DecompositionReviewStateSchema,
  DecompositionStateSchema,
  ImplementationIssueStateCollectionSchema,
  PlannerRunInputSchema,
  RepoStateSchema,
  RunExecutionSchema,
  RunStatusSchema,
  RunStepSchema,
} from "@pass/shared";
import { renderMermaid, renderSummary } from "../planner/runPlannerAgent";
import {
  generateArchitectureAssistantReply,
  refineArchitecturePack,
} from "../providers/llmClient";
import {
  LlmObservabilityRecorder,
  withLlmObservabilityRecorder,
} from "../lib/llmObservability";

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

type RunDetail = z.infer<typeof RunDetailSchema>;
type ChatMessage = z.infer<typeof ArchitectureChatStateSchema>["messages"][number];

const REFINEMENT_FAILURE_MARKER =
  "I could not persist the revised architecture pack in this attempt because the refinement job failed:";

class PassApiClient {
  private readonly baseUrl: string;
  private readonly token: string;

  constructor(opts: { baseUrl: string; token: string }) {
    this.baseUrl = opts.baseUrl.replace(/\/+$/, "");
    this.token = opts.token;
  }

  async getRun(runId: string): Promise<RunDetail> {
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

  async updateArchitectureChat(runId: string, payload: z.infer<typeof ArchitectureChatStateSchema>) {
    await this.request("PATCH", `/runs/${runId}/architecture-chat`, payload, true);
  }

  async updateDecompositionState(runId: string, payload: z.infer<typeof DecompositionStateSchema>) {
    await this.request("PATCH", `/runs/${runId}/decomposition-state`, payload, true);
  }

  async updateDecompositionReviewState(
    runId: string,
    payload: z.infer<typeof DecompositionReviewStateSchema>
  ) {
    await this.request("PATCH", `/runs/${runId}/decomposition-review-state`, payload, true);
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

function isRefinementFailureNoise(message: ChatMessage) {
  return (
    message.role === "assistant" &&
    message.content.includes(REFINEMENT_FAILURE_MARKER)
  );
}

function buildEffectiveRefinementMessages(messages: ChatMessage[]) {
  const filteredMessages = messages.filter((message) => !isRefinementFailureNoise(message));
  const latestUserIndex = [...filteredMessages]
    .map((message, index) => ({ message, index }))
    .reverse()
    .find(({ message }) => message.role === "user")?.index;

  if (latestUserIndex === undefined) {
    throw new Error("Architecture refinement requires at least one user chat message.");
  }

  return filteredMessages.slice(0, latestUserIndex + 1).map((message) => ({
    role: message.role,
    content: message.content,
  }));
}

export async function runArchitectureRefinementAgent(runId: string): Promise<void> {
  const baseUrl = readRequiredEnv("PASS_API_BASE_URL");
  const token = readRequiredEnv("PASS_API_TOKEN");
  const api = new PassApiClient({
    baseUrl,
    token,
  });

  const githubRunId = process.env.GITHUB_RUN_ID ? Number(process.env.GITHUB_RUN_ID) : undefined;
  const githubRunUrl = process.env.GITHUB_RUN_URL;
  let lastKnownChatState: z.infer<typeof ArchitectureChatStateSchema> | undefined;
  let lastKnownPack: z.infer<typeof ArchitecturePackSchema> | undefined;
  let fallbackAssistantReply: string | undefined;
  let recorder: LlmObservabilityRecorder | undefined;
  let sessionStatus: "running" | "succeeded" | "failed" = "running";

  try {
    const run = await api.getRun(runId);
    const artifact = await api.getArtifact(runId, "architecture_pack");
    const currentPack = ArchitecturePackSchema.parse(artifact.payload);
    const chatState = ArchitectureChatStateSchema.parse(
      run.architecture_chat ?? {
        updated_at: new Date().toISOString(),
        messages: [],
      }
    );
    const effectiveMessages = buildEffectiveRefinementMessages(chatState.messages);

    lastKnownChatState = chatState;
    lastKnownPack = currentPack;
    recorder = new LlmObservabilityRecorder({
      runId,
      workflowName: "phase1-architecture-refinement",
      backend: run.execution?.backend,
      model: process.env.ANTHROPIC_MODEL ?? "claude-sonnet-4-6",
    });

    await api.updateExecution(runId, {
      status: "running",
      github_run_id: Number.isFinite(githubRunId) ? githubRunId : undefined,
      github_run_url: githubRunUrl,
    });

    fallbackAssistantReply = await withLlmObservabilityRecorder(recorder, () =>
      generateArchitectureAssistantReply({
        currentPack,
        messages: effectiveMessages,
      })
    );

    const refinementResult = await withLlmObservabilityRecorder(recorder, () =>
      refineArchitecturePack({
        currentPack,
        messages: effectiveMessages,
      })
    );
    const updatedPack = refinementResult.updatedPack;

    const nextChatState = ArchitectureChatStateSchema.parse({
      updated_at: new Date().toISOString(),
      messages: [
        ...chatState.messages,
        {
          id: `assistant_${Date.now()}`,
          role: "assistant",
          content: refinementResult.assistantResponse,
          created_at: new Date().toISOString(),
        },
      ],
    });

    await api.uploadArtifact(runId, {
      name: "architecture_pack",
      content_type: "application/json",
      payload: updatedPack,
    });
    await api.uploadArtifact(runId, {
      name: "architecture_pack_summary",
      content_type: "text/markdown",
      payload: renderSummary(updatedPack),
    });
    await api.uploadArtifact(runId, {
      name: "architecture_pack_diagram",
      content_type: "text/plain",
      payload: renderMermaid(updatedPack),
    });
    await api.uploadArtifact(runId, {
      name: "architecture_chat",
      content_type: "application/json",
      payload: nextChatState,
    });

    await api.updateArchitectureChat(runId, nextChatState);
    await api.updateDecompositionState(runId, {
      status: "not_started",
      artifact_name: "decomposition_plan",
      work_item_count: 0,
    });
    await api.updateDecompositionReviewState(runId, {
      status: "not_started",
      artifact_name: "decomposition_review",
      iteration_count: 0,
      gap_count: 0,
      open_question_count: 0,
      questions: [],
    });
    await api.updateRun(runId, {
      status: "plan_generated",
      current_step: "plan",
    });
    await api.updateExecution(runId, {
      status: "succeeded",
      github_run_id: Number.isFinite(githubRunId) ? githubRunId : undefined,
      github_run_url: githubRunUrl,
    });
    sessionStatus = "succeeded";
  } catch (error) {
    const message = buildFailureMessage(error);
    sessionStatus = "failed";
    if (lastKnownChatState && lastKnownPack) {
      const safeChatState = lastKnownChatState;
      const safePack = lastKnownPack;
      try {
        const fallbackReply =
          fallbackAssistantReply ??
          (await withLlmObservabilityRecorder(
            recorder ??
              new LlmObservabilityRecorder({
                runId,
                workflowName: "phase1-architecture-refinement",
                model: process.env.ANTHROPIC_MODEL ?? "claude-sonnet-4-6",
              }),
            () =>
              generateArchitectureAssistantReply({
                currentPack: safePack,
                messages: buildEffectiveRefinementMessages(safeChatState.messages),
              })
          ));

        const failureChatState = ArchitectureChatStateSchema.parse({
          updated_at: new Date().toISOString(),
          messages: [
            ...safeChatState.messages,
            {
              id: `assistant_${Date.now()}`,
              role: "assistant",
              content: `${fallbackReply}\n\nI could not persist the revised architecture pack in this attempt because the refinement job failed: ${message}`,
              created_at: new Date().toISOString(),
            },
          ],
        });

        await api.uploadArtifact(runId, {
          name: "architecture_chat",
          content_type: "application/json",
          payload: failureChatState,
        });
        await api.updateArchitectureChat(runId, failureChatState);
      } catch {
        // Preserve the original failure if fallback chat generation also fails.
      }
    }

    try {
      await api.updateRun(runId, {
        status: "failed",
        current_step: "plan",
      });
    } catch {
      // Preserve the original failure if run status cannot be updated.
    }

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
  } finally {
    if (recorder) {
      recorder.complete(sessionStatus);
      try {
        await recorder.flush({ baseUrl, token });
      } catch {
        // Preserve the primary workflow result if observability flush fails.
      }
    }
  }
}
