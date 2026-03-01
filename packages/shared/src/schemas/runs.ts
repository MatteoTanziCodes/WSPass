import { z } from "zod";
import {
  RUN_EXECUTION_BACKENDS,
  RUN_EXECUTION_STATUSES,
  WORKFLOW_NAMES,
} from "../constants";

export const PlannerRunSourceSchema = z
  .object({
    repository: z.string().min(1).optional(),
    ref: z.string().min(1).optional(),
    trigger: z.literal("api").default("api"),
  })
  .strict();

export type PlannerRunSource = z.infer<typeof PlannerRunSourceSchema>;

export const PlannerRunInputSchema = z
  .object({
    prd_text: z.string().min(1),
    org_constraints_yaml: z.string().min(1).optional(),
    requested_by: z.string().min(1).optional(),
    source: PlannerRunSourceSchema.optional(),
  })
  .strict();

export type PlannerRunInput = z.infer<typeof PlannerRunInputSchema>;

export const RunExecutionBackendSchema = z.enum(RUN_EXECUTION_BACKENDS);
export type RunExecutionBackend = z.infer<typeof RunExecutionBackendSchema>;

export const RunExecutionStatusSchema = z.enum(RUN_EXECUTION_STATUSES);
export type RunExecutionStatus = z.infer<typeof RunExecutionStatusSchema>;

export const WorkflowNameSchema = z.enum(WORKFLOW_NAMES);
export type WorkflowName = z.infer<typeof WorkflowNameSchema>;

export const RunExecutionSchema = z
  .object({
    backend: RunExecutionBackendSchema,
    workflow_name: WorkflowNameSchema,
    status: RunExecutionStatusSchema,
    github_run_id: z.number().int().positive().optional(),
    github_run_url: z.string().url().optional(),
    requested_at: z.string().datetime(),
    started_at: z.string().datetime().optional(),
    completed_at: z.string().datetime().optional(),
    error_message: z.string().min(1).optional(),
  })
  .strict();

export type RunExecution = z.infer<typeof RunExecutionSchema>;

export const ImplementationIssueSyncStatusSchema = z.enum([
  "created",
  "updated",
  "unchanged",
  "failed",
]);
export type ImplementationIssueSyncStatus = z.infer<typeof ImplementationIssueSyncStatusSchema>;

export const ImplementationIssueStateSchema = z
  .object({
    plan_item_id: z.string().min(1),
    title: z.string().min(1),
    issue_number: z.number().int().positive().optional(),
    issue_url: z.string().url().optional(),
    github_state: z.enum(["open", "closed"]).optional(),
    sync_status: ImplementationIssueSyncStatusSchema,
    labels: z.array(z.string().min(1)).default([]),
    last_synced_at: z.string().datetime(),
    last_error: z.string().min(1).optional(),
  })
  .strict();

export type ImplementationIssueState = z.infer<typeof ImplementationIssueStateSchema>;

export const ImplementationIssueStateCollectionSchema = z
  .object({
    synced_at: z.string().datetime(),
    issues: z.array(ImplementationIssueStateSchema).default([]),
  })
  .strict();

export type ImplementationIssueStateCollection = z.infer<
  typeof ImplementationIssueStateCollectionSchema
>;
