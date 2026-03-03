import {
  BuildOrchestrationStateSchema,
  IssueExecutionAttemptSchema,
  IssueExecutionStateSchema,
  PullRequestStateSchema,
  type BuildOrchestrationState,
  type DecompositionPlan,
  type IssueExecutionState,
} from "@pass/shared";
import { BuildApiClient } from "../lib/buildApiClient";
import { runIssueExecutionAgent } from "../implementation/runIssueExecutionAgent";
import { runPrSupervisorAgent } from "../implementation/runPrSupervisorAgent";

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

function deriveRings(plan: DecompositionPlan) {
  const workItemsById = new Map(plan.work_items.map((item) => [item.id, item]));
  const remaining = new Set(plan.work_items.map((item) => item.id));
  const completed = new Set<string>();
  const rings = new Map<string, number>();
  let ring = 0;

  while (remaining.size > 0) {
    const ready = [...remaining].filter((id) => {
      const item = workItemsById.get(id);
      if (!item) {
        return false;
      }
      return item.depends_on.every((dependency) => !workItemsById.has(dependency) || completed.has(dependency));
    });

    if (!ready.length) {
      for (const id of remaining) {
        rings.set(id, ring);
      }
      break;
    }

    for (const id of ready) {
      remaining.delete(id);
      completed.add(id);
      rings.set(id, ring);
    }

    ring += 1;
  }

  return rings;
}

function buildInitialIssueState(input: {
  workItem: DecompositionPlan["work_items"][number];
  syncedIssue?: {
    issue_number?: number;
    title: string;
  };
  ring: number;
}): IssueExecutionState {
  return IssueExecutionStateSchema.parse({
    issue_id: input.workItem.id,
    issue_number: input.syncedIssue?.issue_number,
    title: input.workItem.title,
    ring: input.ring,
    dependencies: input.workItem.depends_on,
    status: "queued",
    worker_workflow_name: "phase3-issue-execution",
    current_attempt: 1,
    attempts: [
      IssueExecutionAttemptSchema.parse({
        attempt_number: 1,
        started_at: now(),
        status: "queued",
        summary: `Queued ${input.workItem.title} for issue execution.`,
        log_artifact_names: [],
      }),
    ],
    secret_requirements: [],
    context_questions: [],
    pull_request: PullRequestStateSchema.parse({
      issue_id: input.workItem.id,
      branch_name: `agent/${input.syncedIssue?.issue_number ?? input.workItem.id}-${slugify(input.workItem.title)}`.slice(0, 80),
      status: "not_opened",
      last_updated_at: now(),
      failing_checks: [],
    }),
    last_updated_at: now(),
  });
}

function refreshIssueCatalog(
  current: BuildOrchestrationState | undefined,
  plan: DecompositionPlan,
  syncedIssues: NonNullable<Awaited<ReturnType<BuildApiClient["getRun"]>>["run"]["implementation_state"]>["issues"]
) {
  const existingById = new Map((current?.issues ?? []).map((issue) => [issue.issue_id, issue]));
  const ringMap = deriveRings(plan);

  return plan.work_items.map((workItem) => {
    const existing = existingById.get(workItem.id);
    const synced = syncedIssues.find((issue) => issue.plan_item_id === workItem.id);

    if (!existing) {
      return buildInitialIssueState({
        workItem,
        syncedIssue: synced
          ? {
              issue_number: synced.issue_number,
              title: synced.title,
            }
          : undefined,
        ring: ringMap.get(workItem.id) ?? 0,
      });
    }

    return IssueExecutionStateSchema.parse({
      ...existing,
      issue_number: synced?.issue_number ?? existing.issue_number,
      title: workItem.title,
      ring: ringMap.get(workItem.id) ?? existing.ring,
      dependencies: workItem.depends_on,
      pull_request: {
        ...existing.pull_request,
        issue_id: workItem.id,
        branch_name:
          existing.pull_request.branch_name ||
          `agent/${synced?.issue_number ?? workItem.id}-${slugify(workItem.title)}`.slice(0, 80),
      },
      last_updated_at: now(),
    });
  });
}

function summarizeBuildState(buildState: BuildOrchestrationState) {
  const counts = buildState.issues.reduce(
    (acc, issue) => {
      acc[issue.status] = (acc[issue.status] ?? 0) + 1;
      return acc;
    },
    {} as Record<string, number>
  );

  return [
    `queued=${counts.queued ?? 0}`,
    `working=${counts.working ?? 0}`,
    `pr_open=${counts.pr_open ?? 0}`,
    `testing=${counts.testing ?? 0}`,
    `blocked=${(counts.blocked_missing_tools ?? 0) + (counts.blocked_missing_context ?? 0) + (counts.commit_blocked ?? 0)}`,
    `merged=${counts.merged ?? 0}`,
    `failed=${counts.failed ?? 0}`,
  ].join(" | ");
}

function buildAuditPayload(runId: string, buildState: BuildOrchestrationState) {
  const counts = buildState.issues.reduce(
    (acc, issue) => {
      acc[issue.status] = (acc[issue.status] ?? 0) + 1;
      return acc;
    },
    {} as Record<string, number>
  );

  return {
    generated_at: now(),
    run_id: runId,
    status: buildState.status,
    current_ring: buildState.current_ring,
    summary: buildState.summary,
    blocked_reason: buildState.blocked_reason,
    counts,
    issues: buildState.issues.map((issue) => ({
      issue_id: issue.issue_id,
      issue_number: issue.issue_number,
      title: issue.title,
      ring: issue.ring,
      status: issue.status,
      branch_name: issue.branch_name,
      worktree_path: issue.worktree_path,
      blocker_summary: issue.blocker_summary,
      current_attempt: issue.current_attempt,
      pull_request: issue.pull_request,
      secret_requirements: issue.secret_requirements,
      context_questions: issue.context_questions,
      last_updated_at: issue.last_updated_at,
    })),
  };
}

async function persistBuildAudit(
  api: BuildApiClient,
  runId: string,
  buildState: BuildOrchestrationState
) {
  await api.writeArtifact(runId, {
    name: "build_audit_summary",
    content_type: "application/json",
    payload: buildAuditPayload(runId, buildState),
  });

  return BuildOrchestrationStateSchema.parse({
    ...buildState,
    audit_artifact_name: "build_audit_summary",
  });
}

function dependenciesMerged(issue: IssueExecutionState, issues: IssueExecutionState[]) {
  const mergedSet = new Set(issues.filter((item) => item.status === "merged").map((item) => item.issue_id));
  return issue.dependencies.every((dependency) => mergedSet.has(dependency));
}

function nextRunnableIssues(buildState: BuildOrchestrationState) {
  const eligible = buildState.issues
    .filter((issue) => issue.status === "queued" && dependenciesMerged(issue, buildState.issues))
    .sort((left, right) => left.ring - right.ring);

  if (!eligible.length) {
    return [];
  }

  const ring = eligible[0].ring;
  return eligible.filter((issue) => issue.ring === ring).slice(0, buildState.max_parallel_workers);
}

export async function runBuildOrchestratorAgent(runId: string): Promise<void> {
  const api = new BuildApiClient();
  const githubRunId = process.env.GITHUB_RUN_ID ? Number(process.env.GITHUB_RUN_ID) : undefined;
  const githubRunUrl = process.env.GITHUB_RUN_URL;
  let latestBuildState: BuildOrchestrationState | undefined;

  try {
    await api.updateExecution(runId, {
      status: "running",
      github_run_id: Number.isFinite(githubRunId) ? githubRunId : undefined,
      github_run_url: githubRunUrl,
    });

    const envelope = await api.getRun(runId);
    const run = envelope.run;
    if (!run.repo_state) {
      throw new Error("Resolved repository is required before build orchestration can start.");
    }
    if (!run.implementation_state?.issues.length) {
      throw new Error("Implementation issue sync must complete before build orchestration can start.");
    }

    const plan = await api.getDecompositionPlan(runId);
    let buildState = BuildOrchestrationStateSchema.parse({
      status: "planning",
      started_at: run.build_state?.started_at ?? now(),
      current_ring: run.build_state?.current_ring ?? 0,
      max_parallel_workers: run.build_state?.max_parallel_workers ?? 3,
      issues: refreshIssueCatalog(run.build_state, plan, run.implementation_state.issues),
      blocked_reason: undefined,
      summary: "Planning build execution rings and issue workers.",
      audit_artifact_name: "build_audit_summary",
    });
    buildState = await persistBuildAudit(api, runId, buildState);
    latestBuildState = buildState;
    await api.updateBuildState(runId, buildState);
    await api.updateRun(runId, { current_step: "build" });

    while (true) {
      const runnable = nextRunnableIssues(buildState);
      if (!runnable.length) {
        break;
      }

      buildState = BuildOrchestrationStateSchema.parse({
        ...buildState,
        status: "running",
        current_ring: runnable[0].ring,
        summary: `Running build ring ${runnable[0].ring + 1}. ${summarizeBuildState(buildState)}`,
      });
      buildState = await persistBuildAudit(api, runId, buildState);
      latestBuildState = buildState;
      await api.updateBuildState(runId, buildState);

      for (const issue of runnable) {
        await runIssueExecutionAgent(runId, issue.issue_id);
        const refreshed = await api.getRun(runId);
        buildState = BuildOrchestrationStateSchema.parse(
          refreshed.run.build_state ?? buildState
        );
        latestBuildState = buildState;
        const refreshedIssue = buildState.issues.find((item) => item.issue_id === issue.issue_id);
        if (refreshedIssue?.status === "pr_open" || refreshedIssue?.status === "testing") {
          await runPrSupervisorAgent(runId, issue.issue_id);
          const afterSupervisor = await api.getRun(runId);
          buildState = BuildOrchestrationStateSchema.parse(
            afterSupervisor.run.build_state ?? buildState
          );
          latestBuildState = buildState;
        }
      }
    }

    const mergedCount = buildState.issues.filter((issue) => issue.status === "merged").length;
    const blockedIssues = buildState.issues.filter((issue) =>
      ["blocked_missing_tools", "blocked_missing_context", "commit_blocked"].includes(issue.status)
    );
    const failedIssues = buildState.issues.filter((issue) => issue.status === "failed");
    const remainingQueued = buildState.issues.filter((issue) => issue.status === "queued");

    if (mergedCount === buildState.issues.length && buildState.issues.length > 0) {
      buildState = BuildOrchestrationStateSchema.parse({
        ...buildState,
        status: "completed",
        completed_at: now(),
        blocked_reason: undefined,
        summary: "All synced build issues have been merged.",
      });
      buildState = await persistBuildAudit(api, runId, buildState);
      latestBuildState = buildState;
      await api.updateBuildState(runId, buildState);
      await api.updateRun(runId, {
        status: "completed",
        current_step: "build",
      });
    } else if (blockedIssues.length > 0 || failedIssues.length > 0 || remainingQueued.length > 0) {
      const blockedReason =
        blockedIssues[0]?.blocker_summary ??
        failedIssues[0]?.blocker_summary ??
        "Build requires user input or reruns before more issues can proceed.";
      buildState = BuildOrchestrationStateSchema.parse({
        ...buildState,
        status: blockedIssues.length > 0 ? "blocked" : failedIssues.length > 0 ? "failed" : "running",
        blocked_reason: blockedReason,
        summary: `Build orchestration paused. ${summarizeBuildState(buildState)}`,
      });
      buildState = await persistBuildAudit(api, runId, buildState);
      latestBuildState = buildState;
      await api.updateBuildState(runId, buildState);
      await api.updateRun(runId, {
        status: blockedIssues.length > 0 ? "review_blocked" : failedIssues.length > 0 ? "failed" : run.status,
        current_step: "build",
      });
    }

    await api.updateExecution(runId, {
      status: "succeeded",
      github_run_id: Number.isFinite(githubRunId) ? githubRunId : undefined,
      github_run_url: githubRunUrl,
    });
  } catch (error) {
    const message = summarizeError(error);
    if (latestBuildState) {
      try {
        const failedBuildState = await persistBuildAudit(
          api,
          runId,
          BuildOrchestrationStateSchema.parse({
            ...latestBuildState,
            status: "failed",
            blocked_reason: message,
            summary: `Build orchestration failed. ${message}`,
          })
        );
        await api.updateBuildState(runId, failedBuildState);
      } catch {
        // Best effort only; the execution failure still needs to surface.
      }
    }
    await api.updateExecution(runId, {
      status: "failed",
      github_run_id: Number.isFinite(githubRunId) ? githubRunId : undefined,
      github_run_url: githubRunUrl,
      error_message: message,
    });
    throw error;
  }
}
