import path from "node:path";
import { promises as fs } from "node:fs";
import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

function normalizeProjectKey(value: string) {
  return createHash("sha256").update(value).digest("hex").slice(0, 16);
}

function repoRoot() {
  return path.resolve(__dirname, "../../../../");
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
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

  private projectLockPath(projectKey: string) {
    return path.join(this.projectRoot(projectKey), ".git-ops.lock");
  }

  private async pathExists(targetPath: string) {
    try {
      await fs.stat(targetPath);
      return true;
    } catch {
      return false;
    }
  }

  private async removeDirectory(targetPath: string) {
    await fs.rm(targetPath, { recursive: true, force: true }).catch(() => undefined);

    if (await this.pathExists(targetPath)) {
      throw new Error(`Unable to clean existing directory at ${targetPath}. Close any processes using it and retry.`);
    }
  }

  private async isGitClone(clonePath: string) {
    try {
      const result = await this.git(["rev-parse", "--is-inside-work-tree"], clonePath);
      return result.stdout.trim() === "true";
    } catch {
      return false;
    }
  }

  private async clearStaleGitLocks(clonePath: string) {
    const gitDir = path.join(clonePath, ".git");
    for (const lockName of ["config.lock", "index.lock"]) {
      const lockPath = path.join(gitDir, lockName);
      try {
        const stats = await fs.stat(lockPath);
        if (Date.now() - stats.mtime.getTime() > 30_000) {
          await fs.unlink(lockPath).catch(() => undefined);
        }
      } catch {
        // ignore missing lock files
      }
    }
  }

  async withProjectGitLock<T>(projectKey: string, work: () => Promise<T>): Promise<T> {
    const projectRoot = this.projectRoot(projectKey);
    const lockPath = this.projectLockPath(projectKey);
    const startedAt = Date.now();
    const timeoutMs = 60_000;
    const staleMs = 5 * 60_000;

    await fs.mkdir(projectRoot, { recursive: true });

    while (true) {
      try {
        await fs.mkdir(lockPath);
        break;
      } catch (error: any) {
        if (error?.code !== "EEXIST") {
          throw error;
        }

        try {
          const stats = await fs.stat(lockPath);
          if (Date.now() - stats.mtime.getTime() > staleMs) {
            await fs.rm(lockPath, { recursive: true, force: true }).catch(() => undefined);
            continue;
          }
        } catch {
          continue;
        }

        if (Date.now() - startedAt > timeoutMs) {
          throw new Error(`Timed out waiting for shared git lock for project ${projectKey}.`);
        }

        await sleep(200);
      }
    }

    try {
      return await work();
    } finally {
      await fs.rm(lockPath, { recursive: true, force: true }).catch(() => undefined);
    }
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
    const cloneExists = await this.pathExists(clonePath);

    if (cloneExists && (await this.isGitClone(clonePath))) {
      await this.git(["remote", "set-url", "origin", remoteUrl], clonePath);
      await this.git(["fetch", "origin", input.defaultBranch], clonePath);
      await this.git(["checkout", input.defaultBranch], clonePath);
      await this.git(["reset", "--hard", `origin/${input.defaultBranch}`], clonePath);
      await this.git(["clean", "-fd"], clonePath);
      return clonePath;
    }

    if (cloneExists) {
      await this.removeDirectory(clonePath);
      await fs.mkdir(path.dirname(clonePath), { recursive: true });
    }

    await this.git(["clone", "--branch", input.defaultBranch, remoteUrl, clonePath], repoRoot());
    return clonePath;
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
    return this.withProjectGitLock(input.projectKey, async () => {
      const clonePath = await this.ensureClone({
        projectKey: input.projectKey,
        repository: input.repository,
        defaultBranch: input.defaultBranch,
        token: input.token,
      });

      await this.clearStaleGitLocks(clonePath);

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
    });
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
