import Link from "next/link";
import { listAccessibleRepositories } from "../lib/github";
import {
  deriveRunDisplayStatus,
  deriveRunDisplayTone,
  formatDate,
  getProjectsCached,
} from "../lib/consoleData";
import { StatusBadge } from "../components/StatusBadge";

export default async function ProjectsPage() {
  const [projects, repositories] = await Promise.all([
    getProjectsCached(),
    listAccessibleRepositories(),
  ]);

  return (
    <div className="min-h-screen bg-[color:var(--bg)] text-[color:var(--ink)]">
      <header className="border-b border-[color:var(--line)] bg-[color:var(--panel)]">
        <div className="mx-auto max-w-[1800px] px-4 py-3 lg:px-8">
          <div className="font-mono text-xs uppercase tracking-[0.18em] text-[color:var(--muted)]">
            <span className="text-[color:var(--accent)]">WSPass // orchestration console</span>{" "}
            // project selection
          </div>
        </div>
        <div className="mx-auto grid max-w-[1800px] gap-2 px-4 pb-3 sm:grid-cols-2 xl:grid-cols-4 lg:px-8">
          {[
            ["Select", "active", "Choose or create"],
            ["Architecture", "pending", "Pending selection"],
            ["Decompose", "pending", "Pending architecture"],
            ["Build", "pending", "Pending decomposition"],
          ].map(([step, state, detail]) => (
            <div
              key={step}
              className={`border px-3 py-3 ${
                state === "active"
                  ? "border-[color:var(--warning)] bg-[color:var(--panel-strong)]"
                  : "border-[color:var(--line)]"
              }`}
            >
              <div className="flex items-start justify-between gap-3">
                <span className="font-mono text-[11px] uppercase tracking-[0.18em] text-[color:var(--ink-strong)]">
                  {step}
                </span>
                <span
                  className={`font-mono text-[10px] uppercase tracking-[0.16em] ${
                    state === "active" ? "text-[color:var(--warning)]" : "text-[color:var(--muted)]"
                  }`}
                >
                  {state}
                </span>
              </div>
              <p className="mt-2 font-mono text-[10px] uppercase tracking-[0.14em] text-[color:var(--muted)]">
                {detail}
              </p>
            </div>
          ))}
        </div>
      </header>

      <main className="mx-auto grid min-h-[calc(100vh-61px)] max-w-[1800px] gap-8 px-4 py-8 xl:grid-cols-[420px_minmax(0,1fr)] lg:px-8">
        <section className="space-y-6">
          <section className="border border-[color:var(--line)] bg-[color:var(--panel)] p-6">
            <p className="font-mono text-xs uppercase tracking-[0.18em] text-[color:var(--accent)]">
              01 // Choose a project
            </p>
            <h1 className="mt-6 max-w-[10ch] text-5xl font-semibold leading-[0.95] tracking-[-0.06em] text-[color:var(--ink-strong)]">
              Pick an existing project or start a new one.
            </h1>
            <p className="mt-6 max-w-[34ch] font-mono text-sm leading-7 text-[color:var(--muted)]">
              Existing projects go straight into architecture review and refinement. New projects
              continue to a dedicated intake page where you can drop a PRD, org constraints, and
              design guidelines.
            </p>

            <div className="mt-8 space-y-4 border border-[color:var(--line)] bg-[color:var(--panel-soft)] p-5">
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="border border-[color:var(--line)] bg-[color:var(--panel)] p-4">
                  <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-[color:var(--muted)]">
                    Existing projects
                  </p>
                  <p className="mt-3 text-4xl font-semibold text-[color:var(--ink-strong)]">
                    {projects.length}
                  </p>
                </div>
                <div className="border border-[color:var(--line)] bg-[color:var(--panel)] p-4">
                  <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-[color:var(--muted)]">
                    Reachable repos
                  </p>
                  <p className="mt-3 text-4xl font-semibold text-[color:var(--ink-strong)]">
                    {repositories.length}
                  </p>
                </div>
              </div>

              <Link
                href="/projects/new"
                className="block border border-[color:var(--accent)] bg-[color:var(--accent)] px-4 py-4 text-center font-mono text-sm uppercase tracking-[0.18em] text-white transition hover:bg-transparent hover:text-[color:var(--accent)]"
              >
                New project intake
              </Link>
            </div>
          </section>
        </section>

        <section className="border border-[color:var(--line)] bg-[color:var(--panel)]">
          <div className="grid grid-cols-[minmax(0,1.3fr)_120px_180px] gap-4 border-b border-[color:var(--line)] px-4 py-3 font-mono text-[11px] uppercase tracking-[0.18em] text-[color:var(--muted)] md:grid-cols-[minmax(0,1.3fr)_160px_200px]">
            <span>Project</span>
            <span>Runs</span>
            <span>Status</span>
          </div>

          {projects.map((project) => (
            <Link
              key={project.key}
              href={`/projects/${project.latest.run_id}/architecture`}
              className="grid grid-cols-[minmax(0,1.3fr)_120px_180px] items-center gap-4 border-b border-[color:var(--line)] px-4 py-4 transition hover:bg-[color:var(--panel-soft)] md:grid-cols-[minmax(0,1.3fr)_160px_200px]"
            >
              <div className="min-w-0">
                <p className="break-words text-lg font-semibold text-[color:var(--ink-strong)]">
                  {project.label}
                </p>
                <p className="mt-1 font-mono text-[11px] uppercase tracking-[0.14em] text-[color:var(--muted)]">
                  latest {formatDate(project.latest.last_updated_at)}
                </p>
              </div>
              <div className="font-mono text-sm text-[color:var(--ink)]">{project.runs.length}</div>
              <div className="flex items-center justify-start">
                <StatusBadge
                  label={deriveRunDisplayStatus(project.latest)}
                  tone={deriveRunDisplayTone(project.latest)}
                />
              </div>
            </Link>
          ))}

          {projects.length === 0 ? (
            <div className="px-4 py-10 font-mono text-sm uppercase tracking-[0.16em] text-[color:var(--muted)]">
              No projects yet.
            </div>
          ) : null}
        </section>
      </main>
    </div>
  );
}
