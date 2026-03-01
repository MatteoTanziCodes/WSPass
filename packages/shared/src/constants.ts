// packages/shared/src/constants.ts

/** PASS Architecture Pack contract version. */
export const PACK_VERSION = "0.1" as const;

/** Normalized component kinds so 2B can map them to infra deterministically. */
export const COMPONENT_TYPES = [
  "web",
  "api",
  "worker",
  "db",
  "queue",
  "cache",
  "object_storage",
  "auth_provider",
  "external_integration",
] as const;

/** Run lifecycle for minimal filesystem tracking (runs/index.json + run.json). */
export const RUN_STATUSES = [
  "created",
  "parsed",
  "clarified",
  "plan_generated",
  "decomposition_generated",
  "approved",
  "exported",
  "failed",
] as const;

/** Step names. */
export const RUN_STEPS = [
  "created",
  "parse",
  "clarify",
  "plan",
  "decompose",
  "approve",
  "export",
] as const;

/** Supported execution backends for workflow-driven agents. */
export const RUN_EXECUTION_BACKENDS = ["github_actions", "local_process"] as const;

/** Execution lifecycle for workflow-backed runs. */
export const RUN_EXECUTION_STATUSES = [
  "queued",
  "dispatched",
  "running",
  "succeeded",
  "failed",
] as const;

/** Initial workflow names supported by the execution contract. */
export const WORKFLOW_NAMES = [
  "phase1-planner",
  "phase1-architecture-refinement",
  "phase2-repo-provision",
  "phase2-decomposition",
  "phase2-implementation",
] as const;
