import Link from "next/link";
import { LiveRefreshShell } from "./LiveRefreshShell";
import { StatusBadge } from "./StatusBadge";
import {
  buildProgressItems,
  deriveLiveExecution,
  deriveRunDisplayStatus,
  deriveRunDisplayTone,
  type RunEnvelope,
} from "../lib/consoleData";

function progressTileTone(state: "active" | "completed" | "pending" | "blocked") {
  if (state === "blocked") {
    return {
      borderColor: "var(--danger)",
      backgroundColor: "var(--danger-soft)",
      stripeColor: "var(--danger)",
      labelColor: "var(--ink-strong)",
      statusColor: "var(--danger-ink)",
      detailColor: "var(--danger-ink)",
    };
  }

  if (state === "completed") {
    return {
      borderColor: "var(--success)",
      backgroundColor: "var(--success-soft)",
      stripeColor: "var(--success)",
      labelColor: "var(--ink-strong)",
      statusColor: "var(--success-ink)",
      detailColor: "var(--success-ink)",
    };
  }

  return {
    borderColor: "var(--warning)",
    backgroundColor: "var(--warning-soft)",
    stripeColor: "var(--warning)",
    labelColor: "var(--ink-strong)",
    statusColor: "var(--warning-ink)",
    detailColor: "var(--warning-ink)",
  };
}

export function ConsoleChrome(props: {
  run: RunEnvelope["run"];
  projectLabel: string;
  children: React.ReactNode;
}) {
  const { run, projectLabel, children } = props;
  const progress = buildProgressItems(run);
  const displayStatus = deriveRunDisplayStatus(run);
  const liveExecution = deriveLiveExecution(run);
  const executionLabel = liveExecution?.backend
    ? `${liveExecution.backend}:${liveExecution.workflowName}`
    : liveExecution?.workflowName ?? "idle";

  return (
    <div className="min-h-screen bg-[color:var(--bg)] text-[color:var(--ink)]">
      <header className="border-b border-[color:var(--line)] bg-[color:var(--panel)] backdrop-blur">
        <div className="mx-auto max-w-[1800px] px-4 py-3 lg:px-8">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div className="flex flex-wrap items-center gap-4 font-mono text-xs uppercase tracking-[0.18em] text-[color:var(--muted)]">
              <Link href="/projects" className="text-[color:var(--accent)]">
                WSPass // system console
              </Link>
              <span>//</span>
              <span className="text-[color:var(--ink)]">{projectLabel}</span>
              <span className="hidden lg:inline">//</span>
              <span className="hidden lg:inline">run {run.run_id.slice(0, 8)}</span>
            </div>

            <div className="flex items-center gap-3">
              <StatusBadge
                label={displayStatus}
                tone={deriveRunDisplayTone(run)}
              />
              <StatusBadge
                label={executionLabel}
                tone={
                  liveExecution?.status === "failed"
                    ? "danger"
                    : liveExecution?.status === "succeeded"
                    ? "success"
                    : "default"
                }
              />
            </div>
          </div>

          <div className="mt-4 grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
            {progress.map((item) => {
              const tone = progressTileTone(item.state);

              return (
                <Link
                  key={item.key}
                  href={item.href}
                  className="relative border px-3 py-3 transition hover:opacity-95 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[color:var(--accent)]"
                  style={{
                    borderColor: tone.borderColor,
                    backgroundColor: tone.backgroundColor,
                    boxShadow: `inset 0 0 0 1px ${tone.borderColor}`,
                  }}
                >
                  <span
                    className="absolute inset-x-0 top-0 h-[3px]"
                    style={{ backgroundColor: tone.stripeColor }}
                  />
                  <div className="flex items-start justify-between gap-3">
                    <span
                      className="font-mono text-[11px] uppercase tracking-[0.18em]"
                      style={{ color: tone.labelColor }}
                    >
                      {item.label}
                    </span>
                    <span
                      className="font-mono text-[10px] uppercase tracking-[0.16em]"
                      style={{ color: tone.statusColor }}
                    >
                      {item.state}
                    </span>
                  </div>
                  <p
                    className="mt-2 font-mono text-[10px] uppercase tracking-[0.14em]"
                    style={{ color: tone.detailColor }}
                  >
                    {item.detail}
                  </p>
                </Link>
              );
            })}
          </div>

        </div>
      </header>

      <main className="mx-auto max-w-[1800px] px-4 py-6 lg:px-8">
        <LiveRefreshShell
          executionStatus={liveExecution?.status}
          workflowName={liveExecution?.workflowName}
        >
          <div>{children}</div>
        </LiveRefreshShell>
      </main>
    </div>
  );
}
