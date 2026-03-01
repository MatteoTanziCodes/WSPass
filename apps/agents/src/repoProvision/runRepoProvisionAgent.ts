import { z } from "zod";
import {
  PlannerRunInputSchema,
  RepoStateSchema,
  RepoTargetSchema,
  RunExecutionSchema,
  RunStatusSchema,
  RunStepSchema,
} from "@pass/shared";
import { GitHubRepoClient } from "./githubRepoClient";

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
  })
  .strict();

const GetRunResponseSchema = z
  .object({
    run: RunDetailSchema,
    artifacts: z.array(z.unknown()),
  })
  .strict();

type RunDetail = z.infer<typeof RunDetailSchema>;

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

  async updateRepoState(runId: string, repoState: z.infer<typeof RepoStateSchema>): Promise<void> {
    await this.request("PATCH", `/runs/${runId}/repo-state`, repoState, true);
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
      throw new Error(`PASS API ${method} ${path} failed with ${response.status}: ${text || response.statusText}`);
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

function splitRepository(repository: string) {
  const [owner, name] = repository.split("/", 2);
  if (!owner || !name) {
    throw new Error(`Invalid repository format: ${repository}. Expected owner/repo.`);
  }
  return { owner, name };
}

function deriveRepositoryDescription(run: RunDetail, repositoryName: string) {
  const explicitDescription = run.input?.repo_target?.description?.trim();
  if (explicitDescription) {
    return explicitDescription;
  }

  const prdText = run.input?.prd_text?.trim();
  if (!prdText) {
    return `Generated delivery repository for ${repositoryName}.`;
  }

  const firstContentLine = prdText
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => line.length > 0);

  if (!firstContentLine) {
    return `Generated delivery repository for ${repositoryName}.`;
  }

  const normalized = firstContentLine.replace(/^#+\s*/, "").replace(/\s+/g, " ").trim();
  const bounded = normalized.length > 300 ? `${normalized.slice(0, 297).trimEnd()}...` : normalized;
  return bounded || `Generated delivery repository for ${repositoryName}.`;
}

function resolveDefaultRepoTarget() {
  const repository =
    process.env.GITHUB_ISSUES_REPOSITORY ??
    (process.env.GITHUB_ISSUES_OWNER && process.env.GITHUB_ISSUES_REPO
      ? `${process.env.GITHUB_ISSUES_OWNER}/${process.env.GITHUB_ISSUES_REPO}`
      : undefined);

  if (!repository) {
    throw new Error(
      "Run input repo_target is missing and no GITHUB_ISSUES_REPOSITORY fallback is configured."
    );
  }

  return RepoTargetSchema.parse({
    mode: "use_existing_repo",
    repository,
  });
}

function resolveRepoTarget(run: RunDetail) {
  return run.input?.repo_target ? RepoTargetSchema.parse(run.input.repo_target) : resolveDefaultRepoTarget();
}

function renderRepoSummary(repoState: z.infer<typeof RepoStateSchema>) {
  return [
    "# Target Repository",
    "",
    `- Mode: ${repoState.mode}`,
    `- Status: ${repoState.status}`,
    `- Source: ${repoState.source}`,
    `- Repository: ${repoState.repository}`,
    `- URL: ${repoState.html_url}`,
    `- Visibility: ${repoState.visibility ?? "unknown"}`,
    `- Default Branch: ${repoState.default_branch ?? "unknown"}`,
    ...(repoState.template_repository ? [`- Template: ${repoState.template_repository}`] : []),
    "",
  ].join("\n");
}

function toRepoState(
  mode: "create_new_repo" | "use_existing_repo",
  source: "created" | "existing",
  repository: {
    full_name: string;
    name: string;
    html_url: string;
    private: boolean;
    description: string | null;
    default_branch: string;
    owner: { login: string };
  },
  templateRepository?: string
) {
  return RepoStateSchema.parse({
    mode,
    status: source === "created" ? "created" : "attached",
    source,
    repository: repository.full_name,
    owner: repository.owner.login,
    name: repository.name,
    html_url: repository.html_url,
    visibility: repository.private ? "private" : "public",
    default_branch: repository.default_branch,
    description: repository.description ?? undefined,
    template_repository: templateRepository,
    configured_at: new Date().toISOString(),
  });
}

function buildFailureMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

export async function runRepoProvisionAgent(runId: string): Promise<void> {
  const api = new PassApiClient({
    baseUrl: readRequiredEnv("PASS_API_BASE_URL"),
    token: readRequiredEnv("PASS_API_TOKEN"),
  });
  const gitHub = new GitHubRepoClient();

  const githubRunId = process.env.GITHUB_RUN_ID ? Number(process.env.GITHUB_RUN_ID) : undefined;
  const githubRunUrl = process.env.GITHUB_RUN_URL;

  try {
    const run = await api.getRun(runId);
    const repoTarget = resolveRepoTarget(run);

    await api.updateExecution(runId, {
      status: "running",
      github_run_id: Number.isFinite(githubRunId) ? githubRunId : undefined,
      github_run_url: githubRunUrl,
    });

    let repoState: z.infer<typeof RepoStateSchema>;

    if (repoTarget.mode === "use_existing_repo") {
      const existingRef = repoTarget.repository
        ? splitRepository(repoTarget.repository)
        : { owner: repoTarget.owner!, name: repoTarget.name! };
      const repository = await gitHub.getRepository(existingRef.owner, existingRef.name);
      repoState = toRepoState("use_existing_repo", "existing", repository);
    } else {
      const repositoryName = repoTarget.name ?? splitRepository(repoTarget.repository!).name;
      const repository = await gitHub.createRepository({
        name: repositoryName,
        description: deriveRepositoryDescription(run, repositoryName),
        visibility: repoTarget.visibility ?? "private",
        templateRepository: repoTarget.template_repository,
      });
      repoState = toRepoState(
        "create_new_repo",
        "created",
        repository,
        repoTarget.template_repository
      );
    }

    await api.updateRepoState(runId, repoState);
    await api.uploadArtifact(runId, {
      name: "repo_state",
      content_type: "application/json",
      payload: repoState,
    });
    await api.uploadArtifact(runId, {
      name: "repo_state_summary",
      content_type: "text/markdown",
      payload: renderRepoSummary(repoState),
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
