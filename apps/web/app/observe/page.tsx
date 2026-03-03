import Link from "next/link";
import { deriveProjectKeyFromRun, deriveProjectLabelFromRun, type WorkflowName } from "@pass/shared";
import { AgentLogTail } from "../components/AgentLogTail";
import { StatusBadge } from "../components/StatusBadge";
import { getArtifact, getRun, getRunLog, listRunLogs, listRuns } from "../lib/passApi";

type SearchParamsShape = Promise<Record<string, string | string[] | undefined>>;

type AgentEntry = {
  id: string;
  projectKey: string;
  projectLabel: string;
  runId: string;
  workflowName: WorkflowName;
  kind: "workflow" | "issue";
  issueId?: string;
  title: string;
  summary: string;
  statusLabel: string;
  statusTone: "success" | "accent" | "danger" | "default";
  updatedAt: string;
  state: "running" | "blocked";
};

type ProjectObserveSummary = {
  key: string;
  label: string;
  runningCount: number;
  blockedCount: number;
  totalAgents: number;
  lastUpdatedAt: string;
};

const ACTIVE_EXECUTION_STATUSES = new Set(["queued", "dispatched", "running"]);
const ACTIVE_ISSUE_STATUSES = new Set([
  "queued",
  "gathering_requirements",
  "working",
  "testing",
  "fixing",
]);
const BLOCKED_ISSUE_STATUSES = new Set([
  "blocked_missing_tools",
  "blocked_missing_context",
  "commit_blocked",
  "failed",
]);

function firstString(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

function formatDate(value?: string) {
  if (!value) {
    return "n/a";
  }
  return new Date(value).toLocaleString();
}

function humanizeStatus(value: string) {
  return value.replace(/_/g, " ");
}

function tailText(text: string, maxLines = 80) {
  return text.split(/\r?\n/).slice(-maxLines).join("\n").trim();
}

function artifactPreview(payload: unknown) {
  if (typeof payload === "string") {
    return payload.trim();
  }
  return JSON.stringify(payload, null, 2);
}

function buildWorkflowSummaryEntry(run: Awaited<ReturnType<typeof listRuns>>[number]): AgentEntry | null {
  const execution = run.execution;
  if (!execution) {
    return null;
  }

  const active = ACTIVE_EXECUTION_STATUSES.has(execution.status);
  const failed = execution.status === "failed";
  if (!active && !failed) {
    return null;
  }

  return {
    id: `workflow:${run.run_id}:${execution.workflow_name}`,
    projectKey: deriveProjectKeyFromRun(run),
    projectLabel: deriveProjectLabelFromRun(run),
    runId: run.run_id,
    workflowName: execution.workflow_name,
    kind: "workflow",
    title: execution.workflow_name,
    summary: failed
      ? execution.error_message ?? "Workflow failed."
      : `Run-level workflow is ${execution.status}.`,
    statusLabel: failed ? "failed" : "running",
    statusTone: failed ? "danger" : "accent",
    updatedAt: run.last_updated_at,
    state: failed ? "blocked" : "running",
  };
}

function buildIssueEntries(run: Awaited<ReturnType<typeof listRuns>>[number]): AgentEntry[] {
  const issues = run.build_state?.issues ?? [];
  return issues
    .filter((issue) => ACTIVE_ISSUE_STATUSES.has(issue.status) || BLOCKED_ISSUE_STATUSES.has(issue.status))
    .map((issue) => {
      const blocked = BLOCKED_ISSUE_STATUSES.has(issue.status);
      return {
        id: `issue:${run.run_id}:${issue.issue_id}`,
        projectKey: deriveProjectKeyFromRun(run),
        projectLabel: deriveProjectLabelFromRun(run),
        runId: run.run_id,
        workflowName: issue.worker_workflow_name,
        kind: "issue",
        issueId: issue.issue_id,
        title: issue.title,
        summary:
          issue.blocker_summary ??
          issue.attempts.at(-1)?.summary ??
          `Issue worker is ${humanizeStatus(issue.status)}.`,
        statusLabel: humanizeStatus(issue.status),
        statusTone: blocked ? "danger" : "accent",
        updatedAt: issue.last_updated_at,
        state: blocked ? "blocked" : "running",
      };
    });
}

function buildAgentEntries(runs: Awaited<ReturnType<typeof listRuns>>) {
  return runs
    .flatMap((run) => {
      const entries: AgentEntry[] = [];
      const workflowEntry = buildWorkflowSummaryEntry(run);
      if (workflowEntry) {
        entries.push(workflowEntry);
      }
      entries.push(...buildIssueEntries(run));
      return entries;
    })
    .sort((left, right) => {
      const stateRank = { running: 0, blocked: 1 };
      const rankDiff = stateRank[left.state] - stateRank[right.state];
      if (rankDiff !== 0) {
        return rankDiff;
      }
      return new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime();
    });
}

function buildProjectSummaries(entries: AgentEntry[]): ProjectObserveSummary[] {
  const grouped = new Map<string, ProjectObserveSummary>();

  for (const entry of entries) {
    const current = grouped.get(entry.projectKey);
    if (!current) {
      grouped.set(entry.projectKey, {
        key: entry.projectKey,
        label: entry.projectLabel,
        runningCount: entry.state === "running" ? 1 : 0,
        blockedCount: entry.state === "blocked" ? 1 : 0,
        totalAgents: 1,
        lastUpdatedAt: entry.updatedAt,
      });
      continue;
    }

    current.runningCount += entry.state === "running" ? 1 : 0;
    current.blockedCount += entry.state === "blocked" ? 1 : 0;
    current.totalAgents += 1;
    if (new Date(entry.updatedAt).getTime() > new Date(current.lastUpdatedAt).getTime()) {
      current.lastUpdatedAt = entry.updatedAt;
    }
  }

  return [...grouped.values()].sort(
    (left, right) => new Date(right.lastUpdatedAt).getTime() - new Date(left.lastUpdatedAt).getTime()
  );
}

function selectArtifactCandidates(entry: AgentEntry, availableNames: Set<string>) {
  const candidates =
    entry.kind === "issue" && entry.issueId
      ? [`issue_execution_summary_${entry.issueId}`, `issue_execution_context_${entry.issueId}`]
      : {
          "phase1-planner": ["architecture_pack_summary", "normalized_prd"],
          "phase1-architecture-refinement": ["architecture_pack_summary", "architecture_chat"],
          "phase2-repo-provision": ["repo_state_summary"],
          "phase2-decomposition": ["decomposition_plan_summary"],
          "phase2-decomposition-iterator": ["decomposition_review_summary", "decomposition_review"],
          "phase2-implementation": ["implementation_issue_state_summary", "implementation_issue_state"],
          "phase3-build-orchestrator": ["build_audit_summary"],
          "phase3-issue-execution": entry.issueId ? [`issue_execution_summary_${entry.issueId}`] : [],
          "phase3-pr-supervisor": entry.issueId ? [`issue_execution_summary_${entry.issueId}`] : [],
        }[entry.workflowName] ?? [];

  return candidates.find((candidate) => availableNames.has(candidate));
}

export default async function ObservePage(props: { searchParams: SearchParamsShape }) {
  const searchParams = await props.searchParams;
  const selectedProjectKey = firstString(searchParams.project);
  const selectedAgentId = firstString(searchParams.agent);

  const runs = await listRuns();
  const allAgentEntries = buildAgentEntries(runs);
  const projectSummaries = buildProjectSummaries(allAgentEntries);

  const effectiveProjectKey = selectedProjectKey ?? projectSummaries[0]?.key ?? null;
  const visibleAgents = effectiveProjectKey
    ? allAgentEntries.filter((entry) => entry.projectKey === effectiveProjectKey)
    : [];
  const selectedAgent =
    visibleAgents.find((entry) => entry.id === selectedAgentId) ?? null;

  const runningAgents = allAgentEntries.filter((entry) => entry.state === "running");
  const blockedAgents = allAgentEntries.filter((entry) => entry.state === "blocked");
  const activeProjects = new Set(runningAgents.map((entry) => entry.projectKey));

  let selectedRun: Awaited<ReturnType<typeof getRun>> | null = null;
  let logTail = "";
  let selectedLogName: string | null = null;
  let expectedLogName: string | null = null;
  let outputPreview = "";
  let outputArtifactName: string | null = null;

  if (selectedAgent) {
    selectedRun = await getRun(selectedAgent.runId);
    const logs = await listRunLogs(selectedAgent.runId);
    const exactLogName = `${selectedAgent.workflowName}.log`;
    expectedLogName = exactLogName;
    const preferredLog =
      logs.find((log) => log.name === exactLogName) ??
      logs.sort((left, right) => new Date(right.updated_at).getTime() - new Date(left.updated_at).getTime())[0];

    if (preferredLog) {
      const logContent = await getRunLog(selectedAgent.runId, preferredLog.name);
      if (logContent) {
        selectedLogName = preferredLog.name;
        logTail = tailText(logContent);
      }
    }

    const artifactNames = new Set(selectedRun?.artifacts.map((artifact) => artifact.name) ?? []);
    const candidateArtifact = selectArtifactCandidates(selectedAgent, artifactNames);
    if (candidateArtifact) {
      const artifact = await getArtifact(selectedAgent.runId, candidateArtifact);
      if (artifact) {
        outputArtifactName = candidateArtifact;
        outputPreview = artifactPreview(artifact.payload);
      }
    }
  }

  return (
    <div className="min-h-screen bg-[color:var(--bg)] text-[color:var(--ink)]">
      <header className="border-b border-[color:var(--line)] bg-[color:var(--panel)]">
        <div className="mx-auto max-w-[1800px] px-4 py-3 lg:px-8">
          <div className="font-mono text-xs uppercase tracking-[0.18em] text-[color:var(--muted)]">
            <span className="text-[color:var(--accent)]">WSPass // observe console</span> // live agent activity
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-[1800px] space-y-8 px-4 py-8 lg:px-8">
        <section className="grid gap-4 md:grid-cols-4">
          {[
            ["Running agents", String(runningAgents.length), "Currently active workflows or issue workers."],
            ["Projects with activity", String(activeProjects.size), "Projects with at least one running agent."],
            ["Blocked agents", String(blockedAgents.length), "Agents paused by failures, missing tools, or missing context."],
            ["Tracked projects", String(projectSummaries.length), "Projects with visible running or blocked agent activity."],
          ].map(([label, value, note]) => (
            <div key={label} className="border border-[color:var(--line)] bg-[color:var(--panel)] p-5">
              <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-[color:var(--muted)]">
                {label}
              </p>
              <p className="mt-3 text-4xl font-semibold tracking-[-0.05em] text-[color:var(--ink-strong)]">
                {value}
              </p>
              <p className="mt-3 text-sm leading-6 text-[color:var(--ink)]">{note}</p>
            </div>
          ))}
        </section>

        <section className="grid gap-8 xl:grid-cols-[420px_minmax(0,1fr)]">
          <section className="border border-[color:var(--line)] bg-[color:var(--panel)]">
            <div className="border-b border-[color:var(--line)] px-5 py-4">
              <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-[color:var(--accent)]">
                Select project
              </p>
              <p className="mt-3 text-sm leading-6 text-[color:var(--ink)]">
                Choose a project first. Agent activity and log drilldown stay scoped to the selected project.
              </p>
            </div>
            <div className="divide-y divide-[color:var(--line)]">
              {projectSummaries.length > 0 ? (
                projectSummaries.map((project) => {
                  const active = project.key === effectiveProjectKey;
                  const tone =
                    project.blockedCount > 0 ? "danger" : project.runningCount > 0 ? "accent" : "default";
                  const statusLabel =
                    project.blockedCount > 0
                      ? `${project.blockedCount} blocked`
                      : `${project.runningCount} running`;

                  return (
                    <Link
                      key={project.key}
                      href={`/observe?project=${encodeURIComponent(project.key)}`}
                      className={`block px-5 py-4 transition ${
                        active ? "bg-[color:var(--panel-strong)]" : "hover:bg-[color:var(--panel-soft)]"
                      }`}
                    >
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <p className="min-w-0 truncate text-base font-semibold text-[color:var(--ink-strong)]">
                          {project.label}
                        </p>
                        <StatusBadge label={statusLabel} tone={tone} />
                      </div>
                      <p className="mt-3 font-mono text-[10px] uppercase tracking-[0.14em] text-[color:var(--muted)]">
                        {project.totalAgents} visible agents // updated {formatDate(project.lastUpdatedAt)}
                      </p>
                    </Link>
                  );
                })
              ) : (
                <div className="px-5 py-10 font-mono text-sm uppercase tracking-[0.16em] text-[color:var(--muted)]">
                  No running or blocked agents are currently visible.
                </div>
              )}
            </div>
          </section>

          <section className="space-y-6">
            <section className="border border-[color:var(--line)] bg-[color:var(--panel)] p-6">
              <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-[color:var(--accent)]">
                Agent activity
              </p>
              {effectiveProjectKey ? (
                <>
                  <h1 className="mt-4 text-3xl font-semibold tracking-[-0.05em] text-[color:var(--ink-strong)]">
                    {projectSummaries.find((project) => project.key === effectiveProjectKey)?.label ?? "Project"}
                  </h1>
                  <p className="mt-3 max-w-[72ch] text-sm leading-7 text-[color:var(--ink)]">
                    Select an agent below to inspect its recent log tail and latest structured output. Until then,
                    this page only shows the live agent roster for the chosen project.
                  </p>
                </>
              ) : (
                <p className="mt-3 text-sm leading-7 text-[color:var(--ink)]">
                  Select a project to inspect its running or blocked agents.
                </p>
              )}

              <div className="mt-6 divide-y divide-[color:var(--line)] border border-[color:var(--line)]">
                {visibleAgents.length > 0 ? (
                  visibleAgents.map((entry) => {
                    const active = entry.id === selectedAgent?.id;
                    const href = `/observe?project=${encodeURIComponent(entry.projectKey)}&agent=${encodeURIComponent(entry.id)}`;
                    return (
                      <Link
                        key={entry.id}
                        href={href}
                        className={`block px-5 py-4 transition ${
                          active ? "bg-[color:var(--panel-strong)]" : "hover:bg-[color:var(--panel-soft)]"
                        }`}
                      >
                        <div className="flex flex-wrap items-center justify-between gap-3">
                          <p className="min-w-0 truncate text-base font-semibold text-[color:var(--ink-strong)]">
                            {entry.title}
                          </p>
                          <StatusBadge label={entry.statusLabel} tone={entry.statusTone} />
                        </div>
                        <p className="mt-2 font-mono text-[11px] uppercase tracking-[0.16em] text-[color:var(--muted)]">
                          {entry.workflowName} // run {entry.runId}
                        </p>
                        <p className="mt-3 line-clamp-2 text-sm leading-6 text-[color:var(--ink)]">{entry.summary}</p>
                        <p className="mt-3 font-mono text-[10px] uppercase tracking-[0.14em] text-[color:var(--muted)]">
                          updated {formatDate(entry.updatedAt)}
                        </p>
                      </Link>
                    );
                  })
                ) : (
                  <div className="px-5 py-10 font-mono text-sm uppercase tracking-[0.16em] text-[color:var(--muted)]">
                    {effectiveProjectKey
                      ? "No running or blocked agents are currently visible for this project."
                      : "Select a project to view its agents."}
                  </div>
                )}
              </div>
            </section>

            {selectedAgent ? (
              <section className="space-y-6">
                <section className="border border-[color:var(--line)] bg-[color:var(--panel)] p-6">
                  <div className="flex flex-wrap items-start justify-between gap-4">
                    <div className="min-w-0">
                      <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-[color:var(--accent)]">
                        Agent inspector
                      </p>
                      <h2 className="mt-4 text-3xl font-semibold tracking-[-0.05em] text-[color:var(--ink-strong)]">
                        {selectedAgent.title}
                      </h2>
                      <p className="mt-3 max-w-[80ch] font-mono text-sm leading-7 text-[color:var(--muted)]">
                        {selectedAgent.projectLabel} // run {selectedAgent.runId} // {selectedAgent.workflowName}
                      </p>
                    </div>
                    <StatusBadge label={selectedAgent.statusLabel} tone={selectedAgent.statusTone} />
                  </div>

                  <div className="mt-6 grid gap-4 md:grid-cols-3">
                    <div className="border border-[color:var(--line)] bg-[color:var(--panel-soft)] p-4">
                      <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-[color:var(--muted)]">
                        Agent type
                      </p>
                      <p className="mt-3 text-lg font-semibold text-[color:var(--ink-strong)]">
                        {selectedAgent.kind === "issue" ? "Issue worker" : "Workflow agent"}
                      </p>
                    </div>
                    <div className="border border-[color:var(--line)] bg-[color:var(--panel-soft)] p-4">
                      <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-[color:var(--muted)]">
                        Last updated
                      </p>
                      <p className="mt-3 text-lg font-semibold text-[color:var(--ink-strong)]">
                        {formatDate(selectedAgent.updatedAt)}
                      </p>
                    </div>
                    <div className="border border-[color:var(--line)] bg-[color:var(--panel-soft)] p-4">
                      <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-[color:var(--muted)]">
                        Latest summary
                      </p>
                      <p className="mt-3 text-sm leading-6 text-[color:var(--ink)]">{selectedAgent.summary}</p>
                    </div>
                  </div>
                </section>

                <section className="grid gap-6 xl:grid-cols-2">
                  <section className="border border-[color:var(--line)] bg-[color:var(--panel)] p-6">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div>
                        <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-[color:var(--accent)]">
                          Recent log tail
                        </p>
                        <p className="mt-3 text-sm leading-6 text-[color:var(--ink)]">
                          {selectedLogName
                            ? `Showing the last lines of ${selectedLogName}.`
                            : "No workflow log available for this agent yet."}
                        </p>
                      </div>
                      {selectedLogName ? (
                        <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-[color:var(--muted)]">
                          {selectedAgent.runId}
                        </span>
                      ) : null}
                    </div>
                    <div className="mt-6">
                      <AgentLogTail
                        runId={selectedAgent.runId}
                        logName={selectedLogName ?? expectedLogName ?? `${selectedAgent.workflowName}.log`}
                        initialTail={logTail || "No log output available yet."}
                        live={selectedAgent.state === "running"}
                      />
                    </div>
                  </section>

                  <section className="border border-[color:var(--line)] bg-[color:var(--panel)] p-6">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div>
                        <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-[color:var(--accent)]">
                          Recent output
                        </p>
                        <p className="mt-3 text-sm leading-6 text-[color:var(--ink)]">
                          {outputArtifactName
                            ? `Showing the latest relevant artifact: ${outputArtifactName}.`
                            : "No matching output artifact is available for this agent yet."}
                        </p>
                      </div>
                      {selectedRun ? (
                        <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-[color:var(--muted)]">
                          {selectedRun.artifacts.length} artifacts
                        </span>
                      ) : null}
                    </div>
                    <pre className="mt-6 max-h-[540px] overflow-auto border border-[color:var(--line)] bg-[color:var(--panel-soft)] p-4 font-mono text-xs leading-6 text-[color:var(--ink-strong)]">
                      {outputPreview || "No structured output preview available."}
                    </pre>
                  </section>
                </section>
              </section>
            ) : effectiveProjectKey ? (
              <section className="border border-[color:var(--line)] bg-[color:var(--panel)] p-6">
                <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-[color:var(--accent)]">
                  Agent inspector
                </p>
                <p className="mt-4 text-sm leading-7 text-[color:var(--ink)]">
                  Select one of the visible agents above to inspect a tail of its logs and its latest structured output.
                </p>
              </section>
            ) : null}
          </section>
        </section>
      </main>
    </div>
  );
}
