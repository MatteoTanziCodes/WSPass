import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import type { WorkflowName } from "@pass/shared";

type DispatchLocalWorkflowInput = {
  workflowName: WorkflowName;
  runId: string;
};

const workflowCliMap: Record<WorkflowName, string> = {
  "phase1-planner": "planner",
  "phase1-architecture-refinement": "architectureRefinement",
  "phase2-repo-provision": "repoProvision",
  "phase2-decomposition": "decomposition",
  "phase2-implementation": "implementation",
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
  const tsxPath = path.join(root, "node_modules", "tsx", "dist", "cli.mjs");
  const sourceCliPath = path.join(root, "apps", "agents", "src", "cli", `${cliName}.ts`);
  if (fs.existsSync(tsxPath) && fs.existsSync(sourceCliPath)) {
    return {
      command: process.execPath,
      args: [tsxPath, sourceCliPath],
    };
  }

  const builtCliPath = path.join(root, "apps", "agents", "dist", "cli", `${cliName}.js`);
  if (fs.existsSync(builtCliPath)) {
    return {
      command: process.execPath,
      args: [builtCliPath],
    };
  }

  throw new LocalWorkflowRunnerError(
    `Cannot resolve local agent entrypoint for ${workflowName}. Install dependencies or build @pass/agents.`
  );
}

export class LocalWorkflowRunner {
  async dispatchWorkflow(input: DispatchLocalWorkflowInput): Promise<void> {
    const root = repoRoot();
    const { command, args } = resolveCommand(input.workflowName);
    const logsDir = path.join(root, "runs", input.runId, "logs");
    fs.mkdirSync(logsDir, { recursive: true });
    const logPath = path.join(logsDir, `${input.workflowName}.log`);
    const logFd = fs.openSync(logPath, "a");

    const child = spawn(command, [...args, `--run-id=${input.runId}`], {
      cwd: root,
      env: {
        ...process.env,
        PASS_API_BASE_URL: process.env.PASS_API_BASE_URL ?? "http://localhost:3001",
      },
      detached: true,
      stdio: ["ignore", logFd, logFd],
      windowsHide: true,
    });

    if (!child.pid) {
      fs.closeSync(logFd);
      throw new LocalWorkflowRunnerError(
        `Failed to start local workflow runner for ${input.workflowName}.`
      );
    }

    child.unref();
    fs.closeSync(logFd);
  }
}
