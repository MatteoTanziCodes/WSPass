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

function makeCoverageWorkItem(
  pack: z.infer<typeof ArchitecturePackSchema>,
  plan: DecompositionPlan,
  target: CoverageTarget
) {
  const component = inferComponentForTarget(pack, target);
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

function buildClarifyingQuestion(target: CoverageTarget): DecompositionQuestion {
  return DecompositionClarifyingQuestionSchema.parse({
    id: `dq_${slugify(`${target.type}_${target.id}`)}`,
    prompt: `How should we implement coverage for ${target.type.replace(/_/g, " ")} "${target.id}"?`,
    rationale: `The iterator could not assign a safe implementation slice for ${target.summary}.`,
    status: "open",
    created_at: new Date().toISOString(),
    related_requirement_ids: target.type === "requirement" ? [target.id] : [],
    related_components: target.relatedComponents,
  });
}

function buildClarifyingQuestionFromGap(gap: DecompositionGap): DecompositionQuestion {
  return DecompositionClarifyingQuestionSchema.parse({
    id: `dq_gap_${slugify(gap.id)}`,
    prompt: `Resolve coverage gap: ${gap.summary}`,
    rationale:
      gap.resolution_notes ||
      `The iterator cannot safely complete this decomposition while the ${gap.type.replace(/_/g, " ")} gap remains.`,
    status: "open",
    created_at: new Date().toISOString(),
    related_requirement_ids: gap.affected_requirement_ids,
    related_components: gap.affected_components,
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
    "",
    "## Amendments Applied",
    ...(review.amendments_applied.length > 0 ? review.amendments_applied.map((item) => `- ${item}`) : ["- None"]),
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
      resultStatus === "blocked" && review.questions.length > 0
        ? "Clarifying answers are required before the project is build-ready."
        : undefined,
    questions: review.questions,
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

  for (let iteration = 1; iteration <= MAX_ITERATIONS; iteration += 1) {
    const amendmentsBeforeIteration = allAmendments.length;
    const sanitized = sanitizePlan(pack, currentPlan);
    currentPlan = sanitized.plan;
    allAmendments.push(...sanitized.amendments);

    const targets = buildCoverageTargets(pack);
    const initialSnapshot = buildCoverageSnapshot(pack, currentPlan);
    const missingTargets = targets.filter((target) =>
      initialSnapshot.some(
        (snapshot) =>
          snapshot.target_id === target.id &&
          snapshot.target_type === target.type &&
          snapshot.status === "missing"
      )
    );

    const claudeReview = await generateDecompositionIteratorReview({
      pack,
      projectContext,
      plan: currentPlan,
      coverageSnapshot: initialSnapshot,
      iteration,
    });
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
    const deterministicRemainingGaps = finalSnapshot
      .filter((snapshot) => snapshot.status === "missing")
      .map((snapshot) =>
        DecompositionGapSchema.parse({
          id: `gap_${slugify(`${snapshot.target_type}_${snapshot.target_id}`)}`,
          type: "missing_coverage",
          severity:
            snapshot.target_type === "requirement" || snapshot.target_type === "workflow"
              ? "high"
              : "medium",
          summary: `Missing implementation coverage for ${snapshot.target_type.replace(/_/g, " ")} "${snapshot.target_id}".`,
          affected_requirement_ids:
            snapshot.target_type === "requirement" ? [snapshot.target_id] : [],
          affected_components:
            targets.find(
              (target) => target.id === snapshot.target_id && target.type === snapshot.target_type
            )?.relatedComponents ?? [],
          affected_work_item_ids: [],
          auto_resolved: false,
        })
      );
    const claudeRemainingGaps = claudeReview.gaps.filter((gap) => !gap.auto_resolved);
    const remainingGaps = mergeGaps(deterministicRemainingGaps, claudeRemainingGaps);

    for (const target of missingTargets) {
      if (
        (target.type === "requirement" || target.type === "workflow") &&
        !questions.some((question) => questionAddressesTarget(question, target)) &&
        !remainingGaps.some((gap) => gapAddressesTarget(gap, target))
      ) {
        questions.push(buildClarifyingQuestion(target));
      }
    }

    for (const gap of remainingGaps) {
      const alreadyCoveredByQuestion = questions.some((question) => {
        if (
          question.related_requirement_ids.some((id) => gap.affected_requirement_ids.includes(id))
        ) {
          return true;
        }

        if (question.related_components.some((component) => gap.affected_components.includes(component))) {
          return true;
        }

        const questionTokens = tokens(`${question.prompt} ${question.rationale}`);
        const gapTokens = tokens(`${gap.summary} ${gap.resolution_notes ?? ""}`);
        return gapTokens.some((token) => questionTokens.includes(token));
      });

      if (!alreadyCoveredByQuestion) {
        questions.push(buildClarifyingQuestionFromGap(gap));
      }
    }

    if (remainingGaps.length === 0 && questions.length === 0 && !iterationAddedAmendments) {
      return {
        plan: currentPlan,
        review: DecompositionReviewArtifactSchema.parse({
          generated_at: new Date().toISOString(),
          summary: summarizeResult("clean", [], [], allAmendments, {
            finalPassAddedIssues: false,
          }),
          result: "clean",
          iteration_count: iteration,
          gaps: [],
          questions: [],
          amendments_applied: allAmendments,
          coverage_snapshot: finalSnapshot,
        }),
        stateStatus: "build_ready",
      };
    }

    if (remainingGaps.length === 0 && questions.length === 0 && iterationAddedAmendments) {
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
          gaps: [stabilizationGap],
          questions: [],
          amendments_applied: allAmendments,
          coverage_snapshot: finalSnapshot,
        }),
        stateStatus: "blocked",
      };
    }

    if (questions.length > 0 || iteration === MAX_ITERATIONS) {
      return {
        plan: currentPlan,
        review: DecompositionReviewArtifactSchema.parse({
          generated_at: new Date().toISOString(),
          summary: summarizeResult("blocked", remainingGaps, questions, allAmendments),
          result: "blocked",
          iteration_count: iteration,
          gaps: remainingGaps,
          questions,
          amendments_applied: allAmendments,
          coverage_snapshot: finalSnapshot,
        }),
        stateStatus: "blocked",
      };
    }
  }

  throw new Error("Iterator exhausted its review loop unexpectedly.");
}

export async function runDecompositionIteratorAgent(runId: string): Promise<void> {
  const api = new PassApiClient({
    baseUrl: readRequiredEnv("PASS_API_BASE_URL"),
    token: readRequiredEnv("PASS_API_TOKEN"),
  });

  const githubRunId = process.env.GITHUB_RUN_ID ? Number(process.env.GITHUB_RUN_ID) : undefined;
  const githubRunUrl = process.env.GITHUB_RUN_URL;

  try {
    const run = await api.getRun(runId);
    if (!run.repo_state) {
      throw new Error("Target repository has not been resolved for this run.");
    }

    await api.updateExecution(runId, {
      status: "running",
      github_run_id: Number.isFinite(githubRunId) ? githubRunId : undefined,
      github_run_url: githubRunUrl,
    });

    await api.updateDecompositionReviewState(runId, {
      ...(run.decomposition_review_state ?? {
        artifact_name: "decomposition_review",
        iteration_count: 0,
        gap_count: 0,
        open_question_count: 0,
        questions: [],
      }),
      status: "iterating",
      artifact_name: "decomposition_review",
      questions: run.decomposition_review_state?.questions ?? [],
    });

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

    let plan = existingPlanArtifact
      ? DecompositionPlanSchema.parse(existingPlanArtifact.payload)
      : await generateDecompositionPlan({ pack });

    const needsFreshPlan =
      !existingPlanArtifact ||
      new Date(plan.generated_at).getTime() < new Date(pack.created_at).getTime();

    if (needsFreshPlan) {
      plan = await generateDecompositionPlan({ pack });
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

    const reviewed = await reviewPlan(pack, projectContext, plan);

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
  } catch (error) {
    const message = buildFailureMessage(error);
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
  }
}
