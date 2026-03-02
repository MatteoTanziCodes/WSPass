import Link from "next/link";

const mockActions = [
  {
    title: "GitHub auth",
    note: "Mock control for GitHub OAuth or PAT connection state.",
  },
  {
    title: "Secret store",
    note: "Mock control for Anthropic key, repo token, and project-scoped secrets.",
  },
  {
    title: "Org presets",
    note: "Mock control for pre-filled natural-language org constraints.",
  },
  {
    title: "Design presets",
    note: "Mock control for saved design and linting guidelines.",
  },
];

export default function AdminPage() {
  return (
    <div className="min-h-screen bg-[color:var(--bg)] text-[color:var(--ink)]">
      <header className="border-b border-[color:var(--line)] bg-[color:var(--panel)]">
        <div className="mx-auto max-w-[1800px] px-4 py-4 lg:px-8">
          <div className="font-mono text-xs uppercase tracking-[0.18em] text-[color:var(--muted)]">
            <span className="text-[color:var(--accent)]">WSPass // admin scaffold</span> // demo controls
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-[1800px] px-4 py-8 lg:px-8">
        <div className="grid gap-8 xl:grid-cols-[360px_minmax(0,1fr)]">
          <section className="border border-[color:var(--line)] bg-[color:var(--panel)] p-6">
            <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-[color:var(--accent)]">
              Admin
            </p>
            <h1 className="mt-6 text-4xl font-semibold tracking-[-0.05em] text-[color:var(--ink-strong)]">
              Global demo controls
            </h1>
            <p className="mt-4 font-mono text-sm leading-7 text-[color:var(--muted)]">
              This is a scaffold for future admin controls. For the demo it exposes placeholder
              buttons for auth, secret storage, and reusable intake defaults.
            </p>
            <Link
              href="/projects"
              className="mt-8 inline-flex border border-[color:var(--line-strong)] px-4 py-3 font-mono text-xs uppercase tracking-[0.18em] text-[color:var(--ink-strong)] transition hover:border-[color:var(--accent)] hover:text-[color:var(--accent)]"
            >
              Back to projects
            </Link>
          </section>

          <section className="grid gap-4 md:grid-cols-2">
            {mockActions.map((action) => (
              <div key={action.title} className="border border-[color:var(--line)] bg-[color:var(--panel)] p-6">
                <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-[color:var(--accent)]">
                  {action.title}
                </p>
                <p className="mt-4 text-sm leading-7 text-[color:var(--ink)]">{action.note}</p>
                <button
                  type="button"
                  className="mt-6 w-full border border-[color:var(--line-strong)] px-4 py-3 font-mono text-xs uppercase tracking-[0.18em] text-[color:var(--ink-strong)]"
                >
                  Mock action
                </button>
              </div>
            ))}
          </section>
        </div>
      </main>
    </div>
  );
}
