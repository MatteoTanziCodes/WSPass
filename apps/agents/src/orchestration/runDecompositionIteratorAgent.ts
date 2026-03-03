import { z } from "zod";
import {
  ArchitectureChatStateSchema,
  ArchitecturePackSchema,
  DecompositionClarifyingQuestionSchema,
  DecompositionGapSchema,
  DecompositionPlanSchema,
  DecompositionReviewArtifactSchema,
  DecompositionReviewStateSchema,
  DecompositionStateSchema,
  DecompositionWorkItemSchema,
  ImplementationIssueStateCollectionSchema,
  PlannerRunInputSchema,
  ProjectContextSchema,
  RepoStateSchema,
  RunExecutionSchema,
  RunStatusSchema,
  RunStepSchema,
} from "@pass/shared";
import {
  generateDecompositionIteratorReview,
  generateDecompositionPlan,
} from "../providers/llmClient";
import { renderSummary as renderDecompositionSummary } from "../decomposition/runDecompositionAgent";
import {
  LlmObservabilityRecorder,
  withLlmObservabilityRecorder,
} from "../lib/llmObservability";

const MAX_ITERATIONS = 3;

const RunDetailSchema = z
  .object({
    run_id: z.uuid(),
    created_at: z.string().datetime(),
    status: RunStatusSchema,
    current_step: RunStepSchema,
    last_updated_at: z.string().datetime(),
    step_timestamps: z.record(z.string(), z.string().datetime()),
    input: PlannerRunInputSchema.optional(),
    execution: RunExecutionSchema.optional(),
    repo_state: RepoStateSchema.optional(),
    architecture_chat: ArchitectureChatStateSchema.optional(),
    decomposition_state: DecompositionStateSchema.optional(),
    decomposition_review_state: DecompositionReviewStateSchema.optional(),
    implementation_state: ImplementationIssueStateCollectionSchema.optional(),
  })
  .strict();

const GetRunResponseSchema = z
  .object({
    run: RunDetailSchema,
    artifacts: z.array(z.unknown()),
  })
  .strict();

const GetArtifactResponseSchema = z
  .object({
    artifact: z.object({
      name: z.string().min(1),
      filename: z.string().min(1),
      content_type: z.enum(["application/json", "text/plain", "text/markdown"]),
      created_at: z.string().datetime(),
      sha256: z.string().optional(),
    }),
    payload: z.unknown(),
  })
  .strict();

type RunDetail = z.infer<typeof RunDetailSchema>;
type ProjectContext = z.infer<typeof ProjectContextSchema>;
type DecompositionPlan = z.infer<typeof DecompositionPlanSchema>;
type DecompositionWorkItem = z.infer<typeof DecompositionWorkItemSchema>;
type DecompositionGap = z.infer<typeof DecompositionGapSchema>;
type DecompositionQuestion = z.infer<typeof DecompositionClarifyingQuestionSchema>;
type DecompositionReviewArtifact = z.infer<typeof DecompositionReviewArtifactSchema>;
type ClaudeIteratorReview = Awaited<ReturnType<typeof generateDecompositionIteratorReview>>;
type CoverageTargetType =
  | "requirement"
  | "workflow"
  | "component"
  | "integration"
  | "data_store"
  | "async_pattern"
  | "api_surface";
type CoverageTarget = {
  id: string;
  type: CoverageTargetType;
  summary: string;
  relatedComponents: string[];
  tokens: string[];
};
type CoverageSnapshot = DecompositionReviewArtifact["coverage_snapshot"][number];

class PassApiClient {
  private readonly baseUrl: string;
  private readonly token: string;

  constructor(opts: { baseUrl: string; token: string }) {
    this.baseUrl = opts.baseUrl.replace(/\/+$/, "");
    this.token = opts.token;
  }

  async getRun(runId: string): Promise<RunDetail> {
    const response = await this.request("GET", `/runs/${runId}`);
    return GetRunResponseSchema.parse(response).run;
  }

  async getArtifact(runId: string, artifactName: string) {
    const response = await this.request("GET", `/runs/${runId}/artifacts/${artifactName}`);
    return GetArtifactResponseSchema.parse(response);
  }

  async getOptionalArtifact(runId: string, artifactName: string) {
    try {
      return await this.getArtifact(runId, artifactName);
    } catch (error) {
      if (error instanceof Error && error.message.includes(" 404:")) {
        return null;
      }
      throw error;
    }
  }

  async updateRun(
    runId: string,
    patch: { status?: z.infer<typeof RunStatusSchema>; current_step?: z.infer<typeof RunStepSchema> }
  ) {
    await this.request("PATCH", `/runs/${runId}`, patch);
  }

  async updateExecution(
    runId: string,
    patch: {
      status: "running" | "succeeded" | "failed";
      github_run_id?: number;
      github_run_url?: string;
      error_message?: string;
    }
  ) {
    await this.request("PATCH", `/runs/${runId}/execution`, patch, true);
  }

  async updateDecompositionState(runId: string, payload: z.infer<typeof DecompositionStateSchema>) {
    await this.request("PATCH", `/runs/${runId}/decomposition-state`, payload, true);
  }

  async updateDecompositionReviewState(
    runId: string,
    payload: z.infer<typeof DecompositionReviewStateSchema>
  ) {
    await this.request("PATCH", `/runs/${runId}/decomposition-review-state`, payload, true);
  }

  async uploadArtifact(
    runId: string,
    artifact: {
      name: string;
      content_type: "application/json" | "text/plain" | "text/markdown";
      payload: unknown;
    }
  ) {
    await this.request("POST", `/runs/${runId}/artifacts`, artifact, true);
  }

  private async request(method: string, path: string, body?: unknown, authenticated = false) {
    const headers: Record<string, string> = { Accept: "application/json" };
    if (body !== undefined) {
      headers["Content-Type"] = "application/json";
    }
    if (authenticated) {
      headers.Authorization = `Bearer ${this.token}`;
    }

    const response = await fetch(`${this.baseUrl}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });

    const text = await response.text();
    const json = text ? JSON.parse(text) : undefined;

    if (!response.ok) {
      throw new Error(
        `PASS API ${method} ${path} failed with ${response.status}: ${text || response.statusText}`
      );
    }

    return json;
  }
}

function readRequiredEnv(name: string) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is required.`);
  }
  return value;
}

function buildFailureMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function normalizeText(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9\s]+/g, " ");
}

function slugify(value: string) {
  return normalizeText(value).trim().replace(/\s+/g, "_").slice(0, 48) || "item";
}

const STOP_WORDS = new Set([
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
        .filter((token) => token.length > 2 && !STOP_WORDS.has(token))
    ),
  ];
}

function categoryForComponentType(
  componentType: z.infer<typeof ArchitecturePackSchema>["architecture"]["components"][number]["type"]
) {
  switch (componentType) {
    case "web":
      return "frontend" as const;
    case "db":
      return "data" as const;
    case "queue":
    case "cache":
    case "object_storage":
      return "infra" as const;
    case "auth_provider":
    case "external_integration":
      return "ops" as const;
    default:
      return "backend" as const;
  }
}

function buildProjectContext(args: {
  pack: z.infer<typeof ArchitecturePackSchema>;
  normalizedPrdText?: string;
  normalizedOrgConstraintsText?: string;
  normalizedDesignGuidelinesText?: string;
  chatState?: z.infer<typeof ArchitectureChatStateSchema>;
}): ProjectContext {
  const { pack, normalizedPrdText, normalizedOrgConstraintsText, normalizedDesignGuidelinesText, chatState } =
    args;
  const refinementDecisions = (chatState?.messages ?? [])
    .filter((message) => message.role !== "system")
    .slice(-8)
    .map((message) => `${message.role}: ${message.content.replace(/\s+/g, " ").trim().slice(0, 180)}`);

  return ProjectContextSchema.parse({
    generated_at: new Date().toISOString(),
    prd_summary: normalizedPrdText?.trim() || pack.prd.summary,
    org_constraints_summary:
      normalizedOrgConstraintsText?.trim() || "No explicit org constraints were provided.",
    design_guidelines_summary:
      normalizedDesignGuidelinesText?.trim() || "No explicit design guidelines were provided.",
    architecture_summary: [
      pack.architecture.description,
      `Components: ${pack.architecture.components.map((item) => item.name).join(", ")}`,
      `Integrations: ${pack.integrations.map((item) => item.name).join(", ") || "none"}`,
    ].join("\n"),
    key_decisions: [
      ...pack.architecture.components.map((item) => `Use ${item.name} as the ${item.type} component.`),
      ...pack.architecture.tradeoffs.pros.slice(0, 3),
      ...pack.architecture.tradeoffs.cons.slice(0, 3),
    ],
    refinement_decisions: refinementDecisions,
    coverage_targets: [
      ...pack.requirements.map((item) => `Requirement ${item.id}: ${item.text}`),
      ...pack.workflows.map((item) => `Workflow ${item.id}: ${item.name}`),
      ...pack.architecture.components.map((item) => `Component: ${item.name} (${item.type})`),
      ...pack.integrations.map((item) => `Integration: ${item.name}`),
      ...pack.architecture.data_stores.map((item) => `Data store: ${item}`),
      ...pack.architecture.async_patterns.map((item) => `Async pattern: ${item}`),
      ...pack.architecture.api_surface.map((item) => `API surface: ${item}`),
    ],
    unresolved_architecture_questions: [
      ...pack.open_questions,
      ...pack.clarifications.filter((item) => item.default_used).map((item) => item.question),
    ],
  });
}

function renderProjectContextSummary(context: ProjectContext) {
  return [
    "# Project Context",
    "",
    "## PRD Summary",
    context.prd_summary,
    "",
    "## Org Constraints",
    context.org_constraints_summary,
    "",
    "## Design Guidelines",
    context.design_guidelines_summary,
    "",
    "## Architecture Summary",
    context.architecture_summary,
    "",
    "## Key Decisions",
    ...(context.key_decisions.length > 0 ? context.key_decisions.map((item) => `- ${item}`) : ["- None"]),
    "",
    "## Refinement Decisions",
    ...(context.refinement_decisions.length > 0
      ? context.refinement_decisions.map((item) => `- ${item}`)
      : ["- None"]),
    "",
  ].join("\n");
}

function buildCoverageTargets(pack: z.infer<typeof ArchitecturePackSchema>): CoverageTarget[] {
  const componentNames = pack.architecture.components.map((item) => item.name);
  const guessRelatedComponents = (value: string) => {
    const valueTokens = tokens(value);
    const matches = pack.architecture.components
      .filter((component) => {
        const componentTokens = tokens(`${component.name} ${component.type}`);
        return componentTokens.some((token) => valueTokens.includes(token));
      })
      .map((component) => component.name);

    return matches.length > 0 ? matches : componentNames.slice(0, 1);
  };

  return [
    ...pack.requirements.map((item) => ({
      id: item.id,
      type: "requirement" as const,
      summary: item.text,
      relatedComponents: guessRelatedComponents(item.text),
      tokens: tokens(item.text),
    })),
    ...pack.workflows.map((item) => ({
      id: item.id,
      type: "workflow" as const,
      summary: `${item.name} ${item.steps.join(" ")}`,
      relatedComponents: guessRelatedComponents(`${item.name} ${item.steps.join(" ")}`),
      tokens: tokens(`${item.name} ${item.steps.join(" ")}`),
    })),
    ...pack.architecture.components.map((item) => ({
      id: item.name,
      type: "component" as const,
      summary: `${item.name} ${item.type}`,
      relatedComponents: [item.name],
      tokens: tokens(`${item.name} ${item.type}`),
    })),
    ...pack.integrations.map((item) => ({
      id: item.name,
      type: "integration" as const,
      summary: `${item.name} ${item.purpose}`,
      relatedComponents: guessRelatedComponents(`${item.name} ${item.purpose}`),
      tokens: tokens(`${item.name} ${item.purpose}`),
    })),
    ...pack.architecture.data_stores.map((item) => ({
      id: item,
      type: "data_store" as const,
      summary: item,
      relatedComponents: guessRelatedComponents(item),
      tokens: tokens(item),
    })),
    ...pack.architecture.async_patterns.map((item) => ({
      id: item,
      type: "async_pattern" as const,
      summary: item,
      relatedComponents: guessRelatedComponents(item),
      tokens: tokens(item),
    })),
    ...pack.architecture.api_surface.map((item) => ({
      id: item,
      type: "api_surface" as const,
      summary: item,
      relatedComponents: guessRelatedComponents(item),
      tokens: tokens(item),
    })),
  ];
}

function itemTokens(item: DecompositionWorkItem) {
  return tokens(
    [item.id, item.title, item.summary, item.component, ...item.acceptance_criteria, ...item.labels].join(" ")
  );
}

function isTestingOnlyWorkItem(item: DecompositionWorkItem) {
  const haystack = normalizeText(
    [item.category, item.title, item.summary, ...item.acceptance_criteria, ...item.labels].join(" ")
  );

  return (
    item.category === "qa" ||
    [
      "smoke test",
      "test suite",
      "integration test",
      "unit test",
      "e2e",
      "end to end",
      "ci gate",
      "playwright",
      "cypress",
      "jest",
      "vitest",
    ].some((needle) => haystack.includes(needle))
  );
}

function isStaleWorkItem(pack: z.infer<typeof ArchitecturePackSchema>, item: DecompositionWorkItem) {
  const haystack = normalizeText([item.title, item.summary, item.component, ...item.labels].join(" "));
  const validComponents = new Set(pack.architecture.components.map((component) => normalizeText(component.name).trim()));
  const normalizedComponent = normalizeText(item.component).trim();

  if (haystack.includes("strapi") || haystack.includes("aladham") || haystack.includes("aladhan")) {
    return true;
  }

  if (
    normalizedComponent &&
    !validComponents.has(normalizedComponent) &&
    !["platform", "shared", "cross cutting", "cross-cutting", "ops", "infrastructure"].includes(normalizedComponent)
  ) {
    return true;
  }

  return false;
}

function sanitizePlan(
  pack: z.infer<typeof ArchitecturePackSchema>,
  plan: DecompositionPlan
): { plan: DecompositionPlan; amendments: string[] } {
  const amendments: string[] = [];
  const seen = new Set<string>();
  const nextItems: DecompositionWorkItem[] = [];

  for (const item of plan.work_items) {
    if (isTestingOnlyWorkItem(item)) {
      amendments.push(`Removed testing-only work item ${item.id}.`);
      continue;
    }

    if (isStaleWorkItem(pack, item)) {
      amendments.push(`Removed stale work item ${item.id} that no longer matches the architecture.`);
      continue;
    }

    const dedupeKey = `${normalizeText(item.component).trim()}::${slugify(item.title)}`;
    if (seen.has(dedupeKey)) {
      amendments.push(`Removed duplicate work item ${item.id}.`);
      continue;
    }

    seen.add(dedupeKey);
    nextItems.push(item);
  }

  if (amendments.length === 0) {
    return { plan, amendments };
  }

  return {
    amendments,
    plan: DecompositionPlanSchema.parse({
      ...plan,
      generated_at: new Date().toISOString(),
      work_items: nextItems,
    }),
  };
}

function findCoveringWorkItems(target: CoverageTarget, workItems: DecompositionWorkItem[]) {
  return workItems.filter((item) => {
    if (target.type === "component" && normalizeText(item.component).trim() === normalizeText(target.id).trim()) {
      return true;
    }

    const labels = item.labels.map((label) => label.toLowerCase());
    if (
      labels.includes(`${target.type}:${target.id.toLowerCase()}`) ||
      labels.includes(`component:${slugify(target.id)}`)
    ) {
      return true;
    }

    const overlap = itemTokens(item).filter((token) => target.tokens.includes(token)).length;
    if (overlap >= 2) {
      return true;
    }

    return (
      target.relatedComponents.some(
        (component) => normalizeText(component).trim() === normalizeText(item.component).trim()
      ) && overlap >= 1
    );
  });
}

function buildCoverageSnapshot(
  pack: z.infer<typeof ArchitecturePackSchema>,
  plan: DecompositionPlan
): CoverageSnapshot[] {
  const targets = buildCoverageTargets(pack);
  return targets.map((target) => {
    const coveredBy = findCoveringWorkItems(target, plan.work_items).map((item) => item.id);
    return {
      target_id: target.id,
      target_type: target.type,
      summary: target.summary,
      covered_by: coveredBy,
      status: coveredBy.length > 0 ? "covered" : "missing",
    };
  });
}

function nextWorkItemId(plan: DecompositionPlan, fragment: string) {
  return `iter_${String(plan.work_items.length + 1).padStart(3, "0")}_${slugify(fragment)}`;
}

function inferComponentForTarget(
  pack: z.infer<typeof ArchitecturePackSchema>,
  target: CoverageTarget
) {
  if (target.relatedComponents.length > 0) {
    return pack.architecture.components.find((component) => component.name === target.relatedComponents[0]);
  }

  return pack.architecture.components.find((component) => component.type === "api") ?? pack.architecture.components[0];
}

function getTargetComponent(
  pack: z.infer<typeof ArchitecturePackSchema>,
  target: CoverageTarget
) {
  if (target.type === "component") {
    return (
      pack.architecture.components.find((component) => component.name === target.id) ??
      inferComponentForTarget(pack, target)
    );
  }

  return inferComponentForTarget(pack, target);
}

function makeCoverageWorkItem(
  pack: z.infer<typeof ArchitecturePackSchema>,
  plan: DecompositionPlan,
  target: CoverageTarget
) {
  const component = getTargetComponent(pack, target);
  if (!component) {
    return null;
  }

  const category = categoryForComponentType(component.type);
  const labelTarget =
    target.type === "data_store" ? `data_store:${slugify(target.id)}` : `${target.type}:${target.id.toLowerCase()}`;

  const titlePrefix =
    target.type === "requirement"
      ? "Implement requirement"
      : target.type === "workflow"
        ? "Support workflow"
        : target.type === "component"
          ? "Implement component"
          : target.type === "integration"
            ? "Wire integration"
            : target.type === "data_store"
              ? "Implement persistence"
              : target.type === "async_pattern"
                ? "Implement async pattern"
                : "Implement API surface";

  return DecompositionWorkItemSchema.parse({
    id: nextWorkItemId(plan, `${target.type}_${target.id}`),
    title: `${titlePrefix}: ${target.id}`,
    summary: `Add the implementation slice required to cover ${target.type.replace(/_/g, " ")} "${target.summary}".`,
    category,
    size: target.type === "component" ? "small" : "tiny",
    component: component.name,
    acceptance_criteria: [
      `The implementation covers ${target.type.replace(/_/g, " ")} "${target.id}".`,
      "The work aligns with the current architecture pack.",
    ],
    depends_on: [],
    labels: ["implementation", "source:iterator", `category:${category}`, labelTarget, `component:${slugify(component.name)}`],
  });
}

function buildRecommendedInputs(
  target: CoverageTarget,
  component?: z.infer<typeof ArchitecturePackSchema>["architecture"]["components"][number]
) {
  const inputs: z.infer<typeof DecompositionClarifyingQuestionSchema>["recommended_inputs"] = [
    {
      channel: "answer",
      label: "Answer here",
      prompt: `Answer the open question about ${target.type.replace(/_/g, " ")} "${target.id}".`,
    },
  ];

  if (target.type === "requirement" || target.type === "workflow") {
    inputs.push({
      channel: "prd_update",
      label: "Add PRD update",
      prompt: `Add product behavior detail for ${target.type.replace(/_/g, " ")} "${target.id}".`,
    });
  }

  if (
    target.type === "integration" ||
    target.type === "data_store" ||
    target.type === "async_pattern" ||
    target.type === "api_surface" ||
    component?.type === "external_integration" ||
    component?.type === "auth_provider"
  ) {
    inputs.push({
      channel: "org_constraints_update",
      label: "Add org constraints update",
      prompt: `Add engineering or operational constraints for ${target.summary}.`,
    });
  }

  if (
    component?.type === "web" ||
    target.tokens.some((token) => ["ui", "design", "page", "screen", "frontend"].includes(token))
  ) {
    inputs.push({
      channel: "design_guidelines_update",
      label: "Add design guidelines update",
      prompt: `Add UI, brand, or frontend guidance for ${target.summary}.`,
    });
  }

  return inputs;
}

function buildMissingInformation(
  target: CoverageTarget,
  component?: z.infer<typeof ArchitecturePackSchema>["architecture"]["components"][number]
) {
  if (target.type === "requirement" || target.type === "workflow") {
    return [
      `Clarify the implementation boundary for ${target.type.replace(/_/g, " ")} "${target.id}".`,
      `Describe the backend, frontend, or data side effects required to complete "${target.summary}".`,
    ];
  }

  if (target.type === "component" && component) {
    if (component.type === "db") {
      return [
        `Confirm whether ${component.name} owns only schema and repository work, or also cleanup, projections, and reporting jobs.`,
        `Confirm which application services are expected to read from or write to ${component.name}.`,
      ];
    }

    if (component.type === "web") {
      return [
        `Confirm which pages, views, or interaction surfaces ${component.name} must deliver.`,
        `Confirm whether ${component.name} needs additional design guidance before issues are created.`,
      ];
    }

    if (component.type === "api") {
      return [
        `Confirm which routes, handlers, or mutations ${component.name} must implement.`,
        `Confirm any side effects or downstream integrations ${component.name} owns.`,
      ];
    }
  }

  if (target.type === "integration") {
    return [
      `Clarify the integration boundary for "${target.id}" and the exact data exchanged.`,
      `Confirm which component owns the outbound or inbound contract for "${target.id}".`,
    ];
  }

  if (target.type === "data_store") {
    return [
      `Clarify which data lifecycle operations must be implemented for "${target.id}" (writes, reads, retention, cleanup).`,
      `Confirm which components own persistence responsibilities for "${target.id}".`,
    ];
  }

  if (target.type === "async_pattern") {
    return [
      `Clarify which producer and consumer flows are required for "${target.id}".`,
      `Confirm retry, ordering, or compensation behavior for "${target.id}".`,
    ];
  }

  if (target.type === "api_surface") {
    return [
      `Clarify which handlers, authorization rules, and persistence steps are required for "${target.id}".`,
      `Confirm which component owns "${target.id}" so implementation issues can be scoped safely.`,
    ];
  }

  return [
    `Clarify the implementation ownership and expected behavior for "${target.summary}".`,
  ];
}

function buildExpectedIssueOutcomes(
  pack: z.infer<typeof ArchitecturePackSchema>,
  target: CoverageTarget
) {
  const component = getTargetComponent(pack, target);
  if (!component) {
    return [];
  }

  if (component.type === "db") {
    return [
      {
        title: `Create ${component.name} schema migration work`,
        component: component.name,
        category: "data" as const,
        reason: `Claude needs enough detail to scope schema and persistence work for ${target.summary}.`,
      },
      {
        title: `Implement ${component.name} repository and data access layer`,
        component: component.name,
        category: "backend" as const,
        reason: `Coverage for ${component.name} likely requires application-side persistence code, not just data definitions.`,
      },
    ];
  }

  if (component.type === "web") {
    return [
      {
        title: `Implement ${component.name} UI slice for ${target.id}`,
        component: component.name,
        category: "frontend" as const,
        reason: `Claude expects a frontend issue once the exact UX scope is confirmed.`,
      },
    ];
  }

  if (component.type === "api") {
    return [
      {
        title: `Implement ${component.name} handler for ${target.id}`,
        component: component.name,
        category: "backend" as const,
        reason: `The API layer needs a concrete route or mutation issue once the missing behavior is confirmed.`,
      },
    ];
  }

  const genericWorkItem = makeCoverageWorkItem(pack, {
    ...DecompositionPlanSchema.parse({
      generated_at: new Date().toISOString(),
      summary: "synthetic",
      approval_notes: undefined,
      work_items: [],
    }),
  }, target);

  if (!genericWorkItem) {
    return [];
  }

  return [
    {
      title: genericWorkItem.title,
      component: genericWorkItem.component,
      category: genericWorkItem.category,
      reason: `Claude expects to create this implementation slice once the missing information for ${target.id} is resolved.`,
    },
  ];
}

function buildGapEvidence(
  pack: z.infer<typeof ArchitecturePackSchema>,
  target: CoverageTarget,
  snapshot?: CoverageSnapshot
) {
  const component = getTargetComponent(pack, target);
  const evidence = [
    `Coverage snapshot marks ${target.type.replace(/_/g, " ")} "${target.id}" as ${snapshot?.status ?? "missing"}.`,
  ];

  if (component) {
    evidence.push(`Architecture includes component "${component.name}" of type "${component.type}".`);
  }

  if (target.type === "requirement" || target.type === "workflow") {
    evidence.push(`Project context still expects implementation coverage for "${target.summary}".`);
  }

  return evidence.slice(0, 3);
}

function shouldAutoAmendTarget(
  pack: z.infer<typeof ArchitecturePackSchema>,
  target: CoverageTarget
) {
  const component = getTargetComponent(pack, target);
  if (!component) {
    return false;
  }

  return (
    target.type === "component" ||
    target.type === "integration" ||
    target.type === "data_store" ||
    target.type === "async_pattern" ||
    target.type === "api_surface"
  );
}

function buildBlockingGapForTarget(
  pack: z.infer<typeof ArchitecturePackSchema>,
  target: CoverageTarget,
  snapshot?: CoverageSnapshot
): DecompositionGap {
  const component = getTargetComponent(pack, target);
  const missingInformation = buildMissingInformation(target, component);
  const expectedIssueOutcomes = buildExpectedIssueOutcomes(pack, target);
  const recommendedInputs = buildRecommendedInputs(target, component);
  const evidence = buildGapEvidence(pack, target, snapshot);

  return DecompositionGapSchema.parse({
    id: `gap_${slugify(`${target.type}_${target.id}`)}`,
    type: "missing_coverage",
    severity:
      target.type === "requirement" || target.type === "workflow"
        ? "high"
        : "medium",
    summary: `Missing implementation coverage for ${target.type.replace(/_/g, " ")} "${target.id}".`,
    affected_requirement_ids: target.type === "requirement" ? [target.id] : [],
    affected_components: target.relatedComponents,
    affected_work_item_ids: [],
    auto_resolved: false,
    why_blocked: `Claude cannot safely create the missing implementation issue(s) for ${target.summary} without this information.`,
    missing_information: missingInformation,
    evidence,
    recommended_inputs: recommendedInputs,
    expected_issue_outcomes: expectedIssueOutcomes,
    resolution_notes: `Answer the missing-information prompts so Claude can create scoped implementation work for ${target.id}.`,
  });
}

function findTargetForGap(targets: CoverageTarget[], gap: DecompositionGap) {
  return targets.find((target) => gapAddressesTarget(gap, target));
}

function enrichGap(
  pack: z.infer<typeof ArchitecturePackSchema>,
  targets: CoverageTarget[],
  coverageSnapshot: CoverageSnapshot[],
  gap: DecompositionGap
) {
  const target = findTargetForGap(targets, gap);
  if (!target) {
    return gap;
  }

  const snapshot = coverageSnapshot.find(
    (item) => item.target_id === target.id && item.target_type === target.type
  );
  const fallbackGap = buildBlockingGapForTarget(pack, target, snapshot);

  return DecompositionGapSchema.parse({
    ...fallbackGap,
    ...gap,
    why_blocked: gap.why_blocked ?? fallbackGap.why_blocked,
    missing_information:
      gap.missing_information.length > 0
        ? gap.missing_information
        : fallbackGap.missing_information,
    evidence: gap.evidence.length > 0 ? gap.evidence : fallbackGap.evidence,
    recommended_inputs:
      gap.recommended_inputs.length > 0
        ? gap.recommended_inputs
        : fallbackGap.recommended_inputs,
    expected_issue_outcomes:
      gap.expected_issue_outcomes.length > 0
        ? gap.expected_issue_outcomes
        : fallbackGap.expected_issue_outcomes,
    resolution_notes: gap.resolution_notes ?? fallbackGap.resolution_notes,
  });
}

function buildClarifyingQuestion(
  pack: z.infer<typeof ArchitecturePackSchema>,
  target: CoverageTarget,
  snapshot?: CoverageSnapshot
): DecompositionQuestion {
  const component = getTargetComponent(pack, target);
  const missingInformation = buildMissingInformation(target, component);
  const expectedIssueOutcomes = buildExpectedIssueOutcomes(pack, target);
  const recommendedInputs = buildRecommendedInputs(target, component);
  const evidence = buildGapEvidence(pack, target, snapshot);

  return DecompositionClarifyingQuestionSchema.parse({
    id: `dq_${slugify(`${target.type}_${target.id}`)}`,
    prompt: `How should we implement coverage for ${target.type.replace(/_/g, " ")} "${target.id}"?`,
    rationale: `Claude could not assign a safe implementation slice for ${target.summary} without additional detail.`,
    status: "open",
    created_at: new Date().toISOString(),
    related_requirement_ids: target.type === "requirement" ? [target.id] : [],
    related_components: target.relatedComponents,
    derived_from_gap_ids: [],
    missing_information: missingInformation,
    evidence,
    recommended_inputs: recommendedInputs,
    expected_issue_outcomes: expectedIssueOutcomes,
  });
}

function buildClarifyingQuestionFromGap(
  pack: z.infer<typeof ArchitecturePackSchema>,
  targets: CoverageTarget[],
  coverageSnapshot: CoverageSnapshot[],
  gap: DecompositionGap
): DecompositionQuestion {
  const enrichedGap = enrichGap(pack, targets, coverageSnapshot, gap);
  const missingInformation =
    enrichedGap.missing_information.length > 0
      ? enrichedGap.missing_information
      : [`Clarify the implementation ownership and missing behavior for "${gap.summary}".`];
  const evidence =
    enrichedGap.evidence.length > 0
      ? enrichedGap.evidence
      : ["The iterator review still reports this gap as unresolved."];
  const recommendedInputs =
    enrichedGap.recommended_inputs.length > 0
      ? enrichedGap.recommended_inputs
      : [
          {
            channel: "answer" as const,
            label: "Answer here",
            prompt: `Provide the missing implementation detail needed to resolve "${gap.summary}".`,
          },
        ];

  return DecompositionClarifyingQuestionSchema.parse({
    id: `dq_gap_${slugify(gap.id)}`,
    prompt: `Resolve coverage gap: ${gap.summary}`,
    rationale:
      enrichedGap.why_blocked ||
      enrichedGap.resolution_notes ||
      `The iterator cannot safely complete this decomposition while the ${gap.type.replace(/_/g, " ")} gap remains.`,
    status: "open",
    created_at: new Date().toISOString(),
    related_requirement_ids: gap.affected_requirement_ids,
    related_components: gap.affected_components,
    derived_from_gap_ids: [gap.id],
    missing_information: missingInformation,
    evidence,
    recommended_inputs: recommendedInputs,
    expected_issue_outcomes: enrichedGap.expected_issue_outcomes,
  });
}

function gapAddressesTarget(gap: DecompositionGap, target: CoverageTarget) {
  if (target.type === "requirement" && gap.affected_requirement_ids.includes(target.id)) {
    return true;
  }

  if (gap.affected_components.some((component) => target.relatedComponents.includes(component))) {
    return true;
  }

  const gapTokens = tokens(`${gap.summary} ${gap.resolution_notes ?? ""}`);
  return target.tokens.some((token) => gapTokens.includes(token));
}

function normalizeIteratorQuestions(
  questions: ClaudeIteratorReview["questions"]
): DecompositionQuestion[] {
  return questions.map((question) =>
    DecompositionClarifyingQuestionSchema.parse({
      id: `dq_claude_${slugify(question.prompt)}`,
      prompt: question.prompt,
      rationale: question.rationale,
      status: "open",
      created_at: new Date().toISOString(),
      related_requirement_ids: question.related_requirement_ids,
      related_components: question.related_components,
      derived_from_gap_ids: question.derived_from_gap_ids,
      missing_information: question.missing_information,
      evidence: question.evidence,
      recommended_inputs: question.recommended_inputs,
      expected_issue_outcomes: question.expected_issue_outcomes,
    })
  );
}

function normalizeIteratorSuggestedWorkItems(
  pack: z.infer<typeof ArchitecturePackSchema>,
  plan: DecompositionPlan,
  workItems: ClaudeIteratorReview["proposed_work_items"]
) {
  const filteredItems = workItems.filter(
    (item) => !isTestingOnlyWorkItem(item) && !isStaleWorkItem(pack, item)
  );
  const idMap = new Map<string, string>();

  const normalized = filteredItems.map((item, index) => {
    const nextId = nextWorkItemId(
      {
        ...plan,
        work_items: [...plan.work_items, ...filteredItems.slice(0, index)],
      },
      `${item.component}_${item.title}`
    );
    idMap.set(item.id, nextId);
    return DecompositionWorkItemSchema.parse({
      ...item,
      id: nextId,
      title: item.title.trim(),
      summary: item.summary.trim(),
      component: item.component.trim(),
      acceptance_criteria: [...new Set(item.acceptance_criteria.map((value) => value.trim()).filter(Boolean))].slice(0, 4),
      labels: [
        ...new Set(
          [
            ...item.labels,
            "implementation",
            "source:claude_iterator",
            `category:${item.category}`,
            `component:${slugify(item.component)}`,
          ]
            .map((value) => value.trim())
            .filter(Boolean)
        ),
      ].slice(0, 8),
    });
  });

  return normalized.map((item) => ({
    ...item,
    depends_on: item.depends_on
      .map((value) => idMap.get(value))
      .filter((value): value is string => Boolean(value)),
  }));
}

function questionAddressesTarget(question: DecompositionQuestion, target: CoverageTarget) {
  if (target.type === "requirement" && question.related_requirement_ids.includes(target.id)) {
    return true;
  }

  if (question.related_components.some((component) => target.relatedComponents.includes(component))) {
    return true;
  }

  const promptTokens = tokens(`${question.prompt} ${question.rationale}`);
  return target.tokens.some((token) => promptTokens.includes(token));
}

function mergeGaps(primary: DecompositionGap[], secondary: DecompositionGap[]) {
  const seen = new Set<string>();
  return [...primary, ...secondary].filter((gap) => {
    const key = `${gap.type}:${normalizeText(gap.summary).trim()}`;
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

function summarizeResult(
  result: "clean" | "blocked" | "amended",
  gaps: DecompositionGap[],
  questions: DecompositionQuestion[],
  amendments: string[],
  options?: { finalPassAddedIssues?: boolean }
) {
  if (result === "clean") {
    if (amendments.length > 0) {
      return options?.finalPassAddedIssues
        ? "Iterator auto-amended the decomposition and found no remaining gaps, but the final pass still introduced new issues."
        : "Iterator auto-amended the decomposition, reran coverage review, and found no remaining gaps. No new issues were added on the final pass.";
    }
    return "Iterator found no remaining decomposition gaps. No new issues were added on the review pass. The project is build-ready.";
  }
  if (result === "amended") {
    return `Iterator auto-amended the decomposition and resolved ${amendments.length} issue(s) without blocking questions.`;
  }
  return `Iterator found ${gaps.length} remaining gap(s) and opened ${questions.length} clarifying question(s).`;
}

function renderReviewSummary(review: DecompositionReviewArtifact) {
  return [
    "# Decomposition Review",
    "",
    `Result: ${review.result}`,
    `Iterations: ${review.iteration_count}`,
    "",
    review.summary,
    ...(review.blocking_summary ? ["", "## Blocking Summary", review.blocking_summary] : []),
    "",
    "## Amendments Applied",
    ...(review.amendments_applied.length > 0 ? review.amendments_applied.map((item) => `- ${item}`) : ["- None"]),
    "",
    "## Claude Review Notes",
    ...(review.claude_review_notes.length > 0
      ? review.claude_review_notes.map((item) => `- ${item}`)
      : ["- None"]),
    "",
    "## Open Questions",
    ...(review.questions.length > 0 ? review.questions.map((item) => `- ${item.prompt}`) : ["- None"]),
    "",
    "## Remaining Gaps",
    ...(review.gaps.length > 0 ? review.gaps.map((item) => `- ${item.summary}`) : ["- None"]),
    "",
  ].join("\n");
}

function buildReviewState(
  review: DecompositionReviewArtifact,
  plan: DecompositionPlan,
  resultStatus: z.infer<typeof DecompositionReviewStateSchema>["status"]
) {
  return DecompositionReviewStateSchema.parse({
    status: resultStatus,
    artifact_name: "decomposition_review",
    iteration_count: review.iteration_count,
    last_reviewed_at: review.generated_at,
    source_decomposition_generated_at: plan.generated_at,
    gap_count: review.gaps.length,
    open_question_count: review.questions.filter((question) => question.status === "open").length,
    clean_at: resultStatus === "build_ready" ? review.generated_at : undefined,
    blocked_reason:
      resultStatus === "blocked"
        ? review.blocking_summary ??
          review.questions[0]?.prompt ??
          "Clarifying answers are required before the project is build-ready."
        : undefined,
    questions: review.questions,
  });
}

function buildProgressReviewState(
  current: z.infer<typeof DecompositionReviewStateSchema> | undefined,
  message: string
) {
  return DecompositionReviewStateSchema.parse({
    artifact_name: "decomposition_review",
    iteration_count: current?.iteration_count ?? 0,
    gap_count: current?.gap_count ?? 0,
    open_question_count: current?.open_question_count ?? 0,
    questions: current?.questions ?? [],
    source_decomposition_generated_at: current?.source_decomposition_generated_at,
    clean_at: current?.clean_at,
    last_reviewed_at: new Date().toISOString(),
    status: "iterating",
    blocked_reason: message,
  });
}

async function reviewPlan(
  pack: z.infer<typeof ArchitecturePackSchema>,
  projectContext: ProjectContext,
  startingPlan: DecompositionPlan
): Promise<{
  plan: DecompositionPlan;
  review: DecompositionReviewArtifact;
  stateStatus: z.infer<typeof DecompositionReviewStateSchema>["status"];
}> {
  let currentPlan = startingPlan;
  const allAmendments: string[] = [];
  const allClaudeReviewNotes: string[] = [];

  for (let iteration = 1; iteration <= MAX_ITERATIONS; iteration += 1) {
    const amendmentsBeforeIteration = allAmendments.length;
    const sanitized = sanitizePlan(pack, currentPlan);
    currentPlan = sanitized.plan;
    allAmendments.push(...sanitized.amendments);

    const targets = buildCoverageTargets(pack);
    const initialSnapshot = buildCoverageSnapshot(pack, currentPlan);

    const claudeReview = await generateDecompositionIteratorReview({
      pack,
      projectContext,
      plan: currentPlan,
      coverageSnapshot: initialSnapshot,
      iteration,
    });
    allClaudeReviewNotes.push(
      ...claudeReview.claude_review_notes.filter(
        (item, index, source) => item.trim().length > 0 && source.indexOf(item) === index
      )
    );
    const additions = normalizeIteratorSuggestedWorkItems(
      pack,
      currentPlan,
      claudeReview.proposed_work_items
    );
    const questions = normalizeIteratorQuestions(claudeReview.questions);

    for (const nextItem of additions) {
      allAmendments.push(`Claude iterator added ${nextItem.id}: ${nextItem.title}.`);
    }

    if (additions.length > 0) {
      currentPlan = DecompositionPlanSchema.parse({
        ...currentPlan,
        generated_at: new Date().toISOString(),
        work_items: [...currentPlan.work_items, ...additions],
      });
    }

    const iterationAddedAmendments = allAmendments.length > amendmentsBeforeIteration;

    const finalSnapshot = buildCoverageSnapshot(pack, currentPlan);
    const finalMissingTargets = targets.filter((target) =>
      finalSnapshot.some(
        (snapshot) =>
          snapshot.target_id === target.id &&
          snapshot.target_type === target.type &&
          snapshot.status === "missing"
      )
    );
    const deterministicAutoAdditions = finalMissingTargets
      .filter((target) => shouldAutoAmendTarget(pack, target))
      .map((target) => makeCoverageWorkItem(pack, currentPlan, target))
      .filter((item): item is DecompositionWorkItem => Boolean(item))
      .filter((item) => {
        const hasCoveringItem = currentPlan.work_items.some(
          (existing) =>
            normalizeText(existing.component).trim() === normalizeText(item.component).trim() &&
            existing.labels.some((label) => item.labels.includes(label))
        );
        return !hasCoveringItem;
      });

    if (deterministicAutoAdditions.length > 0) {
      for (const item of deterministicAutoAdditions) {
        allAmendments.push(`Iterator added ${item.id}: ${item.title}.`);
      }

      currentPlan = DecompositionPlanSchema.parse({
        ...currentPlan,
        generated_at: new Date().toISOString(),
        work_items: [...currentPlan.work_items, ...deterministicAutoAdditions],
      });
      continue;
    }

    const deterministicRemainingGaps = finalMissingTargets.map((target) =>
      buildBlockingGapForTarget(
        pack,
        target,
        finalSnapshot.find(
          (snapshot) => snapshot.target_id === target.id && snapshot.target_type === target.type
        )
      )
    );
    const claudeRemainingGaps = claudeReview.gaps
      .filter((gap) => !gap.auto_resolved)
      .map((gap) => enrichGap(pack, targets, finalSnapshot, gap));
    const remainingGaps = mergeGaps(deterministicRemainingGaps, claudeRemainingGaps);

    for (const target of finalMissingTargets) {
      if (
        (target.type === "requirement" || target.type === "workflow") &&
        !questions.some((question) => questionAddressesTarget(question, target)) &&
        !remainingGaps.some((gap) => gapAddressesTarget(gap, target))
      ) {
        questions.push(
          buildClarifyingQuestion(
            pack,
            target,
            finalSnapshot.find(
              (snapshot) => snapshot.target_id === target.id && snapshot.target_type === target.type
            )
          )
        );
      }
    }

    for (const gap of remainingGaps) {
      const alreadyCoveredByQuestion = questions.some((question) =>
        question.derived_from_gap_ids.includes(gap.id)
      );

      if (!alreadyCoveredByQuestion) {
        questions.push(buildClarifyingQuestionFromGap(pack, targets, finalSnapshot, gap));
      }
    }

    const blockingGaps = remainingGaps.filter((gap) => gap.missing_information.length > 0);
    const nonBlockingGaps = remainingGaps.filter((gap) => gap.missing_information.length === 0);
    let addedNonBlockingWork = false;
    for (const gap of nonBlockingGaps) {
      const target = findTargetForGap(targets, gap);
      if (!target) {
        continue;
      }

      const autoItem = makeCoverageWorkItem(pack, currentPlan, target);
      if (autoItem) {
        allAmendments.push(`Iterator added ${autoItem.id}: ${autoItem.title}.`);
        currentPlan = DecompositionPlanSchema.parse({
          ...currentPlan,
          generated_at: new Date().toISOString(),
          work_items: [...currentPlan.work_items, autoItem],
        });
        addedNonBlockingWork = true;
      }
    }

    if (addedNonBlockingWork) {
      continue;
    }

    if (blockingGaps.length === 0 && questions.length === 0 && !iterationAddedAmendments) {
      return {
        plan: currentPlan,
        review: DecompositionReviewArtifactSchema.parse({
          generated_at: new Date().toISOString(),
          summary: summarizeResult("clean", [], [], allAmendments, {
            finalPassAddedIssues: false,
          }),
          result: "clean",
          iteration_count: iteration,
          blocking_summary: undefined,
          gaps: [],
          questions: [],
          amendments_applied: allAmendments,
          claude_review_notes: allClaudeReviewNotes,
          coverage_snapshot: finalSnapshot,
        }),
        stateStatus: "build_ready",
      };
    }

    if (blockingGaps.length === 0 && questions.length === 0 && iterationAddedAmendments) {
      if (iteration < MAX_ITERATIONS) {
        continue;
      }

      const stabilizationGap = DecompositionGapSchema.parse({
        id: "gap_iterator_stabilization",
        type: "missing_coverage",
        severity: "medium",
        summary:
          "Iterator continued auto-amending the decomposition and did not complete a final clean no-change pass before the iteration limit.",
        affected_requirement_ids: [],
        affected_components: [],
        affected_work_item_ids: [],
        auto_resolved: false,
        resolution_notes:
          "Rerun build readiness review to confirm the decomposition is stable and no new issues are added.",
      });

      return {
        plan: currentPlan,
        review: DecompositionReviewArtifactSchema.parse({
          generated_at: new Date().toISOString(),
          summary:
            "Iterator kept auto-amending the decomposition but did not complete a final clean no-change pass before the iteration limit. Rerun build readiness review.",
          result: "blocked",
          iteration_count: iteration,
          blocking_summary:
            "The decomposition changed during the final review pass. Rerun build readiness to confirm no new issues are added.",
          gaps: [stabilizationGap],
          questions: [],
          amendments_applied: allAmendments,
          claude_review_notes: allClaudeReviewNotes,
          coverage_snapshot: finalSnapshot,
        }),
        stateStatus: "blocked",
      };
    }

    if (questions.length > 0 || blockingGaps.length > 0 || iteration === MAX_ITERATIONS) {
      return {
        plan: currentPlan,
        review: DecompositionReviewArtifactSchema.parse({
          generated_at: new Date().toISOString(),
          summary: summarizeResult("blocked", blockingGaps, questions, allAmendments),
          blocking_summary:
            claudeReview.blocking_summary ??
            (questions.length > 0
              ? "Claude still needs the information listed in the open questions before it can finish issue generation."
              : "Claude still needs the information listed in the remaining gaps before it can finish issue generation."),
          result: "blocked",
          iteration_count: iteration,
          gaps: blockingGaps,
          questions,
          amendments_applied: allAmendments,
          claude_review_notes: allClaudeReviewNotes,
          coverage_snapshot: finalSnapshot,
        }),
        stateStatus: "blocked",
      };
    }
  }

  throw new Error("Iterator exhausted its review loop unexpectedly.");
}

export async function runDecompositionIteratorAgent(runId: string): Promise<void> {
  const baseUrl = readRequiredEnv("PASS_API_BASE_URL");
  const token = readRequiredEnv("PASS_API_TOKEN");
  const api = new PassApiClient({
    baseUrl,
    token,
  });

  const githubRunId = process.env.GITHUB_RUN_ID ? Number(process.env.GITHUB_RUN_ID) : undefined;
  const githubRunUrl = process.env.GITHUB_RUN_URL;
  let recorder: LlmObservabilityRecorder | undefined;
  let sessionStatus: "running" | "succeeded" | "failed" = "running";

  try {
    const run = await api.getRun(runId);
    if (!run.repo_state) {
      throw new Error("Target repository has not been resolved for this run.");
    }
    recorder = new LlmObservabilityRecorder({
      runId,
      workflowName: "phase2-decomposition-iterator",
      backend: run.execution?.backend,
      model: process.env.ANTHROPIC_MODEL ?? "claude-sonnet-4-6",
    });

    await api.updateExecution(runId, {
      status: "running",
      github_run_id: Number.isFinite(githubRunId) ? githubRunId : undefined,
      github_run_url: githubRunUrl,
    });

    let progressState = buildProgressReviewState(
      run.decomposition_review_state,
      "Preparing iterator review."
    );
    console.log(`[iterator] ${progressState.blocked_reason}`);
    await api.updateDecompositionReviewState(runId, progressState);

    progressState = buildProgressReviewState(
      progressState,
      "Loading architecture and refinement artifacts."
    );
    console.log(`[iterator] ${progressState.blocked_reason}`);
    await api.updateDecompositionReviewState(runId, progressState);
    const packArtifact = await api.getArtifact(runId, "architecture_pack");
    const pack = ArchitecturePackSchema.parse(packArtifact.payload);

    const [chatArtifact, normalizedPrd, normalizedOrgConstraints, normalizedDesignGuidelines, existingPlanArtifact] =
      await Promise.all([
        api.getOptionalArtifact(runId, "architecture_chat"),
        api.getOptionalArtifact(runId, "normalized_prd"),
        api.getOptionalArtifact(runId, "normalized_org_constraints"),
        api.getOptionalArtifact(runId, "normalized_design_guidelines"),
        api.getOptionalArtifact(runId, "decomposition_plan"),
      ]);

    const chatState = chatArtifact
      ? ArchitectureChatStateSchema.parse(chatArtifact.payload)
      : run.architecture_chat;

    progressState = buildProgressReviewState(
      progressState,
      "Building condensed project context for Claude review."
    );
    console.log(`[iterator] ${progressState.blocked_reason}`);
    await api.updateDecompositionReviewState(runId, progressState);
    const projectContext = buildProjectContext({
      pack,
      normalizedPrdText: typeof normalizedPrd?.payload === "string" ? normalizedPrd.payload : undefined,
      normalizedOrgConstraintsText:
        typeof normalizedOrgConstraints?.payload === "string" ? normalizedOrgConstraints.payload : undefined,
      normalizedDesignGuidelinesText:
        typeof normalizedDesignGuidelines?.payload === "string"
          ? normalizedDesignGuidelines.payload
          : undefined,
      chatState,
    });

    await api.uploadArtifact(runId, {
      name: "project_context",
      content_type: "application/json",
      payload: projectContext,
    });
    await api.uploadArtifact(runId, {
      name: "project_context_summary",
      content_type: "text/markdown",
      payload: renderProjectContextSummary(projectContext),
    });

    progressState = buildProgressReviewState(
      progressState,
      existingPlanArtifact
        ? "Refreshing decomposition draft against the latest architecture."
        : "Generating the first decomposition draft."
    );
    console.log(`[iterator] ${progressState.blocked_reason}`);
    await api.updateDecompositionReviewState(runId, progressState);
    let plan = existingPlanArtifact
      ? DecompositionPlanSchema.parse(existingPlanArtifact.payload)
      : await generateDecompositionPlan({ pack });

    const needsFreshPlan =
      !existingPlanArtifact ||
      new Date(plan.generated_at).getTime() < new Date(pack.created_at).getTime();

    if (needsFreshPlan) {
      plan = await withLlmObservabilityRecorder(recorder, () =>
        generateDecompositionPlan({ pack })
      );
    }

    await api.uploadArtifact(runId, {
      name: "decomposition_plan",
      content_type: "application/json",
      payload: plan,
    });
    await api.uploadArtifact(runId, {
      name: "decomposition_plan_summary",
      content_type: "text/markdown",
      payload: renderDecompositionSummary(plan),
    });
    await api.updateDecompositionState(runId, {
      status: "draft",
      artifact_name: "decomposition_plan",
      generated_at: plan.generated_at,
      work_item_count: plan.work_items.length,
    });

    progressState = buildProgressReviewState(
      progressState,
      "Running Claude iterator review over decomposition coverage."
    );
    console.log(`[iterator] ${progressState.blocked_reason}`);
    await api.updateDecompositionReviewState(runId, progressState);
    const reviewed = await withLlmObservabilityRecorder(recorder, () =>
      reviewPlan(pack, projectContext, plan)
    );

    if (
      reviewed.plan.generated_at !== plan.generated_at ||
      reviewed.plan.work_items.length !== plan.work_items.length
    ) {
      await api.uploadArtifact(runId, {
        name: "decomposition_plan",
        content_type: "application/json",
        payload: reviewed.plan,
      });
      await api.uploadArtifact(runId, {
        name: "decomposition_plan_summary",
        content_type: "text/markdown",
        payload: renderDecompositionSummary(reviewed.plan),
      });
      await api.updateDecompositionState(runId, {
        status: "draft",
        artifact_name: "decomposition_plan",
        generated_at: reviewed.plan.generated_at,
        work_item_count: reviewed.plan.work_items.length,
      });
    }

    await api.uploadArtifact(runId, {
      name: "decomposition_review",
      content_type: "application/json",
      payload: reviewed.review,
    });
    await api.uploadArtifact(runId, {
      name: "decomposition_review_summary",
      content_type: "text/markdown",
      payload: renderReviewSummary(reviewed.review),
    });
    console.log(
      `[iterator] Completed with result=${reviewed.review.result} iterations=${reviewed.review.iteration_count}`
    );
    await api.updateDecompositionReviewState(
      runId,
      buildReviewState(reviewed.review, reviewed.plan, reviewed.stateStatus)
    );
    await api.updateRun(runId, {
      status: reviewed.stateStatus === "build_ready" ? "build_ready" : "review_blocked",
      current_step: "review",
    });
    await api.updateExecution(runId, {
      status: "succeeded",
      github_run_id: Number.isFinite(githubRunId) ? githubRunId : undefined,
      github_run_url: githubRunUrl,
    });
    sessionStatus = "succeeded";
  } catch (error) {
    const message = buildFailureMessage(error);
    sessionStatus = "failed";
    try {
      await api.updateExecution(runId, {
        status: "failed",
        github_run_id: Number.isFinite(githubRunId) ? githubRunId : undefined,
        github_run_url: githubRunUrl,
        error_message: message,
      });
    } catch {
      // Preserve the original failure.
    }

    throw error;
  } finally {
    if (recorder) {
      recorder.complete(sessionStatus);
      try {
        await recorder.flush({ baseUrl, token });
      } catch {
        // Preserve the primary workflow result if observability flush fails.
      }
    }
  }
}
