type GitHubRepositoryResponse = {
  name: string;
  full_name: string;
  html_url: string;
  private: boolean;
  description: string | null;
  default_branch: string;
  owner: {
    login: string;
  };
};

type CreateRepositoryInput = {
  name: string;
  description?: string;
  visibility: "private" | "public";
  templateRepository?: string;
};

function readGitHubToken() {
  const token =
    process.env.PASS_GITHUB_WORKFLOW_TOKEN ??
    process.env.GITHUB_WORKFLOW_TOKEN ??
    process.env.PASS_GITHUB_TOKEN ??
    process.env.GITHUB_TOKEN;

  if (!token) {
    throw new Error(
      "GitHub repo provisioning requires PASS_GITHUB_WORKFLOW_TOKEN, GITHUB_WORKFLOW_TOKEN, PASS_GITHUB_TOKEN, or GITHUB_TOKEN."
    );
  }

  return token;
}

function splitRepository(repository: string) {
  const [owner, repo] = repository.split("/", 2);
  if (!owner || !repo) {
    throw new Error(`Invalid repository format: ${repository}. Expected owner/repo.`);
  }
  return { owner, repo };
}

export class GitHubRepoClient {
  private readonly token: string;

  constructor() {
    this.token = readGitHubToken();
  }

  async getRepository(owner: string, repo: string) {
    return this.request<GitHubRepositoryResponse>("GET", `/repos/${owner}/${repo}`);
  }

  async createRepository(input: CreateRepositoryInput) {
    if (input.templateRepository) {
      const template = splitRepository(input.templateRepository);
      return this.request<GitHubRepositoryResponse>(
        "POST",
        `/repos/${template.owner}/${template.repo}/generate`,
        {
          owner: await this.getAuthenticatedLogin(),
          name: input.name,
          description: input.description,
          private: input.visibility !== "public",
          include_all_branches: false,
        }
      );
    }

    return this.request<GitHubRepositoryResponse>("POST", "/user/repos", {
      name: input.name,
      description: input.description,
      private: input.visibility !== "public",
      auto_init: true,
    });
  }

  private async getAuthenticatedLogin() {
    const viewer = await this.request<{ login: string }>("GET", "/user");
    return viewer.login;
  }

  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const response = await fetch(`https://api.github.com${path}`, {
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
      throw new Error(`GitHub API ${method} ${path} failed with ${response.status}: ${text || response.statusText}`);
    }

    return json as T;
  }
}
