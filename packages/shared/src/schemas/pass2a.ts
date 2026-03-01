import { z } from "zod";
import { COMPONENT_TYPES, PACK_VERSION, RUN_STATUSES, RUN_STEPS } from "../constants";

/* ----------------------------- Shared enums ------------------------------ */

export const ComponentTypeSchema = z.enum(COMPONENT_TYPES);
export type ComponentType = z.infer<typeof ComponentTypeSchema>;

export const RunStatusSchema = z.enum(RUN_STATUSES);
export type RunStatus = z.infer<typeof RunStatusSchema>;

export const RunStepSchema = z.enum(RUN_STEPS);
export type RunStep = z.infer<typeof RunStepSchema>;

/* ----------------------------- Org Constraints --------------------------- */
/**
 * Org constraints are parsed from YAML (org.yml), validated BEFORE any model call,
 * and defaulted deterministically.
 */
export const OrgConstraintsSchema = z
  .object({
    strictness: z.enum(["strict", "prefer"]).default("prefer"),

    stack: z
      .object({
        language: z.enum(["typescript", "python", "java", "go"]).default("typescript"),
        web: z.enum(["nextjs", "react", "none"]).default("nextjs"),
        api: z.enum(["fastify", "express", "nestjs"]).default("fastify"),
        primary_db: z.enum(["postgres", "mysql", "sqlite", "dynamodb"]).default("postgres"),
      })
      .default({ language: "typescript", web: "nextjs", api: "fastify", primary_db: "postgres" }),

    cloud: z
      .object({
        provider: z.enum(["aws", "gcp", "azure", "none"]).default("aws"),
        allowed_services: z.array(z.string().min(1)).default(["rds", "s3", "sqs"]),
      })
      .default({ provider: "aws", allowed_services: ["rds", "s3", "sqs"] }),

    architecture_preference: z
      .enum(["monolith", "api_worker", "microservices", "no_preference"])
      .default("no_preference"),

    naming: z
      .object({
        service_prefix: z
          .string()
          .min(1)
          .max(32)
          .regex(/^[a-z][a-z0-9-]*$/)
          .default("pass"),
      })
      .default({ service_prefix: "pass" }),

    security: z
      .object({
        allow_public_db: z.boolean().default(false),
      })
      .default({ allow_public_db: false }),
  })
  .strict();

export type OrgConstraints = z.infer<typeof OrgConstraintsSchema>;

/* ---------------------------- Architecture Pack --------------------------- */

export const ClarificationSchema = z
  .object({
    id: z.string().min(1),
    question: z.string().min(1),
    answer: z.string().min(1),
    default_used: z.boolean().default(false),
    why_it_matters: z.string().min(1),
  })
  .strict();

export const WorkflowSchema = z
  .object({
    id: z.string().min(1),
    name: z.string().min(1),
    steps: z.array(z.string().min(1)).min(1),
  })
  .strict();

export const RequirementSchema = z
  .object({
    id: z.string().min(1),
    text: z.string().min(1),
    priority: z.enum(["must", "should", "could"]).default("must"),
    acceptance_criteria: z.array(z.string().min(1)).default([]),
  })
  .strict();

export const EntitySchema = z
  .object({
    name: z.string().min(1),
    fields: z.array(z.string().min(1)).default([]),
    notes: z.string().optional(),
  })
  .strict();

export const IntegrationSchema = z
  .object({
    name: z.string().min(1),
    purpose: z.string().min(1),
    direction: z.enum(["inbound", "outbound", "both"]).default("outbound"),
    criticality: z.enum(["low", "medium", "high"]).default("medium"),
    contract_stub: z.string().optional(),
  })
  .strict();

export const NfrsSchema = z
  .object({
    scale: z.enum(["small", "medium", "large"]).default("small"),
    availability: z.enum(["best_effort", "standard", "high"]).default("standard"),
    latency: z.enum(["relaxed", "standard", "low"]).default("standard"),
    data_sensitivity: z.enum(["none", "pii", "financial_like"]).default("none"),
    auditability: z.enum(["none", "basic", "strong"]).default("basic"),
  })
  .strict();

export const ArchitectureComponentSchema = z
  .object({
    name: z.string().min(1),
    type: ComponentTypeSchema,
  })
  .strict();

export const ArchitectureTradeoffsSchema = z
  .object({
    pros: z.array(z.string().min(1)).default([]),
    cons: z.array(z.string().min(1)).default([]),
    risks: z.array(z.string().min(1)).default([]),
  })
  .strict();

export const ArchitectureSchema = z
  .object({
    name: z.string().min(1),
    description: z.string().min(1),
    components: z.array(ArchitectureComponentSchema).min(1),
    data_flows: z.array(z.string().min(1)).default([]),
    data_stores: z.array(z.string().min(1)).default([]),
    async_patterns: z.array(z.string().min(1)).default([]),
    api_surface: z.array(z.string().min(1)).default([]),
    tradeoffs: ArchitectureTradeoffsSchema,
    rationale: z.string().min(1),
  })
  .strict();

export const LogicRequirementSchema = z
  .object({
    id: z.string().min(1),
    title: z.string().min(1),
    summary: z.string().min(1),
    priority: z.enum(["must", "should", "could"]).default("must"),
    acceptance_criteria: z.array(z.string().min(1)).default([]),
    affected_components: z.array(z.string().min(1)).default([]),
    dependencies: z.array(z.string().min(1)).default([]),
  })
  .strict();

export const GitHubIssuePlanItemSchema = z
  .object({
    id: z.string().min(1),
    title: z.string().min(1),
    summary: z.string().min(1),
    body: z.string().min(1),
    labels: z.array(z.string().min(1)).default([]),
    depends_on: z.array(z.string().min(1)).default([]),
    acceptance_criteria: z.array(z.string().min(1)).default([]),
  })
  .strict();

export const IaCHandoffSchema = z
  .object({
    summary: z.string().min(1),
    modules: z.array(z.string().min(1)).default([]),
  })
  .strict();

export const ImplementationCoordinationSchema = z
  .object({
    pause_on_pending_questions: z.boolean().default(true),
    live_issue_updates: z.boolean().default(true),
    coordination_views: z.array(z.string().min(1)).default([]),
    question_sources: z.array(z.string().min(1)).default([]),
  })
  .strict();

export const ImplementationObservabilitySchema = z
  .object({
    log_traces_enabled: z.boolean().default(true),
    coordination_panel_enabled: z.boolean().default(true),
    required_signals: z.array(z.string().min(1)).default([]),
    dashboard_panels: z.array(z.string().min(1)).default([]),
  })
  .strict();

export const ImplementationRailSchema = z
  .object({
    summary: z.string().min(1),
    iac_handoff: IaCHandoffSchema,
    logic_requirements: z.array(LogicRequirementSchema).default([]),
    github_issue_plan: z.array(GitHubIssuePlanItemSchema).default([]),
    coordination: ImplementationCoordinationSchema,
    observability: ImplementationObservabilitySchema,
  })
  .strict();

export const RefinementSchema = z
  .object({
    wireframe: z
      .object({
        enabled: z.boolean().default(true),
        editable_components: z.array(z.string().min(1)).default([]),
      })
      .strict()
      .default({ enabled: true, editable_components: [] }),
    chat: z
      .object({
        enabled: z.boolean().default(true),
        suggested_questions: z.array(z.string().min(1)).default([]),
        editable_topics: z.array(z.string().min(1)).default([]),
      })
      .strict()
      .default({ enabled: true, suggested_questions: [], editable_topics: [] }),
  })
  .strict()
  .default({
    wireframe: { enabled: true, editable_components: [] },
    chat: { enabled: true, suggested_questions: [], editable_topics: [] },
  });

export const CoverageItemSchema = z
  .object({
    requirement_id: z.string().min(1),
    status: z.enum(["covered", "partial", "missing"]),
    notes: z.string().optional(),
  })
  .strict();

export const TraceItemSchema = z
  .object({
    requirement_id: z.string().min(1),
    source_hint: z.string().min(1),
  })
  .strict();

export const ArchitecturePackSchema = z
  .object({
    pack_version: z.literal(PACK_VERSION),
    run_id: z.uuid(),
    created_at: z.iso.datetime(),

    tool: z
      .object({
        name: z.literal("PASS-2A"),
        version: z.string().min(1),
      })
      .strict(),

    prd: z
      .object({
        title: z.string().optional(),
        raw_text: z.string().min(1),
        summary: z.string().min(1),
      })
      .strict(),

    org_constraints: OrgConstraintsSchema,

    clarifications: z.array(ClarificationSchema).default([]),
    actors: z.array(z.string().min(1)).default([]),
    workflows: z.array(WorkflowSchema).default([]),
    requirements: z.array(RequirementSchema).default([]),
    entities: z.array(EntitySchema).default([]),
    integrations: z.array(IntegrationSchema).default([]),
    nfrs: NfrsSchema,

    architecture: ArchitectureSchema,
    refinement: RefinementSchema,
    implementation: ImplementationRailSchema,

    assumptions: z.array(z.string().min(1)).default([]),
    open_questions: z.array(z.string().min(1)).default([]),
    coverage: z.array(CoverageItemSchema).default([]),
    trace: z.array(TraceItemSchema).default([]),
  })
  .strict();

export type ArchitecturePack = z.infer<typeof ArchitecturePackSchema>;
