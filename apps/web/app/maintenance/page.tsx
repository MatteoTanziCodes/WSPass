import { MaintenanceProjectSelector } from "../components/MaintenanceProjectSelector";
import {
  deriveRunHealthBucket,
  deriveRetryWorkflow,
  deriveRunDisplayTone,
  deriveRunDisplayStatus,
  formatDate,
  getProjectsCached,
  isFailedRunState,
} from "../lib/consoleData";

export default async function MaintenanceSelectionPage() {
  const projects = await getProjectsCached();
  const projectItems = projects.map((project) => {
    const displayStatus = deriveRunDisplayStatus(project.latest);
    const displayTone = deriveRunDisplayTone(project.latest);
    const bucket = deriveRunHealthBucket(project.latest);

    return {
      key: project.key,
      label: project.label,
      latestRunId: project.latest.run_id,
      latestUpdatedAt: formatDate(project.latest.last_updated_at),
      runsCount: project.runs.length,
      latestStatusLabel: displayStatus,
      latestStatusTone: displayTone,
      bucket,
      bucketLabel:
        bucket === "green"
          ? "Project completed"
          : bucket === "red"
            ? "Blocked / failed"
            : "Pending / in progress",
      rerunWorkflowName: deriveRetryWorkflow(project.latest),
      rerunnable: isFailedRunState(project.latest),
      runIds: project.runs.map((run) => run.run_id),
    } as const;
  });

  return (
    <div className="min-h-screen bg-[color:var(--bg)] text-[color:var(--ink)]">
      <header className="border-b border-[color:var(--line)] bg-[color:var(--panel)]">
        <div className="mx-auto max-w-[1800px] px-4 py-3 lg:px-8">
          <div className="font-mono text-xs uppercase tracking-[0.18em] text-[color:var(--muted)]">
            <span className="text-[color:var(--accent)]">WSPass // maintenance console</span> // project selection
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-[1800px] px-4 py-8 lg:px-8">
        <div className="grid gap-8 xl:grid-cols-[420px_minmax(0,1fr)]">
          <section className="border border-[color:var(--line)] bg-[color:var(--panel)] p-6">
            <p className="font-mono text-xs uppercase tracking-[0.18em] text-[color:var(--accent)]">
              Maintenance
            </p>
            <h1 className="mt-6 max-w-[11ch] text-5xl font-semibold leading-[0.95] tracking-[-0.06em] text-[color:var(--ink-strong)]">
              Choose the project to inspect.
            </h1>
            <p className="mt-6 max-w-[34ch] font-mono text-sm leading-7 text-[color:var(--muted)]">
              This step is the entrypoint for patch remediation, operational alerts, and logs. For
              now, select the project first. Detailed maintenance workflows can expand after the
              project selection rail is solid.
            </p>
          </section>

          <MaintenanceProjectSelector projects={projectItems} />
        </div>
      </main>
    </div>
  );
}
