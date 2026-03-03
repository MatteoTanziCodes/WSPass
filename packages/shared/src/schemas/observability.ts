import { z } from "zod";
import { RunExecutionBackendSchema, WorkflowNameSchema } from "./runs";

export const LlmProviderSchema = z.enum(["anthropic"]);
export type LlmProvider = z.infer<typeof LlmProviderSchema>;

export const LlmUsageSchema = z
  .object({
    input_tokens: z.number().int().nonnegative(),
    output_tokens: z.number().int().nonnegative(),
    cache_creation_input_tokens: z.number().int().nonnegative().optional(),
    cache_read_input_tokens: z.number().int().nonnegative().optional(),
    total_tokens: z.number().int().nonnegative(),
    estimated_cost_usd: z.number().nonnegative().nullable(),
  })
  .strict();

export type LlmUsage = z.infer<typeof LlmUsageSchema>;

export const LlmTraceRequestSchema = z
  .object({
    id: z.string().min(1),
    provider: LlmProviderSchema,
    model: z.string().min(1),
    workflow_name: WorkflowNameSchema,
    section_name: z.string().min(1),
    tool_name: z.string().min(1).optional(),
    request_id: z.string().min(1).optional(),
    status: z.enum(["succeeded", "failed", "rate_limited"]),
    started_at: z.string().datetime(),
    completed_at: z.string().datetime(),
    duration_ms: z.number().int().nonnegative(),
    stop_reason: z.string().min(1).optional(),
    retry_count: z.number().int().nonnegative().default(0),
    usage: LlmUsageSchema,
    prompt_redacted: z.string().min(1),
    response_redacted: z.string().min(1).optional(),
    error_message: z.string().min(1).optional(),
    schema_hash: z.string().min(1).optional(),
  })
  .strict();

export type LlmTraceRequest = z.infer<typeof LlmTraceRequestSchema>;

export const LlmWorkflowSessionSchema = z
  .object({
    workflow_name: WorkflowNameSchema,
    backend: RunExecutionBackendSchema.optional(),
    status: z.enum(["succeeded", "failed", "running"]),
    started_at: z.string().datetime(),
    completed_at: z.string().datetime().optional(),
    provider: LlmProviderSchema,
    model: z.string().min(1),
    request_count: z.number().int().nonnegative(),
    usage: LlmUsageSchema,
    requests: z.array(LlmTraceRequestSchema).default([]),
  })
  .strict();

export type LlmWorkflowSession = z.infer<typeof LlmWorkflowSessionSchema>;

export const RunLlmObservabilitySchema = z
  .object({
    run_id: z.uuid(),
    updated_at: z.string().datetime(),
    sessions: z.array(LlmWorkflowSessionSchema).default([]),
    totals: LlmUsageSchema,
  })
  .strict();

export type RunLlmObservability = z.infer<typeof RunLlmObservabilitySchema>;

export const ProjectObservabilityBudgetSchema = z
  .object({
    window_days: z.literal(30).default(30),
    warning_usd: z.number().nonnegative().nullable(),
    critical_usd: z.number().nonnegative().nullable(),
    updated_at: z.string().datetime(),
  })
  .strict();

export type ProjectObservabilityBudget = z.infer<typeof ProjectObservabilityBudgetSchema>;

export const ProjectObservabilityRunSummarySchema = z
  .object({
    run_id: z.uuid(),
    latest_workflow_name: WorkflowNameSchema.optional(),
    latest_status: z.string().min(1),
    last_updated_at: z.string().datetime(),
    totals: LlmUsageSchema.extend({
      request_count: z.number().int().nonnegative(),
    }),
    sessions: z.array(LlmWorkflowSessionSchema).default([]),
    available_log_files: z.array(z.string().min(1)).default([]),
  })
  .strict();

export type ProjectObservabilityRunSummary = z.infer<
  typeof ProjectObservabilityRunSummarySchema
>;

export const ProjectObservabilitySummarySchema = z
  .object({
    project_key: z.string().min(1),
    project_label: z.string().min(1),
    rolling_window_started_at: z.string().datetime(),
    generated_at: z.string().datetime(),
    totals: LlmUsageSchema.extend({
      request_count: z.number().int().nonnegative(),
      run_count: z.number().int().nonnegative(),
    }),
    budget: ProjectObservabilityBudgetSchema.nullable(),
    budget_state: z.enum(["none", "green", "yellow", "red"]),
    runs: z.array(ProjectObservabilityRunSummarySchema).default([]),
  })
  .strict();

export type ProjectObservabilitySummary = z.infer<
  typeof ProjectObservabilitySummarySchema
>;
