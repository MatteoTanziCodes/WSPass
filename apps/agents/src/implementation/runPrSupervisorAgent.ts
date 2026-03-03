import { BuildOrchestrationStateSchema, IssueExecutionAttemptSchema, IssueExecutionStateSchema } from "@pass/shared";
import { BuildApiClient } from "../lib/buildApiClient";
import { GitHubPullRequestsClient } from "./githubPullRequestsClient";
import { resolveIntegrationToken } from "../lib/integrationTokens";

function now() {
  return new Date().toISOString();
}

function summarizeError(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

export async function runPrSupervisorAgent(runId: string, issueId: string) {
  const api = new BuildApiClient();
  const runEnvelope = await api.getRun(runId);
  const run = runEnvelope.run;
  const buildState = run.build_state;
  if (!buildState) {
    throw new Error("Build state has not been initialized for this run.");
  }

  const issue = buildState.issues.find((item) => item.issue_id === issueId);
  if (!issue) {
    throw new Error(`Issue ${issueId} is not tracked in the build state.`);
  }
  if (!run.repo_state?.repository) {
    throw new Error("Resolved repository is required for PR supervision.");
  }
  if (!issue.pull_request.pr_number || !issue.branch_name) {
    return issue;
  }

  const token = await resolveIntegrationToken(
    "github",
    ["PASS_GITHUB_WORKFLOW_TOKEN", "GITHUB_WORKFLOW_TOKEN", "PASS_GITHUB_TOKEN", "GITHUB_TOKEN"],
    "GitHub integration is required for PR supervision."
  );
  const prClient = new GitHubPullRequestsClient({
    repository: run.repo_state.repository,
    token,
  });

  try {
    const pr = await prClient.getPullRequest(issue.pull_request.pr_number);
    const checks = await prClient.listCheckRuns(issue.pull_request.pr_number).catch(() => []);
    const failingChecks = checks
      .filter((check) => check.status === "completed" && check.conclusion && check.conclusion !== "success")
      .map((check) => check.name);
    const pendingChecks = checks.some((check) => check.status !== "completed");

    let nextStatus = issue.status;
    let prStatus = issue.pull_request.status;
    let failureSummary: string | undefined;

    if (pr.merged_at) {
      nextStatus = "merged";
      prStatus = "merged";
    } else if (failingChecks.length > 0) {
      nextStatus = "fixing";
      prStatus = "checks_failed";
      failureSummary = `Failing checks: ${failingChecks.join(", ")}`;
    } else if (pendingChecks) {
      nextStatus = "testing";
      prStatus = "checks_running";
    } else {
      await prClient.mergePullRequest(issue.pull_request.pr_number);
      nextStatus = "merged";
      prStatus = "merged";
    }

    const nextIssue = IssueExecutionStateSchema.parse({
      ...issue,
      status: nextStatus,
      pull_request: {
        ...issue.pull_request,
        status: prStatus,
        failing_checks: failingChecks,
        failure_summary: failureSummary,
        last_updated_at: now(),
      },
      blocker_summary: failureSummary,
      attempts: [
        ...issue.attempts,
        IssueExecutionAttemptSchema.parse({
          attempt_number: issue.current_attempt,
          started_at: now(),
          completed_at: now(),
          status: nextStatus,
          summary:
            nextStatus === "merged"
              ? `PR #${issue.pull_request.pr_number} merged.`
              : nextStatus === "fixing"
                ? failureSummary ?? "Checks failed."
                : "PR checks are still running.",
          log_artifact_names: [],
          error_message: failureSummary,
        }),
      ],
      last_updated_at: now(),
    });

    const nextBuildState = BuildOrchestrationStateSchema.parse({
      ...buildState,
      issues: buildState.issues.map((item) => (item.issue_id === issueId ? nextIssue : item)),
    });

    await api.updateIssueExecutionState(runId, issueId, nextIssue);
    await api.updateBuildState(runId, nextBuildState);
    return nextIssue;
  } catch (error) {
    const message = summarizeError(error);
    const nextIssue = IssueExecutionStateSchema.parse({
      ...issue,
      status: "failed",
      blocker_summary: message,
      pull_request: {
        ...issue.pull_request,
        status: "checks_failed",
        failure_summary: message,
        last_updated_at: now(),
      },
      attempts: [
        ...issue.attempts,
        IssueExecutionAttemptSchema.parse({
          attempt_number: issue.current_attempt,
          started_at: now(),
          completed_at: now(),
          status: "failed",
          summary: message,
          log_artifact_names: [],
          error_message: message,
        }),
      ],
      last_updated_at: now(),
    });
    const nextBuildState = BuildOrchestrationStateSchema.parse({
      ...buildState,
      issues: buildState.issues.map((item) => (item.issue_id === issueId ? nextIssue : item)),
    });
    await api.updateIssueExecutionState(runId, issueId, nextIssue);
    await api.updateBuildState(runId, nextBuildState);
    throw error;
  }
}
