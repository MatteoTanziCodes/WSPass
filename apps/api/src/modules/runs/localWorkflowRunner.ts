import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import type { WorkflowName } from "@pass/shared";
import type { RunStore } from "./runStore";

type DispatchLocalWorkflowInput = {
  workflowName: WorkflowName;
  runId: string;
  issueId?: string;
};

const workflowCliMap: Record<WorkflowName, string> = {
  "phase1-planner": "planner",
  "phase1-architecture-refinement": "architectureRefinement",
  "phase2-repo-provision": "repoProvision",
  "phase2-decomposition": "decomposition",
  "phase2-decomposition-iterator": "decompositionIterator",
  "phase2-implementation": "implementation",
  "phase3-build-orchestrator": "buildOrchestrator",
  "phase3-issue-execution": "issueExecution",
  "phase3-pr-supervisor": "prSupervisor",
};

export class LocalWorkflowRunnerError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LocalWorkflowRunnerError";
  }
}

function repoRoot() {
  return path.resolve(__dirname, "../../../../../");
}

function isLocalhostUrl(value?: string) {
  if (!value) {
    return false;
  }

  try {
    const url = new URL(value);
    return ["localhost", "127.0.0.1", "::1"].includes(url.hostname);
  } catch {
    return false;
  }
}

function normalizeLoopbackUrl(value: string) {
  try {
    const url = new URL(value);
    if (url.hostname === "localhost") {
      url.hostname = "127.0.0.1";
    }
    return url.toString();
  } catch {
    return value;
  }
}

export function shouldUseLocalWorkflowExecution() {
  const mode = (process.env.PASS_LOCAL_WORKFLOW_MODE ?? "").trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(mode)) {
    return true;
  }
  if (["0", "false", "no", "off"].includes(mode)) {
    return false;
  }

  return isLocalhostUrl(process.env.PASS_API_PUBLIC_BASE_URL);
}

function resolveCommand(workflowName: WorkflowName) {
  const root = repoRoot();
  const cliName = workflowCliMap[workflowName];
  const builtCliPath = path.join(root, "apps", "agents", "dist", "cli", `${cliName}.js`);
  if (fs.existsSync(builtCliPath)) {
    return {
      command: process.execPath,
      args: [builtCliPath],
    };
  }

  const tsxPath = path.join(root, "node_modules", "tsx", "dist", "cli.mjs");
  const sourceCliPath = path.join(root, "apps", "agents", "src", "cli", `${cliName}.ts`);
  if (fs.existsSync(tsxPath) && fs.existsSync(sourceCliPath)) {
    return {
      command: process.execPath,
      args: [tsxPath, sourceCliPath],
    };
  }

  throw new LocalWorkflowRunnerError(
    `Cannot resolve local agent entrypoint for ${workflowName}. Install dependencies or build @pass/agents.`
  );
}

export class LocalWorkflowRunner {
  private readonly runStore?: RunStore;

  constructor(opts?: { runStore?: RunStore }) {
    this.runStore = opts?.runStore;
  }

  async dispatchWorkflow(input: DispatchLocalWorkflowInput): Promise<void> {
    const root = repoRoot();
    const { command, args } = resolveCommand(input.workflowName);
    const logsDir = path.join(root, "runs", input.runId, "logs");
    fs.mkdirSync(logsDir, { recursive: true });
    const logPath = path.join(logsDir, `${input.workflowName}.log`);
    const logFd = fs.openSync(logPath, "a");
    fs.writeFileSync(
      logFd,
      `\n[${new Date().toISOString()}] dispatch ${input.workflowName} run_id=${input.runId}${input.issueId ? ` issue_id=${input.issueId}` : ""} command=${command} args=${args.join(" ")}\n`
    );

    const child = spawn(
      command,
      [...args, `--run-id=${input.runId}`, ...(input.issueId ? [`--issue-id=${input.issueId}`] : [])],
      {
      cwd: root,
      env: {
        ...process.env,
        PASS_API_BASE_URL: normalizeLoopbackUrl(
          process.env.PASS_API_BASE_URL ?? "http://localhost:3001"
        ),
      },
      detached: true,
      stdio: ["ignore", logFd, logFd],
      windowsHide: true,
      }
    );

    if (!child.pid) {
      fs.closeSync(logFd);
      throw new LocalWorkflowRunnerError(
        `Failed to start local workflow runner for ${input.workflowName}.`
      );
    }

    child.on("error", (error) => {
      void this.handleChildFailure(input, logPath, `Local workflow process error: ${error.message}`);
    });
    child.on("exit", (code, signal) => {
      if (code && code !== 0) {
        const failureReason = signal
          ? `Local workflow exited via signal ${signal}`
          : `Local workflow exited with code ${code}`;
        void this.handleChildFailure(input, logPath, failureReason);
      }
    });

    child.unref();
    fs.closeSync(logFd);
  }

  private async handleChildFailure(
    input: DispatchLocalWorkflowInput,
    logPath: string,
    reason: string
  ) {
    try {
      fs.appendFileSync(logPath, `[${new Date().toISOString()}] ${reason}\n`);
    } catch {
      // Ignore logging fallback failures.
    }

    if (!this.runStore) {
      return;
    }

    try {
      const run = await this.runStore.getRun(input.runId);
      const status = run.execution?.status;
      if (!status || !["queued", "dispatched", "running"].includes(status)) {
        return;
      }

      await this.runStore.failExecution(input.runId, reason);

      if (input.workflowName === "phase3-build-orchestrator") {
        const now = new Date().toISOString();
        const currentBuildState = run.build_state;
        await this.runStore.updateBuildState(input.runId, {
          status: "failed",
          started_at: currentBuildState?.started_at ?? now,
          completed_at: now,
          current_ring: currentBuildState?.current_ring ?? 0,
          max_parallel_workers: currentBuildState?.max_parallel_workers ?? 3,
          issues: currentBuildState?.issues ?? [],
          blocked_reason: reason,
          summary: reason,
          audit_artifact_name: currentBuildState?.audit_artifact_name,
        });
      }
    } catch {
      // Ignore fallback execution update errors and preserve the original workflow logs.
    }
  }
}
