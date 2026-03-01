import { parse as parseYaml } from "yaml";
import { z } from "zod";
import {
  ArchitecturePackSchema,
  OrgConstraintsSchema,
  PlannerRunInputSchema,
  RunExecutionSchema,
  RunStatusSchema,
  RunStepSchema,
  type ArchitecturePack,
  type OrgConstraints,
} from "@pass/shared";
import { generateArchitecturePack } from "../providers/llmClient";

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
  })
  .strict();

const GetRunResponseSchema = z
  .object({
    run: RunDetailSchema,
    artifacts: z.array(z.unknown()),
  })
  .strict();

type RunDetail = z.infer<typeof RunDetailSchema>;

type PassApiClientOptions = {
  baseUrl: string;
  token: string;
};

class PassApiClient {
  private readonly baseUrl: string;
  private readonly token: string;

  constructor(opts: PassApiClientOptions) {
    this.baseUrl = opts.baseUrl.replace(/\/+$/, "");
    this.token = opts.token;
  }

  async getRun(runId: string): Promise<RunDetail> {
    const response = await this.request("GET", `/runs/${runId}`);
    return GetRunResponseSchema.parse(response).run;
  }

  async updateRun(
    runId: string,
    patch: { status?: z.infer<typeof RunStatusSchema>; current_step?: z.infer<typeof RunStepSchema> }
  ): Promise<void> {
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
  ): Promise<void> {
    await this.request("PATCH", `/runs/${runId}/execution`, patch, true);
  }

  async uploadArtifact(
    runId: string,
    artifact: {
      name: string;
      content_type: "application/json" | "text/plain" | "text/markdown";
      payload: unknown;
    }
  ): Promise<void> {
    await this.request("POST", `/runs/${runId}/artifacts`, artifact, true);
  }

  private async request(method: string, path: string, body?: unknown, authenticated = false) {
    const headers: Record<string, string> = {
      Accept: "application/json",
    };

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

function parseOrgConstraints(input?: string): OrgConstraints {
  if (!input?.trim()) {
    return OrgConstraintsSchema.parse({});
  }

  const parsed = parseYaml(input);
  return OrgConstraintsSchema.parse(parsed ?? {});
}

function toNodeId(name: string) {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "") || "node";
}

function renderSummary(pack: ArchitecturePack) {
  const architecture = pack.architecture;
  const implementation = pack.implementation;
  const suggestedQuestions =
    pack.refinement.chat.suggested_questions.length > 0
      ? pack.refinement.chat.suggested_questions
      : ["None"];
  const editableComponents =
    pack.refinement.wireframe.editable_components.length > 0
      ? pack.refinement.wireframe.editable_components
      : ["None"];
  const editableTopics =
    pack.refinement.chat.editable_topics.length > 0 ? pack.refinement.chat.editable_topics : ["None"];
  const logicRequirements =
    implementation.logic_requirements.length > 0 ? implementation.logic_requirements : [];
  const issuePlan = implementation.github_issue_plan.length > 0 ? implementation.github_issue_plan : [];

  return [
    `# Architecture Pack: ${pack.prd.title ?? pack.run_id}`,
    "",
    "## Summary",
    pack.prd.summary,
    "",
    "## Architecture",
    `- ${architecture.name}`,
    `- ${architecture.description}`,
    "",
    "## Components",
    ...architecture.components.map((component) => `- ${component.name} (${component.type})`),
    "",
    "## Data Flows",
    ...(architecture.data_flows.length > 0 ? architecture.data_flows.map((value) => `- ${value}`) : ["- None"]),
    "",
    "## Tradeoffs",
    ...architecture.tradeoffs.pros.map((value) => `- Pro: ${value}`),
    ...architecture.tradeoffs.cons.map((value) => `- Con: ${value}`),
    ...architecture.tradeoffs.risks.map((value) => `- Risk: ${value}`),
    "",
    "## Rationale",
    architecture.rationale,
    "",
    "## Wireframe Editing",
    `- Enabled: ${pack.refinement.wireframe.enabled}`,
    ...editableComponents.map((value) => `- Editable component: ${value}`),
    "",
    "## Chat Guidance",
    `- Enabled: ${pack.refinement.chat.enabled}`,
    ...suggestedQuestions.map((value) => `- Suggested question: ${value}`),
    ...editableTopics.map((value) => `- Editable topic: ${value}`),
    "",
    "## Implementation Rail",
    implementation.summary,
    "",
    "## IaC Handoff",
    implementation.iac_handoff.summary,
    ...(implementation.iac_handoff.modules.length > 0
      ? implementation.iac_handoff.modules.map((value) => `- Module: ${value}`)
      : ["- None"]),
    "",
    "## Logic Requirements",
    ...(logicRequirements.length > 0
      ? logicRequirements.flatMap((item) => [
          `- ${item.id}: ${item.title}`,
          `- Summary: ${item.summary}`,
        ])
      : ["- None"]),
    "",
    "## GitHub Issue Plan",
    ...(issuePlan.length > 0
      ? issuePlan.flatMap((item) => [
          `- ${item.id}: ${item.title}`,
          `- Summary: ${item.summary}`,
        ])
      : ["- None"]),
    "",
    "## Coordination Policy",
    `- Pause on pending questions: ${implementation.coordination.pause_on_pending_questions}`,
    `- Live issue updates: ${implementation.coordination.live_issue_updates}`,
    ...implementation.coordination.coordination_views.map((value) => `- Coordination view: ${value}`),
    ...implementation.coordination.question_sources.map((value) => `- Question source: ${value}`),
    "",
    "## Observability",
    `- Log traces enabled: ${implementation.observability.log_traces_enabled}`,
    `- Coordination panel enabled: ${implementation.observability.coordination_panel_enabled}`,
    ...implementation.observability.required_signals.map((value) => `- Required signal: ${value}`),
    ...implementation.observability.dashboard_panels.map((value) => `- Dashboard panel: ${value}`),
    "",
    "## Assumptions",
    ...(pack.assumptions.length > 0 ? pack.assumptions.map((value) => `- ${value}`) : ["- None"]),
    "",
    "## Open Questions",
    ...(pack.open_questions.length > 0
      ? pack.open_questions.map((value) => `- ${value}`)
      : ["- None"]),
    "",
  ].join("\n");
}

function renderMermaid(pack: ArchitecturePack) {
  const architecture = pack.architecture;
  const lines = ["flowchart LR"];

  for (const component of architecture.components) {
    lines.push(`  ${toNodeId(component.name)}["${component.name} (${component.type})"]`);
  }

  for (let index = 0; index < architecture.components.length - 1; index += 1) {
    const from = architecture.components[index];
    const to = architecture.components[index + 1];
    lines.push(`  ${toNodeId(from.name)} --> ${toNodeId(to.name)}`);
  }

  return lines.join("\n") + "\n";
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

export async function runPlannerAgent(runId: string): Promise<void> {
  const api = new PassApiClient({
    baseUrl: readRequiredEnv("PASS_API_BASE_URL"),
    token: readRequiredEnv("PASS_API_TOKEN"),
  });

  const githubRunId = process.env.GITHUB_RUN_ID ? Number(process.env.GITHUB_RUN_ID) : undefined;
  const githubRunUrl = process.env.GITHUB_RUN_URL;

  try {
    const run = await api.getRun(runId);
    if (!run.input) {
      throw new Error("Run input is missing.");
    }

    const orgConstraints = parseOrgConstraints(run.input.org_constraints_yaml);

    await api.updateExecution(runId, {
      status: "running",
      github_run_id: Number.isFinite(githubRunId) ? githubRunId : undefined,
      github_run_url: githubRunUrl,
    });

    await api.updateRun(runId, { status: "parsed", current_step: "parse" });

    const pack = ArchitecturePackSchema.parse(
      await generateArchitecturePack({
        runId,
        prdText: run.input.prd_text,
        orgConstraints,
      })
    );

    await api.updateRun(runId, { status: "plan_generated", current_step: "plan" });

    await api.uploadArtifact(runId, {
      name: "architecture_pack",
      content_type: "application/json",
      payload: pack,
    });
    await api.uploadArtifact(runId, {
      name: "architecture_pack_summary",
      content_type: "text/markdown",
      payload: renderSummary(pack),
    });
    await api.uploadArtifact(runId, {
      name: "architecture_pack_diagram",
      content_type: "text/plain",
      payload: renderMermaid(pack),
    });

    await api.updateRun(runId, { status: "exported", current_step: "export" });
    await api.updateExecution(runId, {
      status: "succeeded",
      github_run_id: Number.isFinite(githubRunId) ? githubRunId : undefined,
      github_run_url: githubRunUrl,
    });
  } catch (error) {
    const message = buildFailureMessage(error);

    try {
      await api.updateRun(runId, { status: "failed" });
    } catch {
      // Keep the original failure if the status update also fails.
    }

    try {
      await api.updateExecution(runId, {
        status: "failed",
        github_run_id: Number.isFinite(githubRunId) ? githubRunId : undefined,
        github_run_url: githubRunUrl,
        error_message: message,
      });
    } catch {
      // Keep the original failure if the execution update also fails.
    }

    throw error;
  }
}
