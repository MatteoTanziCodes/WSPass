import { retrieveSecret } from "../integrations/encryptedSecretStore";

type DispatchWorkflowInput = {
  workflowName:
    | "phase1-planner"
    | "phase1-architecture-refinement"
    | "phase2-repo-provision"
    | "phase2-decomposition"
    | "phase2-decomposition-iterator"
    | "phase2-implementation"
    | "phase3-build-orchestrator"
    | "phase3-issue-execution"
    | "phase3-pr-supervisor";
  runId: string;
  apiBaseUrl: string;
  issueId?: string;
};

export class GitHubActionsConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GitHubActionsConfigError";
  }
}

export class GitHubActionsDispatchError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GitHubActionsDispatchError";
  }
}

function resolveRepository() {
  const explicitOwner = process.env.GITHUB_WORKFLOW_OWNER ?? process.env.GITHUB_OWNER;
  const explicitRepo = process.env.GITHUB_WORKFLOW_REPO ?? process.env.GITHUB_REPO;

  if (explicitOwner && explicitRepo) {
    return { owner: explicitOwner, repo: explicitRepo };
  }

  const combined = process.env.GITHUB_WORKFLOW_REPOSITORY ?? process.env.GITHUB_REPOSITORY;
  if (!combined?.includes("/")) {
    throw new GitHubActionsConfigError(
      "GitHub workflow dispatch requires GITHUB_WORKFLOW_OWNER and GITHUB_WORKFLOW_REPO, or GITHUB_WORKFLOW_REPOSITORY."
    );
  }

  const [owner, repo] = combined.split("/", 2);
  if (!owner || !repo) {
    throw new GitHubActionsConfigError(
      "Invalid GITHUB_WORKFLOW_REPOSITORY format; expected owner/repo."
    );
  }

  return { owner, repo };
}

export class GitHubActionsClient {
  private readonly workflowRef: string;
  private readonly owner: string;
  private readonly repo: string;

  constructor() {
    this.workflowRef = process.env.GITHUB_WORKFLOW_REF ?? "main";
    const repository = resolveRepository();
    this.owner = repository.owner;
    this.repo = repository.repo;
  }

  private async getToken() {
    const token =
      (await retrieveSecret("github")) ??
      process.env.PASS_GITHUB_WORKFLOW_TOKEN ??
      process.env.GITHUB_WORKFLOW_TOKEN ??
      process.env.PASS_GITHUB_TOKEN ??
      process.env.GITHUB_TOKEN ??
      "";

    if (!token) {
      throw new GitHubActionsConfigError(
        "GitHub workflow dispatch requires a connected admin integration or PASS_GITHUB_WORKFLOW_TOKEN / GITHUB_TOKEN."
      );
    }

    return token;
  }

  async dispatchWorkflow(input: DispatchWorkflowInput): Promise<void> {
    const token = await this.getToken();
    const workflowFile =
      input.workflowName === "phase1-architecture-refinement"
        ? process.env.GITHUB_ARCHITECTURE_REFINEMENT_WORKFLOW_FILE ?? "phase1-architecture-refinement.yml"
        : input.workflowName === "phase2-repo-provision"
        ? process.env.GITHUB_REPO_PROVISION_WORKFLOW_FILE ?? "phase2-repo-provision.yml"
        : input.workflowName === "phase2-decomposition"
        ? process.env.GITHUB_DECOMPOSITION_WORKFLOW_FILE ?? "phase2-decomposition.yml"
        : input.workflowName === "phase2-decomposition-iterator"
        ? process.env.GITHUB_DECOMPOSITION_ITERATOR_WORKFLOW_FILE ?? "phase2-decomposition-iterator.yml"
        : input.workflowName === "phase2-implementation"
        ? process.env.GITHUB_IMPLEMENTATION_WORKFLOW_FILE ?? "phase2-implementation.yml"
        : input.workflowName === "phase3-build-orchestrator"
        ? process.env.GITHUB_BUILD_ORCHESTRATOR_WORKFLOW_FILE ?? "phase3-build-orchestrator.yml"
        : input.workflowName === "phase3-issue-execution"
        ? process.env.GITHUB_ISSUE_EXECUTION_WORKFLOW_FILE ?? "phase3-issue-execution.yml"
        : input.workflowName === "phase3-pr-supervisor"
        ? process.env.GITHUB_PR_SUPERVISOR_WORKFLOW_FILE ?? "phase3-pr-supervisor.yml"
        : process.env.GITHUB_PLANNER_WORKFLOW_FILE ?? "phase1-planner.yml";
    const url = `https://api.github.com/repos/${this.owner}/${this.repo}/actions/workflows/${workflowFile}/dispatches`;

    const response = await fetch(url, {
      method: "POST",
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        "X-GitHub-Api-Version": "2022-11-28",
      },
      body: JSON.stringify({
        ref: this.workflowRef,
        inputs: {
          run_id: input.runId,
          api_base_url: input.apiBaseUrl,
          ...(input.issueId ? { issue_id: input.issueId } : {}),
        },
      }),
    });

    if (!response.ok) {
      const body = await response.text();
      throw new GitHubActionsDispatchError(
        `GitHub workflow dispatch failed with ${response.status}: ${body || response.statusText}`
      );
    }
  }
}
