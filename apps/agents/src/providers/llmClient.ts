import { stringify as stringifyYaml } from "yaml";
import { z } from "zod";
import {
  ArchitecturePackSchema,
  DecompositionGapSchema,
  DecompositionPlanSchema,
  DecompositionWorkItemSchema,
  DesignGuidelinesSchema,
  OrgConstraintsSchema,
  PACK_VERSION,
  ProjectContextSchema,
  type ArchitecturePack,
  type ProjectContext,
  type DesignGuidelines,
  type DecompositionPlan,
  type OrgConstraints,
} from "@pass/shared";

const TOOL_VERSION = process.env.PASS_2A_VERSION ?? "0.1.0";

const DraftPrdCoreSchema = z.object({
  prd: z.object({
    title: z.string().optional(),
    summary: z.string(),
  }),
  actors: z.array(z.string()).default([]),
});

const DraftClarificationSchema = z.object({
  id: z.string().optional(),
  question: z.string(),
  answer: z.string().optional(),
  default_used: z.boolean().optional(),
  why_it_matters: z.string().optional(),
  impact: z.string().optional(),
});

const DraftWorkflowSchema = z.object({
  id: z.string().optional(),
  name: z.string(),
  steps: z.array(z.string()).default([]),
});

const DraftRequirementSchema = z.object({
  id: z.string().optional(),
  text: z.string().optional(),
  title: z.string().optional(),
  summary: z.string().optional(),
  description: z.string().optional(),
  priority: z.enum(["must", "should", "could"]).optional(),
  acceptance_criteria: z.array(z.string()).default([]),
});

const DraftEntitySchema = z.object({
  name: z.string(),
  fields: z.array(z.string()).default([]),
  notes: z.string().optional(),
});

const DraftIntegrationSchema = z.object({
  name: z.string(),
  purpose: z.string(),
  direction: z.enum(["inbound", "outbound", "both"]).optional(),
  criticality: z.enum(["low", "medium", "high"]).optional(),
  contract_stub: z.string().optional(),
});

const DraftNfrsSchema = z.object({
  scale: z.enum(["small", "medium", "large"]).optional(),
  availability: z.enum(["best_effort", "standard", "high"]).optional(),
  latency: z.enum(["relaxed", "standard", "low"]).optional(),
  data_sensitivity: z.enum(["none", "pii", "financial_like"]).optional(),
  auditability: z.enum(["none", "basic", "strong"]).optional(),
});

const DraftDomainSchema = z.object({
  entities: z.array(DraftEntitySchema).default([]),
  integrations: z.array(DraftIntegrationSchema).default([]),
  nfrs: DraftNfrsSchema,
  assumptions: z.array(z.string()).default([]),
  open_questions: z.array(z.string()).default([]),
});

const DraftArchitectureSchema = z.object({
  name: z.string(),
  description: z.string(),
  components: z.array(
    z.object({
      name: z.string(),
      type: z.enum([
        "web",
        "api",
        "worker",
        "db",
        "queue",
        "cache",
        "object_storage",
        "auth_provider",
        "external_integration",
      ]),
    })
  ),
  data_flows: z.array(z.string()).default([]),
  data_stores: z.array(z.string()).default([]),
  async_patterns: z.array(z.string()).default([]),
  api_surface: z.array(z.string()).default([]),
  tradeoffs: z.object({
    pros: z.array(z.string()).default([]),
    cons: z.array(z.string()).default([]),
    risks: z.array(z.string()).default([]),
  }),
  rationale: z.string(),
});

const DraftRefinementSchema = z.object({
  wireframe: z
    .object({
      enabled: z.boolean().optional(),
      editable_components: z.array(z.string()).default([]),
    })
    .default({ editable_components: [] }),
  chat: z
    .object({
      enabled: z.boolean().optional(),
      suggested_questions: z.array(z.string()).default([]),
      editable_topics: z.array(z.string()).default([]),
    })
    .default({ suggested_questions: [], editable_topics: [] }),
});

const DraftImplementationOverviewSchema = z.object({
  summary: z.string(),
  iac_handoff: z.object({
    summary: z.string(),
    modules: z.array(z.string()).default([]),
  }),
  coordination: z.object({
    pause_on_pending_questions: z.boolean().optional(),
    live_issue_updates: z.boolean().optional(),
    coordination_views: z.array(z.string()).default([]),
    question_sources: z.array(z.string()).default([]),
  }),
  observability: z.object({
    log_traces_enabled: z.boolean().optional(),
    coordination_panel_enabled: z.boolean().optional(),
    required_signals: z.array(z.string()).default([]),
    dashboard_panels: z.array(z.string()).default([]),
  }),
});

const DraftCoverageTraceSchema = z.object({
  coverage: z
    .array(
      z.object({
        requirement_id: z.string(),
        status: z.enum(["covered", "partial", "missing"]),
        notes: z.string().optional(),
      })
    )
    .default([]),
  trace: z
    .array(
      z.object({
        requirement_id: z.string(),
        source_hint: z.string(),
      })
    )
    .default([]),
});

type GenerateArchitecturePackInput = {
  runId: string;
  prdText: string;
  normalizedPrdYaml: string;
  orgConstraints: OrgConstraints;
  normalizedOrgConstraintsYaml: string;
  designGuidelines: DesignGuidelines;
  normalizedDesignGuidelinesYaml: string;
};

type RefineArchitecturePackInput = {
  currentPack: ArchitecturePack;
  messages: Array<{ role: "user" | "assistant" | "system"; content: string }>;
};

const RefinementPlanningUpdateSchema = z.object({
  clarifications: z.array(DraftClarificationSchema).default([]),
  workflows: z.array(DraftWorkflowSchema).default([]),
  requirements: z.array(DraftRequirementSchema).default([]),
});

const RefinementDomainCoreUpdateSchema = z.object({
  entities: z.array(DraftEntitySchema).default([]),
  integrations: z.array(DraftIntegrationSchema).default([]),
});

const RefinementDomainNfrUpdateSchema = z.object({
  nfrs: DraftNfrsSchema,
});

const RefinementDomainDecisionUpdateSchema = z.object({
  assumptions: z.array(z.string()).default([]),
  open_questions: z.array(z.string()).default([]),
});

const ArchitectureFragmentSchema = z.object({
  name: z.string().optional(),
  description: z.string().optional(),
  components: DraftArchitectureSchema.shape.components.optional(),
  data_flows: z.array(z.string()).optional(),
  data_stores: z.array(z.string()).optional(),
  async_patterns: z.array(z.string()).optional(),
  api_surface: z.array(z.string()).optional(),
  tradeoffs: DraftArchitectureSchema.shape.tradeoffs.optional(),
  rationale: z.string().optional(),
});

const ArchitectureCoreUpdateSchema = z.object({
  name: z.string().optional(),
  description: z.string().optional(),
  components: DraftArchitectureSchema.shape.components.optional(),
});

const ArchitectureTopologyUpdateSchema = z.object({
  data_flows: z.array(z.string()).optional(),
  data_stores: z.array(z.string()).optional(),
  async_patterns: z.array(z.string()).optional(),
  api_surface: z.array(z.string()).optional(),
});

const ArchitectureTradeoffsUpdateSchema = z.object({
  tradeoffs: DraftArchitectureSchema.shape.tradeoffs.optional(),
  rationale: z.string().optional(),
});

const RefinementFragmentSchema = z.object({
  wireframe: DraftRefinementSchema.shape.wireframe.optional(),
  chat: DraftRefinementSchema.shape.chat.optional(),
});

const RefinementSectionUpdateSchema = z.object({
  refinement: RefinementFragmentSchema.optional(),
  wireframe: RefinementFragmentSchema.shape.wireframe,
  chat: RefinementFragmentSchema.shape.chat,
});

type GenerateDecompositionPlanInput = {
  pack: ArchitecturePack;
};

type GenerateDecompositionIteratorReviewInput = {
  pack: ArchitecturePack;
  projectContext: ProjectContext;
  plan: DecompositionPlan;
  coverageSnapshot: Array<{
    target_id: string;
    target_type:
      | "requirement"
      | "workflow"
      | "component"
      | "integration"
      | "data_store"
      | "async_pattern"
      | "api_surface";
    summary: string;
    covered_by: string[];
    status: "covered" | "partial" | "missing";
  }>;
  iteration: number;
};

const DecompositionBatchSchema = z.object({
  work_items: z.array(DecompositionWorkItemSchema).default([]),
});

const DecompositionBaseTaskCategorySchema = z.enum([
  "frontend",
  "backend",
  "infra",
  "data",
  "docs",
  "ops",
]);

const DecompositionBaseTaskSchema = z.object({
  id: z.string().optional(),
  title: z.string(),
  summary: z.string(),
  component: z.string(),
  category: DecompositionBaseTaskCategorySchema.optional(),
  depends_on: z.array(z.string()).default([]),
  focus_areas: z.array(z.string()).default([]),
});

const DecompositionBaseTaskPlanSchema = z.object({
  base_tasks: z.array(DecompositionBaseTaskSchema).default([]),
});

const IteratorQuestionDraftSchema = z.object({
  prompt: z.string(),
  rationale: z.string(),
  related_requirement_ids: z.array(z.string()).default([]),
  related_components: z.array(z.string()).default([]),
});

const DecompositionIteratorReviewSchema = z.object({
  summary: z.string(),
  gaps: z.array(DecompositionGapSchema).default([]),
  questions: z.array(IteratorQuestionDraftSchema).default([]),
  proposed_work_items: z.array(DecompositionWorkItemSchema).default([]),
});

const NormalizedPrdSchema = z.object({
  title: z.string().min(1),
  summary: z.string().min(1),
  goals: z.array(z.string()).default([]),
  actors: z.array(z.string()).default([]),
  capabilities: z.array(z.string()).default([]),
  constraints: z.array(z.string()).default([]),
  nfrs: z.array(z.string()).default([]),
  integrations: z.array(z.string()).default([]),
  rollout_notes: z.array(z.string()).default([]),
});

const NormalizedDesignGuidelinesSchema = DesignGuidelinesSchema;

type AnthropicCompletion = {
  text: string;
  stopReason: string | null;
};

type AnthropicMessage = {
  role: "user" | "assistant";
  content: string;
};

type AnthropicReservation = {
  timestamp: number;
  inputTokens: number;
};

const ANTHROPIC_RATE_WINDOW_MS = 60_000;
let anthropicSchedulingLock: Promise<void> = Promise.resolve();
const anthropicState = {
  reservations: [] as AnthropicReservation[],
  activeRequests: 0,
};

class AnthropicRateLimitError extends Error {
  retryAfterMs: number;

  constructor(message: string, retryAfterMs: number) {
    super(message);
    this.name = "AnthropicRateLimitError";
    this.retryAfterMs = retryAfterMs;
  }
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function withAnthropicSchedulingLock<T>(fn: () => Promise<T> | T): Promise<T> {
  const previous = anthropicSchedulingLock;
  let release!: () => void;
  anthropicSchedulingLock = new Promise<void>((resolve) => {
    release = resolve;
  });
  await previous;
  try {
    return await fn();
  } finally {
    release();
  }
}

function getAnthropicInputTokenBudget() {
  return Math.max(1_000, Number(process.env.ANTHROPIC_INPUT_TOKENS_PER_MINUTE ?? "24000"));
}

function getAnthropicMaxConcurrentRequests() {
  return Math.max(1, Number(process.env.ANTHROPIC_MAX_CONCURRENT_REQUESTS ?? "2"));
}

function getAnthropicBatchConcurrency() {
  return Math.max(1, Number(process.env.ANTHROPIC_BATCH_CONCURRENCY ?? "2"));
}

function pruneAnthropicReservations(now = Date.now()) {
  anthropicState.reservations = anthropicState.reservations.filter(
    (entry) => now - entry.timestamp < ANTHROPIC_RATE_WINDOW_MS
  );
}

function estimateAnthropicInputTokens(payload: unknown) {
  const serialized = typeof payload === "string" ? payload : JSON.stringify(payload);
  const trimmed = serialized.trim();
  if (!trimmed) {
    return 64;
  }

  const wordEstimate = trimmed.split(/\s+/).filter(Boolean).length;
  const charEstimate = Math.ceil(trimmed.length / 3);
  return Math.max(64, Math.ceil(Math.max(wordEstimate * 1.2, charEstimate) * 1.15));
}

async function reserveAnthropicInputBudget(inputTokens: number) {
  const budget = getAnthropicInputTokenBudget();
  const requiredTokens = Math.min(Math.max(64, inputTokens), budget);

  while (true) {
    const waitMs = await withAnthropicSchedulingLock(() => {
      const now = Date.now();
      pruneAnthropicReservations(now);

      const usedTokens = anthropicState.reservations.reduce(
        (total, entry) => total + entry.inputTokens,
        0
      );

      if (usedTokens + requiredTokens <= budget) {
        anthropicState.reservations.push({
          timestamp: now,
          inputTokens: requiredTokens,
        });
        return 0;
      }

      const oldestReservation = anthropicState.reservations[0];
      if (!oldestReservation) {
        return 250;
      }

      return Math.max(250, ANTHROPIC_RATE_WINDOW_MS - (now - oldestReservation.timestamp) + 25);
    });

    if (waitMs <= 0) {
      return;
    }

    await sleep(waitMs);
  }
}

async function acquireAnthropicConcurrencySlot() {
  const maxConcurrentRequests = getAnthropicMaxConcurrentRequests();

  while (true) {
    const acquired = await withAnthropicSchedulingLock(() => {
      if (anthropicState.activeRequests >= maxConcurrentRequests) {
        return false;
      }

      anthropicState.activeRequests += 1;
      return true;
    });

    if (acquired) {
      let released = false;
      return async () => {
        if (released) {
          return;
        }
        released = true;
        await withAnthropicSchedulingLock(() => {
          anthropicState.activeRequests = Math.max(0, anthropicState.activeRequests - 1);
        });
      };
    }

    await sleep(150);
  }
}

function parseRetryAfterMs(headers: Headers) {
  const retryAfterMsHeader = headers.get("retry-after-ms");
  if (retryAfterMsHeader) {
    const parsed = Number(retryAfterMsHeader);
    if (Number.isFinite(parsed) && parsed > 0) {
      return parsed;
    }
  }

  const retryAfterHeader = headers.get("retry-after");
  if (retryAfterHeader) {
    const parsedSeconds = Number(retryAfterHeader);
    if (Number.isFinite(parsedSeconds) && parsedSeconds > 0) {
      return Math.ceil(parsedSeconds * 1000);
    }

    const parsedDate = Date.parse(retryAfterHeader);
    if (Number.isFinite(parsedDate)) {
      return Math.max(1000, parsedDate - Date.now());
    }
  }

  for (const headerName of [
    "anthropic-ratelimit-input-tokens-reset",
    "anthropic-ratelimit-tokens-reset",
    "anthropic-ratelimit-requests-reset",
  ]) {
    const headerValue = headers.get(headerName);
    if (!headerValue) {
      continue;
    }

    const parsedSeconds = Number(headerValue);
    if (Number.isFinite(parsedSeconds) && parsedSeconds > 0) {
      return Math.ceil(parsedSeconds * 1000);
    }

    const parsedDate = Date.parse(headerValue);
    if (Number.isFinite(parsedDate)) {
      return Math.max(1000, parsedDate - Date.now());
    }
  }

  return null;
}

async function runAnthropicRequest<T>(
  payload: Record<string, unknown>,
  parseResponse: (response: any) => T
): Promise<T> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error("ANTHROPIC_API_KEY is required.");
  }

  const responseUrl = `${process.env.ANTHROPIC_BASE_URL ?? "https://api.anthropic.com/v1"}/messages`;
  const version = process.env.ANTHROPIC_VERSION ?? "2023-06-01";
  const timeoutMs = Number(process.env.ANTHROPIC_TIMEOUT_MS ?? "45000");
  const maxAttempts = Math.max(1, Number(process.env.ANTHROPIC_MAX_RETRY_ATTEMPTS ?? "4"));
  const baseRetryMs = Math.max(500, Number(process.env.ANTHROPIC_RETRY_BASE_MS ?? "2000"));
  const inputTokens = estimateAnthropicInputTokens(payload);

  let lastError: Error | null = null;

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    await reserveAnthropicInputBudget(inputTokens);
    const releaseSlot = await acquireAnthropicConcurrencySlot();

    try {
      const response = await fetch(responseUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": apiKey,
          "anthropic-version": version,
        },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(timeoutMs),
      });

      if (response.status === 429) {
        const body = await response.text();
        const retryAfterMs = parseRetryAfterMs(response.headers) ?? baseRetryMs * (attempt + 1);
        throw new AnthropicRateLimitError(
          `Anthropic request failed with 429: ${body || response.statusText}`,
          retryAfterMs
        );
      }

      if (!response.ok) {
        const body = await response.text();
        throw new Error(`Anthropic request failed with ${response.status}: ${body || response.statusText}`);
      }

      return parseResponse(await response.json());
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      if (lastError instanceof AnthropicRateLimitError && attempt < maxAttempts - 1) {
        const jitterMs = Math.floor(Math.random() * 350);
        await sleep(lastError.retryAfterMs + jitterMs);
        continue;
      }
      throw lastError;
    } finally {
      await releaseSlot();
    }
  }

  throw lastError ?? new Error("Anthropic request failed.");
}

async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  mapper: (item: T, index: number) => Promise<R>
) {
  const limitedConcurrency = Math.max(1, Math.min(concurrency, items.length || 1));
  const results = new Array<R>(items.length);
  let nextIndex = 0;

  await Promise.all(
    Array.from({ length: limitedConcurrency }, async () => {
      while (true) {
        const currentIndex = nextIndex;
        nextIndex += 1;

        if (currentIndex >= items.length) {
          return;
        }

        results[currentIndex] = await mapper(items[currentIndex], currentIndex);
      }
    })
  );

  return results;
}

function resolveArchitectureSection(
  fragments: {
    core?: z.infer<typeof ArchitectureCoreUpdateSchema>;
    topology?: z.infer<typeof ArchitectureTopologyUpdateSchema>;
    tradeoffs?: z.infer<typeof ArchitectureTradeoffsUpdateSchema>;
  },
  fallback: z.infer<typeof DraftArchitectureSchema>
) {
  return DraftArchitectureSchema.parse({
    ...fallback,
    ...(fragments.core ?? {}),
    ...(fragments.topology ?? {}),
    ...(fragments.tradeoffs ?? {}),
    name: fragments.core?.name ?? fallback.name,
    description: fragments.core?.description ?? fallback.description,
    components: fragments.core?.components ?? fallback.components,
    data_flows: fragments.topology?.data_flows ?? fallback.data_flows,
    data_stores: fragments.topology?.data_stores ?? fallback.data_stores,
    async_patterns: fragments.topology?.async_patterns ?? fallback.async_patterns,
    api_surface: fragments.topology?.api_surface ?? fallback.api_surface,
    tradeoffs: fragments.tradeoffs?.tradeoffs ?? fallback.tradeoffs,
    rationale: fragments.tradeoffs?.rationale ?? fallback.rationale,
  });
}

function resolveRefinementSection(
  value: z.infer<typeof RefinementSectionUpdateSchema>,
  fallback: z.infer<typeof DraftRefinementSchema>
) {
  return DraftRefinementSchema.parse({
    ...fallback,
    ...(value.refinement ?? {}),
    wireframe: value.wireframe ?? value.refinement?.wireframe ?? fallback.wireframe,
    chat: value.chat ?? value.refinement?.chat ?? fallback.chat,
  });
}

function compactJson(value: unknown) {
  return JSON.stringify(value);
}

function uniqueStrings(values: string[]) {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function limitArray<T>(values: T[], limit: number) {
  return values.slice(0, limit);
}

function normalizeText(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9\s]+/g, " ");
}

const SECTION_STOP_WORDS = new Set([
  "the",
  "and",
  "for",
  "with",
  "that",
  "this",
  "from",
  "into",
  "when",
  "then",
  "will",
  "have",
  "must",
  "should",
  "could",
  "using",
  "used",
  "user",
  "users",
  "page",
  "flow",
  "data",
  "support",
  "allow",
  "build",
  "make",
  "project",
  "system",
  "work",
  "item",
  "implementation",
]);

function tokens(value: string) {
  return [
    ...new Set(
      normalizeText(value)
        .split(/\s+/)
        .filter((token) => token.length > 2 && !SECTION_STOP_WORDS.has(token))
    ),
  ];
}

function buildSectionSystemPrompt(title: string, limits: string[]) {
  return [
    `You are PASS-2A generating the ${title} section of a planning pack.`,
    "Return exactly one JSON object.",
    "Do not use markdown.",
    "Do not add explanatory text.",
    "Do not add keys that were not requested.",
    "Keep strings short and concrete.",
    ...limits,
  ].join("\n");
}

function buildPrdCorePrompt(input: GenerateArchitecturePackInput) {
  return [
    'Return JSON with this exact shape: {"prd":{"title":"optional short title","summary":"one sentence"},"actors":["actor"]}',
    "Use at most 4 actors.",
    "Normalized PRD YAML:",
    input.normalizedPrdYaml,
    "Org constraints JSON:",
    compactJson(input.orgConstraints),
    "Design guidelines JSON:",
    compactJson(input.designGuidelines),
    "PRD text:",
    input.prdText,
  ].join("\n");
}

function buildClarificationsPrompt(input: GenerateArchitecturePackInput) {
  return [
    'Return JSON with this exact shape: {"clarifications":[{"id":"c1","question":"...","answer":"default assumption","default_used":true,"why_it_matters":"..."}]}',
    "Return 3 to 5 architecture-shaping clarifications only.",
    "Use short IDs like c1, c2.",
    "If the PRD does not answer a question, set answer to a reasonable default assumption and default_used to true.",
    "Normalized PRD YAML:",
    input.normalizedPrdYaml,
    "PRD text:",
    input.prdText,
  ].join("\n");
}

function buildWorkflowsPrompt(
  core: z.infer<typeof DraftPrdCoreSchema>,
  clarifications: z.infer<typeof DraftClarificationSchema>[]
) {
  return [
    'Return JSON with this exact shape: {"workflows":[{"id":"wf1","name":"...","steps":["..."]}]}',
    "Return at most 4 workflows.",
    "Each workflow must have 3 to 5 short steps.",
    "Context:",
    compactJson({ prd: core.prd, actors: core.actors, clarifications }),
  ].join("\n");
}

function buildRequirementsPrompt(
  input: GenerateArchitecturePackInput,
  core: z.infer<typeof DraftPrdCoreSchema>,
  workflows: z.infer<typeof DraftWorkflowSchema>[]
) {
  return [
    'Return JSON with this exact shape: {"requirements":[{"id":"req_1","text":"...","priority":"must","acceptance_criteria":["..."]}]}',
    "Return 5 to 10 implementation-relevant requirements only.",
    "Use priority only from must, should, could.",
    "Each requirement text must be one sentence.",
    "Each requirement may have 0 to 2 acceptance criteria.",
    "Context:",
    compactJson({
      prd: core.prd,
      actors: core.actors,
      workflows,
      org_constraints: input.orgConstraints,
      design_guidelines: input.designGuidelines,
      normalized_prd_yaml: input.normalizedPrdYaml,
      normalized_org_constraints_yaml: input.normalizedOrgConstraintsYaml,
      normalized_design_guidelines_yaml: input.normalizedDesignGuidelinesYaml,
    }),
    "PRD text:",
    input.prdText,
  ].join("\n");
}

function buildDomainPrompt(
  input: GenerateArchitecturePackInput,
  core: z.infer<typeof DraftPrdCoreSchema>,
  requirements: z.infer<typeof DraftRequirementSchema>[]
) {
  return [
    'Return JSON with this exact shape: {"entities":[{"name":"...","fields":["..."],"notes":"optional"}],"integrations":[{"name":"...","purpose":"...","direction":"outbound","criticality":"medium","contract_stub":"optional"}],"nfrs":{"scale":"small","availability":"standard","latency":"standard","data_sensitivity":"none","auditability":"basic"},"assumptions":["..."],"open_questions":["..."]}',
    "Use integration.direction only from inbound, outbound, both.",
    "Use integration.criticality only from low, medium, high.",
    "Return at most 6 entities, 6 integrations, 5 assumptions, and 5 open questions.",
    "Context:",
    compactJson({
      prd: core.prd,
      requirements,
      org_constraints: input.orgConstraints,
      design_guidelines: input.designGuidelines,
      normalized_prd_yaml: input.normalizedPrdYaml,
      normalized_org_constraints_yaml: input.normalizedOrgConstraintsYaml,
      normalized_design_guidelines_yaml: input.normalizedDesignGuidelinesYaml,
    }),
  ].join("\n");
}

function buildArchitecturePrompt(
  input: GenerateArchitecturePackInput,
  core: z.infer<typeof DraftPrdCoreSchema>,
  workflows: z.infer<typeof DraftWorkflowSchema>[],
  requirements: z.infer<typeof DraftRequirementSchema>[],
  domain: z.infer<typeof DraftDomainSchema>
) {
  return [
    'Return JSON with this exact shape: {"name":"...","description":"...","components":[{"name":"...","type":"api"}],"data_flows":["..."],"data_stores":["..."],"async_patterns":["..."],"api_surface":["..."],"tradeoffs":{"pros":["..."],"cons":["..."],"risks":["..."]},"rationale":"..."}',
    "Generate exactly one architecture.",
    "Use component.type only from web, api, worker, db, queue, cache, object_storage, auth_provider, external_integration.",
    "Return 4 to 8 components.",
    "Keep data_flows, data_stores, async_patterns, and api_surface to at most 6 items each.",
    "Context:",
    compactJson({
      prd: core.prd,
      actors: core.actors,
      workflows,
      requirements,
      domain,
      org_constraints: input.orgConstraints,
      design_guidelines: input.designGuidelines,
      normalized_prd_yaml: input.normalizedPrdYaml,
      normalized_org_constraints_yaml: input.normalizedOrgConstraintsYaml,
      normalized_design_guidelines_yaml: input.normalizedDesignGuidelinesYaml,
    }),
  ].join("\n");
}

function buildRefinementPrompt(
  requirements: z.infer<typeof DraftRequirementSchema>[],
  architecture: z.infer<typeof DraftArchitectureSchema>
) {
  return [
    'Return JSON with this exact shape: {"wireframe":{"enabled":true,"editable_components":["..."]},"chat":{"enabled":true,"suggested_questions":["..."],"editable_topics":["..."]}}',
    "Return at most 5 editable components, 5 suggested questions, and 5 editable topics.",
    "Context:",
    compactJson({
      requirements: requirements.map((item) => item.text ?? item.title ?? ""),
      architecture: {
        name: architecture.name,
        components: architecture.components,
      },
    }),
  ].join("\n");
}

function buildImplementationOverviewPrompt(
  architecture: z.infer<typeof DraftArchitectureSchema>,
  refinement: z.infer<typeof DraftRefinementSchema>,
  requirements: z.infer<typeof DraftRequirementSchema>[],
  openQuestions: string[]
) {
  return [
    'Return JSON with this exact shape: {"summary":"...","iac_handoff":{"summary":"...","modules":["..."]},"coordination":{"pause_on_pending_questions":true,"live_issue_updates":true,"coordination_views":["..."],"question_sources":["..."]},"observability":{"log_traces_enabled":true,"coordination_panel_enabled":true,"required_signals":["..."],"dashboard_panels":["..."]}}',
    "Keep modules, coordination_views, question_sources, required_signals, and dashboard_panels to at most 6 items each.",
    "Context:",
    compactJson({
      requirements,
      architecture,
      refinement,
      open_questions: openQuestions,
    }),
  ].join("\n");
}

function buildCoverageTracePrompt(
  requirements: Array<{ id: string; text: string }>,
  architecture: z.infer<typeof DraftArchitectureSchema>,
  logicRequirements: Array<{ id: string; title: string }>,
  issuePlan: Array<{ id: string; title: string }>
) {
  return [
    'Return JSON with this exact shape: {"coverage":[{"requirement_id":"req_1","status":"covered","notes":"optional"}],"trace":[{"requirement_id":"req_1","source_hint":"..."}]}',
    "Use coverage.status only from covered, partial, missing.",
    "Return exactly one coverage item and one trace item for each requirement ID provided.",
    "Context:",
    compactJson({
      requirements,
      architecture: {
        name: architecture.name,
        components: architecture.components.map((item) => item.name),
      },
      logic_requirements: logicRequirements,
      github_issue_plan: issuePlan,
    }),
  ].join("\n");
}

function buildRefinementContext(input: RefineArchitecturePackInput) {
  const latestMessages = input.messages.slice(-8);
  return {
    prd: {
      title: input.currentPack.prd.title,
      summary: input.currentPack.prd.summary,
    },
    design_guidelines: input.currentPack.design_guidelines,
    clarifications: input.currentPack.clarifications.slice(0, 5),
    workflows: input.currentPack.workflows.slice(0, 4),
    requirements: input.currentPack.requirements.slice(0, 10),
    entities: input.currentPack.entities.slice(0, 6),
    integrations: input.currentPack.integrations.slice(0, 6),
    nfrs: input.currentPack.nfrs,
    architecture: input.currentPack.architecture,
    refinement: input.currentPack.refinement,
    implementation: {
      summary: input.currentPack.implementation.summary,
      iac_handoff: input.currentPack.implementation.iac_handoff,
      coordination: input.currentPack.implementation.coordination,
      observability: input.currentPack.implementation.observability,
    },
    assumptions: input.currentPack.assumptions.slice(0, 5),
    open_questions: input.currentPack.open_questions.slice(0, 5),
    latest_messages: latestMessages,
  };
}

function buildRefinementPlanningContext(input: RefineArchitecturePackInput) {
  return {
    prd: {
      title: input.currentPack.prd.title,
      summary: input.currentPack.prd.summary,
    },
    latest_messages: input.messages.slice(-6),
    clarifications: input.currentPack.clarifications.slice(0, 5),
    workflows: input.currentPack.workflows.slice(0, 4).map((workflow) => ({
      id: workflow.id,
      name: workflow.name,
      steps: workflow.steps.slice(0, 5),
    })),
    requirements: input.currentPack.requirements.slice(0, 10).map((requirement) => ({
      id: requirement.id,
      text: requirement.text,
      priority: requirement.priority,
      acceptance_criteria: requirement.acceptance_criteria.slice(0, 2),
    })),
    unresolved_open_questions: input.currentPack.open_questions.slice(0, 5),
  };
}

function buildRefinementDomainContext(input: RefineArchitecturePackInput) {
  return {
    prd: {
      title: input.currentPack.prd.title,
      summary: input.currentPack.prd.summary,
    },
    latest_messages: input.messages.slice(-6),
    requirements: input.currentPack.requirements.slice(0, 8).map((requirement) => ({
      id: requirement.id,
      text: requirement.text,
      priority: requirement.priority,
    })),
    entities: input.currentPack.entities.slice(0, 6),
    integrations: input.currentPack.integrations.slice(0, 6),
    nfrs: input.currentPack.nfrs,
    assumptions: input.currentPack.assumptions.slice(0, 5),
    open_questions: input.currentPack.open_questions.slice(0, 5),
    architecture_components: input.currentPack.architecture.components
      .slice(0, 8)
      .map((component) => ({
        name: component.name,
        type: component.type,
      })),
  };
}

function buildRefinementPlanningPrompt(input: RefineArchitecturePackInput) {
  return [
    'Return JSON with this exact shape: {"clarifications":[{"id":"c1","question":"...","answer":"...","default_used":false,"why_it_matters":"..."}],"workflows":[{"id":"wf1","name":"...","steps":["..."]}],"requirements":[{"id":"req_1","text":"...","priority":"must","acceptance_criteria":["..."]}]}',
    "Update only the clarification, workflow, and requirement context that should change because of the latest refinement conversation.",
    "Return the full remaining clarifications array after applying the latest user answers.",
    "If a clarification is now resolved, omit it from clarifications instead of keeping it as a defaulted item.",
    "Preserve stable IDs for clarifications, workflows, and requirements where possible.",
    "Return full arrays for the fields you include, not partial patches.",
    "Keep arrays short and concrete.",
    "Planning refinement context JSON:",
    compactJson(buildRefinementPlanningContext(input)),
  ].join("\n");
}

function buildRefinementDomainCorePrompt(input: RefineArchitecturePackInput) {
  return [
    'Return JSON with this exact shape: {"entities":[{"name":"...","fields":["..."],"notes":"optional"}],"integrations":[{"name":"...","purpose":"...","direction":"outbound","criticality":"medium","contract_stub":"optional"}]}',
    "Update only entities and integrations that should change because of the latest refinement conversation.",
    "Return full arrays for the fields you include, not partial patches.",
    "Keep arrays short and concrete.",
    "Domain refinement context JSON:",
    compactJson(buildRefinementDomainContext(input)),
  ].join("\n");
}

function buildRefinementDomainNfrPrompt(input: RefineArchitecturePackInput) {
  return [
    'Return JSON with this exact shape: {"nfrs":{"scale":"small","availability":"standard","latency":"standard","data_sensitivity":"none","auditability":"basic"}}',
    "Update only the NFR values that should change because of the latest refinement conversation.",
    "If NFRs did not change, return the current NFR values.",
    "Keep values concrete and minimal.",
    "Domain refinement context JSON:",
    compactJson(buildRefinementDomainContext(input)),
  ].join("\n");
}

function buildRefinementDomainDecisionPrompt(input: RefineArchitecturePackInput) {
  return [
    'Return JSON with this exact shape: {"assumptions":["..."],"open_questions":["..."]}',
    "Update only assumptions and open questions based on the latest refinement conversation.",
    "Use the latest user answers to resolve open questions and remove no-longer-needed assumptions.",
    "Return the full remaining open_questions array after applying the latest user answers.",
    "If all open questions are resolved, return an empty open_questions array.",
    "Keep arrays short and concrete.",
    "Domain refinement context JSON:",
    compactJson(buildRefinementDomainContext(input)),
  ].join("\n");
}

function buildArchitectureAssistantReplyPrompt(input: RefineArchitecturePackInput) {
  return [
    'Return JSON with this exact shape: {"assistant_response":"..."}',
    "Write like Claude replying directly in an architecture refinement chat.",
    "Acknowledge the user's requested changes and answer any direct product questions from the latest context.",
    "Do not claim the architecture pack was already updated.",
    "Do not claim an open question is resolved unless the current pack context clearly resolves it.",
    "If the current pack still has open_questions, call them out as pending instead of inventing a final decision.",
    "If there is remaining ambiguity, say so clearly.",
    "Keep it concise but useful.",
    "Current refinement context JSON:",
    compactJson(buildRefinementContext(input)),
  ].join("\n");
}

function buildArchitectureSectionRefinementPrompt(
  input: RefineArchitecturePackInput,
  scopeUpdate: {
    clarifications: z.infer<typeof DraftClarificationSchema>[];
    workflows: z.infer<typeof DraftWorkflowSchema>[];
    requirements: z.infer<typeof DraftRequirementSchema>[];
    entities: z.infer<typeof DraftEntitySchema>[];
    integrations: z.infer<typeof DraftIntegrationSchema>[];
    nfrs: z.infer<typeof DraftNfrsSchema>;
    assumptions: string[];
    open_questions: string[];
  }
) {
  return [
    'Return JSON with this exact shape: {"architecture":{"name":"...","description":"...","components":[{"name":"...","type":"api"}],"data_flows":["..."],"data_stores":["..."],"async_patterns":["..."],"api_surface":["..."],"tradeoffs":{"pros":["..."],"cons":["..."],"risks":["..."]},"rationale":"..."}}',
    "Rework the architecture to match the latest refinement conversation.",
    "Generate exactly one architecture.",
    "Use component.type only from web, api, worker, db, queue, cache, object_storage, auth_provider, external_integration.",
    "Return 4 to 8 components.",
    "Current refinement context JSON:",
    compactJson(buildRefinementContext(input)),
    "Updated scoped context JSON:",
    compactJson(scopeUpdate),
  ].join("\n");
}

function buildArchitectureRefinementContext(
  input: RefineArchitecturePackInput,
  scopeUpdate: {
    clarifications: z.infer<typeof DraftClarificationSchema>[];
    workflows: z.infer<typeof DraftWorkflowSchema>[];
    requirements: z.infer<typeof DraftRequirementSchema>[];
    entities: z.infer<typeof DraftEntitySchema>[];
    integrations: z.infer<typeof DraftIntegrationSchema>[];
    nfrs: z.infer<typeof DraftNfrsSchema>;
    assumptions: string[];
    open_questions: string[];
  }
) {
  return {
    prd: {
      title: input.currentPack.prd.title,
      summary: input.currentPack.prd.summary,
    },
    latest_messages: input.messages.slice(-6),
    current_architecture: {
      name: input.currentPack.architecture.name,
      description: input.currentPack.architecture.description,
      components: input.currentPack.architecture.components.slice(0, 8),
      data_flows: input.currentPack.architecture.data_flows.slice(0, 6),
      data_stores: input.currentPack.architecture.data_stores.slice(0, 6),
      async_patterns: input.currentPack.architecture.async_patterns.slice(0, 6),
      api_surface: input.currentPack.architecture.api_surface.slice(0, 6),
      tradeoffs: input.currentPack.architecture.tradeoffs,
      rationale: input.currentPack.architecture.rationale,
    },
    updated_scope: {
      requirements: scopeUpdate.requirements.slice(0, 8).map((item) => ({
        id: item.id,
        text: item.text,
        priority: item.priority,
      })),
      workflows: scopeUpdate.workflows.slice(0, 4).map((item) => ({
        id: item.id,
        name: item.name,
        steps: item.steps.slice(0, 5),
      })),
      entities: scopeUpdate.entities.slice(0, 6),
      integrations: scopeUpdate.integrations.slice(0, 6),
      nfrs: scopeUpdate.nfrs,
      assumptions: scopeUpdate.assumptions.slice(0, 5),
      open_questions: scopeUpdate.open_questions.slice(0, 5),
    },
  };
}

function buildArchitectureCoreRefinementPrompt(
  input: RefineArchitecturePackInput,
  scopeUpdate: {
    clarifications: z.infer<typeof DraftClarificationSchema>[];
    workflows: z.infer<typeof DraftWorkflowSchema>[];
    requirements: z.infer<typeof DraftRequirementSchema>[];
    entities: z.infer<typeof DraftEntitySchema>[];
    integrations: z.infer<typeof DraftIntegrationSchema>[];
    nfrs: z.infer<typeof DraftNfrsSchema>;
    assumptions: string[];
    open_questions: string[];
  }
) {
  return [
    'Return JSON with this exact shape: {"name":"...","description":"...","components":[{"name":"...","type":"api"}]}',
    "Update only the architecture core: name, description, and components.",
    "Use component.type only from web, api, worker, db, queue, cache, object_storage, auth_provider, external_integration.",
    "Return 4 to 8 components.",
    "Architecture refinement context JSON:",
    compactJson(buildArchitectureRefinementContext(input, scopeUpdate)),
  ].join("\n");
}

function buildArchitectureTopologyRefinementPrompt(
  input: RefineArchitecturePackInput,
  scopeUpdate: {
    clarifications: z.infer<typeof DraftClarificationSchema>[];
    workflows: z.infer<typeof DraftWorkflowSchema>[];
    requirements: z.infer<typeof DraftRequirementSchema>[];
    entities: z.infer<typeof DraftEntitySchema>[];
    integrations: z.infer<typeof DraftIntegrationSchema>[];
    nfrs: z.infer<typeof DraftNfrsSchema>;
    assumptions: string[];
    open_questions: string[];
  }
) {
  return [
    'Return JSON with this exact shape: {"data_flows":["..."],"data_stores":["..."],"async_patterns":["..."],"api_surface":["..."]}',
    "Update only architecture topology details: data flows, data stores, async patterns, and API surface.",
    "Keep arrays short and concrete.",
    "Architecture refinement context JSON:",
    compactJson(buildArchitectureRefinementContext(input, scopeUpdate)),
  ].join("\n");
}

function buildArchitectureTradeoffsRefinementPrompt(
  input: RefineArchitecturePackInput,
  scopeUpdate: {
    clarifications: z.infer<typeof DraftClarificationSchema>[];
    workflows: z.infer<typeof DraftWorkflowSchema>[];
    requirements: z.infer<typeof DraftRequirementSchema>[];
    entities: z.infer<typeof DraftEntitySchema>[];
    integrations: z.infer<typeof DraftIntegrationSchema>[];
    nfrs: z.infer<typeof DraftNfrsSchema>;
    assumptions: string[];
    open_questions: string[];
  }
) {
  return [
    'Return JSON with this exact shape: {"tradeoffs":{"pros":["..."],"cons":["..."],"risks":["..."]},"rationale":"..."}',
    "Update only architecture tradeoffs and rationale.",
    "Keep each list short and concrete.",
    "Architecture refinement context JSON:",
    compactJson(buildArchitectureRefinementContext(input, scopeUpdate)),
  ].join("\n");
}

function buildRefinementGuidanceUpdatePrompt(
  requirements: z.infer<typeof DraftRequirementSchema>[],
  architecture: z.infer<typeof DraftArchitectureSchema>,
  messages: Array<{ role: "user" | "assistant" | "system"; content: string }>
) {
  return [
    'Return JSON with this exact shape: {"refinement":{"wireframe":{"enabled":true,"editable_components":["..."]},"chat":{"enabled":true,"suggested_questions":["..."],"editable_topics":["..."]}}}',
    "Update the wireframe and chat guidance to match the revised architecture and the latest conversation.",
    "Return at most 5 editable components, 5 suggested questions, and 5 editable topics.",
    "Context JSON:",
    compactJson({
      latest_messages: messages.slice(-8),
      requirements,
      architecture: {
        name: architecture.name,
        components: architecture.components,
      },
    }),
  ].join("\n");
}

function buildCoverageTraceRefinementPrompt(
  requirements: Array<{ id: string; text: string }>,
  architecture: z.infer<typeof DraftArchitectureSchema>,
  logicRequirements: Array<{ id: string; title: string }>,
  issuePlan: Array<{ id: string; title: string }>,
  messages: Array<{ role: "user" | "assistant" | "system"; content: string }>
) {
  return [
    'Return JSON with this exact shape: {"coverage":[{"requirement_id":"req_1","status":"covered","notes":"optional"}],"trace":[{"requirement_id":"req_1","source_hint":"..."}]}',
    "Refresh coverage and trace after the latest refinement.",
    "Use coverage.status only from covered, partial, missing.",
    "Return exactly one coverage item and one trace item for each requirement ID provided.",
    "Context JSON:",
    compactJson({
      latest_messages: messages.slice(-6),
      requirements,
      architecture: {
        name: architecture.name,
        components: architecture.components.map((item) => item.name),
      },
      logic_requirements: logicRequirements,
      github_issue_plan: issuePlan,
    }),
  ].join("\n");
}

function buildDecompositionPrompt(input: GenerateDecompositionPlanInput) {
  const targetCount = Number(process.env.PASS_DECOMPOSITION_TARGET_COUNT ?? "36");
  return [
    'Return JSON with this exact shape: {"base_tasks":[{"id":"base_1","title":"...","summary":"...","component":"API","category":"backend","depends_on":["base_0"],"focus_areas":["..."]}]}',
    `Generate a base decomposition of approximately ${Math.max(8, Math.ceil(targetCount / 3))} parent tasks for the project.`,
    "These are parent implementation tasks only. Each parent task will be expanded by its own follow-up agent.",
    "Generate 1 to 2 parent tasks per major architecture component plus shared platform tasks when needed.",
    "Do not generate testing, QA, smoke, end-to-end, unit-test, integration-test, or CI validation tasks.",
    "Use category only from frontend, backend, infra, data, docs, ops.",
    "Keep focus_areas short and implementation-specific.",
    "Architecture pack JSON:",
    compactJson({
      prd: {
        title: input.pack.prd.title,
        summary: input.pack.prd.summary,
      },
      requirements: input.pack.requirements,
      workflows: input.pack.workflows,
      integrations: input.pack.integrations,
      architecture: {
        name: input.pack.architecture.name,
        description: input.pack.architecture.description,
        components: input.pack.architecture.components,
        data_stores: input.pack.architecture.data_stores,
        async_patterns: input.pack.architecture.async_patterns,
        api_surface: input.pack.architecture.api_surface,
      },
      implementation_summary: input.pack.implementation.summary,
      open_questions: input.pack.open_questions,
    }),
  ].join("\n");
}

function buildBaseTaskDetailPrompt(input: {
  pack: ArchitecturePack;
  baseTask: z.infer<typeof DecompositionBaseTaskSchema>;
  targetCount: number;
}) {
  const component = findComponentByName(input.pack, input.baseTask.component);
  const relatedContext = buildBaseTaskContext(input.pack, input.baseTask);

  return [
    'Return JSON with this exact shape: {"work_items":[{"id":"draft_1","title":"...","summary":"...","category":"backend","size":"tiny","component":"API","acceptance_criteria":["..."],"depends_on":["draft_0"],"labels":["implementation","category:backend"]}]}',
    `Expand the parent task "${input.baseTask.title}" into ${Math.max(2, input.targetCount)} very small implementation work items.`,
    "Each work item must be tiny or small.",
    "Focus only on the parent task and the thin slices directly needed to complete it.",
    "Prefer tiny tasks over broad tasks.",
    "Only include dependencies inside this parent-task batch. Cross-parent dependencies will be added later.",
    "Do not generate testing, QA, smoke, end-to-end, integration-test, unit-test, or CI validation tasks.",
    "Those concerns belong to the build and devops layer, not decomposition.",
    "Use category only from frontend, backend, infra, data, docs, ops.",
    "Keep acceptance criteria short.",
    "Relevant architecture context JSON:",
    compactJson({
      parent_task: input.baseTask,
      component: component
        ? {
            name: component.name,
            type: component.type,
          }
        : {
            name: input.baseTask.component,
            type: "shared",
          },
      context: relatedContext,
    }),
  ].join("\n");
}

function buildComponentBaseTaskPrompt(input: {
  pack: ArchitecturePack;
  componentName: string;
  componentType: ArchitecturePack["architecture"]["components"][number]["type"];
}) {
  const relatedRequirements = input.pack.requirements
    .filter((requirement) => inferAffectedComponents(requirement.text, input.pack.architecture).includes(input.componentName))
    .slice(0, 6);
  const relevantDataFlows = input.pack.architecture.data_flows
    .filter((flow) => tokens(flow).some((token) => tokens(input.componentName).includes(token)))
    .slice(0, 4);

  return [
    'Return JSON with this exact shape: {"base_tasks":[{"id":"base_1","title":"...","summary":"...","component":"API","category":"backend","depends_on":[],"focus_areas":["..."]}]}',
    `Generate 1 or 2 parent implementation tasks for the ${input.componentName} component.`,
    "These are parent decomposition tasks only, not tiny work items.",
    "Do not generate testing, QA, smoke, end-to-end, unit-test, integration-test, or CI validation tasks.",
    "Use category only from frontend, backend, infra, data, docs, ops.",
    "Relevant component context JSON:",
    compactJson({
      prd_summary: input.pack.prd.summary,
      component: {
        name: input.componentName,
        type: input.componentType,
      },
      requirements: relatedRequirements,
      workflows: input.pack.workflows.slice(0, 4),
      integrations: input.pack.integrations.slice(0, 4),
      data_flows: relevantDataFlows,
      api_surface: input.pack.architecture.api_surface.slice(0, 4),
    }),
  ].join("\n");
}

function buildSharedBaseTaskPrompt(input: { pack: ArchitecturePack }) {
  return [
    'Return JSON with this exact shape: {"base_tasks":[{"id":"base_shared_1","title":"...","summary":"...","component":"Platform","category":"ops","depends_on":[],"focus_areas":["..."]}]}',
    "Generate 1 to 3 parent implementation tasks for shared platform, data, or operational work that is not owned by a single component.",
    "These are parent decomposition tasks only, not tiny work items.",
    "Do not generate testing, QA, smoke, end-to-end, unit-test, integration-test, or CI validation tasks.",
    "Use category only from frontend, backend, infra, data, docs, ops.",
    "Relevant shared context JSON:",
    compactJson({
      prd_summary: input.pack.prd.summary,
      components: input.pack.architecture.components,
      data_stores: input.pack.architecture.data_stores,
      async_patterns: input.pack.architecture.async_patterns,
      implementation_summary: input.pack.implementation.summary,
      observability: input.pack.implementation.observability,
      coordination: input.pack.implementation.coordination,
    }),
  ].join("\n");
}

function buildCrossCuttingDecompositionPrompt(input: {
  pack: ArchitecturePack;
  targetCount: number;
  focus: string;
  categories: Array<"infra" | "data" | "docs" | "ops" | "backend" | "frontend">;
}) {
  return [
    'Return JSON with this exact shape: {"work_items":[{"id":"draft_1","title":"...","summary":"...","category":"ops","size":"tiny","component":"Platform","acceptance_criteria":["..."],"depends_on":["draft_0"],"labels":["implementation","category:ops"]}]}',
    `Generate ${Math.max(4, input.targetCount)} very small cross-cutting work items.`,
    `Focus only on this cross-cutting scope: ${input.focus}.`,
    `Use categories only from: ${input.categories.join(", ")}.`,
    "Focus only on shared infrastructure, docs, observability, rollout, and operations work that is not owned by one component.",
    "Do not repeat component-specific implementation work.",
    "Do not generate testing, QA, smoke, end-to-end, integration-test, unit-test, or CI validation tasks.",
    "Those concerns belong to the build and devops layer, not decomposition.",
    "Use category only from frontend, backend, infra, data, docs, ops.",
    "Relevant architecture context JSON:",
    compactJson({
      prd: input.pack.prd,
      requirements: input.pack.requirements,
      components: input.pack.architecture.components,
      async_patterns: input.pack.architecture.async_patterns,
      data_stores: input.pack.architecture.data_stores,
      implementation: {
        summary: input.pack.implementation.summary,
        coordination: input.pack.implementation.coordination,
        observability: input.pack.implementation.observability,
      },
      focus: input.focus,
      allowed_categories: input.categories,
      open_questions: input.pack.open_questions,
    }),
  ].join("\n");
}

function buildNormalizedPrdPrompt(prdText: string) {
  return [
    'Return JSON with this exact shape: {"title":"...","summary":"...","goals":["..."],"actors":["..."],"capabilities":["..."],"constraints":["..."],"nfrs":["..."],"integrations":["..."],"rollout_notes":["..."]}',
    "Interpret the input as a natural-language PRD.",
    "Keep arrays concise and concrete.",
    "Return no markdown.",
    "PRD text:",
    prdText,
  ].join("\n");
}

function buildNormalizedOrgConstraintsPrompt(orgConstraintsText: string) {
  return [
    "Return JSON matching the OrgConstraintsSchema shape.",
    "Interpret the input as natural-language engineering or organizational constraints.",
    "Infer the closest valid enum values.",
    "If a value is not specified, use a reasonable default.",
    "Return no markdown.",
    "Org constraints text:",
    orgConstraintsText,
  ].join("\n");
}

function buildNormalizedDesignGuidelinesPrompt(designGuidelinesText: string) {
  return [
    "Return JSON matching the DesignGuidelinesSchema shape.",
    "Interpret the input as natural-language design, brand, UI, frontend, accessibility, and linting guidance.",
    "Keep each item concise and concrete.",
    "If a category is not specified, return an empty array for it.",
    "Return no markdown.",
    "Design guidelines text:",
    designGuidelinesText,
  ].join("\n");
}

function buildDecompositionIteratorReviewPrompt(input: GenerateDecompositionIteratorReviewInput) {
  return [
    'Return JSON with this exact shape: {"summary":"...","gaps":[{"id":"gap_1","type":"missing_coverage","severity":"medium","summary":"...","affected_requirement_ids":["req_1"],"affected_components":["pass-api"],"affected_work_item_ids":[],"auto_resolved":false,"resolution_notes":"optional"}],"questions":[{"prompt":"...","rationale":"...","related_requirement_ids":["req_1"],"related_components":["pass-api"]}],"proposed_work_items":[{"id":"draft_1","title":"...","summary":"...","category":"backend","size":"tiny","component":"pass-api","acceptance_criteria":["..."],"depends_on":[],"labels":["implementation","category:backend"]}]}',
    "You are the decomposition iterator review agent.",
    "Review whether the decomposition plan fully covers the project context and architecture.",
    "Exclude testing, QA, smoke, unit, integration, end-to-end, and CI work from decomposition.",
    "If obvious implementation slices are missing, propose tiny or small work items to fill them.",
    "If ambiguity prevents a safe amendment, ask clarifying questions instead of guessing.",
    "Return unresolved gaps after considering any proposed_work_items in this same response.",
    "Keep proposed_work_items small, implementation-focused, and component-scoped.",
    "Do not propose more than 6 work items, 6 gaps, or 4 questions.",
    "Review context JSON:",
    compactJson({
      iteration: input.iteration,
      project_context: {
        prd_summary: input.projectContext.prd_summary,
        org_constraints_summary: input.projectContext.org_constraints_summary,
        design_guidelines_summary: input.projectContext.design_guidelines_summary,
        architecture_summary: input.projectContext.architecture_summary,
        key_decisions: input.projectContext.key_decisions.slice(0, 8),
        refinement_decisions: input.projectContext.refinement_decisions.slice(-6),
        coverage_targets: input.projectContext.coverage_targets.slice(0, 40),
        unresolved_architecture_questions: input.projectContext.unresolved_architecture_questions,
      },
      architecture: {
        name: input.pack.architecture.name,
        components: input.pack.architecture.components,
        integrations: input.pack.integrations,
        data_stores: input.pack.architecture.data_stores,
        async_patterns: input.pack.architecture.async_patterns,
        api_surface: input.pack.architecture.api_surface,
      },
      decomposition_plan: input.plan.work_items.slice(0, 80).map((item) => ({
        id: item.id,
        title: item.title,
        summary: item.summary,
        component: item.component,
        category: item.category,
        size: item.size,
        depends_on: item.depends_on,
        labels: item.labels,
      })),
      machine_snapshot: input.coverageSnapshot
        .filter((item) => item.status !== "covered")
        .slice(0, 40),
    }),
  ].join("\n");
}

function buildRepairPrompt(candidate: string, issues: string[]) {
  return [
    "Rewrite the previous response into one valid JSON object only.",
    "Do not add markdown or commentary.",
    "Keep the same intent, but make it shorter.",
    "Validation issues:",
    ...issues.map((issue) => `- ${issue}`),
    "Previous response:",
    candidate,
  ].join("\n");
}

function buildTruncationPrompt(initialPrompt: string, attempt: number) {
  const note = attempt === 1
    ? "The previous response was cut off. Return a much shorter JSON object with fewer items and shorter strings."
    : "The response is still too long. Return the absolute minimum valid JSON — 2 items max per array, 1 sentence per string.";
  return [note, initialPrompt].join("\n");
}

function buildStructuredRetryPrompt(initialPrompt: string) {
  return [
    "The previous structured attempt failed.",
    "Retry with the same schema, but use fewer items and much shorter strings.",
    "Prefer empty arrays over speculative entries.",
    initialPrompt,
  ].join("\n");
}

function extractText(response: any) {
  const parts =
    response?.content
      ?.filter((item: any) => item?.type === "text" && typeof item?.text === "string")
      ?.map((item: any) => item.text) ?? [];
  const text = parts.join("\n").trim();
  if (!text) {
    throw new Error("Anthropic response did not include text content.");
  }
  return {
    text,
    stopReason: typeof response?.stop_reason === "string" ? response.stop_reason : null,
  } satisfies AnthropicCompletion;
}

function clampAnthropicOutputTokens(maxTokens: number) {
  const globalCap = Number(
    process.env.ANTHROPIC_SECTION_MAX_OUTPUT_TOKENS ??
      process.env.CLAUDE_CODE_MAX_OUTPUT_TOKENS ??
      "4096"
  );
  return Math.max(256, Math.min(maxTokens, globalCap));
}

function buildContinuationCue(segment: number) {
  return [
    `CONTINUE segment ${segment}.`,
    "Resume exactly where you stopped.",
    "Do not repeat earlier text.",
    "Do not restart the JSON object.",
    "Output only the remaining JSON text.",
  ].join(" ");
}

function stripCodeFences(text: string) {
  const trimmed = text.trim();
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  return fenced ? fenced[1].trim() : trimmed;
}

function extractBalancedJsonObject(text: string) {
  const input = stripCodeFences(text);
  const firstBrace = input.indexOf("{");
  const firstBracket = input.indexOf("[");

  let start = -1;
  let opening = "{";
  let closing = "}";

  if (firstBrace !== -1 && (firstBracket === -1 || firstBrace < firstBracket)) {
    start = firstBrace;
  } else if (firstBracket !== -1) {
    start = firstBracket;
    opening = "[";
    closing = "]";
  }

  if (start === -1) {
    throw new Error("No JSON value found in model output.");
  }

  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let index = start; index < input.length; index += 1) {
    const char = input[index];

    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (char === "\\") {
        escaped = true;
      } else if (char === "\"") {
        inString = false;
      }
      continue;
    }

    if (char === "\"") {
      inString = true;
      continue;
    }

    if (char === opening) {
      depth += 1;
    } else if (char === closing) {
      depth -= 1;
      if (depth === 0) {
        return input.slice(start, index + 1);
      }
    }
  }

  throw new Error("Could not extract a balanced JSON value from model output.");
}

function summarizeZodIssues(error: z.ZodError) {
  return error.issues.map((issue) => {
    const path = issue.path.length > 0 ? issue.path.join(".") : "<root>";
    return `${path}: ${issue.message}`;
  });
}

async function callAnthropic(
  systemPrompt: string,
  messages: AnthropicMessage[],
  maxTokens: number
) {
  const model = process.env.ANTHROPIC_MODEL ?? "claude-sonnet-4-6";
  const temperature = Number(process.env.ANTHROPIC_TEMPERATURE ?? "0");
  return runAnthropicRequest(
    {
      model,
      max_tokens: clampAnthropicOutputTokens(maxTokens),
      temperature,
      system: systemPrompt,
      messages,
    },
    extractText
  );
}

function extractToolUseInput(response: any, toolName: string) {
  const toolUse = response?.content?.find(
    (item: any) => item?.type === "tool_use" && item?.name === toolName
  );

  if (!toolUse?.input) {
    const fallbackText =
      response?.content
        ?.filter((item: any) => item?.type === "text" && typeof item?.text === "string")
        ?.map((item: any) => item.text)
        ?.join("\n")
        ?.trim() ?? "";
    throw new Error(
      fallbackText
        ? `Anthropic tool response did not include ${toolName}. Fallback text: ${fallbackText}`
        : `Anthropic tool response did not include ${toolName}.`
    );
  }

  return toolUse.input;
}

async function callAnthropicStructuredTool<T extends z.ZodTypeAny>(
  schema: T,
  toolName: string,
  description: string,
  systemPrompt: string,
  prompt: string,
  maxTokens: number
): Promise<z.infer<T>> {
  const model = process.env.ANTHROPIC_MODEL ?? "claude-sonnet-4-6";
  const temperature = Number(process.env.ANTHROPIC_TEMPERATURE ?? "0");
  return runAnthropicRequest(
    {
      model,
      max_tokens: clampAnthropicOutputTokens(maxTokens),
      temperature,
      system: systemPrompt,
      tools: [
        {
          name: toolName,
          description,
          input_schema: z.toJSONSchema(schema),
          strict: true,
        },
      ],
      tool_choice: { type: "tool", name: toolName },
      messages: [{ role: "user", content: prompt }],
    },
    (response) => schema.parse(extractToolUseInput(response, toolName))
  );
}

async function callAnthropicChunked(
  systemPrompt: string,
  prompt: string,
  maxTokens: number
) {
  const maxSegments = Number(process.env.ANTHROPIC_MAX_CONTINUATION_SEGMENTS ?? "8");
  const messages: AnthropicMessage[] = [{ role: "user", content: prompt }];
  let combinedText = "";
  let lastStopReason: string | null = null;

  for (let segment = 0; segment < maxSegments; segment += 1) {
    const completion = await callAnthropic(systemPrompt, messages, maxTokens);
    combinedText = `${combinedText}${combinedText ? "\n" : ""}${completion.text}`.trim();
    lastStopReason = completion.stopReason;

    if (completion.stopReason !== "max_tokens") {
      return {
        text: combinedText,
        stopReason: completion.stopReason,
      } satisfies AnthropicCompletion;
    }

    try {
      extractBalancedJsonObject(combinedText);
      return {
        text: combinedText,
        stopReason: null,
      } satisfies AnthropicCompletion;
    } catch {
      // Keep requesting continuation until the JSON is complete or the segment cap is reached.
    }

    messages.push({ role: "assistant", content: completion.text });
    messages.push({ role: "user", content: buildContinuationCue(segment + 1) });
  }

  return {
    text: combinedText,
    stopReason: lastStopReason ?? "max_tokens",
  } satisfies AnthropicCompletion;
}

async function generateSection<T extends z.ZodTypeAny>(
  schema: T,
  sectionName: string,
  systemPrompt: string,
  initialPrompt: string,
  maxTokens: number
): Promise<z.infer<T>> {
  let currentPrompt = initialPrompt;
  let candidateText = "";
  let lastError = "";

  for (let attempt = 0; attempt < 4; attempt += 1) {
    try {
      const completion = await callAnthropicChunked(systemPrompt, currentPrompt, maxTokens);
      candidateText = completion.text;

      try {
        const candidateJson = extractBalancedJsonObject(candidateText);
        return schema.parse(JSON.parse(candidateJson));
      } catch (error) {
        if (completion.stopReason === "max_tokens") {
          lastError = "Model output was truncated by max_tokens.";
          currentPrompt = buildTruncationPrompt(initialPrompt, attempt+1);
          continue;
        }
        throw error;
      }
    } catch (error) {
      if (error instanceof z.ZodError) {
        lastError = summarizeZodIssues(error).join("; ");
        currentPrompt = buildRepairPrompt(candidateText, summarizeZodIssues(error));
        continue;
      }

      if (error instanceof SyntaxError) {
        lastError = "The response was not valid JSON.";
        currentPrompt = buildRepairPrompt(candidateText, [lastError]);
        continue;
      }

      const message = error instanceof Error ? error.message : String(error);
      lastError = message;

      if (candidateText && message.includes("Could not extract a balanced JSON value")) {
        currentPrompt = buildRepairPrompt(candidateText, [message]);
        continue;
      }

      if (message.includes("No JSON value found")) {
        currentPrompt = buildTruncationPrompt(initialPrompt, attempt+1);
        continue;
      }

      throw new Error(`${sectionName} generation failed: ${message}`);
    }
  }

  throw new Error(`${sectionName} generation failed: ${lastError || "unknown error"}`);
}

async function generateStructuredSection<T extends z.ZodTypeAny>(args: {
  schema: T;
  toolName: string;
  toolDescription: string;
  sectionName: string;
  systemPrompt: string;
  prompt: string;
  maxTokens: number;
}) {
  const attempts = [
    {
      prompt: args.prompt,
      maxTokens: args.maxTokens,
    },
    {
      prompt: buildStructuredRetryPrompt(args.prompt),
      maxTokens: Math.max(256, Math.floor(args.maxTokens * 0.75)),
    },
    {
      prompt: buildStructuredRetryPrompt(buildStructuredRetryPrompt(args.prompt)),
      maxTokens: Math.max(256, Math.floor(args.maxTokens * 0.6)),
    },
  ];

  let lastError = "unknown error";

  for (const attempt of attempts) {
    try {
      return await callAnthropicStructuredTool(
        args.schema,
        args.toolName,
        args.toolDescription,
        args.systemPrompt,
        attempt.prompt,
        attempt.maxTokens
      );
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
  }

  throw new Error(`${args.sectionName} generation failed: ${lastError}`);
}

function normalizeClarifications(items: z.infer<typeof DraftClarificationSchema>[]) {
  return limitArray(
    items.map((item, index) => ({
      id: item.id?.trim() || `c${index + 1}`,
      question: item.question.trim(),
      answer: item.answer?.trim() || "No explicit answer provided; use the default architecture assumption.",
      default_used: item.default_used ?? true,
      why_it_matters: item.why_it_matters?.trim() || item.impact?.trim() || "This shapes the resulting architecture.",
    })),
    5
  );
}

function normalizeWorkflows(items: z.infer<typeof DraftWorkflowSchema>[]) {
  return limitArray(
    items.map((item, index) => ({
      id: item.id?.trim() || `wf${index + 1}`,
      name: item.name.trim(),
      steps: limitArray(uniqueStrings(item.steps), 5),
    })),
    4
  ).filter((item) => item.steps.length > 0);
}

function normalizeRequirements(items: z.infer<typeof DraftRequirementSchema>[]) {
  return limitArray(
    items.map((item, index) => {
      const text =
        item.text?.trim() ||
        item.description?.trim() ||
        item.summary?.trim() ||
        item.title?.trim() ||
        `Requirement ${index + 1}`;
      return {
        id: item.id?.trim() || `req_${index + 1}`,
        text,
        priority: item.priority ?? "must",
        acceptance_criteria: limitArray(uniqueStrings(item.acceptance_criteria), 2),
      };
    }),
    10
  );
}

function preferNonEmpty<T>(nextValues: T[], fallbackValues: T[]) {
  return nextValues.length > 0 ? nextValues : fallbackValues;
}

function slugifyWorkItemFragment(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 24) || "item";
}

function normalizeBatchWorkItems(
  items: z.infer<typeof DecompositionWorkItemSchema>[],
  prefix: string,
  startIndex: number
) {
  const filteredItems = items.filter((item) => !isTestingOnlyWorkItem(item));
  const idMap = new Map<string, string>();

  const normalized = filteredItems.map((item, index) => {
    const nextId = `${prefix}_${String(startIndex + index + 1).padStart(3, "0")}_${slugifyWorkItemFragment(item.title)}`;
    idMap.set(item.id, nextId);
    return {
      ...item,
      id: nextId,
      title: item.title.trim(),
      summary: item.summary.trim(),
      component: item.component.trim(),
      acceptance_criteria: limitArray(uniqueStrings(item.acceptance_criteria), 4),
      labels: limitArray(uniqueStrings(item.labels), 6),
    };
  });

  return normalized.map((item) => ({
    ...item,
    depends_on: item.depends_on
      .map((value) => idMap.get(value))
      .filter((value): value is string => Boolean(value)),
  }));
}

function isTestingOnlyWorkItem(item: z.infer<typeof DecompositionWorkItemSchema>) {
  if (item.category === "qa") {
    return true;
  }

  const haystack = [
    item.title,
    item.summary,
    ...item.acceptance_criteria,
    ...item.labels,
  ]
    .join(" ")
    .toLowerCase();

  return [
    "smoke test",
    "smoke suite",
    "test suite",
    "end-to-end test",
    "end to end test",
    "e2e test",
    "integration test",
    "unit test",
    "qa ",
    " qa",
    "ci gate",
    "ci validation",
  ].some((needle) => haystack.includes(needle));
}

function categoryForComponentType(componentType: ArchitecturePack["architecture"]["components"][number]["type"]) {
  switch (componentType) {
    case "web":
      return "frontend";
    case "db":
      return "data";
    case "queue":
    case "cache":
    case "object_storage":
      return "infra";
    case "auth_provider":
    case "external_integration":
      return "ops";
    default:
      return "backend";
  }
}

function buildDecompositionSummary(pack: ArchitecturePack, workItems: z.infer<typeof DecompositionWorkItemSchema>[]) {
  return `Decomposed ${pack.architecture.name} into ${workItems.length} small work items across ${pack.architecture.components.length} architecture components plus cross-cutting delivery work.`;
}

function buildDecompositionApprovalNotes(pack: ArchitecturePack) {
  return [
    "Review the batch sizes and dependency order before syncing issues.",
    `Open questions still recorded in the architecture pack: ${pack.open_questions.length}.`,
    "If architecture refinement changes any component boundaries, regenerate this decomposition draft.",
  ].join(" ");
}

function dedupeWorkItems(items: z.infer<typeof DecompositionWorkItemSchema>[]) {
  const seen = new Set<string>();
  return items.filter((item) => {
    const key = `${item.component} ${item.title} ${item.summary}`
      .toLowerCase()
      .replace(/[^a-z0-9\s]+/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

function buildBaseTaskContext(
  pack: ArchitecturePack,
  baseTask: z.infer<typeof DecompositionBaseTaskSchema>
) {
  const focusTokens = tokens(
    [baseTask.title, baseTask.summary, baseTask.component, ...baseTask.focus_areas].join(" ")
  );
  const relatedComponentNames = uniqueStrings([
    baseTask.component,
    ...inferAffectedComponents(`${baseTask.title} ${baseTask.summary}`, pack.architecture),
  ]).filter(Boolean);

  const selectRelevant = <T extends string | { name?: string; text?: string; purpose?: string }>(
    values: T[],
    toText: (value: T) => string
  ) =>
    values
      .filter((value) => {
        const haystackTokens = tokens(toText(value));
        return haystackTokens.some((token) => focusTokens.includes(token));
      })
      .slice(0, 6);

  const requirements = pack.requirements
    .filter((item) => {
      const affectedComponents = inferAffectedComponents(item.text, pack.architecture);
      return (
        affectedComponents.includes(baseTask.component) ||
        tokens(item.text).some((token) => focusTokens.includes(token))
      );
    })
    .slice(0, 6);

  const workflows = pack.workflows
    .filter((item) =>
      tokens(`${item.name} ${item.steps.join(" ")}`).some((token) => focusTokens.includes(token))
    )
    .slice(0, 4);

  const entities = selectRelevant(pack.entities, (value) => `${value.name} ${value.fields.join(" ")} ${value.notes ?? ""}`);
  const integrations = selectRelevant(
    pack.integrations,
    (value) => `${value.name} ${value.purpose} ${value.contract_stub ?? ""}`
  );

  return {
    prd_summary: pack.prd.summary,
    related_components:
      relatedComponentNames.length > 0
        ? pack.architecture.components.filter((component) =>
            relatedComponentNames.includes(component.name)
          )
        : pack.architecture.components.slice(0, 3),
    requirements,
    workflows,
    entities,
    integrations,
    data_flows: pack.architecture.data_flows
      .filter((flow) => tokens(flow).some((token) => focusTokens.includes(token)))
      .slice(0, 5),
    data_stores: pack.architecture.data_stores
      .filter((item) => tokens(item).some((token) => focusTokens.includes(token)))
      .slice(0, 4),
    async_patterns: pack.architecture.async_patterns
      .filter((item) => tokens(item).some((token) => focusTokens.includes(token)))
      .slice(0, 4),
    api_surface: pack.architecture.api_surface
      .filter((item) => tokens(item).some((token) => focusTokens.includes(token)))
      .slice(0, 5),
    open_questions: pack.open_questions.slice(0, 4),
    design_guidelines: pack.design_guidelines,
  };
}

function normalizeBaseDecompositionTasks(
  pack: ArchitecturePack,
  items: z.infer<typeof DecompositionBaseTaskSchema>[]
) {
  const architectureComponentNames = new Set(pack.architecture.components.map((component) => component.name));
  const normalizedSeed = limitArray(
    items.map((item, index) => {
      const inferredComponent =
        architectureComponentNames.has(item.component)
          ? item.component
          : inferAffectedComponents(`${item.title} ${item.summary}`, pack.architecture)[0] ?? "Platform";
      const component = architectureComponentNames.has(inferredComponent) ? inferredComponent : "Platform";
      const componentType = findComponentByName(pack, component)?.type ?? "api";
      return {
        id: item.id?.trim() || `base_${index + 1}`,
        title: item.title.trim(),
        summary: item.summary.trim(),
        component,
        category: item.category ?? categoryForComponentType(componentType),
        depends_on: uniqueStrings(item.depends_on),
        focus_areas: limitArray(uniqueStrings(item.focus_areas), 6),
      };
    }),
    16
  ).filter((item) => item.title.length > 0 && item.summary.length > 0);

  const idMap = new Map<string, string>();
  const normalized = normalizedSeed.map((item, index) => {
    const nextId = `base_${String(index + 1).padStart(3, "0")}_${slugifyWorkItemFragment(item.title)}`;
    idMap.set(item.id, nextId);
    return {
      ...item,
      id: nextId,
    };
  });

  return normalized.map((item) => ({
    ...item,
    depends_on: item.depends_on
      .map((value) => idMap.get(value))
      .filter((value): value is string => Boolean(value)),
  }));
}

function detailTargetCount(
  totalTargetCount: number,
  baseTaskCount: number,
  baseTask: z.infer<typeof DecompositionBaseTaskSchema>
) {
  const baseline = Math.ceil(totalTargetCount / Math.max(baseTaskCount, 1));
  const categoryFloor = baseTask.category === "infra" || baseTask.component === "Platform" ? 2 : 3;
  return Math.min(4, Math.max(categoryFloor, baseline));
}

async function generateFallbackBaseTasks(pack: ArchitecturePack) {
  const componentPlans = await mapWithConcurrency(
    pack.architecture.components,
    getAnthropicBatchConcurrency(),
    (component) =>
      callAnthropicStructuredTool(
        DecompositionBaseTaskPlanSchema,
        "generate_component_base_tasks",
        "Create one or two parent decomposition tasks for a single architecture component.",
        buildSectionSystemPrompt(`component base tasks for ${component.name}`, [
          "Return only parent implementation tasks.",
          "Do not generate testing work.",
        ]),
        buildComponentBaseTaskPrompt({
          pack,
          componentName: component.name,
          componentType: component.type,
        }),
        Number(process.env.ANTHROPIC_DECOMPOSITION_COMPONENT_BASE_MAX_TOKENS ?? "450")
      )
  );

  const sharedPlan = await callAnthropicStructuredTool(
    DecompositionBaseTaskPlanSchema,
    "generate_shared_base_tasks",
    "Create parent decomposition tasks for shared platform work.",
    buildSectionSystemPrompt("shared base tasks", [
      "Return only parent implementation tasks.",
      "Do not generate testing work.",
    ]),
    buildSharedBaseTaskPrompt({ pack }),
    Number(process.env.ANTHROPIC_DECOMPOSITION_SHARED_BASE_MAX_TOKENS ?? "450")
  );

  return [...componentPlans.flatMap((plan) => plan.base_tasks), ...sharedPlan.base_tasks];
}

function deriveCrossCuttingWorkItems(
  pack: ArchitecturePack,
  startIndex: number
): z.infer<typeof DecompositionWorkItemSchema>[] {
  const items: z.infer<typeof DecompositionWorkItemSchema>[] = [];
  const componentNames = pack.architecture.components.map((component) => component.name);
  const sharedRuntimeSummary =
    componentNames.length > 0 ? componentNames.join(", ") : pack.architecture.name;

  items.push({
    id: "shared_runtime",
    title: "Configure shared runtime, secrets, and environment boundaries",
    summary: `Define shared runtime configuration, secret boundaries, and deployment environment wiring for ${sharedRuntimeSummary}.`,
    category: "infra",
    size: "small",
    component: "Platform",
    acceptance_criteria: [
      "Shared runtime configuration is defined for all participating services.",
      "Secrets and environment boundaries are documented with clear ownership.",
    ],
    depends_on: [],
    labels: ["implementation", "category:infra"],
  });

  if (pack.architecture.data_stores.length > 0) {
    items.push({
      id: "shared_data",
      title: "Implement shared data store provisioning and migration baseline",
      summary: `Create the provisioning and schema baseline for ${pack.architecture.data_stores.join(", ")} used by the architecture.`,
      category: "data",
      size: "small",
      component: "Platform",
      acceptance_criteria: [
        "Each shared data store has a clear provisioning and migration path.",
        "Application components have an agreed ownership boundary for shared data.",
      ],
      depends_on: ["shared_runtime"],
      labels: ["implementation", "category:data"],
    });
  }

  if (pack.architecture.async_patterns.length > 0) {
    items.push({
      id: "shared_async",
      title: "Implement shared async orchestration and failure handling",
      summary: `Establish delivery, retry, and recovery handling for ${pack.architecture.async_patterns.join(", ")} across the system.`,
      category: "ops",
      size: "small",
      component: "Platform",
      acceptance_criteria: [
        "Each async pattern has an owner and failure-handling path.",
        "Retry and recovery behavior is defined for shared async processing.",
      ],
      depends_on: ["shared_runtime"],
      labels: ["implementation", "category:ops"],
    });
  }

  if (pack.implementation.observability.required_signals.length > 0) {
    items.push({
      id: "shared_observability",
      title: "Implement shared observability signals and operator dashboards",
      summary: `Create the core log, trace, metric, and dashboard setup required for ${pack.architecture.name}.`,
      category: "ops",
      size: "small",
      component: "Platform",
      acceptance_criteria: [
        "Required operational signals are emitted by the relevant services.",
        "Operator dashboards exist for the agreed high-level platform views.",
      ],
      depends_on: ["shared_runtime"],
      labels: ["implementation", "category:ops"],
    });
  }

  items.push({
    id: "shared_docs",
    title: "Document shared platform decisions and implementation handoff",
    summary: `Capture the cross-cutting platform decisions, IaC handoff, and operator notes for ${pack.architecture.name}.`,
    category: "docs",
    size: "tiny",
    component: "Platform",
    acceptance_criteria: [
      "Shared platform decisions are documented in repo-first docs.",
      "Implementation handoff notes align with the current architecture pack.",
    ],
    depends_on: ["shared_runtime"],
    labels: ["implementation", "category:docs"],
  });

  const normalized = normalizeBatchWorkItems(
    dedupeWorkItems(items),
    "shared",
    startIndex
  );

  return normalized.filter((item) => !isTestingOnlyWorkItem(item));
}

function findComponentByName(
  pack: ArchitecturePack,
  componentName?: string
) {
  if (!componentName) {
    return undefined;
  }
  return pack.architecture.components.find((component) => component.name === componentName);
}

function deriveDeterministicDecompositionWorkItems(pack: ArchitecturePack) {
  const logicRequirements = pack.implementation.logic_requirements;
  const rawItems: z.infer<typeof DecompositionWorkItemSchema>[] = logicRequirements.map((item, index) => {
    const primaryComponentName =
      item.affected_components[0] ??
      inferAffectedComponents(item.summary, pack.architecture)[0] ??
      pack.architecture.components[0]?.name ??
      "Platform";
    const primaryComponent = findComponentByName(pack, primaryComponentName);
    const category = categoryForComponentType(primaryComponent?.type ?? "api");

    return {
      id: item.id || `logic_${index + 1}`,
      title: item.title,
      summary: item.summary,
      category,
      size: item.priority === "must" ? "small" : "tiny",
      component: primaryComponentName,
      acceptance_criteria:
        item.acceptance_criteria.length > 0
          ? item.acceptance_criteria
          : [`The implementation covers ${item.title.toLowerCase()}.`],
      depends_on: item.dependencies,
      labels: uniqueStrings([
        "implementation",
        `category:${category}`,
        `priority:${item.priority}`,
        `component:${slugifyWorkItemFragment(primaryComponentName)}`,
      ]),
    };
  });

  const normalizedLogicItems = normalizeBatchWorkItems(rawItems, "logic", 0);
  const crossCuttingItems = deriveCrossCuttingWorkItems(pack, normalizedLogicItems.length);
  return dedupeWorkItems([...normalizedLogicItems, ...crossCuttingItems]);
}

function componentLabel(componentType: z.infer<typeof DraftArchitectureSchema>["components"][number]["type"]) {
  switch (componentType) {
    case "web":
      return "web";
    case "api":
      return "api";
    case "worker":
      return "worker";
    case "db":
      return "database";
    case "queue":
      return "queue";
    case "cache":
      return "cache";
    case "object_storage":
      return "object storage";
    case "auth_provider":
      return "auth";
    case "external_integration":
      return "integration";
  }
}

function deriveImplementationOverviewFromArchitecture(
  architecture: z.infer<typeof DraftArchitectureSchema>,
  refinement: z.infer<typeof DraftRefinementSchema>,
  currentOverview: z.infer<typeof DraftImplementationOverviewSchema>,
  openQuestions: string[]
) {
  const componentModules = uniqueStrings(
    architecture.components.map((component) => `${component.name} ${componentLabel(component.type)}`)
  ).slice(0, 6);

  const componentNames = architecture.components.map((component) => component.name);
  const usesQueue = architecture.components.some((component) => component.type === "queue");
  const usesCache = architecture.components.some((component) => component.type === "cache");
  const unresolvedReviewFlow = openQuestions.some((question) => /review/i.test(question));
  const unresolvedCatalogInvalidation = openQuestions.some((question) => /catalog|listing|isr/i.test(question));

  return DraftImplementationOverviewSchema.parse({
    summary: `Implementation centers on ${architecture.components
      .slice(0, 4)
      .map((component) => component.name)
      .join(", ")} with ${architecture.data_flows.length > 0 ? architecture.data_flows[0] : "refined service interactions"}.`,
    iac_handoff: {
      summary: `Provision infrastructure for ${architecture.name} across ${componentModules.length} primary modules with alignment to the refined component graph.`,
      modules: componentModules.length > 0 ? componentModules : currentOverview.iac_handoff.modules,
    },
    coordination: {
      pause_on_pending_questions: currentOverview.coordination.pause_on_pending_questions ?? true,
      live_issue_updates: currentOverview.coordination.live_issue_updates ?? true,
      coordination_views: limitArray(
        uniqueStrings([
          "Architecture refinement chat and decision log",
          `Component graph review for ${componentNames.slice(0, 3).join(", ")}`,
          "Decomposition approval queue after architecture sign-off",
          ...(unresolvedReviewFlow ? ["Pending review-publication policy confirmation"] : []),
          ...(unresolvedCatalogInvalidation ? ["Pending ISR invalidation scope confirmation"] : []),
        ]),
        6
      ),
      question_sources: limitArray(
        uniqueStrings([
          "Architecture refinement chat",
          "Product owner follow-up on unresolved architecture questions",
          "Decomposition review before issue sync",
        ]),
        6
      ),
    },
    observability: {
      log_traces_enabled: currentOverview.observability.log_traces_enabled ?? true,
      coordination_panel_enabled: currentOverview.observability.coordination_panel_enabled ?? refinement.chat.enabled,
      required_signals: limitArray(
        uniqueStrings([
          "workflow state transitions across refinement and decomposition",
          "agent logs for planner, refinement, and decomposition runs",
          "architecture decision deltas captured from refinement chat",
          ...(usesQueue ? ["queue depth and message age for payment or webhook processing"] : []),
          ...(usesCache ? ["cache hit rate and eviction count for catalog/session caching"] : []),
          "API latency and ISR revalidation failures on admin content updates",
        ]),
        6
      ),
      dashboard_panels: limitArray(
        uniqueStrings([
          "Architecture status and pending decisions",
          "Decomposition readiness and approval state",
          "Implementation progress overview",
          ...(usesQueue ? ["Queue health and worker throughput"] : []),
          ...(usesCache ? ["Cache performance"] : []),
        ]),
        6
      ),
    },
  });
}

function inferAffectedComponents(
  requirementText: string,
  architecture: z.infer<typeof DraftArchitectureSchema>
) {
  const lowered = requirementText.toLowerCase();
  const directMatches = architecture.components
    .map((component) => component.name)
    .filter((name) => lowered.includes(name.toLowerCase()));

  if (directMatches.length > 0) {
    return uniqueStrings(directMatches).slice(0, 3);
  }

  const fallback = architecture.components
    .filter((component) => ["web", "api", "worker", "db"].includes(component.type))
    .map((component) => component.name);

  return uniqueStrings(fallback).slice(0, 3);
}

function toTaskTitle(requirementText: string) {
  const clean = requirementText.replace(/\.$/, "").trim();
  if (clean.length <= 72) {
    return clean;
  }
  return `${clean.slice(0, 69).trim()}...`;
}

function deriveLogicRequirements(
  requirements: Array<{
    id: string;
    text: string;
    priority: "must" | "should" | "could";
    acceptance_criteria: string[];
  }>,
  architecture: z.infer<typeof DraftArchitectureSchema>
) {
  return requirements.map((requirement, index) => ({
    id: `logic_${index + 1}`,
    title: toTaskTitle(requirement.text),
    summary: requirement.text,
    priority: requirement.priority,
    acceptance_criteria: limitArray(uniqueStrings(requirement.acceptance_criteria), 4),
    affected_components: inferAffectedComponents(requirement.text, architecture),
    dependencies: index > 0 && requirement.priority !== "must" ? [`logic_${index}`] : [],
  }));
}

function deriveIssuePlan(
  logicRequirements: Array<{
    id: string;
    title: string;
    summary: string;
    priority: "must" | "should" | "could";
    acceptance_criteria: string[];
    affected_components: string[];
    dependencies: string[];
  }>,
  overview: z.infer<typeof DraftImplementationOverviewSchema>
) {
  return logicRequirements.map((item, index) => {
    const issueId = `issue_${index + 1}`;
    const dependsOn = item.dependencies.map((dependency) => dependency.replace("logic_", "issue_"));
    const labels = uniqueStrings([
      "implementation",
      `priority:${item.priority}`,
      ...(overview.observability.coordination_panel_enabled ? ["coordination-aware"] : []),
    ]);

    return {
      id: issueId,
      title: item.title,
      summary: item.summary,
      body: [
        "Summary:",
        item.summary,
        "",
        "Affected Components:",
        ...(item.affected_components.length > 0 ? item.affected_components.map((value) => `- ${value}`) : ["- None"]),
        "",
        "Acceptance Criteria:",
        ...(item.acceptance_criteria.length > 0
          ? item.acceptance_criteria.map((value) => `- ${value}`)
          : ["- Validate against the architecture pack requirement."]),
        "",
        "Coordination:",
        `- Pause on pending questions: ${overview.coordination.pause_on_pending_questions ?? true}`,
        `- Live issue updates: ${overview.coordination.live_issue_updates ?? true}`,
      ].join("\n"),
      labels,
      depends_on: dependsOn,
      acceptance_criteria: item.acceptance_criteria,
    };
  });
}

function finalizePack(
  core: z.infer<typeof DraftPrdCoreSchema>,
  clarifications: z.infer<typeof DraftClarificationSchema>[],
  workflows: z.infer<typeof DraftWorkflowSchema>[],
  requirements: z.infer<typeof DraftRequirementSchema>[],
  domain: z.infer<typeof DraftDomainSchema>,
  architecture: z.infer<typeof DraftArchitectureSchema>,
  refinement: z.infer<typeof DraftRefinementSchema>,
  overview: z.infer<typeof DraftImplementationOverviewSchema>,
  logicRequirements: Array<{
    id: string;
    title: string;
    summary: string;
    priority: "must" | "should" | "could";
    acceptance_criteria: string[];
    affected_components: string[];
    dependencies: string[];
  }>,
  issuePlan: Array<{
    id: string;
    title: string;
    summary: string;
    body: string;
    labels: string[];
    depends_on: string[];
    acceptance_criteria: string[];
  }>,
  coverageTrace: z.infer<typeof DraftCoverageTraceSchema>,
  input: GenerateArchitecturePackInput,
  createdAt: string
) {
  return ArchitecturePackSchema.parse({
    pack_version: PACK_VERSION,
    run_id: input.runId,
    created_at: createdAt,
    tool: {
      name: "PASS-2A",
      version: TOOL_VERSION,
    },
    prd: {
      ...core.prd,
      raw_text: input.prdText,
    },
    org_constraints: OrgConstraintsSchema.parse(input.orgConstraints),
    design_guidelines: DesignGuidelinesSchema.parse(input.designGuidelines),
    clarifications: normalizeClarifications(clarifications),
    actors: uniqueStrings(core.actors),
    workflows: normalizeWorkflows(workflows),
    requirements: normalizeRequirements(requirements),
    entities: limitArray(domain.entities, 6),
    integrations: limitArray(
      domain.integrations.map((item) => ({
        ...item,
        direction: item.direction ?? "outbound",
        criticality: item.criticality ?? "medium",
      })),
      6
    ),
    nfrs: domain.nfrs,
    architecture: {
      ...architecture,
      components: limitArray(architecture.components, 8),
      data_flows: limitArray(uniqueStrings(architecture.data_flows), 6),
      data_stores: limitArray(uniqueStrings(architecture.data_stores), 6),
      async_patterns: limitArray(uniqueStrings(architecture.async_patterns), 6),
      api_surface: limitArray(uniqueStrings(architecture.api_surface), 6),
      tradeoffs: {
        pros: limitArray(uniqueStrings(architecture.tradeoffs.pros), 5),
        cons: limitArray(uniqueStrings(architecture.tradeoffs.cons), 5),
        risks: limitArray(uniqueStrings(architecture.tradeoffs.risks), 5),
      },
    },
    refinement,
    implementation: {
      summary: overview.summary,
      iac_handoff: {
        summary: overview.iac_handoff.summary,
        modules: limitArray(uniqueStrings(overview.iac_handoff.modules), 6),
      },
      logic_requirements: logicRequirements,
      github_issue_plan: issuePlan,
      coordination: {
        pause_on_pending_questions: overview.coordination.pause_on_pending_questions ?? true,
        live_issue_updates: overview.coordination.live_issue_updates ?? true,
        coordination_views: limitArray(uniqueStrings(overview.coordination.coordination_views), 6),
        question_sources: limitArray(uniqueStrings(overview.coordination.question_sources), 6),
      },
      observability: {
        log_traces_enabled: overview.observability.log_traces_enabled ?? true,
        coordination_panel_enabled: overview.observability.coordination_panel_enabled ?? true,
        required_signals: limitArray(uniqueStrings(overview.observability.required_signals), 6),
        dashboard_panels: limitArray(uniqueStrings(overview.observability.dashboard_panels), 6),
      },
    },
    assumptions: limitArray(uniqueStrings(domain.assumptions), 5),
    open_questions: limitArray(uniqueStrings(domain.open_questions), 5),
    coverage: coverageTrace.coverage,
    trace: coverageTrace.trace,
  });
}

export async function normalizePrdToYaml(prdText: string): Promise<{
  yaml: string;
  normalized: z.infer<typeof NormalizedPrdSchema>;
}> {
  const systemPrompt = buildSectionSystemPrompt("normalized PRD", [
    "Convert the natural-language PRD into a concise structured planning input.",
  ]);
  const prompt = buildNormalizedPrdPrompt(prdText);
  const maxTokens = Number(process.env.ANTHROPIC_PRD_NORMALIZATION_MAX_TOKENS ?? "500");
  const normalized = await generateStructuredSection({
    schema: NormalizedPrdSchema,
    toolName: "normalize_prd",
    toolDescription: "Normalize a natural-language PRD into the PASS normalized PRD schema.",
    sectionName: "Normalized PRD",
    systemPrompt,
    prompt,
    maxTokens,
  });

  return {
    yaml: stringifyYaml(normalized).trimEnd() + "\n",
    normalized,
  };
}

export async function normalizeOrgConstraintsToYaml(orgConstraintsText?: string): Promise<{
  yaml: string;
  normalized: OrgConstraints;
}> {
  const normalized = !orgConstraintsText?.trim()
    ? OrgConstraintsSchema.parse({})
    : await (async () => {
        const systemPrompt = buildSectionSystemPrompt("normalized org constraints", [
          "Convert the natural-language org constraints into the PASS org constraints schema.",
        ]);
        const prompt = buildNormalizedOrgConstraintsPrompt(orgConstraintsText);
        const maxTokens = Number(process.env.ANTHROPIC_ORG_CONSTRAINTS_NORMALIZATION_MAX_TOKENS ?? "350");

        return generateStructuredSection({
          schema: OrgConstraintsSchema,
          toolName: "normalize_org_constraints",
          toolDescription:
            "Normalize natural-language org constraints into the PASS org constraints schema.",
          sectionName: "Normalized org constraints",
          systemPrompt,
          prompt,
          maxTokens,
        });
      })();

  return {
    yaml: stringifyYaml(normalized).trimEnd() + "\n",
    normalized,
  };
}

export async function normalizeDesignGuidelinesToYaml(designGuidelinesText?: string): Promise<{
  yaml: string;
  normalized: DesignGuidelines;
}> {
  const normalized = !designGuidelinesText?.trim()
    ? DesignGuidelinesSchema.parse({})
    : await (async () => {
        const systemPrompt = buildSectionSystemPrompt("normalized design guidelines", [
          "Convert the natural-language design guidance into the PASS design guidelines schema.",
        ]);
        const prompt = buildNormalizedDesignGuidelinesPrompt(designGuidelinesText);
        const maxTokens = Number(
          process.env.ANTHROPIC_DESIGN_GUIDELINES_NORMALIZATION_MAX_TOKENS ?? "350"
        );

        return generateStructuredSection({
          schema: NormalizedDesignGuidelinesSchema,
          toolName: "normalize_design_guidelines",
          toolDescription:
            "Normalize natural-language design guidance into the PASS design guidelines schema.",
          sectionName: "Normalized design guidelines",
          systemPrompt,
          prompt,
          maxTokens,
        });
      })();

  return {
    yaml: stringifyYaml(normalized).trimEnd() + "\n",
    normalized,
  };
}

export async function generateArchitecturePack(
  input: GenerateArchitecturePackInput
): Promise<ArchitecturePack> {
  const createdAt = new Date().toISOString();

  const core = await generateStructuredSection({
    schema: DraftPrdCoreSchema,
    toolName: "generate_prd_core",
    toolDescription: "Generate the core PRD summary and actors for the PASS planning pack.",
    sectionName: "PRD core",
    systemPrompt: buildSectionSystemPrompt("PRD core", ["Keep the response under 250 words."]),
    prompt: buildPrdCorePrompt(input),
    maxTokens: Number(process.env.ANTHROPIC_CORE_MAX_TOKENS ?? "350"),
  });

  const clarificationsResult = await generateStructuredSection({
    schema: z.object({ clarifications: z.array(DraftClarificationSchema).default([]) }),
    toolName: "generate_clarifications",
    toolDescription: "Generate architecture-shaping clarification questions and default assumptions.",
    sectionName: "Clarifications",
    systemPrompt: buildSectionSystemPrompt("clarifications", [
      "Return only architecture-shaping questions.",
    ]),
    prompt: buildClarificationsPrompt(input),
    maxTokens: Number(process.env.ANTHROPIC_CLARIFICATIONS_MAX_TOKENS ?? "450"),
  });

  const workflowsResult = await generateStructuredSection({
    schema: z.object({ workflows: z.array(DraftWorkflowSchema).default([]) }),
    toolName: "generate_workflows",
    toolDescription: "Generate core product workflows for the PASS planning pack.",
    sectionName: "Workflows",
    systemPrompt: buildSectionSystemPrompt("workflows", [
      "Keep workflows terse and execution-oriented.",
    ]),
    prompt: buildWorkflowsPrompt(core, clarificationsResult.clarifications),
    maxTokens: Number(process.env.ANTHROPIC_WORKFLOWS_MAX_TOKENS ?? "500"),
  });

  const requirementsResult = await generateStructuredSection({
    schema: z.object({ requirements: z.array(DraftRequirementSchema).default([]) }),
    toolName: "generate_requirements",
    toolDescription: "Generate implementation-relevant requirements for the PASS planning pack.",
    sectionName: "Requirements",
    systemPrompt: buildSectionSystemPrompt("requirements", [
      "Focus on build-critical requirements only.",
    ]),
    prompt: buildRequirementsPrompt(input, core, workflowsResult.workflows),
    maxTokens: Number(process.env.ANTHROPIC_REQUIREMENTS_MAX_TOKENS ?? "700"),
  });

  const domain = await generateStructuredSection({
    schema: DraftDomainSchema,
    toolName: "generate_domain",
    toolDescription:
      "Generate the domain model, integrations, NFRs, assumptions, and open questions.",
    sectionName: "Domain",
    systemPrompt: buildSectionSystemPrompt("domain", [
      "Extract only domain model, integrations, NFRs, assumptions, and open questions.",
    ]),
    prompt: buildDomainPrompt(input, core, requirementsResult.requirements),
    maxTokens: Number(process.env.ANTHROPIC_DOMAIN_MAX_TOKENS ?? "650"),
  });

  const architecture = await generateStructuredSection({
    schema: DraftArchitectureSchema,
    toolName: "generate_architecture",
    toolDescription: "Generate one concrete architecture for the PASS planning pack.",
    sectionName: "Architecture",
    systemPrompt: buildSectionSystemPrompt("architecture", [
      "Generate one concrete architecture only.",
    ]),
    prompt: buildArchitecturePrompt(
      input,
      core,
      workflowsResult.workflows,
      requirementsResult.requirements,
      domain
    ),
    maxTokens: Number(process.env.ANTHROPIC_ARCHITECTURE_MAX_TOKENS ?? "750"),
  });

  const refinement = await generateStructuredSection({
    schema: DraftRefinementSchema,
    toolName: "generate_refinement_guidance",
    toolDescription: "Generate wireframe and chat refinement guidance for the architecture.",
    sectionName: "Refinement",
    systemPrompt: buildSectionSystemPrompt("refinement", [
      "Generate wireframe and chat refinement guidance only.",
    ]),
    prompt: buildRefinementPrompt(requirementsResult.requirements, architecture),
    maxTokens: Number(process.env.ANTHROPIC_REFINEMENT_MAX_TOKENS ?? "350"),
  });

  const implementationOverview = await generateStructuredSection({
    schema: DraftImplementationOverviewSchema,
    toolName: "generate_implementation_overview",
    toolDescription:
      "Generate the implementation overview, IaC handoff, coordination, and observability plan.",
    sectionName: "Implementation overview",
    systemPrompt: buildSectionSystemPrompt("implementation overview", [
      "Focus on IaC handoff, coordination, and observability policy.",
    ]),
    prompt: buildImplementationOverviewPrompt(
      architecture,
      refinement,
      requirementsResult.requirements,
      domain.open_questions
    ),
    maxTokens: Number(process.env.ANTHROPIC_IMPLEMENTATION_OVERVIEW_MAX_TOKENS ?? "550"),
  });

  const normalizedRequirements = normalizeRequirements(requirementsResult.requirements).map((item) => ({
    id: item.id,
    text: item.text,
  }));
  const derivedLogicRequirements = deriveLogicRequirements(normalizeRequirements(requirementsResult.requirements), architecture);
  const derivedIssuePlan = deriveIssuePlan(derivedLogicRequirements, implementationOverview);
  const normalizedLogicRequirements = derivedLogicRequirements.map((item) => ({
    id: item.id,
    title: item.title,
  }));
  const normalizedIssuePlan = derivedIssuePlan.map((item) => ({
    id: item.id,
    title: item.title,
  }));

  const coverageTrace = await generateStructuredSection({
    schema: DraftCoverageTraceSchema,
    toolName: "generate_coverage_trace",
    toolDescription: "Generate requirement coverage and trace mappings for the planning pack.",
    sectionName: "Coverage and trace",
    systemPrompt: buildSectionSystemPrompt("coverage and trace", [
      "Map each requirement ID to coverage and a terse source hint.",
    ]),
    prompt: buildCoverageTracePrompt(
      normalizedRequirements,
      architecture,
      normalizedLogicRequirements,
      normalizedIssuePlan
    ),
    maxTokens: Number(process.env.ANTHROPIC_COVERAGE_MAX_TOKENS ?? "500"),
  });

  return finalizePack(
    core,
    clarificationsResult.clarifications,
    workflowsResult.workflows,
    requirementsResult.requirements,
    domain,
    architecture,
    refinement,
    implementationOverview,
    derivedLogicRequirements,
    derivedIssuePlan,
    coverageTrace,
    input,
    createdAt
  );
}

export async function refineArchitecturePack(
  input: RefineArchitecturePackInput
): Promise<{ updatedPack: ArchitecturePack; assistantResponse: string }> {
  const planningUpdate = await generateStructuredSection({
    schema: RefinementPlanningUpdateSchema,
    toolName: "refine_planning_scope",
    toolDescription:
      "Update clarification, workflow, and requirement scope for the refined architecture pack.",
    sectionName: "Refinement planning update",
    systemPrompt: buildSectionSystemPrompt("refinement planning update", [
      "Return only the updated clarification, workflow, and requirement scope.",
      "Preserve stable IDs where possible.",
    ]),
    prompt: buildRefinementPlanningPrompt(input),
    maxTokens: Number(process.env.ANTHROPIC_ARCHITECTURE_PLANNING_SCOPE_MAX_TOKENS ?? "700"),
  });

  const domainCoreUpdate = await generateStructuredSection({
    schema: RefinementDomainCoreUpdateSchema,
    toolName: "refine_domain_core_scope",
    toolDescription:
      "Update domain entities and integrations for the refined architecture pack.",
    sectionName: "Refinement domain core update",
    systemPrompt: buildSectionSystemPrompt("refinement domain core update", [
      "Return only the updated entities and integrations.",
    ]),
    prompt: buildRefinementDomainCorePrompt(input),
    maxTokens: Number(process.env.ANTHROPIC_ARCHITECTURE_DOMAIN_CORE_MAX_TOKENS ?? "450"),
  });
  const domainNfrUpdate = await generateStructuredSection({
    schema: RefinementDomainNfrUpdateSchema,
    toolName: "refine_domain_nfr_scope",
    toolDescription: "Update non-functional requirements for the refined architecture pack.",
    sectionName: "Refinement domain NFR update",
    systemPrompt: buildSectionSystemPrompt("refinement domain NFR update", [
      "Return only the updated NFR object.",
    ]),
    prompt: buildRefinementDomainNfrPrompt(input),
    maxTokens: Number(process.env.ANTHROPIC_ARCHITECTURE_DOMAIN_NFR_MAX_TOKENS ?? "250"),
  });
  const domainDecisionUpdate = await generateStructuredSection({
    schema: RefinementDomainDecisionUpdateSchema,
    toolName: "refine_domain_decision_scope",
    toolDescription:
      "Update assumptions and remaining open questions for the refined architecture pack.",
    sectionName: "Refinement domain decision update",
    systemPrompt: buildSectionSystemPrompt("refinement domain decision update", [
      "Return only the updated assumptions and remaining open questions.",
    ]),
    prompt: buildRefinementDomainDecisionPrompt(input),
    maxTokens: Number(process.env.ANTHROPIC_ARCHITECTURE_DOMAIN_DECISION_MAX_TOKENS ?? "350"),
  });

  const mergedClarifications = normalizeClarifications(planningUpdate.clarifications);
  const mergedWorkflows = preferNonEmpty(
    normalizeWorkflows(planningUpdate.workflows),
    input.currentPack.workflows
  );
  const mergedRequirements = preferNonEmpty(
    normalizeRequirements(planningUpdate.requirements),
    input.currentPack.requirements
  );
  const mergedEntities = preferNonEmpty(
    limitArray(domainCoreUpdate.entities, 6),
    input.currentPack.entities
  );
  const mergedIntegrations = preferNonEmpty(
    limitArray(
      domainCoreUpdate.integrations.map((item) => ({
        ...item,
        direction: item.direction ?? "outbound",
        criticality: item.criticality ?? "medium",
      })),
      6
    ),
    input.currentPack.integrations
  );
  const mergedNfrs = {
    ...input.currentPack.nfrs,
    ...domainNfrUpdate.nfrs,
  };
  const mergedAssumptions = limitArray(uniqueStrings(domainDecisionUpdate.assumptions), 5);
  const mergedOpenQuestions = limitArray(uniqueStrings(domainDecisionUpdate.open_questions), 5);

  const mergedScopeContext = {
    ...planningUpdate,
    ...domainCoreUpdate,
    ...domainNfrUpdate,
    ...domainDecisionUpdate,
    clarifications: mergedClarifications,
    workflows: mergedWorkflows,
    requirements: mergedRequirements,
    entities: mergedEntities,
    integrations: mergedIntegrations,
    nfrs: mergedNfrs,
    assumptions: mergedAssumptions,
    open_questions: mergedOpenQuestions,
  };

  const architectureCoreUpdate = await generateStructuredSection({
    schema: ArchitectureCoreUpdateSchema,
    toolName: "refine_architecture_core",
    toolDescription:
      "Return the revised architecture core: name, description, and components.",
    sectionName: "Refined architecture core",
    systemPrompt: buildSectionSystemPrompt("refined architecture core", [
      "Return only the revised architecture core.",
      "Preserve component names where they still make sense.",
    ]),
    prompt: buildArchitectureCoreRefinementPrompt(input, mergedScopeContext),
    maxTokens: Number(process.env.ANTHROPIC_ARCHITECTURE_CORE_MAX_TOKENS ?? "450"),
  });
  const architectureTopologyUpdate = await generateStructuredSection({
    schema: ArchitectureTopologyUpdateSchema,
    toolName: "refine_architecture_topology",
    toolDescription:
      "Return the revised architecture topology: flows, stores, async patterns, and API surface.",
    sectionName: "Refined architecture topology",
    systemPrompt: buildSectionSystemPrompt("refined architecture topology", [
      "Return only the revised topology details.",
    ]),
    prompt: buildArchitectureTopologyRefinementPrompt(input, mergedScopeContext),
    maxTokens: Number(process.env.ANTHROPIC_ARCHITECTURE_TOPOLOGY_MAX_TOKENS ?? "400"),
  });
  const architectureTradeoffsUpdate = await generateStructuredSection({
    schema: ArchitectureTradeoffsUpdateSchema,
    toolName: "refine_architecture_tradeoffs",
    toolDescription: "Return the revised architecture tradeoffs and rationale.",
    sectionName: "Refined architecture tradeoffs",
    systemPrompt: buildSectionSystemPrompt("refined architecture tradeoffs", [
      "Return only the revised tradeoffs and rationale.",
    ]),
    prompt: buildArchitectureTradeoffsRefinementPrompt(input, mergedScopeContext),
    maxTokens: Number(process.env.ANTHROPIC_ARCHITECTURE_TRADEOFFS_MAX_TOKENS ?? "350"),
  });

  const updatedArchitecture = resolveArchitectureSection(
    {
      core: architectureCoreUpdate,
      topology: architectureTopologyUpdate,
      tradeoffs: architectureTradeoffsUpdate,
    },
    input.currentPack.architecture
  );

  const refinementSection = await generateStructuredSection({
    schema: RefinementSectionUpdateSchema,
    toolName: "refine_refinement_guidance",
    toolDescription: "Return revised wireframe and chat refinement guidance.",
    sectionName: "Refinement guidance update",
    systemPrompt: buildSectionSystemPrompt("refinement guidance update", [
      "Return only the revised refinement guidance.",
    ]),
    prompt: buildRefinementGuidanceUpdatePrompt(
      mergedRequirements,
      updatedArchitecture,
      input.messages
    ),
    maxTokens: Number(process.env.ANTHROPIC_REFINEMENT_GUIDANCE_MAX_TOKENS ?? "350"),
  });
  const updatedRefinement = resolveRefinementSection(
    refinementSection,
    input.currentPack.refinement
  );

  const implementationOverview = deriveImplementationOverviewFromArchitecture(
    updatedArchitecture,
    updatedRefinement,
    {
      summary: input.currentPack.implementation.summary,
      iac_handoff: input.currentPack.implementation.iac_handoff,
      coordination: input.currentPack.implementation.coordination,
      observability: input.currentPack.implementation.observability,
    },
    mergedOpenQuestions
  );

  const derivedLogicRequirements = deriveLogicRequirements(mergedRequirements, updatedArchitecture);
  const derivedIssuePlan = deriveIssuePlan(derivedLogicRequirements, implementationOverview);
  const normalizedRequirements = mergedRequirements.map((item) => ({
    id: item.id,
    text: item.text,
  }));
  const normalizedLogicRequirements = derivedLogicRequirements.map((item) => ({
    id: item.id,
    title: item.title,
  }));
  const normalizedIssuePlan = derivedIssuePlan.map((item) => ({
    id: item.id,
    title: item.title,
  }));

  const coverageTrace = await generateStructuredSection({
    schema: DraftCoverageTraceSchema,
    toolName: "refine_coverage_trace",
    toolDescription: "Refresh requirement coverage and trace after refinement.",
    sectionName: "Refined coverage and trace",
    systemPrompt: buildSectionSystemPrompt("refined coverage and trace", [
      "Refresh requirement coverage after refinement.",
    ]),
    prompt: buildCoverageTraceRefinementPrompt(
      normalizedRequirements,
      updatedArchitecture,
      normalizedLogicRequirements,
      normalizedIssuePlan,
      input.messages
    ),
    maxTokens: Number(process.env.ANTHROPIC_REFINEMENT_COVERAGE_MAX_TOKENS ?? "450"),
  });

  const updatedPack = ArchitecturePackSchema.parse({
    ...input.currentPack,
    run_id: input.currentPack.run_id,
    pack_version: PACK_VERSION,
    created_at: new Date().toISOString(),
    tool: {
      name: "PASS-2A",
      version: TOOL_VERSION,
    },
    clarifications: mergedClarifications,
    workflows: mergedWorkflows,
    requirements: mergedRequirements,
    entities: mergedEntities,
    integrations: mergedIntegrations,
    nfrs: mergedNfrs,
    architecture: {
      ...updatedArchitecture,
      components: limitArray(updatedArchitecture.components, 8),
      data_flows: limitArray(uniqueStrings(updatedArchitecture.data_flows), 6),
      data_stores: limitArray(uniqueStrings(updatedArchitecture.data_stores), 6),
      async_patterns: limitArray(uniqueStrings(updatedArchitecture.async_patterns), 6),
      api_surface: limitArray(uniqueStrings(updatedArchitecture.api_surface), 6),
      tradeoffs: {
        pros: limitArray(uniqueStrings(updatedArchitecture.tradeoffs.pros), 5),
        cons: limitArray(uniqueStrings(updatedArchitecture.tradeoffs.cons), 5),
        risks: limitArray(uniqueStrings(updatedArchitecture.tradeoffs.risks), 5),
      },
    },
    refinement: updatedRefinement,
    implementation: {
      summary: implementationOverview.summary,
      iac_handoff: {
        summary: implementationOverview.iac_handoff.summary,
        modules: limitArray(uniqueStrings(implementationOverview.iac_handoff.modules), 6),
      },
      logic_requirements: derivedLogicRequirements,
      github_issue_plan: derivedIssuePlan,
      coordination: {
        pause_on_pending_questions: implementationOverview.coordination.pause_on_pending_questions ?? true,
        live_issue_updates: implementationOverview.coordination.live_issue_updates ?? true,
        coordination_views: limitArray(uniqueStrings(implementationOverview.coordination.coordination_views), 6),
        question_sources: limitArray(uniqueStrings(implementationOverview.coordination.question_sources), 6),
      },
      observability: {
        log_traces_enabled: implementationOverview.observability.log_traces_enabled ?? true,
        coordination_panel_enabled: implementationOverview.observability.coordination_panel_enabled ?? true,
        required_signals: limitArray(uniqueStrings(implementationOverview.observability.required_signals), 6),
        dashboard_panels: limitArray(uniqueStrings(implementationOverview.observability.dashboard_panels), 6),
      },
    },
    assumptions: mergedAssumptions,
    open_questions: mergedOpenQuestions,
    coverage: coverageTrace.coverage,
    trace: coverageTrace.trace,
  });

  const assistantResponse = await generateArchitectureAssistantReply({
    currentPack: updatedPack,
    messages: input.messages,
  });

  return {
    updatedPack,
    assistantResponse,
  };
}

export async function generateArchitectureAssistantReply(
  input: RefineArchitecturePackInput
): Promise<string> {
  const result = await generateStructuredSection({
    schema: z.object({ assistant_response: z.string().min(1) }),
    toolName: "generate_architecture_assistant_reply",
    toolDescription: "Generate a concise assistant reply for the architecture refinement chat.",
    sectionName: "Architecture assistant reply",
    systemPrompt: buildSectionSystemPrompt("architecture assistant reply", [
      "Return one assistant reply only.",
      "Do not return the architecture pack.",
    ]),
    prompt: buildArchitectureAssistantReplyPrompt(input),
    maxTokens: Number(process.env.ANTHROPIC_ARCHITECTURE_CHAT_MAX_TOKENS ?? "550"),
  });

  return result.assistant_response.trim();
}

export async function generateDecompositionPlan(
  input: GenerateDecompositionPlanInput
): Promise<DecompositionPlan> {
  const targetCount = Number(process.env.PASS_DECOMPOSITION_TARGET_COUNT ?? "36");
  const baseTaskPlan = await callAnthropicStructuredTool(
    DecompositionBaseTaskPlanSchema,
    "generate_decomposition_base_tasks",
    "Create the parent/base implementation tasks for a project decomposition plan.",
    buildSectionSystemPrompt("decomposition base task plan", [
      "Return only parent implementation tasks.",
      "Do not generate testing work.",
    ]),
    buildDecompositionPrompt(input),
    Number(process.env.ANTHROPIC_DECOMPOSITION_BASE_MAX_TOKENS ?? "900")
  );
  const primaryBaseTasks =
    baseTaskPlan.base_tasks.length > 0 ? baseTaskPlan.base_tasks : await generateFallbackBaseTasks(input.pack);
  const baseTasks = normalizeBaseDecompositionTasks(input.pack, primaryBaseTasks);

  if (baseTasks.length === 0) {
    throw new Error("Decomposition base task generation returned no tasks.");
  }

  const batchItemIdsByBaseTask = new Map<string, string[]>();
  const detailedBatches = await mapWithConcurrency(
    baseTasks,
    getAnthropicBatchConcurrency(),
    async (baseTask) => ({
      baseTask,
      batch: await callAnthropicStructuredTool(
        DecompositionBatchSchema,
        "generate_decomposition_detail_batch",
        "Expand one parent decomposition task into tiny implementation work items.",
        buildSectionSystemPrompt(`detailed decomposition for ${baseTask.title}`, [
          "Return only implementation work items for this parent task.",
          "Do not generate testing work.",
        ]),
        buildBaseTaskDetailPrompt({
          pack: input.pack,
          baseTask,
          targetCount: detailTargetCount(targetCount, baseTasks.length, baseTask),
        }),
        Number(process.env.ANTHROPIC_DECOMPOSITION_DETAIL_MAX_TOKENS ?? "850")
      ),
    })
  );

  const detailedItems: z.infer<typeof DecompositionWorkItemSchema>[] = [];

  for (const { baseTask, batch } of detailedBatches) {
    const normalizedBatch = normalizeBatchWorkItems(
      batch.work_items.map((item) => ({
        ...item,
        component: item.component?.trim() || baseTask.component,
        category: item.category,
        labels: uniqueStrings([
          ...item.labels,
          "implementation",
          `category:${item.category}`,
          `base_task:${slugifyWorkItemFragment(baseTask.title)}`,
        ]),
      })),
      slugifyWorkItemFragment(baseTask.id),
      detailedItems.length
    );

    if (normalizedBatch.length === 0) {
      continue;
    }

    batchItemIdsByBaseTask.set(
      baseTask.id,
      normalizedBatch.map((item) => item.id)
    );
    detailedItems.push(...normalizedBatch);
  }

  const workItems = dedupeWorkItems(
    detailedItems.map((item) => {
      const baseTaskMatch = baseTasks.find((baseTask) =>
        item.labels.includes(`base_task:${slugifyWorkItemFragment(baseTask.title)}`)
      );
      if (!baseTaskMatch) {
        return item;
      }

      const inheritedDependencies = baseTaskMatch.depends_on
        .flatMap((dependencyId) => {
          const batchIds = batchItemIdsByBaseTask.get(dependencyId) ?? [];
          return batchIds.length > 0 ? [batchIds[batchIds.length - 1] as string] : [];
        })
        .filter(Boolean);

      if (inheritedDependencies.length === 0) {
        return item;
      }

      const baseBatchIds = batchItemIdsByBaseTask.get(baseTaskMatch.id) ?? [];
      if (baseBatchIds[0] !== item.id) {
        return item;
      }

      return {
        ...item,
        depends_on: uniqueStrings([...inheritedDependencies, ...item.depends_on]),
      };
    })
  ).filter((item) => !isTestingOnlyWorkItem(item));

  if (workItems.length === 0) {
    throw new Error("Detailed decomposition generation returned no implementation work items.");
  }

  return DecompositionPlanSchema.parse({
    generated_at: new Date().toISOString(),
    summary: buildDecompositionSummary(input.pack, workItems),
    approval_notes: buildDecompositionApprovalNotes(input.pack),
    work_items: workItems,
  });
}

export async function generateDecompositionIteratorReview(
  input: GenerateDecompositionIteratorReviewInput
) {
  return callAnthropicStructuredTool(
    DecompositionIteratorReviewSchema,
    "review_decomposition_iterator",
    "Review decomposition coverage, propose missing implementation work items, and open clarifying questions when needed.",
    buildSectionSystemPrompt("decomposition iterator review", [
      "Return only decomposition review findings.",
      "Do not generate testing work.",
    ]),
    buildDecompositionIteratorReviewPrompt(input),
    Number(process.env.ANTHROPIC_DECOMPOSITION_REVIEW_MAX_TOKENS ?? "900")
  );
}
