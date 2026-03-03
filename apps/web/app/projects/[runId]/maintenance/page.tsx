import { notFound } from "next/navigation";
import { deriveProjectKeyFromRun } from "@pass/shared";
import { dispatchWorkflowAction } from "../../../actions";
import { ConsoleChrome } from "../../../components/ConsoleChrome";
import { FormSubmitButton } from "../../../components/FormSubmitButton";
import { StatusBadge } from "../../../components/StatusBadge";
import { deriveRetryWorkflow, getRunConsoleData, isFailedRunState } from "../../../lib/consoleData";
import {
  getProjectObservability,
  getProjectObservabilityExportPath,
} from "../../../lib/passApi";
import { updateProjectObservabilityBudgetAction } from "../../../actions";

function formatUsd(value: number | null | undefined) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return "n/a";
  }

  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 2,
  }).format(value);
}

function formatTokenCount(value: number | null | undefined) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return "0";
  }

  return new Intl.NumberFormat("en-US").format(value);
}

function observabilityBudgetTone(state: "none" | "green" | "yellow" | "red") {
  if (state === "green") {
    return "success" as const;
  }
  if (state === "yellow") {
    return "accent" as const;
  }
  if (state === "red") {
    return "danger" as const;
  }
  return "default" as const;
}

function observabilityBudgetLabel(state: "none" | "green" | "yellow" | "red") {
  if (state === "none") {
    return "No budget";
  }
  if (state === "green") {
    return "Below warning";
  }
  if (state === "yellow") {
    return "Warning threshold";
  }
  return "Critical threshold";
}

function deriveSeverity(labels: string[]) {
  const lowered = labels.map((label) => label.toLowerCase());
  if (lowered.some((label) => label.includes("critical"))) {
    return "critical";
  }
  if (lowered.some((label) => label.includes("high"))) {
    return "high";
  }
  if (lowered.some((label) => label.includes("medium"))) {
    return "medium";
  }
  return "low";
}

export default async function MaintenancePage(props: {
  params: Promise<{ runId: string }>;
}) {
  const { runId } = await props.params;
  const data = await getRunConsoleData(runId);

  if (!data) {
    notFound();
  }

  const { run, projectLabel } = data;
  const projectKey = deriveProjectKeyFromRun(run.run);
  const observability = await getProjectObservability(projectKey);
  const observabilityExportPath = getProjectObservabilityExportPath(projectKey);
  const returnTo = `/projects/${runId}/maintenance`;
  const retryWorkflow = deriveRetryWorkflow(run.run);
  const failedExecution = isFailedRunState(run.run) ? run.run.execution : null;
  const issues = run.run.implementation_state?.issues ?? [];
  const latestObservedRun = observability?.runs[0] ?? null;
  const escalations = issues
    .filter((issue) => issue.sync_status === "failed" || issue.github_state !== "closed")
    .map((issue) => ({
      ...issue,
      severity: deriveSeverity(issue.labels ?? []),
    }));

  const severityCounts = {
    critical: escalations.filter((issue) => issue.severity === "critical").length,
    high: escalations.filter((issue) => issue.severity === "high").length,
    medium: escalations.filter((issue) => issue.severity === "medium").length,
    low: escalations.filter((issue) => issue.severity === "low").length,
  };

  return (
    <ConsoleChrome run={run.run} projectLabel={projectLabel}>
      <div className="space-y-6">
        {isFailedRunState(run.run) && retryWorkflow ? (
          <section className="border border-[color:var(--danger)] bg-[color:var(--panel)] p-5">
            <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
              <div className="min-w-0">
                <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-[color:var(--danger-ink)]">
                  Recovery
                </p>
                <h2 className="mt-3 text-2xl font-semibold tracking-[-0.04em] text-[color:var(--ink-strong)]">
                  The current stage failed.
                </h2>
                <p className="mt-3 font-mono text-sm uppercase tracking-[0.14em] text-[color:var(--muted)]">
                  workflow {failedExecution?.workflow_name ?? retryWorkflow} // backend {failedExecution?.backend ?? "unknown"}
                </p>
                {failedExecution?.error_message ? (
                  <p className="mt-4 max-w-[90ch] whitespace-pre-wrap text-sm leading-7 text-[color:var(--ink)]">
                    {failedExecution.error_message}
                  </p>
                ) : (
                  <p className="mt-4 text-sm leading-7 text-[color:var(--ink)]">
                    The run is in a failed state. Re-run the current stage to recover from the last failed step.
                  </p>
                )}
              </div>
              <form action={dispatchWorkflowAction} className="shrink-0">
                <input type="hidden" name="run_id" value={runId} />
                <input type="hidden" name="workflow_name" value={retryWorkflow} />
                <input type="hidden" name="return_to" value={returnTo} />
                <FormSubmitButton
                  idleLabel="Re-run current stage"
                  pendingLabel="Re-running stage..."
                  className="border border-[color:var(--accent)] bg-[color:var(--accent)] px-4 py-3 font-mono text-xs uppercase tracking-[0.18em] text-white transition hover:bg-transparent hover:text-[color:var(--accent)] disabled:cursor-not-allowed disabled:opacity-50"
                />
              </form>
            </div>
          </section>
        ) : null}

        <section className="grid gap-6 xl:grid-cols-[1.3fr_0.9fr]">
          <section className="border border-[color:var(--line)] bg-[color:var(--panel)] p-6">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
              <div className="min-w-0">
                <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-[color:var(--accent)]">
                  Claude observability
                </p>
                <h2 className="mt-3 text-3xl font-semibold tracking-[-0.05em] text-[color:var(--ink-strong)]">
                  Token spend and execution traces
                </h2>
                <p className="mt-3 max-w-[72ch] font-mono text-sm leading-7 text-[color:var(--muted)]">
                  Rolling 30-day Anthropic usage for this project, plus per-run Claude traces and downloadable
                  workflow logs. This is the maintenance observability layer for prompt spend and model behavior.
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-3">
                <StatusBadge
                  label={observabilityBudgetLabel(observability?.budget_state ?? "none")}
                  tone={observabilityBudgetTone(observability?.budget_state ?? "none")}
                />
                <a
                  href={observabilityExportPath}
                  className="border border-[color:var(--accent)] px-4 py-3 font-mono text-[11px] uppercase tracking-[0.18em] text-[color:var(--accent)] transition hover:bg-[color:var(--accent)] hover:text-white"
                >
                  Download observability bundle
                </a>
              </div>
            </div>

            <div className="mt-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
              {[
                [
                  "Rolling 30d input tokens",
                  formatTokenCount(observability?.totals.input_tokens),
                  "Anthropic prompt volume across all project runs in the last 30 days.",
                ],
                [
                  "Rolling 30d output tokens",
                  formatTokenCount(observability?.totals.output_tokens),
                  "Anthropic generated output volume across the same rolling window.",
                ],
                [
                  "Rolling 30d estimated cost",
                  formatUsd(observability?.totals.estimated_cost_usd),
                  "Estimated USD based on configured model pricing and captured Anthropic usage.",
                ],
                [
                  "Latest run cost",
                  formatUsd(latestObservedRun?.totals.estimated_cost_usd ?? null),
                  "Estimated USD for the most recently observed run in this project.",
                ],
              ].map(([label, value, note]) => (
                <div
                  key={String(label)}
                  className="border border-[color:var(--line)] bg-[color:var(--panel-soft)] p-4"
                >
                  <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-[color:var(--muted)]">
                    {label}
                  </p>
                  <p className="mt-3 text-3xl font-semibold tracking-[-0.04em] text-[color:var(--ink-strong)]">
                    {value}
                  </p>
                  <p className="mt-3 text-sm leading-6 text-[color:var(--ink)]">{note}</p>
                </div>
              ))}
            </div>

            <div className="mt-4 grid gap-4 sm:grid-cols-3">
              <div className="border border-[color:var(--line)] bg-[color:var(--panel-soft)] p-4">
                <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-[color:var(--muted)]">
                  Runs in window
                </p>
                <p className="mt-3 text-2xl font-semibold text-[color:var(--ink-strong)]">
                  {formatTokenCount(observability?.totals.run_count ?? 0)}
                </p>
              </div>
              <div className="border border-[color:var(--line)] bg-[color:var(--panel-soft)] p-4">
                <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-[color:var(--muted)]">
                  Claude requests
                </p>
                <p className="mt-3 text-2xl font-semibold text-[color:var(--ink-strong)]">
                  {formatTokenCount(observability?.totals.request_count ?? 0)}
                </p>
              </div>
              <div className="border border-[color:var(--line)] bg-[color:var(--panel-soft)] p-4">
                <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-[color:var(--muted)]">
                  Budget window
                </p>
                <p className="mt-3 text-2xl font-semibold text-[color:var(--ink-strong)]">
                  {observability?.budget?.window_days ?? 30} days
                </p>
              </div>
            </div>
          </section>

          <section className="border border-[color:var(--line)] bg-[color:var(--panel)] p-6">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-[color:var(--accent)]">
                  Budget management
                </p>
                <h2 className="mt-3 text-2xl font-semibold tracking-[-0.04em] text-[color:var(--ink-strong)]">
                  Rolling 30-day budget thresholds
                </h2>
              </div>
              <StatusBadge
                label={observabilityBudgetLabel(observability?.budget_state ?? "none")}
                tone={observabilityBudgetTone(observability?.budget_state ?? "none")}
              />
            </div>
            <p className="mt-4 text-sm leading-7 text-[color:var(--ink)]">
              Configure warning and critical estimated-spend thresholds for Anthropic usage on this project.
              Leave either field blank to clear it.
            </p>
            <form action={updateProjectObservabilityBudgetAction} className="mt-6 space-y-4">
              <input type="hidden" name="project_key" value={projectKey} />
              <input type="hidden" name="return_to" value={returnTo} />
              <label className="block">
                <span className="block font-mono text-[11px] uppercase tracking-[0.18em] text-[color:var(--muted)]">
                  Warning threshold (USD)
                </span>
                <input
                  name="warning_usd"
                  type="number"
                  min="0"
                  step="0.01"
                  defaultValue={observability?.budget?.warning_usd ?? ""}
                  className="mt-2 w-full border border-[color:var(--line)] bg-[color:var(--panel-soft)] px-4 py-3 text-sm leading-7 outline-none transition focus:border-[color:var(--accent)]"
                />
              </label>
              <label className="block">
                <span className="block font-mono text-[11px] uppercase tracking-[0.18em] text-[color:var(--muted)]">
                  Critical threshold (USD)
                </span>
                <input
                  name="critical_usd"
                  type="number"
                  min="0"
                  step="0.01"
                  defaultValue={observability?.budget?.critical_usd ?? ""}
                  className="mt-2 w-full border border-[color:var(--line)] bg-[color:var(--panel-soft)] px-4 py-3 text-sm leading-7 outline-none transition focus:border-[color:var(--accent)]"
                />
              </label>
              <FormSubmitButton
                idleLabel="Save budget thresholds"
                pendingLabel="Saving budget..."
                className="border border-[color:var(--accent)] bg-[color:var(--accent)] px-4 py-3 font-mono text-[11px] uppercase tracking-[0.18em] text-white transition hover:bg-transparent hover:text-[color:var(--accent)] disabled:cursor-not-allowed disabled:opacity-50"
              />
            </form>
          </section>
        </section>

        <section className="border border-[color:var(--line)] bg-[color:var(--panel)] p-6">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-[color:var(--accent)]">
                Claude execution traces
              </p>
              <h2 className="mt-3 text-2xl font-semibold tracking-[-0.04em] text-[color:var(--ink-strong)]">
                Per-run model sessions
              </h2>
            </div>
            <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-[color:var(--muted)]">
              Redacted full trace // downloadable via observability bundle
            </p>
          </div>

          {observability && observability.runs.length > 0 ? (
            <div className="mt-6 space-y-6">
              {observability.runs.map((observedRun) => (
                <section
                  key={observedRun.run_id}
                  className="border border-[color:var(--line)] bg-[color:var(--panel-soft)]"
                >
                  <div className="grid gap-4 border-b border-[color:var(--line)] px-5 py-4 lg:grid-cols-[minmax(0,1.2fr)_180px_180px_180px_180px] lg:items-center">
                    <div className="min-w-0">
                      <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-[color:var(--muted)]">
                        Run
                      </p>
                      <p className="mt-2 break-all text-sm text-[color:var(--ink-strong)]">
                        {observedRun.run_id}
                      </p>
                      <p className="mt-2 font-mono text-[10px] uppercase tracking-[0.14em] text-[color:var(--muted)]">
                        Updated {observedRun.last_updated_at}
                      </p>
                    </div>
                    <div>
                      <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-[color:var(--muted)]">
                        Latest workflow
                      </p>
                      <p className="mt-2 font-mono text-[11px] uppercase tracking-[0.14em] text-[color:var(--ink)]">
                        {observedRun.latest_workflow_name ?? "n/a"}
                      </p>
                    </div>
                    <div>
                      <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-[color:var(--muted)]">
                        Requests
                      </p>
                      <p className="mt-2 text-lg font-semibold text-[color:var(--ink-strong)]">
                        {formatTokenCount(observedRun.totals.request_count)}
                      </p>
                    </div>
                    <div>
                      <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-[color:var(--muted)]">
                        Tokens
                      </p>
                      <p className="mt-2 text-lg font-semibold text-[color:var(--ink-strong)]">
                        {formatTokenCount(observedRun.totals.total_tokens)}
                      </p>
                    </div>
                    <div>
                      <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-[color:var(--muted)]">
                        Estimated cost
                      </p>
                      <p className="mt-2 text-lg font-semibold text-[color:var(--ink-strong)]">
                        {formatUsd(observedRun.totals.estimated_cost_usd)}
                      </p>
                    </div>
                  </div>

                  <div className="space-y-4 px-5 py-5">
                    {observedRun.sessions.length > 0 ? (
                      observedRun.sessions.map((session, index) => (
                        <div
                          key={`${observedRun.run_id}_${session.workflow_name}_${index}`}
                          className="border border-[color:var(--line)] bg-[color:var(--panel)] p-4"
                        >
                          <div className="grid gap-4 lg:grid-cols-[minmax(0,1.2fr)_120px_120px_140px_140px]">
                            <div className="min-w-0">
                              <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-[color:var(--muted)]">
                                Workflow / model
                              </p>
                              <p className="mt-2 font-mono text-[11px] uppercase tracking-[0.14em] text-[color:var(--ink)]">
                                {session.workflow_name} // {session.model}
                              </p>
                              <p className="mt-2 font-mono text-[10px] uppercase tracking-[0.14em] text-[color:var(--muted)]">
                                backend {session.backend ?? "unknown"} // updated {session.completed_at ?? session.started_at}
                              </p>
                            </div>
                            <div>
                              <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-[color:var(--muted)]">
                                Requests
                              </p>
                              <p className="mt-2 text-lg font-semibold text-[color:var(--ink-strong)]">
                                {formatTokenCount(session.request_count)}
                              </p>
                            </div>
                            <div>
                              <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-[color:var(--muted)]">
                                Input
                              </p>
                              <p className="mt-2 text-lg font-semibold text-[color:var(--ink-strong)]">
                                {formatTokenCount(session.usage.input_tokens)}
                              </p>
                            </div>
                            <div>
                              <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-[color:var(--muted)]">
                                Output
                              </p>
                              <p className="mt-2 text-lg font-semibold text-[color:var(--ink-strong)]">
                                {formatTokenCount(session.usage.output_tokens)}
                              </p>
                            </div>
                            <div>
                              <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-[color:var(--muted)]">
                                Cost
                              </p>
                              <p className="mt-2 text-lg font-semibold text-[color:var(--ink-strong)]">
                                {formatUsd(session.usage.estimated_cost_usd)}
                              </p>
                            </div>
                          </div>

                          <div className="mt-4 flex flex-wrap gap-2">
                            <StatusBadge
                              label={session.status}
                              tone={
                                session.status === "failed"
                                  ? "danger"
                                  : session.status === "running"
                                    ? "accent"
                                    : "success"
                              }
                            />
                            {observedRun.available_log_files.map((logName) => (
                              <span
                                key={`${observedRun.run_id}_${logName}`}
                                className="inline-flex border border-[color:var(--line)] px-2 py-1 font-mono text-[10px] uppercase tracking-[0.16em] text-[color:var(--muted)]"
                              >
                                {logName}
                              </span>
                            ))}
                          </div>

                          {session.requests.some((request) => request.error_message) ? (
                            <div className="mt-4 space-y-2">
                              <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-[color:var(--muted)]">
                                Latest request issues
                              </p>
                              {session.requests
                                .filter((request) => request.error_message)
                                .slice(-2)
                                .map((request) => (
                                  <div
                                    key={request.id}
                                    className="border border-[color:var(--danger)] bg-[color:var(--danger-soft)] px-3 py-3 text-sm leading-6 text-[color:var(--ink)]"
                                  >
                                    <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-[color:var(--danger-ink)]">
                                      {request.section_name} // {request.status}
                                    </p>
                                    <p className="mt-2 whitespace-pre-wrap">{request.error_message}</p>
                                  </div>
                                ))}
                            </div>
                          ) : null}
                        </div>
                      ))
                    ) : (
                      <div className="font-mono text-sm uppercase tracking-[0.16em] text-[color:var(--muted)]">
                        No Claude sessions recorded for this run yet.
                      </div>
                    )}
                  </div>
                </section>
              ))}
            </div>
          ) : (
            <div className="mt-6 border border-[color:var(--line)] bg-[color:var(--panel-soft)] px-5 py-8 font-mono text-sm uppercase tracking-[0.16em] text-[color:var(--muted)]">
              No Claude observability data has been recorded for this project yet.
            </div>
          )}
        </section>

        <section className="grid gap-4 lg:grid-cols-2 2xl:grid-cols-5">
          <div className="border border-[color:var(--line)] bg-[color:var(--panel)] p-5 2xl:col-span-2">
            <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-[color:var(--accent)]">
              05 // Maintenance / Resolution Agents
            </p>
            <h1 className="mt-4 text-3xl font-semibold tracking-[-0.05em] text-[color:var(--ink-strong)]">
              Operational risk overview
            </h1>
            <p className="mt-4 max-w-[72ch] font-mono text-sm leading-7 text-[color:var(--muted)]">
              This screen is the scaffold for the maintenance rail: vulnerability overview,
              patch/resolution agents, and long-lived program health. The current repo already has
              enough synced issue data to shape the control surface.
            </p>
          </div>

          {([
            ["Critical", severityCounts.critical, "danger"],
            ["High", severityCounts.high, "danger"],
            ["Medium", severityCounts.medium, "accent"],
            ["Low", severityCounts.low, "success"],
          ] as const).map(([label, value, tone]) => (
            <div key={label} className="border border-[color:var(--line)] bg-[color:var(--panel)] p-5">
              <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-[color:var(--muted)]">
                {label}
              </p>
              <div className="mt-3 flex items-center justify-between">
                <p className="text-4xl font-semibold text-[color:var(--ink-strong)]">{value}</p>
                <StatusBadge label={label} tone={tone as "danger" | "accent" | "success"} />
              </div>
            </div>
          ))}
        </section>

        <section className="grid gap-6 xl:grid-cols-[0.8fr_1.2fr]">
          <section className="border border-[color:var(--line)] bg-[color:var(--panel)] p-6">
            <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-[color:var(--accent)]">
              Agent queues
            </p>
            <div className="mt-5 space-y-4">
              {[
                {
                  title: "Patch management",
                  value: escalations.filter((issue) =>
                    issue.labels?.some((label) => label.toLowerCase().includes("infra"))
                  ).length,
                  note: "Infrastructure or dependency-adjacent work needing patch context.",
                },
                {
                  title: "Vulnerability resolution",
                  value: severityCounts.critical + severityCounts.high,
                  note: "Open items that should flow to resolution agents first.",
                },
                {
                  title: "Operational follow-up",
                  value: escalations.length,
                  note: "Open or failed downstream items that still need a closure loop.",
                },
              ].map((item) => (
                <div key={item.title} className="border border-[color:var(--line)] bg-[color:var(--panel-soft)] p-4">
                  <div className="flex items-center justify-between gap-4">
                    <p className="text-base font-semibold text-[color:var(--ink-strong)]">{item.title}</p>
                    <p className="font-mono text-2xl text-[color:var(--accent)]">{item.value}</p>
                  </div>
                  <p className="mt-3 text-sm leading-6 text-[color:var(--ink)]">{item.note}</p>
                </div>
              ))}
            </div>
          </section>

          <section className="border border-[color:var(--line)] bg-[color:var(--panel)]">
            <div className="overflow-x-auto">
              <div className="grid min-w-[760px] grid-cols-[minmax(0,1.4fr)_140px_180px] border-b border-[color:var(--line)] px-6 py-3 font-mono text-[11px] uppercase tracking-[0.18em] text-[color:var(--muted)]">
                <span>Resolution item</span>
                <span>Severity</span>
                <span>Status</span>
              </div>
              {escalations.map((issue) => (
                <div
                  key={issue.plan_item_id}
                  className="grid min-w-[760px] grid-cols-[minmax(0,1.4fr)_140px_180px] gap-4 border-b border-[color:var(--line)] px-6 py-4"
                >
                  <div className="min-w-0">
                    <p className="truncate text-base font-semibold text-[color:var(--ink-strong)]">
                      {issue.title}
                    </p>
                    <p className="mt-2 font-mono text-xs uppercase tracking-[0.16em] text-[color:var(--muted)]">
                      {issue.issue_number ? `Issue #${issue.issue_number}` : "Not yet raised"}
                    </p>
                  </div>
                  <div className="flex items-center">
                    <StatusBadge
                      label={issue.severity}
                      tone={
                        issue.severity === "low"
                          ? "success"
                          : issue.severity === "medium"
                            ? "accent"
                            : "danger"
                      }
                    />
                  </div>
                  <div className="flex items-center">
                    <StatusBadge
                      label={
                        issue.sync_status === "failed"
                          ? "escalated"
                          : issue.github_state ?? "open"
                      }
                      tone={
                        issue.sync_status === "failed"
                          ? "danger"
                          : issue.github_state === "closed"
                            ? "success"
                            : "default"
                      }
                    />
                  </div>
                </div>
              ))}
            </div>
            {escalations.length === 0 ? (
              <div className="px-6 py-12 font-mono text-sm uppercase tracking-[0.16em] text-[color:var(--muted)]">
                No active maintenance items yet.
              </div>
            ) : null}
          </section>
        </section>
      </div>
    </ConsoleChrome>
  );
}
