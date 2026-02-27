// packages/shared/src/schemas/pass2a.ts
import { z } from "zod";
import { COMPONENT_TYPES, OPTION_IDS, PACK_VERSION, RUN_STATUSES, RUN_STEPS } from "../constants";

/* ----------------------------- Shared enums ------------------------------ */

export const OptionIdSchema = z.enum(OPTION_IDS);
export type OptionId = z.infer<typeof OptionIdSchema>;

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

// ClarificationSchema: minimal Q&A that resolves architecture-shaping ambiguities
export const ClarificationSchema = z
  .object({
    id: z.string().min(1), // CLAR-001
    question: z.string().min(1),
    answer: z.string().min(1),
    default_used: z.boolean().default(false),
    why_it_matters: z.string().min(1),
  })
  .strict();

// Workflows extracted from PRD (keeps architecture grounded in real flows).
export const WorkflowSchema = z
  .object({
    id: z.string().min(1), // WF-001
    name: z.string().min(1),
    steps: z.array(z.string().min(1)).min(1),
  })
  .strict();

// Functional requirements (must/should/could) + lightweight acceptance checks.
export const RequirementSchema = z
  .object({
    id: z.string().min(1), // REQ-001
    text: z.string().min(1),
    priority: z.enum(["must", "should", "could"]).default("must"),
    acceptance_criteria: z.array(z.string().min(1)).default([]),
  })
  .strict();

// High-level domain entities (conceptual model, not a DB schema).
export const EntitySchema = z
  .object({
    name: z.string().min(1),
    fields: z.array(z.string().min(1)).default([]),
    notes: z.string().optional(),
  })
  .strict();

// Integrations + their purpose and importance (direction + criticality helps drive retries/queues tradeoffs).
export const IntegrationSchema = z
  .object({
    name: z.string().min(1),
    purpose: z.string().min(1),
    direction: z.enum(["inbound", "outbound", "both"]).default("outbound"),
    criticality: z.enum(["low", "medium", "high"]).default("medium"),
    contract_stub: z.string().optional(),
  })
  .strict();

// Non-functional requirements that drive architecture choices
export const NfrsSchema = z
  .object({
    scale: z.enum(["small", "medium", "large"]).default("small"),
    availability: z.enum(["best_effort", "standard", "high"]).default("standard"),
    latency: z.enum(["relaxed", "standard", "low"]).default("standard"),
    data_sensitivity: z.enum(["none", "pii", "financial_like"]).default("none"),
    auditability: z.enum(["none", "basic", "strong"]).default("basic"),
  })
  .strict();

// A normalized component in an option: a named component + its normalized type (so 2B can map to infra ~ ).
export const ArchitectureComponentSchema = z
  .object({
    name: z.string().min(1),
    type: ComponentTypeSchema,
  })
  .strict();

// An architecture option (A/B/C) with its components, tradeoffs, and rationale.
export const ArchitectureOptionSchema = z
  .object({
    option_id: OptionIdSchema,
    name: z.string().min(1),
    components: z.array(ArchitectureComponentSchema).min(1),

    data_stores: z.array(z.string().min(1)).default([]),
    async_patterns: z.array(z.string().min(1)).default([]),

    api_surface: z.array(z.string().min(1)).default([]),

    tradeoffs: z
      .object({
        pros: z.array(z.string().min(1)).default([]),
        cons: z.array(z.string().min(1)).default([]),
        risks: z.array(z.string().min(1)).default([]),
      })
      .strict(),

    when_to_choose: z.string().min(1),
  })
  .strict();

// Required human selection gate for choosing the final option
export const SelectionSchema = z
  .object({
    selected_option_id: OptionIdSchema,
    selected_by: z.literal("human").default("human"),
    reason: z.string().optional(),
    timestamp: z.string().datetime(),
  })
  .strict();

// Mapping the coverage status of each requirement (prove key needs weren't ignored)
export const CoverageItemSchema = z
  .object({
    requirement_id: z.string().min(1),
    status: z.enum(["covered", "partial", "missing"]),
    notes: z.string().optional(),
  })
  .strict();

// Light trace linking requirements back to PRD hints
export const TraceItemSchema = z
  .object({
    requirement_id: z.string().min(1),
    source_hint: z.string().min(1),
  })
  .strict();

// 2–3 options only; unique option_ids; stable A->B->C order
const ArchitectureOptionsSchema = z
  .array(ArchitectureOptionSchema)
  .min(2)
  .max(3)
  .superRefine((opts, ctx) => {
    const ids = opts.map((o) => o.option_id);
    const unique = new Set(ids);
    if (unique.size !== ids.length) {
      ctx.addIssue({
        code: "custom",
        message: "architecture_options must not contain duplicate option_id values",
      });
    }

    const expectedOrder = OPTION_IDS.filter((id) => unique.has(id));
    const sameOrder =
      ids.length === expectedOrder.length && ids.every((id, i) => id === expectedOrder[i]);

    if (!sameOrder) {
      ctx.addIssue({
        code: "custom",
        message: `architecture_options must be ordered deterministically as ${expectedOrder.join(
          ", "
        )}`,
      });
    }
  });

// The exported 2A→2B contract: deterministic, schema-validated Architecture Pack.
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

    architecture_options: ArchitectureOptionsSchema,
    selection: SelectionSchema,

    assumptions: z.array(z.string().min(1)).default([]),
    open_questions: z.array(z.string().min(1)).default([]),
    coverage: z.array(CoverageItemSchema).default([]),
    trace: z.array(TraceItemSchema).default([]),
  })
  .strict()
  .superRefine((pack, ctx) => {
    const optionIds = new Set(pack.architecture_options.map((o) => o.option_id));
    if (!optionIds.has(pack.selection.selected_option_id)) {
      ctx.addIssue({
        code: "custom",
        path: ["selection", "selected_option_id"],
        message: "selection.selected_option_id must match an option in architecture_options",
      });
    }
  });

export type ArchitecturePack = z.infer<typeof ArchitecturePackSchema>;