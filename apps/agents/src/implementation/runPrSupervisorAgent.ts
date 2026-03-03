import { IssueExecutionAttemptSchema, IssueExecutionStateSchema } from "@pass/shared";
import { BuildApiClient } from "../lib/buildApiClient";
import { GitHubPullRequestsClient } from "./githubPullRequestsClient";
import { resolveIntegrationToken } from "../lib/integrationTokens";

function now() {
  return new Date().toISOString();
}

function summarizeError(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function canRetryDraftPromotion(error: unknown) {
  const message = summarizeError(error);
  return (
    message.includes("/ready_for_review") &&
    (message.includes(" 404:") || message.includes(" 405:") || message.includes(" 422:"))
  );
}

function logPr(runId: string, issueId: string, message: string) {
  console.log(`[pr-supervisor][${runId}][${issueId}] ${message}`);
}

export async function runPrSupervisorAgent(runId: string, issueId: string) {
  logPr(runId, issueId, "starting PR supervision");
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
    logPr(runId, issueId, "skipping PR supervision because no PR is attached yet");
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
      logPr(runId, issueId, `PR #${issue.pull_request.pr_number} is already merged`);
      nextStatus = "merged";
      prStatus = "merged";
    } else if (failingChecks.length > 0) {
      logPr(runId, issueId, `PR #${issue.pull_request.pr_number} has failing checks: ${failingChecks.join(", ")}`);
      nextStatus = "fixing";
      prStatus = "checks_failed";
      failureSummary = `Failing checks: ${failingChecks.join(", ")}`;
    } else if (pendingChecks) {
      logPr(runId, issueId, `PR #${issue.pull_request.pr_number} still has pending checks`);
      nextStatus = "testing";
      prStatus = "checks_running";
    } else {
      if (pr.draft) {
        logPr(runId, issueId, `promoting draft PR #${issue.pull_request.pr_number} to ready-for-review`);
        try {
          await prClient.readyForReview(issue.pull_request.pr_number);
        } catch (error) {
          if (!canRetryDraftPromotion(error)) {
            throw error;
          }

          logPr(runId, issueId, `draft promotion failed for PR #${issue.pull_request.pr_number}; recreating as non-draft`);
          await prClient.closePullRequest(issue.pull_request.pr_number);
          const replacementPr = await prClient.createPullRequest({
            title: pr.title ?? issue.title,
            body: pr.body ?? `Automated PR for ${issue.title}.`,
            head: issue.branch_name,
            base: pr.base.ref,
            draft: false,
          });

          const nextIssue = IssueExecutionStateSchema.parse({
            ...issue,
            status: "testing",
            blocker_summary: undefined,
            pull_request: {
              ...issue.pull_request,
              pr_number: replacementPr.number,
              pr_url: replacementPr.html_url,
              status: "checks_running",
              failing_checks: [],
              failure_summary: undefined,
              last_updated_at: now(),
            },
            attempts: [
              ...issue.attempts,
              IssueExecutionAttemptSchema.parse({
                attempt_number: issue.current_attempt,
                started_at: now(),
                completed_at: now(),
                status: "testing",
                summary: `Replaced draft PR #${issue.pull_request.pr_number} with PR #${replacementPr.number} and resumed checks.`,
                log_artifact_names: [],
              }),
            ],
            last_updated_at: now(),
          });

          await api.updateIssueExecutionState(runId, issueId, nextIssue);
          logPr(runId, issueId, `replacement PR #${replacementPr.number} created and issue returned to testing`);
          return nextIssue;
        }
      }
      logPr(runId, issueId, `merging PR #${issue.pull_request.pr_number}`);
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

    await api.updateIssueExecutionState(runId, issueId, nextIssue);
    logPr(runId, issueId, `PR supervision finished with issue status=${nextIssue.status}`);
    return nextIssue;
  } catch (error) {
    const message = summarizeError(error);
    logPr(runId, issueId, `PR supervision failed: ${message}`);
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
    await api.updateIssueExecutionState(runId, issueId, nextIssue);
    throw error;
  }
}
