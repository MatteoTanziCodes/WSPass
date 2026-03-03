import path from "node:path";
import { promises as fs } from "node:fs";
import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

function normalizeProjectKey(value: string) {
  return createHash("sha256").update(value).digest("hex").slice(0, 16);
}

function readRequiredEnv(name: string) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is required.`);
  }
  return value;
}

function repoRoot() {
  return path.resolve(__dirname, "../../../../");
}

export type PreparedWorktree = {
  clonePath: string;
  worktreePath: string;
  branchName: string;
  defaultBranch: string;
};

export class WorktreeManager {
  private readonly worktreesRoot = path.join(repoRoot(), "data", "worktrees");

  private projectRoot(projectKey: string) {
    return path.join(this.worktreesRoot, normalizeProjectKey(projectKey));
  }

  private clonePath(projectKey: string) {
    return path.join(this.projectRoot(projectKey), "repo");
  }

  private issueWorktreePath(projectKey: string, issueId: string) {
    return path.join(this.projectRoot(projectKey), "issues", issueId);
  }

  async ensureClone(input: {
    projectKey: string;
    repository: string;
    defaultBranch: string;
    token: string;
  }) {
    const clonePath = this.clonePath(input.projectKey);
    await fs.mkdir(path.dirname(clonePath), { recursive: true });

    const remoteUrl = `https://x-access-token:${input.token}@github.com/${input.repository}.git`;
    const gitDir = path.join(clonePath, ".git");

    try {
      await fs.stat(gitDir);
      await this.git(["remote", "set-url", "origin", remoteUrl], clonePath);
      await this.git(["fetch", "origin", input.defaultBranch], clonePath);
      await this.git(["checkout", input.defaultBranch], clonePath);
      await this.git(["reset", "--hard", `origin/${input.defaultBranch}`], clonePath);
      await this.git(["clean", "-fd"], clonePath);
      return clonePath;
    } catch {
      await fs.rm(clonePath, { recursive: true, force: true }).catch(() => undefined);
      await fs.mkdir(path.dirname(clonePath), { recursive: true });
      await this.git(["clone", "--branch", input.defaultBranch, remoteUrl, clonePath], repoRoot());
      return clonePath;
    }
  }

  async prepareIssueWorktree(input: {
    projectKey: string;
    repository: string;
    defaultBranch: string;
    issueId: string;
    issueNumber?: number;
    slug: string;
    token: string;
  }): Promise<PreparedWorktree> {
    const clonePath = await this.ensureClone({
      projectKey: input.projectKey,
      repository: input.repository,
      defaultBranch: input.defaultBranch,
      token: input.token,
    });

    const worktreePath = this.issueWorktreePath(input.projectKey, input.issueId);
    const branchName = `agent/${input.issueNumber ?? input.issueId}-${input.slug}`
      .replace(/[^a-zA-Z0-9/_-]+/g, "-")
      .toLowerCase()
      .slice(0, 80);

    await fs.rm(worktreePath, { recursive: true, force: true }).catch(() => undefined);
    await fs.mkdir(path.dirname(worktreePath), { recursive: true });

    await this.git(["worktree", "prune"], clonePath).catch(() => undefined);
    await this.git(
      ["worktree", "add", "-B", branchName, worktreePath, `origin/${input.defaultBranch}`],
      clonePath
    );

    return {
      clonePath,
      worktreePath,
      branchName,
      defaultBranch: input.defaultBranch,
    };
  }

  async commitAndPushIfChanged(input: {
    repoPath: string;
    branchName: string;
    message: string;
  }) {
    const status = await this.git(["status", "--porcelain"], input.repoPath);
    if (!status.stdout.trim()) {
      return false;
    }

    await this.git(["add", "-A"], input.repoPath);
    await this.git(["commit", "-m", input.message], input.repoPath);
    await this.git(["push", "-u", "origin", input.branchName], input.repoPath);
    return true;
  }

  async writeFile(repoPath: string, relativePath: string, contents: string) {
    const filePath = path.join(repoPath, relativePath);
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, contents, "utf8");
  }

  async readPackageJsonScripts(repoPath: string) {
    try {
      const raw = await fs.readFile(path.join(repoPath, "package.json"), "utf8");
      const parsed = JSON.parse(raw) as { scripts?: Record<string, string> };
      return parsed.scripts ?? {};
    } catch {
      return {};
    }
  }

  private async git(args: string[], cwd: string) {
    return execFileAsync("git", args, {
      cwd,
      env: {
        ...process.env,
        GIT_TERMINAL_PROMPT: "0",
      },
      windowsHide: true,
    });
  }
}
