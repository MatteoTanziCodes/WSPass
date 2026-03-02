import Link from "next/link";
import { LiveRefreshShell } from "./LiveRefreshShell";
import { StatusBadge } from "./StatusBadge";
import {
  buildProgressItems,
  deriveRunDisplayStatus,
  deriveRunDisplayTone,
  type RunEnvelope,
} from "../lib/consoleData";

function progressTileTone(state: "active" | "completed" | "pending" | "blocked") {
  if (state === "blocked") {
    return {
      borderColor: "rgba(255, 118, 118, 0.92)",
      backgroundColor: "rgba(255, 118, 118, 0.08)",
      stripeColor: "rgba(255, 118, 118, 1)",
      labelColor: "rgba(255, 215, 215, 0.98)",
      statusColor: "rgba(255, 118, 118, 1)",
      detailColor: "rgba(255, 176, 176, 0.92)",
    };
  }

  if (state === "completed") {
    return {
      borderColor: "rgba(53, 219, 149, 0.92)",
      backgroundColor: "rgba(53, 219, 149, 0.08)",
      stripeColor: "rgba(53, 219, 149, 1)",
      labelColor: "rgba(231, 255, 242, 0.98)",
      statusColor: "rgba(53, 219, 149, 1)",
      detailColor: "rgba(143, 245, 190, 0.92)",
    };
  }

  return {
    borderColor: "rgba(255, 148, 77, 0.92)",
    backgroundColor: "rgba(255, 148, 77, 0.08)",
    stripeColor: "rgba(255, 148, 77, 1)",
    labelColor: "rgba(255, 244, 233, 0.98)",
    statusColor: "rgba(255, 148, 77, 1)",
    detailColor: "rgba(255, 205, 166, 0.92)",
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
  const executionLabel = run.execution?.backend
    ? `${run.execution.backend}:${run.execution.workflow_name}`
    : "idle";

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
                  run.execution?.status === "failed"
                    ? "danger"
                    : run.execution?.status === "succeeded"
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
          executionStatus={run.execution?.status}
          workflowName={run.execution?.workflow_name}
        >
          <div>{children}</div>
        </LiveRefreshShell>
      </main>
    </div>
  );
}
