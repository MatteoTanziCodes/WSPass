// packages/shared/src/constants.ts

/** PASS Architecture Pack contract version. */
export const PACK_VERSION = "0.1" as const;

/** Architecture options are always A/B/C for deterministic comparisons. */
export const OPTION_IDS = ["A", "B", "C"] as const;

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
  "options_generated",
  "selected",
  "exported",
  "failed",
] as const;

/** Step names. */
export const RUN_STEPS = ["created", "parse", "clarify", "options", "select", "export"] as const;
