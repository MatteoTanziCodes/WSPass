import { z } from "zod";
import { RUN_EXECUTION_BACKENDS, WORKFLOW_NAMES } from "../constants";

export const BuildPhaseStatusSchema = z.enum([
  "not_started",
  "planning",
  "running",
  "blocked",
  "completed",
  "failed",
]);
export type BuildPhaseStatus = z.infer<typeof BuildPhaseStatusSchema>;

export const IssueExecutionStatusSchema = z.enum([
  "queued",
  "gathering_requirements",
  "blocked_missing_tools",
  "blocked_missing_context",
  "ready",
  "working",
  "commit_blocked",
  "pr_open",
  "testing",
  "fixing",
  "merged",
  "failed",
]);
export type IssueExecutionStatus = z.infer<typeof IssueExecutionStatusSchema>;

export const BuildWorkflowNameSchema = z.enum(WORKFLOW_NAMES);
export type BuildWorkflowName = z.infer<typeof BuildWorkflowNameSchema>;

export const BuildExecutionBackendSchema = z.enum(RUN_EXECUTION_BACKENDS);
export type BuildExecutionBackend = z.infer<typeof BuildExecutionBackendSchema>;

export const ProjectSecretRequirementSchema = z
  .object({
    id: z.string().min(1),
    issue_id: z.string().min(1),
    kind: z.enum(["integration", "project_secret", "project_variable"]),
    provider: z.enum(["github", "anthropic", "stripe", "sentry", "other"]).optional(),
    name: z.string().min(1),
    label: z.string().min(1),
    reason: z.string().min(1),
    status: z.enum(["open", "provided", "resolved"]),
    required_by_workflow: BuildWorkflowNameSchema,
    created_at: z.string().datetime(),
    resolved_at: z.string().datetime().optional(),
  })
  .strict();
export type ProjectSecretRequirement = z.infer<typeof ProjectSecretRequirementSchema>;

export const IssueContextQuestionSchema = z
  .object({
    id: z.string().min(1),
    issue_id: z.string().min(1),
    prompt: z.string().min(1),
    rationale: z.string().min(1),
    status: z.enum(["open", "answered", "resolved"]),
    answer: z.string().min(1).optional(),
    created_at: z.string().datetime(),
    answered_at: z.string().datetime().optional(),
    related_requirement_ids: z.array(z.string().min(1)).default([]),
    related_components: z.array(z.string().min(1)).default([]),
  })
  .strict();
export type IssueContextQuestion = z.infer<typeof IssueContextQuestionSchema>;

export const IssueExecutionQualityResultSchema = z
  .object({
    status: z.enum(["passed", "failed", "blocked"]),
    coverage_percent: z.number().min(0).max(100).optional(),
    failing_checks: z.array(z.string().min(1)).default([]),
    summary: z.string().min(1).optional(),
  })
  .strict();
export type IssueExecutionQualityResult = z.infer<typeof IssueExecutionQualityResultSchema>;

export const IssueExecutionAttemptSchema = z
  .object({
    attempt_number: z.number().int().positive(),
    started_at: z.string().datetime(),
    completed_at: z.string().datetime().optional(),
    status: IssueExecutionStatusSchema,
    summary: z.string().min(1),
    log_artifact_names: z.array(z.string().min(1)).default([]),
    llm_observability_artifact_name: z.string().min(1).optional(),
    quality_result: IssueExecutionQualityResultSchema.optional(),
    error_message: z.string().min(1).optional(),
  })
  .strict();
export type IssueExecutionAttempt = z.infer<typeof IssueExecutionAttemptSchema>;

export const PullRequestStateSchema = z
  .object({
    issue_id: z.string().min(1),
    branch_name: z.string().min(1),
    pr_number: z.number().int().positive().optional(),
    pr_url: z.string().url().optional(),
    status: z.enum([
      "not_opened",
      "open",
      "checks_running",
      "checks_failed",
      "ready_to_merge",
      "merged",
      "closed",
    ]),
    last_updated_at: z.string().datetime(),
    coverage_percent: z.number().min(0).max(100).optional(),
    failing_checks: z.array(z.string().min(1)).default([]),
    failure_summary: z.string().min(1).optional(),
  })
  .strict();
export type PullRequestState = z.infer<typeof PullRequestStateSchema>;

export const IssueExecutionStateSchema = z
  .object({
    issue_id: z.string().min(1),
    issue_number: z.number().int().positive().optional(),
    title: z.string().min(1),
    ring: z.number().int().nonnegative(),
    dependencies: z.array(z.string().min(1)).default([]),
    status: IssueExecutionStatusSchema,
    worker_workflow_name: BuildWorkflowNameSchema,
    branch_name: z.string().min(1).optional(),
    worktree_path: z.string().min(1).optional(),
    current_attempt: z.number().int().positive().default(1),
    attempts: z.array(IssueExecutionAttemptSchema).default([]),
    secret_requirements: z.array(ProjectSecretRequirementSchema).default([]),
    context_questions: z.array(IssueContextQuestionSchema).default([]),
    pull_request: PullRequestStateSchema,
    last_updated_at: z.string().datetime(),
    blocker_summary: z.string().min(1).optional(),
    latest_cost_usd: z.number().nonnegative().nullable().optional(),
    latest_total_tokens: z.number().int().nonnegative().optional(),
  })
  .strict();
export type IssueExecutionState = z.infer<typeof IssueExecutionStateSchema>;

export const BuildOrchestrationStateSchema = z
  .object({
    status: BuildPhaseStatusSchema,
    started_at: z.string().datetime().optional(),
    completed_at: z.string().datetime().optional(),
    current_ring: z.number().int().nonnegative().default(0),
    max_parallel_workers: z.number().int().positive().default(3),
    issues: z.array(IssueExecutionStateSchema).default([]),
    blocked_reason: z.string().min(1).optional(),
    summary: z.string().min(1),
    audit_artifact_name: z.string().min(1).optional(),
  })
  .strict();
export type BuildOrchestrationState = z.infer<typeof BuildOrchestrationStateSchema>;

export const QualityCommandConfigSchema = z
  .object({
    install: z.string().min(1).optional(),
    lint: z.string().min(1).optional(),
    typecheck: z.string().min(1).optional(),
    test_changed: z.string().min(1).optional(),
    test_critical: z.string().min(1).optional(),
    coverage_extract: z.string().min(1).optional(),
    security_scan: z.string().min(1).optional(),
    json_yaml_validate: z.string().min(1).optional(),
  })
  .strict();
export type QualityCommandConfig = z.infer<typeof QualityCommandConfigSchema>;

export const ProjectBuildConfigSchema = z
  .object({
    project_key: z.string().min(1),
    quality_commands: QualityCommandConfigSchema.default({}),
    warning_defaults: z.array(z.string().min(1)).default([]),
    critical_defaults: z.array(z.string().min(1)).default([]),
    updated_at: z.string().datetime(),
  })
  .strict();
export type ProjectBuildConfig = z.infer<typeof ProjectBuildConfigSchema>;
