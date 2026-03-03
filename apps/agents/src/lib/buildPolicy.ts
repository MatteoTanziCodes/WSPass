import path from "node:path";
import { promises as fs } from "node:fs";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { ProjectBuildConfig } from "@pass/shared";
import YAML from "yaml";
import { WorktreeManager } from "./worktreeManager";

const execFileAsync = promisify(execFile);

export function inferQualityCommands(
  scripts: Record<string, string>,
  overrides?: Partial<ProjectBuildConfig["quality_commands"]>
) {
  return {
    install:
      overrides?.install ??
      (scripts["install"] ? "npm install" : scripts["ci"] ? "npm ci" : undefined),
    lint: overrides?.lint ?? (scripts["lint"] ? "npm run lint" : undefined),
    typecheck:
      overrides?.typecheck ??
      (scripts["typecheck"] ? "npm run typecheck" : scripts["check"] ? "npm run check" : undefined),
    test_changed:
      overrides?.test_changed ?? (scripts["test"] ? "npm test" : undefined),
    test_critical:
      overrides?.test_critical ?? (scripts["test:critical"] ? "npm run test:critical" : scripts["test"] ? "npm test" : undefined),
    coverage_extract:
      overrides?.coverage_extract ??
      (scripts["coverage"] ? "npm run coverage" : undefined),
    security_scan: overrides?.security_scan,
    json_yaml_validate: overrides?.json_yaml_validate,
  };
}

export type BuildPolicyResult = {
  status: "passed" | "failed" | "blocked";
  coveragePercent?: number;
  failingChecks: string[];
  summary: string;
};

const SENSITIVE_PATH_PATTERNS = [
  /^\.env($|\.)/i,
  /\.pem$/i,
  /\.key$/i,
  /^data[\\/](integrations[\\/]secrets|project-secrets)[\\/]/i,
];

const SECRET_PATTERNS = [
  /sk-ant-[A-Za-z0-9_\-]+/,
  /github_pat_[A-Za-z0-9_]+/,
  /Bearer\s+[A-Za-z0-9._\-]+/,
  /(secret|token|password|api[_-]?key)\s*[:=]\s*['"][^'"]+['"]/i,
];

const DANGEROUS_COMMAND_PATTERNS = [/rm\s+-rf/i, /DROP\s+TABLE/i, /format\s+c:/i];

function policyFileContents(config: ReturnType<typeof inferQualityCommands>) {
  return `dangerous_commands:
  - rm -rf
  - DROP TABLE
  - format c:
blocked_sensitive_paths:
  - .env
  - .env.*
  - "*.pem"
  - "*.key"
  - data/integrations/secrets/**
  - data/project-secrets/**
required_commands:
  lint: ${config.lint ?? ""}
  typecheck: ${config.typecheck ?? ""}
  test_changed: ${config.test_changed ?? ""}
  test_critical: ${config.test_critical ?? ""}
  coverage_extract: ${config.coverage_extract ?? ""}
`;
}

function lefthookContents(config: ReturnType<typeof inferQualityCommands>) {
  const commands = [config.lint, config.typecheck, config.test_changed].filter(Boolean);
  return `pre-commit:
  commands:
${commands
  .map(
    (command, index) =>
      `    step_${index + 1}:\n      run: ${command}`
  )
  .join("\n")}
`;
}

function workflowContents(config: ReturnType<typeof inferQualityCommands>) {
  const steps = [config.install, config.lint, config.typecheck, config.test_changed, config.test_critical]
    .filter(Boolean)
    .map(
      (command) => `      - name: ${command}\n        run: ${command}`
    )
    .join("\n");

  return `name: Agent Quality Gate
on:
  pull_request:
jobs:
  quality:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
${steps}
`;
}

async function runCommand(repoPath: string, command: string) {
  return execFileAsync(
    "powershell",
    ["-NoProfile", "-Command", command],
    {
      cwd: repoPath,
      env: {
        ...process.env,
        CI: "1",
      },
      windowsHide: true,
      maxBuffer: 1024 * 1024 * 8,
    }
  );
}

async function getChangedFiles(repoPath: string) {
  const { stdout } = await execFileAsync(
    "git",
    ["status", "--porcelain"],
    {
      cwd: repoPath,
      env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
      windowsHide: true,
    }
  );

  return stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => line.slice(3).trim().replace(/\\/g, "/"));
}

function extractCoveragePercent(output: string) {
  const matches = [...output.matchAll(/(\d{1,3}(?:\.\d+)?)\s*%/g)];
  if (!matches.length) {
    return undefined;
  }

  const values = matches
    .map((match) => Number(match[1]))
    .filter((value) => Number.isFinite(value) && value >= 0 && value <= 100);

  if (!values.length) {
    return undefined;
  }

  return Math.max(...values);
}

async function validateStructuredFile(filePath: string, raw: string) {
  if (filePath.endsWith(".json")) {
    JSON.parse(raw);
    return;
  }

  if (filePath.endsWith(".yaml") || filePath.endsWith(".yml")) {
    YAML.parse(raw);
  }
}

export async function appendAuditLog(
  repoPath: string,
  entry: {
    workflow: string;
    issueId: string;
    branch: string;
    tool: string;
    summary: string;
    result: string;
  }
) {
  const line = `[${new Date().toISOString()}] workflow=${entry.workflow} issue=${entry.issueId} branch=${entry.branch} tool=${entry.tool} result=${entry.result} summary=${entry.summary}\n`;
  await fs.appendFile(path.join(repoPath, ".agent-audit.log"), line, "utf8");
}

export async function runBuildPolicy(input: {
  repoPath: string;
  branchName: string;
  issueId: string;
  workflowName: string;
  config: ReturnType<typeof inferQualityCommands>;
}): Promise<BuildPolicyResult> {
  const failingChecks: string[] = [];
  const changedFiles = await getChangedFiles(input.repoPath);

  for (const file of changedFiles) {
    if (SENSITIVE_PATH_PATTERNS.some((pattern) => pattern.test(file))) {
      failingChecks.push(`blocked_sensitive_file:${file}`);
    }
  }

  for (const command of [
    input.config.install,
    input.config.lint,
    input.config.typecheck,
    input.config.test_changed,
    input.config.test_critical,
    input.config.security_scan,
  ].filter(Boolean) as string[]) {
    if (DANGEROUS_COMMAND_PATTERNS.some((pattern) => pattern.test(command))) {
      failingChecks.push(`dangerous_command:${command}`);
    }
  }

  for (const file of changedFiles) {
    const absolutePath = path.join(input.repoPath, file);
    let raw = "";
    try {
      raw = await fs.readFile(absolutePath, "utf8");
    } catch {
      continue;
    }

    for (const pattern of SECRET_PATTERNS) {
      if (pattern.test(raw)) {
        failingChecks.push(`credential_pattern:${file}`);
        break;
      }
    }

    try {
      await validateStructuredFile(file, raw);
    } catch {
      failingChecks.push(`invalid_structured_syntax:${file}`);
    }

    if (/^src\/domain\//i.test(file) && /from ['"].*infrastructure/i.test(raw)) {
      failingChecks.push(`architecture_boundary:${file}`);
    }
  }

  let coveragePercent: number | undefined;

  for (const [label, command] of [
    ["lint", input.config.lint],
    ["typecheck", input.config.typecheck],
    ["test_changed", input.config.test_changed],
    ["test_critical", input.config.test_critical],
    ["coverage_extract", input.config.coverage_extract],
    ["security_scan", input.config.security_scan],
  ] as const) {
    if (!command) {
      continue;
    }

    try {
      const { stdout, stderr } = await runCommand(input.repoPath, command);
      if (label === "coverage_extract") {
        coveragePercent = extractCoveragePercent(`${stdout}\n${stderr}`);
        if (coveragePercent !== undefined && coveragePercent < 95) {
          failingChecks.push(`coverage_below_threshold:${coveragePercent}`);
        }
      }
      await appendAuditLog(input.repoPath, {
        workflow: input.workflowName,
        issueId: input.issueId,
        branch: input.branchName,
        tool: label,
        summary: command,
        result: "succeeded",
      });
    } catch (error) {
      failingChecks.push(label);
      await appendAuditLog(input.repoPath, {
        workflow: input.workflowName,
        issueId: input.issueId,
        branch: input.branchName,
        tool: label,
        summary: command,
        result: error instanceof Error ? error.message : String(error),
      });
    }
  }

  if (failingChecks.length > 0) {
    return {
      status: "failed",
      coveragePercent,
      failingChecks,
      summary: `Build policy failed: ${failingChecks.join(", ")}`,
    };
  }

  return {
    status: "passed",
    coveragePercent,
    failingChecks: [],
    summary: "Build policy checks passed.",
  };
}

export async function ensurePolicyFiles(input: {
  worktreeManager: WorktreeManager;
  clonePath: string;
  defaultBranch: string;
  repositoryBranchName?: string;
  config: ReturnType<typeof inferQualityCommands>;
}) {
  const { worktreeManager, clonePath, defaultBranch, config } = input;
  const branchName = input.repositoryBranchName ?? defaultBranch;

  await worktreeManager.writeFile(clonePath, ".agent-policy.yml", policyFileContents(config));
  await worktreeManager.writeFile(clonePath, ".lefthook.yml", lefthookContents(config));
  await worktreeManager.writeFile(
    clonePath,
    path.join(".github", "workflows", "agent-quality-gate.yml"),
    workflowContents(config)
  );

  const gitignorePath = path.join(clonePath, ".gitignore");
  let gitignore = "";
  try {
    gitignore = await fs.readFile(gitignorePath, "utf8");
  } catch {
    gitignore = "";
  }
  if (!gitignore.includes(".agent-audit.log")) {
    gitignore = `${gitignore.trimEnd()}\n.agent-audit.log\n`.replace(/^\n/, "");
    await fs.writeFile(gitignorePath, gitignore, "utf8");
  }

  return worktreeManager.commitAndPushIfChanged({
    repoPath: clonePath,
    branchName,
    message: "chore(agent): add build policy guardrails",
  });
}
