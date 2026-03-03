import { resolveIntegrationToken } from "../lib/integrationTokens";

type GitHubPullRequest = {
  number: number;
  html_url: string;
  state: "open" | "closed";
  title?: string;
  body?: string | null;
  draft?: boolean;
  mergeable_state?: string;
  merged_at?: string | null;
  base: {
    ref: string;
  };
  head: {
    ref: string;
    sha: string;
  };
};

type GitHubCheckRun = {
  name: string;
  conclusion: string | null;
  status: string;
};

function splitRepository(repository: string) {
  const [owner, repo] = repository.split("/", 2);
  if (!owner || !repo) {
    throw new Error(`Invalid repository format: ${repository}. Expected owner/repo.`);
  }
  return { owner, repo };
}

export class GitHubPullRequestsClient {
  private readonly owner: string;
  private readonly repo: string;
  private readonly explicitToken: string | null;

  constructor(input: { repository: string; token?: string }) {
    const repository = splitRepository(input.repository);
    this.owner = repository.owner;
    this.repo = repository.repo;
    this.explicitToken = input.token?.trim() || null;
  }

  async findOpenPullRequest(branchName: string) {
    const pulls = await this.request<GitHubPullRequest[]>(
      "GET",
      `/pulls?state=open&head=${encodeURIComponent(`${this.owner}:${branchName}`)}`
    );
    return pulls[0] ?? null;
  }

  async createPullRequest(input: {
    title: string;
    body: string;
    head: string;
    base: string;
    draft?: boolean;
  }) {
    return this.request<GitHubPullRequest>("POST", "/pulls", {
      title: input.title,
      body: input.body,
      head: input.head,
      base: input.base,
      draft: input.draft ?? false,
    });
  }

  async getPullRequest(prNumber: number) {
    return this.request<GitHubPullRequest>("GET", `/pulls/${prNumber}`);
  }

  async listCheckRuns(prNumber: number) {
    const pull = await this.getPullRequest(prNumber);
    const response = await this.request<{ check_runs: GitHubCheckRun[] }>(
      "GET",
      `/commits/${pull.head.sha}/check-runs`,
      undefined,
      "application/vnd.github+json"
    );
    return response.check_runs;
  }

  async mergePullRequest(prNumber: number) {
    return this.request("PUT", `/pulls/${prNumber}/merge`, {
      merge_method: "squash",
    });
  }

  async readyForReview(prNumber: number) {
    return this.request("POST", `/pulls/${prNumber}/ready_for_review`);
  }

  async closePullRequest(prNumber: number) {
    return this.request<GitHubPullRequest>("PATCH", `/pulls/${prNumber}`, {
      state: "closed",
    });
  }

  private async getToken() {
    return (
      this.explicitToken ??
      (await resolveIntegrationToken(
        "github",
        [
          "PASS_GITHUB_WORKFLOW_TOKEN",
          "GITHUB_WORKFLOW_TOKEN",
          "PASS_GITHUB_TOKEN",
          "GITHUB_TOKEN",
        ],
        "GitHub pull request operations require a connected admin integration or PASS_GITHUB_WORKFLOW_TOKEN / GITHUB_TOKEN."
      ))
    );
  }

  private async request<T>(
    method: string,
    path: string,
    body?: unknown,
    accept = "application/vnd.github+json"
  ) {
    const token = await this.getToken();
    const response = await fetch(`https://api.github.com/repos/${this.owner}/${this.repo}${path}`, {
      method,
      headers: {
        Accept: accept,
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        "X-GitHub-Api-Version": "2022-11-28",
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });

    const text = await response.text();
    const json = text ? JSON.parse(text) : undefined;

    if (!response.ok) {
      throw new Error(
        `GitHub Pull Requests API ${method} ${path} failed with ${response.status}: ${text || response.statusText}`
      );
    }

    return json as T;
  }
}
