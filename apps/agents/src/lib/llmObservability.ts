import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import {
  LlmProviderSchema,
  LlmTraceRequestSchema,
  LlmUsageSchema,
  LlmWorkflowSessionSchema,
  RunLlmObservabilitySchema,
  type LlmProvider,
  type RunExecutionBackend,
  type RunLlmObservability,
  type WorkflowName,
} from "@pass/shared";

type LlmUsageInput = {
  input_tokens?: number;
  output_tokens?: number;
  cache_creation_input_tokens?: number;
  cache_read_input_tokens?: number;
  estimated_cost_usd?: number | null;
};

type LlmTraceRequestInput = {
  provider?: LlmProvider;
  model: string;
  section_name: string;
  tool_name?: string;
  request_id?: string;
  status: "succeeded" | "failed" | "rate_limited";
  started_at: string;
  completed_at: string;
  duration_ms: number;
  stop_reason?: string;
  retry_count?: number;
  usage?: LlmUsageInput;
  prompt_redacted: string;
  response_redacted?: string;
  error_message?: string;
  schema_hash?: string;
};

type RecorderOptions = {
  runId: string;
  workflowName: WorkflowName;
  backend?: RunExecutionBackend;
  model: string;
};

type FlushOptions = {
  baseUrl: string;
  token: string;
};

const SECRET_PATTERNS = [
  /sk-ant-api[0-9a-zA-Z_-]+/g,
  /github_pat_[0-9A-Za-z_]+/g,
  /Bearer\s+[A-Za-z0-9._-]+/g,
  /"x-api-key"\s*:\s*"[^"]+"/gi,
  /"Authorization"\s*:\s*"Bearer[^"]+"/gi,
  /"token"\s*:\s*"[^"]+"/gi,
];

function clampNumber(value: number | undefined) {
  if (!Number.isFinite(value)) {
    return 0;
  }

  return Math.max(0, Math.round(value as number));
}

export function createEmptyUsage(estimatedCostUsd: number | null = null) {
  return LlmUsageSchema.parse({
    input_tokens: 0,
    output_tokens: 0,
    cache_creation_input_tokens: 0,
    cache_read_input_tokens: 0,
    total_tokens: 0,
    estimated_cost_usd: estimatedCostUsd,
  });
}

export function normalizeUsage(input?: LlmUsageInput) {
  const usage = {
    input_tokens: clampNumber(input?.input_tokens),
    output_tokens: clampNumber(input?.output_tokens),
    cache_creation_input_tokens: clampNumber(input?.cache_creation_input_tokens),
    cache_read_input_tokens: clampNumber(input?.cache_read_input_tokens),
    estimated_cost_usd:
      typeof input?.estimated_cost_usd === "number" && Number.isFinite(input.estimated_cost_usd)
        ? Math.max(0, input.estimated_cost_usd)
        : input?.estimated_cost_usd === null
          ? null
          : null,
  };

  return LlmUsageSchema.parse({
    ...usage,
    total_tokens:
      usage.input_tokens +
      usage.output_tokens +
      usage.cache_creation_input_tokens +
      usage.cache_read_input_tokens,
  });
}

function addUsage(left: z.infer<typeof LlmUsageSchema>, right: z.infer<typeof LlmUsageSchema>) {
  const estimated =
    left.estimated_cost_usd === null || right.estimated_cost_usd === null
      ? left.estimated_cost_usd === null && right.estimated_cost_usd === null
        ? null
        : (left.estimated_cost_usd ?? 0) + (right.estimated_cost_usd ?? 0)
      : left.estimated_cost_usd + right.estimated_cost_usd;

  return LlmUsageSchema.parse({
    input_tokens: left.input_tokens + right.input_tokens,
    output_tokens: left.output_tokens + right.output_tokens,
    cache_creation_input_tokens:
      (left.cache_creation_input_tokens ?? 0) + (right.cache_creation_input_tokens ?? 0),
    cache_read_input_tokens:
      (left.cache_read_input_tokens ?? 0) + (right.cache_read_input_tokens ?? 0),
    total_tokens: left.total_tokens + right.total_tokens,
    estimated_cost_usd: estimated,
  });
}

function summarizeSessions(
  sessions: Array<z.infer<typeof LlmWorkflowSessionSchema>>
) {
  return sessions.reduce((totals, session) => addUsage(totals, session.usage), createEmptyUsage(null));
}

function redactText(value: string) {
  let redacted = value;
  for (const pattern of SECRET_PATTERNS) {
    redacted = redacted.replace(pattern, "[REDACTED]");
  }
  return redacted;
}

export function sanitizePromptPayloadForTrace(payload: unknown) {
  const clone =
    typeof payload === "string"
      ? payload
      : JSON.parse(
          JSON.stringify(payload, (_key, value) => {
            if (_key === "tools" && Array.isArray(value)) {
              return value.map((tool: Record<string, unknown>) => ({
                name: tool.name,
                description: tool.description,
                strict: tool.strict,
                schema_hash: tool.input_schema
                  ? createHash("sha256")
                      .update(JSON.stringify(tool.input_schema))
                      .digest("hex")
                  : undefined,
              }));
            }
            return value;
          })
        );

  return redactText(typeof clone === "string" ? clone : JSON.stringify(clone, null, 2));
}

export function sanitizeResponsePayloadForTrace(payload: unknown) {
  return redactText(
    typeof payload === "string" ? payload : JSON.stringify(payload, null, 2)
  );
}

async function fetchExistingObservability(
  runId: string,
  opts: FlushOptions
): Promise<RunLlmObservability | null> {
  const response = await fetch(
    `${opts.baseUrl.replace(/\/+$/, "")}/runs/${runId}/artifacts/llm_observability`,
    {
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${opts.token}`,
      },
    }
  );

  if (response.status === 404) {
    return null;
  }

  if (!response.ok) {
    const text = await response.text();
    throw new Error(
      `Failed to read existing llm_observability artifact: ${response.status} ${text || response.statusText}`
    );
  }

  const payload = (await response.json()) as { payload?: unknown };
  return RunLlmObservabilitySchema.parse(payload.payload);
}

async function uploadObservability(
  runId: string,
  observability: RunLlmObservability,
  opts: FlushOptions
) {
  const response = await fetch(
    `${opts.baseUrl.replace(/\/+$/, "")}/runs/${runId}/artifacts`,
    {
      method: "POST",
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${opts.token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        name: "llm_observability",
        content_type: "application/json",
        payload: observability,
      }),
    }
  );

  if (!response.ok) {
    const text = await response.text();
    throw new Error(
      `Failed to upload llm_observability artifact: ${response.status} ${text || response.statusText}`
    );
  }
}

export class LlmObservabilityRecorder {
  private readonly runId: string;
  private readonly workflowName: WorkflowName;
  private readonly backend?: RunExecutionBackend;
  private readonly model: string;
  private readonly startedAt: string;
  private requests: Array<z.infer<typeof LlmTraceRequestSchema>> = [];
  private completedAt?: string;
  private status: "succeeded" | "failed" | "running" = "running";

  constructor(options: RecorderOptions) {
    this.runId = options.runId;
    this.workflowName = options.workflowName;
    this.backend = options.backend;
    this.model = options.model;
    this.startedAt = new Date().toISOString();
  }

  getWorkflowName() {
    return this.workflowName;
  }

  getBackend() {
    return this.backend;
  }

  getModel() {
    return this.model;
  }

  recordRequest(input: LlmTraceRequestInput) {
    const usage = normalizeUsage(input.usage);
    const entry = LlmTraceRequestSchema.parse({
      id: randomUUID(),
      provider: input.provider ?? LlmProviderSchema.enum.anthropic,
      model: input.model,
      workflow_name: this.workflowName,
      section_name: input.section_name,
      tool_name: input.tool_name,
      request_id: input.request_id,
      status: input.status,
      started_at: input.started_at,
      completed_at: input.completed_at,
      duration_ms: input.duration_ms,
      stop_reason: input.stop_reason,
      retry_count: input.retry_count ?? 0,
      usage,
      prompt_redacted: redactText(input.prompt_redacted),
      response_redacted: input.response_redacted
        ? redactText(input.response_redacted)
        : undefined,
      error_message: input.error_message,
      schema_hash: input.schema_hash,
    });

    this.requests.push(entry);
  }

  complete(status: "succeeded" | "failed" | "running") {
    this.status = status;
    this.completedAt = new Date().toISOString();
  }

  private buildSession() {
    const usage = summarizeSessions([
      LlmWorkflowSessionSchema.parse({
        workflow_name: this.workflowName,
        backend: this.backend,
        status: this.status,
        started_at: this.startedAt,
        completed_at: this.completedAt,
        provider: "anthropic",
        model: this.model,
        request_count: this.requests.length,
        usage: this.requests.reduce(
          (totals, request) => addUsage(totals, request.usage),
          createEmptyUsage(null)
        ),
        requests: this.requests,
      }),
    ]);

    return LlmWorkflowSessionSchema.parse({
      workflow_name: this.workflowName,
      backend: this.backend,
      status: this.status,
      started_at: this.startedAt,
      completed_at: this.completedAt,
      provider: "anthropic",
      model: this.model,
      request_count: this.requests.length,
      usage,
      requests: this.requests,
    });
  }

  async flush(options: FlushOptions) {
    const existing = await fetchExistingObservability(this.runId, options);
    const session = this.buildSession();
    const sessions = [...(existing?.sessions ?? []), session];
    const next = RunLlmObservabilitySchema.parse({
      run_id: this.runId,
      updated_at: new Date().toISOString(),
      sessions,
      totals: summarizeSessions(sessions),
    });

    await uploadObservability(this.runId, next, options);
  }
}

type ActiveRecorder = LlmObservabilityRecorder | null;

let activeRecorder: ActiveRecorder = null;

export async function withLlmObservabilityRecorder<T>(
  recorder: LlmObservabilityRecorder,
  fn: () => Promise<T>
) {
  const previous = activeRecorder;
  activeRecorder = recorder;
  try {
    return await fn();
  } finally {
    activeRecorder = previous;
  }
}

export function getActiveLlmObservabilityRecorder() {
  return activeRecorder;
}
