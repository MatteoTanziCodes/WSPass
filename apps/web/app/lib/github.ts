import "server-only";
import { readServerEnv } from "./env";

export type GitHubRepository = {
  id: number;
  full_name: string;
  private: boolean;
  html_url: string;
};

export async function listAccessibleRepositories(): Promise<GitHubRepository[]> {
  const token =
    process.env.PASS_GITHUB_WORKFLOW_TOKEN ??
    process.env.GITHUB_WORKFLOW_TOKEN ??
    process.env.PASS_GITHUB_TOKEN ??
    process.env.GITHUB_TOKEN;

  if (!token) {
    return [];
  }

  const response = await fetch(
    "https://api.github.com/user/repos?per_page=100&sort=updated&affiliation=owner,collaborator,organization_member",
    {
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${token}`,
        "X-GitHub-Api-Version": "2022-11-28",
      },
      cache: "no-store",
    }
  );

  if (!response.ok) {
    return [];
  }

  const payload = (await response.json()) as GitHubRepository[];
  return payload.sort((left, right) => left.full_name.localeCompare(right.full_name));
}
