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

export const RepoTargetModeSchema = z.enum(["create_new_repo", "use_existing_repo"]);
export type RepoTargetMode = z.infer<typeof RepoTargetModeSchema>;

export const RepoVisibilitySchema = z.enum(["private", "public"]);
export type RepoVisibility = z.infer<typeof RepoVisibilitySchema>;

export const RepoTargetSchema = z
  .object({
    mode: RepoTargetModeSchema,
    repository: z.string().min(1).optional(),
    owner: z.string().min(1).optional(),
    name: z.string().min(1).optional(),
    visibility: RepoVisibilitySchema.optional(),
    description: z.string().min(1).optional(),
    template_repository: z.string().min(1).optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.mode === "use_existing_repo") {
      const hasRepository = Boolean(value.repository?.trim());
      const hasOwnerAndName = Boolean(value.owner?.trim() && value.name?.trim());
      if (!hasRepository && !hasOwnerAndName) {
        ctx.addIssue({
          code: "custom",
          path: ["repository"],
          message: "use_existing_repo requires repository or owner and name",
        });
      }
    }

    if (value.mode === "create_new_repo") {
      const hasName = Boolean(value.name?.trim());
      const hasRepository = Boolean(value.repository?.trim());
      if (!hasName && !hasRepository) {
        ctx.addIssue({
          code: "custom",
          path: ["name"],
          message: "create_new_repo requires name or repository",
        });
      }
    }
  });

export type RepoTarget = z.infer<typeof RepoTargetSchema>;

export const PlannerRunInputSchema = z
  .object({
    prd_text: z.string().min(1),
    org_constraints_yaml: z.string().min(1).optional(),
    requested_by: z.string().min(1).optional(),
    source: PlannerRunSourceSchema.optional(),
    repo_target: RepoTargetSchema.optional(),
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

export const RepoStateSourceSchema = z.enum(["created", "existing"]);
export type RepoStateSource = z.infer<typeof RepoStateSourceSchema>;

export const RepoStateStatusSchema = z.enum(["created", "attached"]);
export type RepoStateStatus = z.infer<typeof RepoStateStatusSchema>;

export const RepoStateSchema = z
  .object({
    mode: RepoTargetModeSchema,
    status: RepoStateStatusSchema,
    source: RepoStateSourceSchema,
    repository: z.string().min(1),
    owner: z.string().min(1),
    name: z.string().min(1),
    html_url: z.string().url(),
    visibility: RepoVisibilitySchema.optional(),
    default_branch: z.string().min(1).optional(),
    description: z.string().min(1).optional(),
    template_repository: z.string().min(1).optional(),
    configured_at: z.string().datetime(),
  })
  .strict();

export type RepoState = z.infer<typeof RepoStateSchema>;

export const ArchitectureChatMessageSchema = z
  .object({
    id: z.string().min(1),
    role: z.enum(["user", "assistant", "system"]),
    content: z.string().min(1),
    created_at: z.string().datetime(),
  })
  .strict();

export type ArchitectureChatMessage = z.infer<typeof ArchitectureChatMessageSchema>;

export const ArchitectureChatStateSchema = z
  .object({
    updated_at: z.string().datetime(),
    messages: z.array(ArchitectureChatMessageSchema).default([]),
  })
  .strict();

export type ArchitectureChatState = z.infer<typeof ArchitectureChatStateSchema>;

export const DecompositionWorkItemSchema = z
  .object({
    id: z.string().min(1),
    title: z.string().min(1),
    summary: z.string().min(1),
    category: z.enum(["frontend", "backend", "infra", "data", "qa", "docs", "ops"]),
    size: z.enum(["tiny", "small"]),
    component: z.string().min(1),
    acceptance_criteria: z.array(z.string().min(1)).default([]),
    depends_on: z.array(z.string().min(1)).default([]),
    labels: z.array(z.string().min(1)).default([]),
  })
  .strict();

export type DecompositionWorkItem = z.infer<typeof DecompositionWorkItemSchema>;

export const DecompositionPlanSchema = z
  .object({
    generated_at: z.string().datetime(),
    summary: z.string().min(1),
    approval_notes: z.string().optional(),
    work_items: z.array(DecompositionWorkItemSchema).default([]),
  })
  .strict();

export type DecompositionPlan = z.infer<typeof DecompositionPlanSchema>;

export const DecompositionStatusSchema = z.enum(["not_started", "draft", "approved", "synced"]);
export type DecompositionStatus = z.infer<typeof DecompositionStatusSchema>;

export const DecompositionStateSchema = z
  .object({
    status: DecompositionStatusSchema,
    artifact_name: z.string().min(1).default("decomposition_plan"),
    generated_at: z.string().datetime().optional(),
    approved_at: z.string().datetime().optional(),
    approved_by: z.string().min(1).optional(),
    work_item_count: z.number().int().nonnegative().default(0),
  })
  .strict();

export type DecompositionState = z.infer<typeof DecompositionStateSchema>;

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
