import "server-only";
import { cache } from "react";
import { deriveProjectKeyFromRun, deriveProjectLabelFromRun } from "@pass/shared";
import {
  getArchitecturePack,
  getDecompositionPlan,
  getDecompositionReview,
  getRun,
  listRuns,
} from "./passApi";

export type RunListItem = Awaited<ReturnType<typeof listRuns>>[number];
export type RunEnvelope = NonNullable<Awaited<ReturnType<typeof getRun>>>;
export type RunHealthBucket = "green" | "yellow" | "red";
export type StatusTone = "default" | "accent" | "danger" | "success";
export type DecompositionReviewStatus = NonNullable<
  RunEnvelope["run"]["decomposition_review_state"]
>["status"];
export type DecompositionDraftStatus = NonNullable<
  RunEnvelope["run"]["decomposition_state"]
>["status"];

export function formatDate(value?: string) {
  if (!value) {
    return "n/a";
  }
  return new Date(value).toLocaleString();
}

function isActiveExecutionStatus(status?: string) {
  return status === "queued" || status === "dispatched" || status === "running";
}

export function hasActiveIssueWorkerState(
  run: Pick<RunListItem, "build_state">
) {
  return (run.build_state?.issues ?? []).some((issue) =>
    ["gathering_requirements", "working", "testing", "fixing"].includes(issue.status)
  );
}

function hasQueuedOrReadyIssueWorkerState(run: Pick<RunListItem, "build_state">) {
  return (run.build_state?.issues ?? []).some((issue) =>
    ["queued", "ready", "pr_open"].includes(issue.status)
  );
}

export function isStaleLocalWorkflowDispatch(
  execution:
    | Pick<
        NonNullable<RunListItem["execution"]>,
        "backend" | "workflow_name" | "status" | "requested_at" | "started_at" | "completed_at"
      >
    | undefined,
  workflowNames?: string[]
) {
  if (!execution) {
    return false;
  }

  if (
    execution.backend !== "local_process" ||
    !isActiveExecutionStatus(execution.status) ||
    (workflowNames && !workflowNames.includes(execution.workflow_name))
  ) {
    return false;
  }

  const lastActivity =
    execution.started_at ?? execution.requested_at ?? execution.completed_at;
  if (!lastActivity) {
    return false;
  }

  return Date.now() - new Date(lastActivity).getTime() > 30_000;
}

function isActiveBuildExecution(run: Pick<RunListItem, "execution">) {
  return (
    isActiveExecutionStatus(run.execution?.status) &&
    run.execution?.workflow_name === "phase3-build-orchestrator" &&
    !isStaleLocalWorkflowDispatch(run.execution, ["phase3-build-orchestrator"])
  );
}

function isBuildInFlight(run: Pick<RunListItem, "execution" | "build_state">) {
  return (
    isActiveBuildExecution(run) ||
    ((run.build_state?.status === "planning" || run.build_state?.status === "running") &&
      (hasActiveIssueWorkerState(run) || hasQueuedOrReadyIssueWorkerState(run))) ||
    hasActiveIssueWorkerState(run)
  );
}

export function deriveLiveExecution(
  run: Pick<RunListItem, "execution" | "build_state">
) {
  if (
    isActiveBuildExecution(run) &&
    run.execution?.workflow_name &&
    run.execution?.status
  ) {
    return {
      workflowName: run.execution.workflow_name,
      status: run.execution.status,
      backend: run.execution.backend,
    };
  }

  if (
    isActiveExecutionStatus(run.execution?.status) &&
    run.execution?.workflow_name &&
    !isStaleLocalWorkflowDispatch(run.execution)
  ) {
    return {
      workflowName: run.execution.workflow_name,
      status: run.execution.status,
      backend: run.execution.backend,
    };
  }

  if (hasActiveIssueWorkerState(run)) {
    return {
      workflowName: "phase3-issue-execution",
      status: "running",
      backend: run.execution?.backend,
    };
  }

  return null;
}

const WORKFLOW_STATUS_LABELS: Partial<
  Record<
    NonNullable<RunListItem["execution"]>["workflow_name"],
    string
  >
> = {
  "phase1-planner": "planner_failed",
  "phase1-architecture-refinement": "refinement_failed",
  "phase2-repo-provision": "repo_failed",
  "phase2-decomposition": "decomposition_failed",
  "phase2-decomposition-iterator": "iterator_failed",
  "phase2-implementation": "implementation_failed",
};

const DISPLAY_STATUS_LABELS: Partial<Record<RunListItem["status"], string>> = {
  exported: "issues_synced",
};

function hasRunFailure(run: Pick<RunListItem, "status" | "execution" | "build_state">) {
  if (isActiveBuildExecution(run)) {
    return false;
  }

  return (
    run.execution?.status === "failed" ||
    run.build_state?.status === "failed" ||
    run.build_state?.status === "blocked" ||
    run.status === "failed" ||
    run.status === "review_blocked"
  );
}

export function deriveRunHealthBucket(
  run: Pick<RunListItem, "status" | "execution" | "build_state">
): RunHealthBucket {
  if (isBuildInFlight(run) || Boolean(deriveLiveExecution(run))) {
    return "yellow";
  }

  if (hasRunFailure(run)) {
    return "red";
  }

  // This product does not currently have a final "project completed" state.
  // Build-ready, exported/issues-synced, and in-flight states are all still
  // part of an active delivery pipeline and should remain yellow.
  if (
    isActiveExecutionStatus(run.execution?.status) ||
    run.execution?.status === "succeeded" ||
    run.status === "build_ready" ||
    run.status === "approved" ||
    run.status === "exported" ||
    run.status === "created" ||
    run.status === "parsed" ||
    run.status === "clarified" ||
    run.status === "plan_generated" ||
    run.status === "decomposition_generated"
  ) {
    return "yellow";
  }

  return "green";
}

export function deriveRunDisplayStatus(
  run: Pick<RunListItem, "status" | "execution" | "build_state">
) {
  if (isBuildInFlight(run) || Boolean(deriveLiveExecution(run))) {
    return "running";
  }

  if (run.build_state?.status === "failed") {
    return "build_failed";
  }

  if (run.build_state?.status === "blocked") {
    return "build_blocked";
  }

  if (isActiveExecutionStatus(run.execution?.status)) {
    return "running";
  }

  if (run.execution?.status === "failed") {
    return WORKFLOW_STATUS_LABELS[run.execution.workflow_name] ?? "failed";
  }

  return DISPLAY_STATUS_LABELS[run.status] ?? run.status;
}

export function deriveRunDisplayTone(
  run: Pick<RunListItem, "status" | "execution" | "build_state">
): StatusTone {
  const bucket = deriveRunHealthBucket(run);
  return bucket === "red" ? "danger" : bucket === "yellow" ? "accent" : "success";
}

export function deriveRunBlockedSummary(
  run: Pick<RunListItem, "status" | "execution" | "decomposition_review_state">
) {
  const reviewState = run.decomposition_review_state;
  if (run.status !== "review_blocked" && reviewState?.status !== "blocked") {
    return null;
  }

  if (reviewState?.blocked_reason?.trim()) {
    return reviewState.blocked_reason;
  }

  const openQuestions = reviewState?.questions.filter((question) => question.status === "open") ?? [];
  if (openQuestions[0]?.prompt) {
    return openQuestions[0].prompt;
  }

  if ((reviewState?.open_question_count ?? 0) > 0) {
    return `Awaiting ${reviewState?.open_question_count} clarification answer(s).`;
  }

  if ((reviewState?.gap_count ?? 0) > 0) {
    return `Blocked on ${reviewState?.gap_count} remaining coverage gap(s).`;
  }

  return "Build readiness review is blocked.";
}

export function isReviewReadyStatus(status?: DecompositionReviewStatus) {
  return status === "build_ready" || status === "synced";
}

export function hasSyncedIssues(run: RunEnvelope["run"]) {
  return (
    run.decomposition_review_state?.status === "synced" ||
    run.status === "exported" ||
    Boolean(run.implementation_state)
  );
}

export function deriveDecompositionStatusTone(
  status?: DecompositionDraftStatus
): StatusTone {
  if (status === "synced" || status === "approved") {
    return "accent";
  }

  return "default";
}

export function deriveDecompositionReviewTone(
  status?: DecompositionReviewStatus
): StatusTone {
  if (status === "blocked") {
    return "danger";
  }

  if (status === "iterating" || isReviewReadyStatus(status)) {
    return "accent";
  }

  return "default";
}

type RetryableRunShape = Pick<
  RunListItem,
  "status" | "current_step" | "execution"
>;

export function deriveRetryWorkflow(run: RetryableRunShape) {
  if (run.execution?.workflow_name) {
    return run.execution.workflow_name;
  }

  switch (run.current_step) {
    case "created":
    case "parse":
    case "clarify":
    case "plan":
      return "phase1-planner" as const;
    case "decompose":
      return "phase2-decomposition" as const;
    case "review":
      return "phase2-decomposition-iterator" as const;
    case "approve":
    case "export":
      return "phase2-implementation" as const;
    default:
      return null;
  }
}

export function isFailedRunState(
  run: Pick<RunListItem, "status" | "execution" | "build_state">
) {
  if (isBuildInFlight(run) || Boolean(deriveLiveExecution(run))) {
    return false;
  }

  return hasRunFailure(run);
}

export function deriveProjectKey(run: RunListItem) {
  return deriveProjectKeyFromRun(run);
}

export function deriveProjectLabel(run: RunListItem) {
  return deriveProjectLabelFromRun(run);
}

export function buildProjectGroups(runs: RunListItem[]) {
  const grouped = new Map<
    string,
    {
      key: string;
      label: string;
      repoUrl?: string;
      latest: RunListItem;
      runs: RunListItem[];
    }
  >();

  for (const run of runs) {
    const key = deriveProjectKey(run);
    const existing = grouped.get(key);
    if (!existing) {
      grouped.set(key, {
        key,
        label: deriveProjectLabel(run),
        repoUrl: run.repo_state?.html_url,
        latest: run,
        runs: [run],
      });
      continue;
    }

    existing.runs.push(run);
    if (new Date(run.last_updated_at).getTime() > new Date(existing.latest.last_updated_at).getTime()) {
      existing.latest = run;
      existing.label = deriveProjectLabel(run);
      existing.repoUrl = run.repo_state?.html_url ?? existing.repoUrl;
    }
  }

  return [...grouped.values()]
    .map((project) => ({
      ...project,
      runs: project.runs.sort(
        (left, right) =>
          new Date(right.last_updated_at).getTime() - new Date(left.last_updated_at).getTime()
      ),
    }))
    .sort(
      (left, right) =>
        new Date(right.latest.last_updated_at).getTime() -
        new Date(left.latest.last_updated_at).getTime()
    );
}

export const getRunsCached = cache(async () => listRuns());

export const getProjectsCached = cache(async () => buildProjectGroups(await getRunsCached()));

export const getRunCached = cache(async (runId: string) => getRun(runId));

export const getArchitecturePackCached = cache(async (runId: string) =>
  getArchitecturePack(runId)
);

export const getDecompositionPlanCached = cache(async (runId: string) =>
  getDecompositionPlan(runId)
);

export const getDecompositionReviewCached = cache(async (runId: string) =>
  getDecompositionReview(runId)
);

export const getProjectLabelForRun = cache(async (runId: string) => {
  const runs = await getRunsCached();
  const target = runs.find((run) => run.run_id === runId);
  return target ? deriveProjectLabel(target) : "Untitled project";
});

export function deriveGates(
  run: RunEnvelope,
  architecturePack: Awaited<ReturnType<typeof getArchitecturePack>> | null,
  hasArchitecturePack: boolean,
  hasDecompositionPlan: boolean
) {
  const execActive =
    (isActiveExecutionStatus(run.run.execution?.status) &&
      run.run.execution?.workflow_name !== "phase3-issue-execution" &&
      run.run.execution?.workflow_name !== "phase3-pr-supervisor") ||
    hasActiveIssueWorkerState(run.run);
  const repoResolved = Boolean(run.run.repo_state);
  const decompStatus = run.run.decomposition_state?.status;
  const reviewStatus = run.run.decomposition_review_state?.status ?? "not_started";
  const buildReady = isReviewReadyStatus(reviewStatus);
  const unresolvedClarifications = architecturePack
    ? architecturePack.clarifications.filter((item) => item.default_used).length
    : 0;
  const unresolvedOpenQuestions = architecturePack?.open_questions.length ?? 0;
  const architectureBlocked = unresolvedOpenQuestions > 0;

  return {
    execActive,
    canRunPlanner: !execActive,
    canRefineArchitecture: !execActive && hasArchitecturePack,
    canResolveRepo: !execActive && hasArchitecturePack && !architectureBlocked,
    canBuildReview: !execActive && hasArchitecturePack && repoResolved && !architectureBlocked,
    canAnswerReviewQuestions: !execActive && reviewStatus === "blocked",
    canSyncIssues: !execActive && buildReady && repoResolved,
    decompIsStale: hasArchitecturePack && decompStatus === "not_started" && hasDecompositionPlan,
    architectureBlocked,
    unresolvedClarifications,
    unresolvedOpenQuestions,
    buildReady,
  };
}

export function describeArchitectureBlock(
  unresolvedClarifications: number,
  unresolvedOpenQuestions: number
) {
  if (unresolvedOpenQuestions > 0) {
    return {
      cta: "Answer open questions before decomposing",
      title: "Architecture blocked by open questions",
      detail:
        "Decomposition is blocked until the remaining architecture-level open questions are answered through refinement.",
    };
  }

  return null;
}

export function buildProgressItems(run: RunEnvelope["run"]) {
  const runBasePath = `/projects/${run.run_id}`;
  const buildStateStatus = run.build_state?.status;
  const buildExecutionActive = isBuildInFlight(run);
  const hasArchitecture =
    Boolean(run.step_timestamps.parse) ||
    Boolean(run.step_timestamps.plan) ||
    run.status !== "created";
  const architectureAccepted = isReviewReadyStatus(run.decomposition_review_state?.status);
  const reviewBlocked =
    run.status === "review_blocked" || run.decomposition_review_state?.status === "blocked";
  const plannerFailed =
    run.execution?.status === "failed" &&
    (run.execution.workflow_name === "phase1-planner" ||
      run.execution.workflow_name === "phase1-architecture-refinement");
  const decomposeFailed =
    run.execution?.status === "failed" &&
    (run.execution.workflow_name === "phase2-decomposition" ||
      run.execution.workflow_name === "phase2-decomposition-iterator");
  const buildFailed =
    (run.execution?.status === "failed" &&
      (run.execution.workflow_name === "phase2-implementation" ||
        run.execution.workflow_name === "phase3-build-orchestrator" ||
        run.execution.workflow_name === "phase3-issue-execution" ||
        run.execution.workflow_name === "phase3-pr-supervisor")) ||
    buildStateStatus === "failed";
  const architectureNeedsWork =
    run.current_step === "plan" ||
    run.current_step === "clarify" ||
    run.current_step === "parse";
  const architectureRunning =
    isActiveExecutionStatus(run.execution?.status) &&
    (run.execution?.workflow_name === "phase1-planner" ||
      run.execution?.workflow_name === "phase1-architecture-refinement");
  const decomposeInFlight =
    Boolean(run.repo_state) ||
    Boolean(run.decomposition_state?.generated_at) ||
    run.current_step === "decompose" ||
    run.current_step === "review";
  const buildInFlight =
    buildStateStatus === "planning" ||
    buildStateStatus === "running" ||
    Boolean(run.implementation_state) ||
    run.current_step === "approve" ||
    run.current_step === "export" ||
    run.current_step === "build";
  const issuesSynced = hasSyncedIssues(run);

  return [
    {
      key: "select",
      label: "Select",
      href: "/projects",
      state: "completed" as const,
      detail: "Project chosen",
    },
    {
      key: "architecture",
      label: "Architecture",
      href: `${runBasePath}/architecture`,
      state: plannerFailed
        ? ("blocked" as const)
        : architectureAccepted
            ? ("completed" as const)
            : architectureRunning
              ? ("active" as const)
              : ("pending" as const),
      detail: plannerFailed
        ? "Action required"
        : architectureAccepted
          ? "Accepted"
          : architectureRunning
            ? "Refinement in progress"
            : hasArchitecture && !architectureNeedsWork
              ? "Wireframe ready"
              : "Awaiting plan",
    },
    {
      key: "decompose",
      label: "Decompose",
      href: `${runBasePath}/decompose`,
      state: buildExecutionActive
        ? ("completed" as const)
        : reviewBlocked || decomposeFailed
        ? ("blocked" as const)
        : isReviewReadyStatus(run.decomposition_review_state?.status)
            ? ("completed" as const)
            : decomposeInFlight
              ? ("active" as const)
              : ("pending" as const),
      detail:
        buildExecutionActive
          ? "Build-ready"
          : isReviewReadyStatus(run.decomposition_review_state?.status)
          ? "Build-ready"
          : reviewBlocked || decomposeFailed
            ? "Action required"
            : decomposeInFlight
              ? "Resolve gaps"
              : run.repo_state
                ? "Run iterator"
                : "Resolve repo",
    },
    {
      key: "build",
      label: "Build",
      href: `${runBasePath}/build`,
      state: buildExecutionActive
        ? ("active" as const)
        : buildFailed || buildStateStatus === "blocked"
        ? ("blocked" as const)
        : buildStateStatus === "completed"
            ? ("completed" as const)
            : issuesSynced || buildInFlight
              ? ("active" as const)
              : ("pending" as const),
      detail: buildExecutionActive
        ? "Execution running"
        : buildFailed
        ? "Action required"
        : buildStateStatus === "completed"
          ? "Merged"
        : buildStateStatus === "blocked"
          ? "Action required"
        : issuesSynced
          ? "Issues synced"
        : buildInFlight
            ? buildStateStatus === "planning" || buildStateStatus === "running"
              ? "Execution running"
              : "Sync in progress"
            : "Awaiting sync",
    },
  ];
}

export function summarizeImplementation(run: RunEnvelope["run"]) {
  const issues = run.implementation_state?.issues ?? [];
  const open = issues.filter((issue) => issue.github_state !== "closed").length;
  const resolved = issues.filter((issue) => issue.github_state === "closed").length;
  const created = issues.filter((issue) => issue.sync_status === "created").length;
  const failed = issues.filter((issue) => issue.sync_status === "failed").length;

  return {
    total: issues.length,
    open,
    resolved,
    created,
    failed,
  };
}

export const getRunConsoleData = cache(async (runId: string) => {
  const run = await getRunCached(runId);

  if (!run) {
    return null;
  }

  const artifactNames = new Set(run.artifacts.map((artifact) => artifact.name));
  const [architecturePack, decompositionPlan, decompositionReview, projectLabel] = await Promise.all([
    artifactNames.has("architecture_pack") ? getArchitecturePackCached(runId) : Promise.resolve(null),
    artifactNames.has("decomposition_plan") ? getDecompositionPlanCached(runId) : Promise.resolve(null),
    artifactNames.has("decomposition_review")
      ? getDecompositionReviewCached(runId)
      : Promise.resolve(null),
    getProjectLabelForRun(runId),
  ]);

  const gates = deriveGates(run, architecturePack, Boolean(architecturePack), Boolean(decompositionPlan));
  const implementation = summarizeImplementation(run.run);

  return {
    run,
    architecturePack,
    decompositionPlan,
    decompositionReview,
    projectLabel,
    gates,
    implementation,
  };
});
