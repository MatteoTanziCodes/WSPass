import { z } from "zod";
import type {
  ArchitecturePack,
  DecompositionPlan,
  ImplementationIssueStateCollection,
  PlannerRunInput,
  ProjectBuildConfig,
} from "@pass/shared";

export const IssueExecutionContextSchema = z
  .object({
    generated_at: z.string().datetime(),
    issue_id: z.string().min(1),
    issue_number: z.number().int().positive().optional(),
    title: z.string().min(1),
    summary: z.string().min(1),
    acceptance_criteria: z.array(z.string().min(1)).default([]),
    dependencies: z.array(z.string().min(1)).default([]),
    related_components: z.array(z.string().min(1)).default([]),
    related_requirements: z.array(
      z.object({
        id: z.string().min(1),
        text: z.string().min(1),
      })
    ).default([]),
    related_integrations: z.array(z.string().min(1)).default([]),
    relevant_design_guidance: z.array(z.string().min(1)).default([]),
    repo_command_config: z.record(z.string(), z.string()).default({}),
    repo_execution_notes: z.array(z.string().min(1)).default([]),
  })
  .strict();

export type IssueExecutionContext = z.infer<typeof IssueExecutionContextSchema>;

function normalizeText(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9\s]+/g, " ");
}

function tokenSet(value: string) {
  return new Set(normalizeText(value).split(/\s+/).filter((item) => item.length > 2));
}

export function buildIssueExecutionContext(input: {
  issueId: string;
  pack: ArchitecturePack;
  decompositionPlan: DecompositionPlan;
  implementationState?: ImplementationIssueStateCollection;
  runInput?: PlannerRunInput;
  buildConfig: ProjectBuildConfig;
}): IssueExecutionContext {
  const { issueId, pack, decompositionPlan, implementationState, runInput, buildConfig } = input;
  const workItem = decompositionPlan.work_items.find((item) => item.id === issueId);
  if (!workItem) {
    throw new Error(`Unable to build issue context. Work item not found: ${issueId}`);
  }

  const syncedIssue = implementationState?.issues.find((issue) => issue.plan_item_id === issueId);
  const itemTokens = tokenSet(
    [workItem.title, workItem.summary, workItem.component, ...workItem.acceptance_criteria].join(" ")
  );

  const relatedRequirements = pack.requirements.filter((requirement) => {
    const requirementTokens = tokenSet(
      [requirement.id, requirement.text, ...requirement.acceptance_criteria].join(" ")
    );
    return [...requirementTokens].some((token) => itemTokens.has(token));
  });

  const relatedIntegrations = pack.integrations
    .filter((integration) => {
      const integrationTokens = tokenSet(`${integration.name} ${integration.purpose}`);
      return [...integrationTokens].some((token) => itemTokens.has(token));
    })
    .map((integration) => integration.name);

  const designGuidance = [
    ...pack.design_guidelines.visual_direction,
    ...pack.design_guidelines.color_guidance,
    ...pack.design_guidelines.typography_guidance,
    ...pack.design_guidelines.interaction_guidance,
    ...pack.design_guidelines.accessibility_guidance,
    ...pack.design_guidelines.engineering_guidance,
    ...pack.design_guidelines.linting_guidance,
  ].slice(0, 24);

  return IssueExecutionContextSchema.parse({
    generated_at: new Date().toISOString(),
    issue_id: workItem.id,
    issue_number: syncedIssue?.issue_number,
    title: workItem.title,
    summary: workItem.summary,
    acceptance_criteria: workItem.acceptance_criteria,
    dependencies: workItem.depends_on,
    related_components: [workItem.component],
    related_requirements: relatedRequirements.map((requirement) => ({
      id: requirement.id,
      text: requirement.text,
    })),
    related_integrations: relatedIntegrations,
    relevant_design_guidance: designGuidance,
    repo_command_config: Object.fromEntries(
      Object.entries(buildConfig.quality_commands).filter((entry): entry is [string, string] => Boolean(entry[1]))
    ),
    repo_execution_notes: [
      runInput?.repo_target?.mode === "create_new_repo"
        ? "Repository was provisioned by WSPass."
        : "Repository existed before WSPass build orchestration.",
      `Primary component focus: ${workItem.component}.`,
    ],
  });
}
