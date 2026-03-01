type IssuePlanItem = {
  id: string;
  title: string;
  summary: string;
  body: string;
  labels: string[];
  acceptance_criteria: string[];
};

type SyncIssueInput = {
  runId: string;
  item: IssuePlanItem;
};

type SyncedGitHubIssue = {
  planItemId: string;
  issueNumber: number;
  issueUrl: string;
  githubState: "open" | "closed";
  labels: string[];
  syncStatus: "created" | "updated" | "unchanged";
};

type GitHubIssue = {
  number: number;
  html_url: string;
  state: "open" | "closed";
  body?: string;
  title: string;
  labels?: Array<{ name?: string }>;
  pull_request?: unknown;
};

type GitHubIssuesClientOptions = {
  owner?: string;
  repo?: string;
  token?: string;
};

function resolveRepository(explicit?: { owner?: string; repo?: string }) {
  const explicitOwner = explicit?.owner ?? process.env.GITHUB_ISSUES_OWNER ?? process.env.GITHUB_OWNER;
  const explicitRepo = explicit?.repo ?? process.env.GITHUB_ISSUES_REPO ?? process.env.GITHUB_REPO;

  if (explicitOwner && explicitRepo) {
    return { owner: explicitOwner, repo: explicitRepo };
  }

  const combined = process.env.GITHUB_ISSUES_REPOSITORY ?? process.env.GITHUB_REPOSITORY;
  if (!combined?.includes("/")) {
    throw new Error(
      "GitHub issue sync requires GITHUB_ISSUES_OWNER and GITHUB_ISSUES_REPO, or GITHUB_ISSUES_REPOSITORY."
    );
  }

  const [owner, repo] = combined.split("/", 2);
  if (!owner || !repo) {
    throw new Error("Invalid GITHUB_ISSUES_REPOSITORY format; expected owner/repo.");
  }

  return { owner, repo };
}

function readGitHubToken(explicit?: string) {
  const token =
    explicit ??
    process.env.PASS_GITHUB_WORKFLOW_TOKEN ??
    process.env.GITHUB_WORKFLOW_TOKEN ??
    process.env.PASS_GITHUB_TOKEN ??
    process.env.GITHUB_TOKEN;
  if (!token) {
    throw new Error(
      "GitHub issue sync requires PASS_GITHUB_WORKFLOW_TOKEN, GITHUB_WORKFLOW_TOKEN, PASS_GITHUB_TOKEN, or GITHUB_TOKEN."
    );
  }
  return token;
}

function buildMarkerBlock(runId: string, itemId: string) {
  return [
    "",
    "---",
    `PASS-Run-Id: ${runId}`,
    `PASS-Plan-Item-Id: ${itemId}`,
  ].join("\n");
}

function buildIssueBody(runId: string, item: IssuePlanItem) {
  const acceptance = item.acceptance_criteria.length
    ? item.acceptance_criteria.map((value) => `- ${value}`).join("\n")
    : "- None";

  return [
    item.body,
    "",
    "## Summary",
    item.summary,
    "",
    "## Acceptance Criteria",
    acceptance,
    buildMarkerBlock(runId, item.id),
  ].join("\n");
}

function hasMatchingBody(issue: GitHubIssue, expectedBody: string) {
  return (issue.body ?? "").trim() === expectedBody.trim();
}

function labelsMatch(issue: GitHubIssue, expectedLabels: string[]) {
  const actual = (issue.labels ?? []).map((label) => label.name).filter((value): value is string => Boolean(value));
  if (actual.length !== expectedLabels.length) {
    return false;
  }
  return [...actual].sort().every((value, index) => value === [...expectedLabels].sort()[index]);
}

export class GitHubIssuesClient {
  private readonly token: string;
  private readonly owner: string;
  private readonly repo: string;

  constructor(opts?: GitHubIssuesClientOptions) {
    this.token = readGitHubToken(opts?.token);
    const repository = resolveRepository({ owner: opts?.owner, repo: opts?.repo });
    this.owner = repository.owner;
    this.repo = repository.repo;
  }

  async syncIssues(input: { runId: string; items: IssuePlanItem[] }): Promise<SyncedGitHubIssue[]> {
    const existingIssues = await this.listRepositoryIssues();
    const existingByPlanItem = new Map<string, GitHubIssue>();

    for (const issue of existingIssues) {
      const body = issue.body ?? "";
      const runMatch = body.includes(`PASS-Run-Id: ${input.runId}`);
      if (!runMatch) {
        continue;
      }

      const match = body.match(/PASS-Plan-Item-Id:\s*(.+)/);
      if (!match?.[1]) {
        continue;
      }

      existingByPlanItem.set(match[1].trim(), issue);
    }

    const results: SyncedGitHubIssue[] = [];
    for (const item of input.items) {
      results.push(await this.syncIssue({ runId: input.runId, item }, existingByPlanItem.get(item.id)));
    }

    return results;
  }

  private async syncIssue(
    input: SyncIssueInput,
    existing?: GitHubIssue
  ): Promise<SyncedGitHubIssue> {
    const body = buildIssueBody(input.runId, input.item);
    const labels = input.item.labels;

    if (!existing) {
      const created = await this.request<GitHubIssue>("POST", `/issues`, {
        title: input.item.title,
        body,
        labels,
      });

      return {
        planItemId: input.item.id,
        issueNumber: created.number,
        issueUrl: created.html_url,
        githubState: created.state,
        labels: (created.labels ?? [])
          .map((label) => label.name)
          .filter((value): value is string => Boolean(value)),
        syncStatus: "created",
      };
    }

    const needsUpdate =
      existing.title !== input.item.title || !hasMatchingBody(existing, body) || !labelsMatch(existing, labels);

    if (!needsUpdate) {
      return {
        planItemId: input.item.id,
        issueNumber: existing.number,
        issueUrl: existing.html_url,
        githubState: existing.state,
        labels: (existing.labels ?? [])
          .map((label) => label.name)
          .filter((value): value is string => Boolean(value)),
        syncStatus: "unchanged",
      };
    }

    const updated = await this.request<GitHubIssue>("PATCH", `/issues/${existing.number}`, {
      title: input.item.title,
      body,
      labels,
    });

    return {
      planItemId: input.item.id,
      issueNumber: updated.number,
      issueUrl: updated.html_url,
      githubState: updated.state,
      labels: (updated.labels ?? [])
        .map((label) => label.name)
        .filter((value): value is string => Boolean(value)),
      syncStatus: "updated",
    };
  }

  private async listRepositoryIssues(): Promise<GitHubIssue[]> {
    const response = await this.request<GitHubIssue[]>("GET", "/issues?state=all&per_page=100");
    return response.filter((issue) => !issue.pull_request);
  }

  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const response = await fetch(`https://api.github.com/repos/${this.owner}/${this.repo}${path}`, {
      method,
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${this.token}`,
        "Content-Type": "application/json",
        "X-GitHub-Api-Version": "2022-11-28",
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });

    const text = await response.text();
    const json = text ? JSON.parse(text) : undefined;

    if (!response.ok) {
      throw new Error(`GitHub Issues API ${method} ${path} failed with ${response.status}: ${text || response.statusText}`);
    }

    return json as T;
  }
}
