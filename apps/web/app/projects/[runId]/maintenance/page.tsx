import { notFound } from "next/navigation";
import { dispatchWorkflowAction } from "../../../actions";
import { ConsoleChrome } from "../../../components/ConsoleChrome";
import { StatusBadge } from "../../../components/StatusBadge";
import { deriveRetryWorkflow, getRunConsoleData, isFailedRunState } from "../../../lib/consoleData";

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
  const returnTo = `/projects/${runId}/maintenance`;
  const retryWorkflow = deriveRetryWorkflow(run.run);
  const failedExecution = isFailedRunState(run.run) ? run.run.execution : null;
  const issues = run.run.implementation_state?.issues ?? [];
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
          <section className="border border-[#aa3d3d] bg-[color:var(--panel)] p-5">
            <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
              <div className="min-w-0">
                <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-[#ff7d7d]">
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
                <button
                  type="submit"
                  className="border border-[color:var(--accent)] bg-[color:var(--accent)] px-4 py-3 font-mono text-xs uppercase tracking-[0.18em] text-white transition hover:bg-transparent hover:text-[color:var(--accent)]"
                >
                  Re-run current stage
                </button>
              </form>
            </div>
          </section>
        ) : null}

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
