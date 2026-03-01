type DispatchWorkflowInput = {
  workflowName:
    | "phase1-planner"
    | "phase1-architecture-refinement"
    | "phase2-repo-provision"
    | "phase2-decomposition"
    | "phase2-implementation";
  runId: string;
  apiBaseUrl: string;
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
  private readonly token: string;
  private readonly workflowRef: string;
  private readonly owner: string;
  private readonly repo: string;

  constructor() {
    this.token =
      process.env.PASS_GITHUB_WORKFLOW_TOKEN ??
      process.env.GITHUB_WORKFLOW_TOKEN ??
      process.env.PASS_GITHUB_TOKEN ??
      process.env.GITHUB_TOKEN ??
      "";
    this.workflowRef = process.env.GITHUB_WORKFLOW_REF ?? "main";
    const repository = resolveRepository();
    this.owner = repository.owner;
    this.repo = repository.repo;

    if (!this.token) {
      throw new GitHubActionsConfigError(
        "GitHub workflow dispatch requires PASS_GITHUB_WORKFLOW_TOKEN, GITHUB_WORKFLOW_TOKEN, PASS_GITHUB_TOKEN, or GITHUB_TOKEN."
      );
    }
  }

  async dispatchWorkflow(input: DispatchWorkflowInput): Promise<void> {
    const workflowFile =
      input.workflowName === "phase1-architecture-refinement"
        ? process.env.GITHUB_ARCHITECTURE_REFINEMENT_WORKFLOW_FILE ?? "phase1-architecture-refinement.yml"
        : input.workflowName === "phase2-repo-provision"
        ? process.env.GITHUB_REPO_PROVISION_WORKFLOW_FILE ?? "phase2-repo-provision.yml"
        : input.workflowName === "phase2-decomposition"
        ? process.env.GITHUB_DECOMPOSITION_WORKFLOW_FILE ?? "phase2-decomposition.yml"
        : input.workflowName === "phase2-implementation"
        ? process.env.GITHUB_IMPLEMENTATION_WORKFLOW_FILE ?? "phase2-implementation.yml"
        : process.env.GITHUB_PLANNER_WORKFLOW_FILE ?? "phase1-planner.yml";
    const url = `https://api.github.com/repos/${this.owner}/${this.repo}/actions/workflows/${workflowFile}/dispatches`;

    const response = await fetch(url, {
      method: "POST",
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${this.token}`,
        "Content-Type": "application/json",
        "X-GitHub-Api-Version": "2022-11-28",
      },
      body: JSON.stringify({
        ref: this.workflowRef,
        inputs: {
          run_id: input.runId,
          api_base_url: input.apiBaseUrl,
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
