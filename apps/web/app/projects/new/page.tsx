import Link from "next/link";
import { ProjectIntakeForm } from "../../components/ProjectIntakeForm";
import { StatusBadge } from "../../components/StatusBadge";
import { listAccessibleRepositories } from "../../lib/github";

export default async function NewProjectPage() {
  const repositories = await listAccessibleRepositories();

  return (
    <div className="min-h-screen bg-[color:var(--bg)] text-[color:var(--ink)]">
      <header className="border-b border-[color:var(--line)] bg-[color:var(--panel)]">
        <div className="mx-auto max-w-[1800px] px-4 py-3 lg:px-8">
          <div className="font-mono text-xs uppercase tracking-[0.18em] text-[color:var(--muted)]">
            <span className="text-[color:var(--accent)]">WSPass // orchestration console</span>{" "}
            // new project intake
          </div>
        </div>
        <div className="mx-auto grid max-w-[1800px] gap-2 px-4 pb-3 sm:grid-cols-2 xl:grid-cols-4 lg:px-8">
          {[
            ["Select", "completed", "Mode selected"],
            ["Architecture", "active", "Collecting inputs"],
            ["Decompose", "pending", "Pending architecture"],
            ["Build", "pending", "Pending decomposition"],
          ].map(([step, state, detail]) => (
            <div
              key={step}
              className={`border px-3 py-3 ${
                state === "active"
                  ? "border-[color:var(--warning)] bg-[color:var(--panel-strong)]"
                  : state === "completed"
                    ? "border-[color:var(--success)] bg-[color:var(--panel-soft)]"
                    : "border-[color:var(--line)]"
              }`}
            >
              <div className="flex items-start justify-between gap-3">
                <span className="font-mono text-[11px] uppercase tracking-[0.18em] text-[color:var(--ink-strong)]">
                  {step}
                </span>
                <span
                  className={`font-mono text-[10px] uppercase tracking-[0.16em] ${
                    state === "active"
                      ? "text-[color:var(--warning)]"
                      : state === "completed"
                        ? "text-[color:var(--success)]"
                        : "text-[color:var(--muted)]"
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

      <main className="mx-auto grid min-h-[calc(100vh-61px)] max-w-[1800px] gap-8 px-4 py-8 xl:grid-cols-[480px_minmax(0,1fr)] lg:px-8">
        <section className="border border-[color:var(--line)] bg-[color:var(--panel)] p-6">
          <p className="font-mono text-xs uppercase tracking-[0.18em] text-[color:var(--accent)]">
            01 // New project
          </p>
          <h1 className="mt-6 max-w-[11ch] text-5xl font-semibold leading-[0.95] tracking-[-0.06em] text-[color:var(--ink-strong)]">
            Drop the PRD. Start the rail.
          </h1>
          <p className="mt-6 max-w-[36ch] font-mono text-sm leading-7 text-[color:var(--muted)]">
            Use natural language for the PRD, org constraints, and design guidelines. WSPass will
            normalize them, generate the first architecture automatically, and keep that context
            pinned across later stages.
          </p>
          <div className="mt-8">
            <Link
              href="/projects"
              className="inline-flex border border-[color:var(--line-strong)] px-4 py-3 font-mono text-xs uppercase tracking-[0.18em] text-[color:var(--ink-strong)] transition hover:border-[color:var(--accent)] hover:text-[color:var(--accent)]"
            >
              Back to project selection
            </Link>
          </div>
        </section>

        <section className="border border-[color:var(--line)] bg-[color:var(--panel)] p-6">
          <ProjectIntakeForm repositories={repositories} />
        </section>
      </main>
    </div>
  );
}
