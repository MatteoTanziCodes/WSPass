import { z } from "zod";
import {
  ArchitecturePackSchema,
  DecompositionPlanSchema,
  OrgConstraintsSchema,
  PACK_VERSION,
  type ArchitecturePack,
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

const DraftDomainSchema = z.object({
  entities: z.array(DraftEntitySchema).default([]),
  integrations: z.array(DraftIntegrationSchema).default([]),
  nfrs: z.object({
    scale: z.enum(["small", "medium", "large"]).optional(),
    availability: z.enum(["best_effort", "standard", "high"]).optional(),
    latency: z.enum(["relaxed", "standard", "low"]).optional(),
    data_sensitivity: z.enum(["none", "pii", "financial_like"]).optional(),
    auditability: z.enum(["none", "basic", "strong"]).optional(),
  }),
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
  orgConstraints: OrgConstraints;
};

type RefineArchitecturePackInput = {
  currentPack: ArchitecturePack;
  messages: Array<{ role: "user" | "assistant" | "system"; content: string }>;
};

type GenerateDecompositionPlanInput = {
  pack: ArchitecturePack;
};

type AnthropicCompletion = {
  text: string;
  stopReason: string | null;
};

function compactJson(value: unknown) {
  return JSON.stringify(value);
}

function uniqueStrings(values: string[]) {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function limitArray<T>(values: T[], limit: number) {
  return values.slice(0, limit);
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
    "Org constraints JSON:",
    compactJson(input.orgConstraints),
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
    compactJson({ prd: core.prd, actors: core.actors, workflows, org_constraints: input.orgConstraints }),
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
    compactJson({ prd: core.prd, requirements, org_constraints: input.orgConstraints }),
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

function buildArchitectureRefinementPrompt(input: RefineArchitecturePackInput) {
  return [
    `Return JSON with the exact full ArchitecturePack shape used by PASS-2A.`,
    "Preserve stable IDs where possible.",
    "Update the architecture, requirements, refinement guidance, implementation summary, assumptions, open questions, coverage, and trace when the feedback requires it.",
    "Keep the pack coherent as one source of truth.",
    "Do not add markdown.",
    "Current architecture pack JSON:",
    compactJson(input.currentPack),
    "Conversation messages JSON:",
    compactJson(input.messages),
  ].join("\n");
}

function buildDecompositionPrompt(input: GenerateDecompositionPlanInput) {
  const targetCount = Number(process.env.PASS_DECOMPOSITION_TARGET_COUNT ?? "36");
  return [
    'Return JSON with this exact shape: {"generated_at":"2026-01-01T00:00:00.000Z","summary":"...","approval_notes":"optional","work_items":[{"id":"work_1","title":"...","summary":"...","category":"backend","size":"tiny","component":"API","acceptance_criteria":["..."],"depends_on":["work_0"],"labels":["implementation","category:backend"]}]}',
    `Generate approximately ${targetCount} work items unless the project is too small to justify that many.`,
    "Work items must be very small and async-friendly.",
    "Prefer tiny tasks over broad tasks.",
    "Each work item should focus on one component or one thin slice.",
    "Use category only from frontend, backend, infra, data, qa, docs, ops.",
    "Use size only from tiny or small.",
    "Keep acceptance criteria short.",
    "Architecture pack JSON:",
    compactJson(input.pack),
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

async function callAnthropic(systemPrompt: string, prompt: string, maxTokens: number) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error("ANTHROPIC_API_KEY is required.");
  }

  const responseUrl = `${process.env.ANTHROPIC_BASE_URL ?? "https://api.anthropic.com/v1"}/messages`;
  const version = process.env.ANTHROPIC_VERSION ?? "2023-06-01";
  const model = process.env.ANTHROPIC_MODEL ?? "claude-sonnet-4-6";
  const timeoutMs = Number(process.env.ANTHROPIC_TIMEOUT_MS ?? "45000");
  const temperature = Number(process.env.ANTHROPIC_TEMPERATURE ?? "0");

  const response = await fetch(responseUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": version,
    },
    body: JSON.stringify({
      model,
      max_tokens: maxTokens,
      temperature,
      system: systemPrompt,
      messages: [{ role: "user", content: prompt }],
    }),
    signal: AbortSignal.timeout(timeoutMs),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Anthropic request failed with ${response.status}: ${body || response.statusText}`);
  }

  return extractText(await response.json());
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
      const completion = await callAnthropic(systemPrompt, currentPrompt, maxTokens);
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

export async function generateArchitecturePack(
  input: GenerateArchitecturePackInput
): Promise<ArchitecturePack> {
  const createdAt = new Date().toISOString();

  const core = await generateSection(
    DraftPrdCoreSchema,
    "PRD core",
    buildSectionSystemPrompt("PRD core", ["Keep the response under 250 words."]),
    buildPrdCorePrompt(input),
    Number(process.env.ANTHROPIC_CORE_MAX_TOKENS ?? "350")
  );

  const clarificationsResult = await generateSection(
    z.object({ clarifications: z.array(DraftClarificationSchema).default([]) }),
    "Clarifications",
    buildSectionSystemPrompt("clarifications", ["Return only architecture-shaping questions."]),
    buildClarificationsPrompt(input),
    Number(process.env.ANTHROPIC_CLARIFICATIONS_MAX_TOKENS ?? "450")
  );

  const workflowsResult = await generateSection(
    z.object({ workflows: z.array(DraftWorkflowSchema).default([]) }),
    "Workflows",
    buildSectionSystemPrompt("workflows", ["Keep workflows terse and execution-oriented."]),
    buildWorkflowsPrompt(core, clarificationsResult.clarifications),
    Number(process.env.ANTHROPIC_WORKFLOWS_MAX_TOKENS ?? "500")
  );

  const requirementsResult = await generateSection(
    z.object({ requirements: z.array(DraftRequirementSchema).default([]) }),
    "Requirements",
    buildSectionSystemPrompt("requirements", ["Focus on build-critical requirements only."]),
    buildRequirementsPrompt(input, core, workflowsResult.workflows),
    Number(process.env.ANTHROPIC_REQUIREMENTS_MAX_TOKENS ?? "700")
  );

  const domain = await generateSection(
    DraftDomainSchema,
    "Domain",
    buildSectionSystemPrompt("domain", ["Extract only domain model, integrations, NFRs, assumptions, and open questions."]),
    buildDomainPrompt(input, core, requirementsResult.requirements),
    Number(process.env.ANTHROPIC_DOMAIN_MAX_TOKENS ?? "650")
  );

  const architecture = await generateSection(
    DraftArchitectureSchema,
    "Architecture",
    buildSectionSystemPrompt("architecture", ["Generate one concrete architecture only."]),
    buildArchitecturePrompt(input, core, workflowsResult.workflows, requirementsResult.requirements, domain),
    Number(process.env.ANTHROPIC_ARCHITECTURE_MAX_TOKENS ?? "750")
  );

  const refinement = await generateSection(
    DraftRefinementSchema,
    "Refinement",
    buildSectionSystemPrompt("refinement", ["Generate wireframe and chat refinement guidance only."]),
    buildRefinementPrompt(requirementsResult.requirements, architecture),
    Number(process.env.ANTHROPIC_REFINEMENT_MAX_TOKENS ?? "350")
  );

  const implementationOverview = await generateSection(
    DraftImplementationOverviewSchema,
    "Implementation overview",
    buildSectionSystemPrompt("implementation overview", [
      "Focus on IaC handoff, coordination, and observability policy.",
    ]),
    buildImplementationOverviewPrompt(
      architecture,
      refinement,
      requirementsResult.requirements,
      domain.open_questions
    ),
    Number(process.env.ANTHROPIC_IMPLEMENTATION_OVERVIEW_MAX_TOKENS ?? "550")
  );

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

  const coverageTrace = await generateSection(
    DraftCoverageTraceSchema,
    "Coverage and trace",
    buildSectionSystemPrompt("coverage and trace", ["Map each requirement ID to coverage and a terse source hint."]),
    buildCoverageTracePrompt(normalizedRequirements, architecture, normalizedLogicRequirements, normalizedIssuePlan),
    Number(process.env.ANTHROPIC_COVERAGE_MAX_TOKENS ?? "500")
  );

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
): Promise<ArchitecturePack> {
  const refined = await generateSection(
    ArchitecturePackSchema,
    "Architecture refinement",
    buildSectionSystemPrompt("architecture refinement", [
      "Return the full architecture pack JSON only.",
      "Preserve existing context unless feedback explicitly changes it.",
    ]),
    buildArchitectureRefinementPrompt(input),
    Number(process.env.ANTHROPIC_ARCHITECTURE_REFINEMENT_MAX_TOKENS ?? "2600")
  );

  return ArchitecturePackSchema.parse({
    ...refined,
    run_id: input.currentPack.run_id,
    pack_version: PACK_VERSION,
    created_at: new Date().toISOString(),
    tool: {
      name: "PASS-2A",
      version: TOOL_VERSION,
    },
  });
}

export async function generateDecompositionPlan(
  input: GenerateDecompositionPlanInput
): Promise<DecompositionPlan> {
  const draft = await generateSection(
    DecompositionPlanSchema,
    "Decomposition plan",
    buildSectionSystemPrompt("decomposition plan", [
      "Return only the decomposition plan JSON.",
      "Generate many very small work items.",
    ]),
    buildDecompositionPrompt(input),
    Number(process.env.ANTHROPIC_DECOMPOSITION_MAX_TOKENS ?? "3200")
  );

  return DecompositionPlanSchema.parse({
    ...draft,
    generated_at: new Date().toISOString(),
  });
}
