import { promises as fs } from "node:fs";
import path from "node:path";
import {
  BuildOrchestrationStateSchema,
  IssueContextQuestionSchema,
  IssueExecutionAttemptSchema,
  IssueExecutionStateSchema,
  ProjectBuildConfigSchema,
  ProjectSecretRequirementSchema,
  type BuildOrchestrationState,
  type DecompositionPlan,
  type IssueContextQuestion,
  type IssueExecutionState,
  type ProjectBuildConfig,
  type ProjectSecretRequirement,
} from "@pass/shared";
import { deriveProjectKeyFromRun } from "@pass/shared";
import { BuildApiClient } from "../lib/buildApiClient";
import { appendAuditLog, ensurePolicyFiles, inferQualityCommands, runBuildPolicy } from "../lib/buildPolicy";
import { buildIssueExecutionContext } from "../lib/issueContextBuilder";
import { resolveIntegrationToken } from "../lib/integrationTokens";
import { ProjectBuildClient } from "../lib/projectBuildClient";
import { WorktreeManager } from "../lib/worktreeManager";
import { GitHubPullRequestsClient } from "./githubPullRequestsClient";

function now() {
  return new Date().toISOString();
}

function slugify(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
}

function summarizeError(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function logIssue(issueId: string, message: string) {
  console.log(`[issue-execution][${issueId}] ${message}`);
}

function containsToken(text: string, token: string) {
  return text.toLowerCase().includes(token.toLowerCase());
}

function collectIssueText(issue: { title: string; blocker_summary?: string }, workItem: DecompositionPlan["work_items"][number]) {
  return [
    issue.title,
    issue.blocker_summary,
    workItem.title,
    workItem.summary,
    workItem.component,
    ...workItem.acceptance_criteria,
    ...workItem.labels,
  ]
    .filter(Boolean)
    .join("\n");
}

function detectSecretRequirements(input: {
  issue: IssueExecutionState;
  workItem: DecompositionPlan["work_items"][number];
  existingSecretNames: Set<string>;
  hasGitHubIntegration: boolean;
}): ProjectSecretRequirement[] {
  const text = collectIssueText(input.issue, input.workItem);
  const requirements: ProjectSecretRequirement[] = [];

  if (!input.hasGitHubIntegration) {
    requirements.push(
      ProjectSecretRequirementSchema.parse({
        id: `${input.issue.issue_id}_github`,
        issue_id: input.issue.issue_id,
        kind: "integration",
        provider: "github",
        name: "github",
        label: "GitHub integration",
        reason: "Required to push branches, open PRs, and merge issue work.",
        status: "open",
        required_by_workflow: "phase3-issue-execution",
        created_at: now(),
      })
    );
  }

  if (containsToken(text, "stripe")) {
    for (const secretName of ["STRIPE_SECRET_KEY", "STRIPE_WEBHOOK_SECRET"]) {
      if (!input.existingSecretNames.has(secretName)) {
        requirements.push(
          ProjectSecretRequirementSchema.parse({
            id: `${input.issue.issue_id}_${secretName.toLowerCase()}`,
            issue_id: input.issue.issue_id,
            kind: "project_secret",
            provider: "stripe",
            name: secretName,
            label: secretName,
            reason: "Stripe-related work requires this project secret before implementation can proceed.",
            status: "open",
            required_by_workflow: "phase3-issue-execution",
            created_at: now(),
          })
        );
      }
    }
  }

  if (containsToken(text, "sentry") && !input.existingSecretNames.has("SENTRY_AUTH_TOKEN")) {
    requirements.push(
      ProjectSecretRequirementSchema.parse({
        id: `${input.issue.issue_id}_sentry_auth_token`,
        issue_id: input.issue.issue_id,
        kind: "project_secret",
        provider: "sentry",
        name: "SENTRY_AUTH_TOKEN",
        label: "SENTRY_AUTH_TOKEN",
        reason: "Sentry-related work requires the project auth token.",
        status: "open",
        required_by_workflow: "phase3-issue-execution",
        created_at: now(),
      })
    );
  }

  return requirements;
}

function detectContextQuestions(input: {
  issue: IssueExecutionState;
  workItem: DecompositionPlan["work_items"][number];
}): IssueContextQuestion[] {
  const text = collectIssueText(input.issue, input.workItem);
  const questions: IssueContextQuestion[] = [];

  if (
    input.workItem.acceptance_criteria.length === 0 ||
    /\b(tbd|confirm|decide|choose|clarify)\b/i.test(text)
  ) {
    questions.push(
      IssueContextQuestionSchema.parse({
        id: `${input.issue.issue_id}_context`,
        issue_id: input.issue.issue_id,
        prompt: `What implementation detail should guide "${input.workItem.title}"?`,
        rationale:
          "The issue does not carry enough concrete acceptance criteria to make a safe autonomous implementation pass.",
        status: "open",
        created_at: now(),
        related_components: [input.workItem.component],
      })
    );
  }

  return questions;
}

function buildContextQuestionResponse(input: {
  question: IssueContextQuestion;
  workItem: DecompositionPlan["work_items"][number];
}) {
  const answer = input.question.answer?.trim();
  if (!answer) {
    return `Acknowledged. I will continue issue execution for "${input.workItem.title}" using the supplied clarification.`;
  }

  return [
    `Got it — I will continue "${input.workItem.title}" using this clarification:`,
    answer,
    "",
    "If another ambiguity appears during implementation, I will raise a new issue-context question here.",
  ].join("\n");
}

function updateIssueInBuildState(
  buildState: BuildOrchestrationState,
  issueId: string,
  updater: (current: IssueExecutionState) => IssueExecutionState
) {
  return BuildOrchestrationStateSchema.parse({
    ...buildState,
    issues: buildState.issues.map((issue) => (issue.issue_id === issueId ? updater(issue) : issue)),
  });
}

async function persistIssueState(
  api: BuildApiClient,
  runId: string,
  buildState: BuildOrchestrationState,
  issueState: IssueExecutionState
) {
  const updated = await api.updateIssueExecutionState(runId, issueState.issue_id, issueState);
  return BuildOrchestrationStateSchema.parse(updated.run.build_state ?? buildState);
}

function withAttempt(
  issue: IssueExecutionState,
  patch: Partial<IssueExecutionState> & { status: IssueExecutionState["status"]; summary?: string }
) {
  const { summary, ...issuePatch } = patch;
  const attempt = IssueExecutionAttemptSchema.parse({
    attempt_number: issue.current_attempt,
    started_at: issue.attempts.at(-1)?.started_at ?? now(),
    completed_at:
      patch.status === "working" ||
      patch.status === "gathering_requirements" ||
      patch.status === "ready"
        ? undefined
        : now(),
    status: patch.status,
    summary: summary ?? issue.attempts.at(-1)?.summary ?? `Issue state: ${patch.status}`,
    log_artifact_names: issue.attempts.at(-1)?.log_artifact_names ?? [],
    llm_observability_artifact_name: issue.attempts.at(-1)?.llm_observability_artifact_name,
    quality_result: issue.attempts.at(-1)?.quality_result,
    error_message: patch.status === "failed" || patch.status === "commit_blocked" ? patch.blocker_summary : undefined,
  });

  return IssueExecutionStateSchema.parse({
    ...issue,
    ...issuePatch,
    attempts: [...issue.attempts.slice(0, Math.max(issue.attempts.length - 1, 0)), attempt],
    last_updated_at: now(),
  });
}

async function writeExecutionArtifacts(input: {
  api: BuildApiClient;
  runId: string;
  issueId: string;
  context: ReturnType<typeof buildIssueExecutionContext>;
  summary: Record<string, unknown>;
  repoPath?: string;
}) {
  await input.api.writeArtifact(input.runId, {
    name: `issue_execution_context_${input.issueId}`,
    content_type: "application/json",
    payload: input.context,
  });
  await input.api.writeArtifact(input.runId, {
    name: `issue_execution_summary_${input.issueId}`,
    content_type: "application/json",
    payload: input.summary,
  });

  if (input.repoPath) {
    const auditPath = path.join(input.repoPath, ".agent-audit.log");
    try {
      const auditLog = await fs.readFile(auditPath, "utf8");
      await input.api.writeArtifact(input.runId, {
        name: `issue_audit_${input.issueId}_attempt_${String(input.summary["attempt"] ?? 1)}`,
        content_type: "text/plain",
        payload: auditLog,
      });
    } catch {
      // No audit log yet.
    }
  }
}

export async function runIssueExecutionAgent(runId: string, issueId: string): Promise<void> {
  logIssue(issueId, `starting issue worker for run ${runId}`);
  const api = new BuildApiClient();
  const projectBuild = new ProjectBuildClient();
  const worktreeManager = new WorktreeManager();

  const runEnvelope = await api.getRun(runId);
  const run = runEnvelope.run;
  const buildState = run.build_state;
  if (!buildState) {
    throw new Error("Build state has not been initialized for this run.");
  }

  let issueState = buildState.issues.find((issue) => issue.issue_id === issueId);
  if (!issueState) {
    throw new Error(`Issue ${issueId} is not tracked in the build state.`);
  }

  const plan = await api.getDecompositionPlan(runId);
  const workItem = plan.work_items.find((item) => item.id === issueId);
  if (!workItem) {
    throw new Error(`Issue ${issueId} was not found in the decomposition plan.`);
  }
  logIssue(issueId, `loaded decomposition work item "${workItem.title}"`);

  const projectKey = deriveProjectKeyFromRun(run);
  const projectConfig = ProjectBuildConfigSchema.parse(await projectBuild.getConfig(projectKey));

  let currentBuildState = buildState;
  issueState = withAttempt(issueState, {
    status: "gathering_requirements",
    blocker_summary: undefined,
    summary: `Gathering requirements for ${workItem.title}.`,
  });
  currentBuildState = await persistIssueState(api, runId, currentBuildState, issueState);
  logIssue(issueId, "persisted gathering_requirements state");

  const secrets = await projectBuild.listSecrets(projectKey);
  const existingSecretNames = new Set(secrets.map((secret) => secret.name));
  let hasGitHubIntegration = true;
  try {
    await resolveIntegrationToken(
      "github",
      ["PASS_GITHUB_WORKFLOW_TOKEN", "GITHUB_WORKFLOW_TOKEN", "PASS_GITHUB_TOKEN", "GITHUB_TOKEN"],
      "Missing GitHub integration."
    );
  } catch {
    hasGitHubIntegration = false;
  }

  const requirements = detectSecretRequirements({
    issue: issueState,
    workItem,
    existingSecretNames,
    hasGitHubIntegration,
  });
  if (requirements.length > 0) {
    logIssue(issueId, `blocking for ${requirements.length} missing secret or integration requirement(s)`);
    issueState = IssueExecutionStateSchema.parse({
      ...issueState,
      status: "blocked_missing_tools",
      secret_requirements: requirements,
      blocker_summary: requirements.map((item) => item.label).join(", "),
      last_updated_at: now(),
    });
    await persistIssueState(api, runId, currentBuildState, issueState);
    return;
  }

  const existingOpenQuestions = issueState.context_questions.filter((question) => question.status === "open");
  if (existingOpenQuestions.length > 0) {
    logIssue(issueId, `blocking for ${existingOpenQuestions.length} existing open context question(s)`);
    issueState = IssueExecutionStateSchema.parse({
      ...issueState,
      status: "blocked_missing_context",
      context_questions: issueState.context_questions,
      blocker_summary: existingOpenQuestions[0]?.prompt,
      last_updated_at: now(),
    });
    await persistIssueState(api, runId, currentBuildState, issueState);
    return;
  }

  const answeredQuestions = issueState.context_questions.filter(
    (question) => question.status === "answered" && question.answer?.trim()
  );

  if (answeredQuestions.length > 0) {
    logIssue(issueId, `consuming ${answeredQuestions.length} answered context question(s)`);
    issueState = IssueExecutionStateSchema.parse({
      ...issueState,
      context_questions: issueState.context_questions.map((question) => {
        if (!answeredQuestions.some((candidate) => candidate.id === question.id)) {
          return question;
        }

        return {
          ...question,
          status: "resolved",
          resolved_at: now(),
          agent_response: buildContextQuestionResponse({
            question,
            workItem,
          }),
        };
      }),
      blocker_summary: undefined,
      last_updated_at: now(),
    });
    currentBuildState = await persistIssueState(api, runId, currentBuildState, issueState);
  }

  const hasResolvedContext = issueState.context_questions.some(
    (question) => question.status === "resolved"
  );
  const contextQuestions = hasResolvedContext
    ? []
    : detectContextQuestions({
        issue: issueState,
        workItem,
      });
  if (contextQuestions.length > 0) {
    logIssue(issueId, `raising ${contextQuestions.length} new context question(s)`);
    issueState = IssueExecutionStateSchema.parse({
      ...issueState,
      status: "blocked_missing_context",
      context_questions: contextQuestions,
      blocker_summary: contextQuestions[0]?.prompt,
      last_updated_at: now(),
    });
    await persistIssueState(api, runId, currentBuildState, issueState);
    return;
  }

  const repository = run.repo_state;
  if (!repository?.repository) {
    throw new Error("Resolved repository is required before issue execution can run.");
  }

  const githubToken = await resolveIntegrationToken(
    "github",
    ["PASS_GITHUB_WORKFLOW_TOKEN", "GITHUB_WORKFLOW_TOKEN", "PASS_GITHUB_TOKEN", "GITHUB_TOKEN"],
    "GitHub integration is required for issue execution."
  );
  const prepared = await worktreeManager.prepareIssueWorktree({
    projectKey,
    repository: repository.repository,
    defaultBranch: repository.default_branch ?? "main",
    issueId,
    issueNumber: issueState.issue_number,
    slug: slugify(workItem.title),
    token: githubToken,
  });
  logIssue(issueId, `prepared worktree ${prepared.worktreePath} on branch ${prepared.branchName}`);

  const scripts = await worktreeManager.readPackageJsonScripts(prepared.clonePath);
  const qualityCommands = inferQualityCommands(scripts, projectConfig.quality_commands);
  await worktreeManager.withProjectGitLock(projectKey, async () => {
    await ensurePolicyFiles({
      worktreeManager,
      clonePath: prepared.clonePath,
      defaultBranch: prepared.defaultBranch,
      repositoryBranchName: prepared.defaultBranch,
      config: qualityCommands,
    });
  });
  logIssue(issueId, "ensured repo policy files");

  const context = buildIssueExecutionContext({
    issueId,
    pack: await api.getArchitecturePack(runId),
    decompositionPlan: plan,
    implementationState: run.implementation_state,
    runInput: run.input,
    buildConfig: projectConfig,
  });

  await worktreeManager.writeFile(
    prepared.worktreePath,
    path.join(".wspass", "issues", issueId, "context.json"),
    JSON.stringify(context, null, 2)
  );
  logIssue(issueId, "wrote per-issue execution context artifacts into worktree");
  await worktreeManager.writeFile(
    prepared.worktreePath,
    path.join(".wspass", "issues", issueId, "implementation-plan.md"),
    [
      `# ${workItem.title}`,
      "",
      workItem.summary,
      "",
      "## Acceptance Criteria",
      ...(workItem.acceptance_criteria.length > 0
        ? workItem.acceptance_criteria.map((item) => `- ${item}`)
        : ["- None provided."]),
      "",
      "## Relevant Components",
      `- ${workItem.component}`,
      "",
      "## Quality Commands",
      `- Lint: ${qualityCommands.lint ?? "n/a"}`,
      `- Typecheck: ${qualityCommands.typecheck ?? "n/a"}`,
      `- Test (changed): ${qualityCommands.test_changed ?? "n/a"}`,
      `- Test (critical): ${qualityCommands.test_critical ?? "n/a"}`,
      `- Coverage: ${qualityCommands.coverage_extract ?? "n/a"}`,
    ].join("\n")
  );

  await appendAuditLog(prepared.worktreePath, {
    workflow: "phase3-issue-execution",
    issueId,
    branch: prepared.branchName,
    tool: "worktree",
    summary: `Prepared worktree at ${prepared.worktreePath}`,
    result: "succeeded",
  });

  issueState = IssueExecutionStateSchema.parse({
    ...issueState,
    status: "working",
    branch_name: prepared.branchName,
    worktree_path: prepared.worktreePath,
    blocker_summary: undefined,
    last_updated_at: now(),
  });
  currentBuildState = await persistIssueState(api, runId, currentBuildState, issueState);
  logIssue(issueId, "issue moved to working state");

  logIssue(issueId, "running local build policy and quality commands");
  const qualityResult = await runBuildPolicy({
    repoPath: prepared.worktreePath,
    branchName: prepared.branchName,
    issueId,
    workflowName: "phase3-issue-execution",
    config: qualityCommands,
  });
  logIssue(issueId, `build policy completed with status=${qualityResult.status}`);

  logIssue(issueId, "committing and pushing branch if changes exist");
  const pushed = await worktreeManager.commitAndPushIfChanged({
    repoPath: prepared.worktreePath,
    branchName: prepared.branchName,
    message: `chore(agent): scaffold execution for ${issueState.issue_number ? `#${issueState.issue_number}` : issueId}`,
  });
  logIssue(issueId, pushed ? "changes pushed to remote branch" : "no code changes were generated to push");

  if (qualityResult.status !== "passed") {
    logIssue(issueId, `commit blocked by policy: ${qualityResult.summary}`);
    issueState = IssueExecutionStateSchema.parse({
      ...issueState,
      status: "commit_blocked",
      blocker_summary: qualityResult.summary,
      latest_cost_usd: null,
      pull_request: {
        ...issueState.pull_request,
        branch_name: prepared.branchName,
        last_updated_at: now(),
        status: "not_opened",
        coverage_percent: qualityResult.coveragePercent,
        failing_checks: qualityResult.failingChecks,
        failure_summary: qualityResult.summary,
      },
      attempts: [
        ...issueState.attempts,
        IssueExecutionAttemptSchema.parse({
          attempt_number: issueState.current_attempt,
          started_at: now(),
          completed_at: now(),
          status: "commit_blocked",
          summary: qualityResult.summary,
          log_artifact_names: [],
          quality_result: {
            status: qualityResult.status,
            coverage_percent: qualityResult.coveragePercent,
            failing_checks: qualityResult.failingChecks,
            summary: qualityResult.summary,
          },
          error_message: qualityResult.summary,
        }),
      ],
      last_updated_at: now(),
    });
    await writeExecutionArtifacts({
      api,
      runId,
      issueId,
      context,
      summary: {
        attempt: issueState.current_attempt,
        status: issueState.status,
        summary: qualityResult.summary,
        quality_result: qualityResult,
      },
      repoPath: prepared.worktreePath,
    });
    await persistIssueState(api, runId, currentBuildState, issueState);
    return;
  }

  const prClient = new GitHubPullRequestsClient({ repository: repository.repository, token: githubToken });
  logIssue(issueId, "checking for existing pull request");
  const existingPr = await prClient.findOpenPullRequest(prepared.branchName);
  const pullRequest =
    existingPr ??
    (pushed
      ? await prClient.createPullRequest({
          title: issueState.issue_number
            ? `[WSPass] #${issueState.issue_number} ${issueState.title}`
            : `[WSPass] ${issueState.title}`,
          body: [
            `Automated issue execution scaffold for ${issueState.issue_number ? `#${issueState.issue_number}` : issueId}.`,
            "",
            `Plan item: ${issueId}`,
            `Branch: ${prepared.branchName}`,
            "",
            "This PR currently contains the generated execution context and implementation plan scaffold.",
          ].join("\n"),
          head: prepared.branchName,
          base: prepared.defaultBranch,
          draft: false,
        })
      : null);
  if (pullRequest) {
    logIssue(issueId, `pull request ready: #${pullRequest.number}`);
  }

  issueState = IssueExecutionStateSchema.parse({
    ...issueState,
    status: pullRequest ? "pr_open" : "ready",
    branch_name: prepared.branchName,
    worktree_path: prepared.worktreePath,
    blocker_summary: pullRequest ? undefined : "No repo changes were generated for this issue attempt.",
    pull_request: {
      issue_id: issueId,
      branch_name: prepared.branchName,
      pr_number: pullRequest?.number,
      pr_url: pullRequest?.html_url,
      status: pullRequest ? "open" : "not_opened",
      last_updated_at: now(),
      coverage_percent: qualityResult.coveragePercent,
      failing_checks: [],
    },
    attempts: [
      ...issueState.attempts,
      IssueExecutionAttemptSchema.parse({
        attempt_number: issueState.current_attempt,
        started_at: now(),
        completed_at: now(),
        status: pullRequest ? "pr_open" : "ready",
        summary: pullRequest
          ? `Opened PR ${pullRequest.number} for ${issueState.title}.`
          : `Prepared issue context for ${issueState.title}; no code changes were generated.`,
        log_artifact_names: [],
        quality_result: {
          status: qualityResult.status,
          coverage_percent: qualityResult.coveragePercent,
          failing_checks: qualityResult.failingChecks,
          summary: qualityResult.summary,
        },
      }),
    ],
    last_updated_at: now(),
  });

  await writeExecutionArtifacts({
    api,
    runId,
    issueId,
    context,
    summary: {
      attempt: issueState.current_attempt,
      status: issueState.status,
      branch_name: prepared.branchName,
      pr_number: issueState.pull_request.pr_number,
      pr_url: issueState.pull_request.pr_url,
      quality_result: qualityResult,
    },
    repoPath: prepared.worktreePath,
  });
  await persistIssueState(api, runId, currentBuildState, issueState);
  logIssue(issueId, `issue execution completed with status=${issueState.status}`);
}
