import Link from "next/link";
import { notFound } from "next/navigation";
import { sendArchitectureFeedbackAction } from "../../../actions";
import { ArchitectureDiagram } from "../../../components/ArchitectureDiagram";
import { ConsoleChrome } from "../../../components/ConsoleChrome";
import { StatusBadge } from "../../../components/StatusBadge";
import { formatDate, getRunConsoleData } from "../../../lib/consoleData";

export default async function ArchitecturePage(props: {
  params: Promise<{ runId: string }>;
}) {
  const { runId } = await props.params;
  const data = await getRunConsoleData(runId);

  if (!data) {
    notFound();
  }

  const { run, architecturePack, gates, projectLabel } = data;
  const returnTo = `/projects/${runId}/architecture`;
  const messages = run.run.architecture_chat?.messages ?? [];
  const latestUserMessage = [...messages].reverse().find((message) => message.role === "user");
  const latestAssistantMessage = [...messages]
    .reverse()
    .find((message) => message.role === "assistant");
  const refinementRunning =
    run.run.execution?.workflow_name === "phase1-architecture-refinement" &&
    ["queued", "dispatched", "running"].includes(run.run.execution.status);
  const pendingRefinement =
    latestUserMessage !== undefined &&
    (!latestAssistantMessage ||
      new Date(latestUserMessage.created_at).getTime() >
        new Date(latestAssistantMessage.created_at).getTime());

  return (
    <ConsoleChrome run={run.run} projectLabel={projectLabel}>
      <div className="grid gap-6 2xl:grid-cols-[1.55fr_0.95fr]">
        <section className="border border-[color:var(--line)] bg-[color:var(--panel)] p-6">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-[color:var(--accent)]">
                02 // Architecture Console
              </p>
              <h1 className="mt-4 text-4xl font-semibold tracking-[-0.05em] text-[color:var(--ink-strong)]">
                {architecturePack?.architecture.name ?? projectLabel}
              </h1>
            </div>
            {run.run.execution?.backend ? (
              <StatusBadge label={run.run.execution.backend} tone="accent" />
            ) : null}
          </div>

          <p className="mt-5 max-w-[80ch] font-mono text-sm leading-7 text-[color:var(--muted)]">
            {architecturePack?.architecture.description ??
              "Generate the first architecture pack to activate the wireframe and refinement loop."}
          </p>

          <div className="mt-6 flex flex-wrap gap-3">
            {architecturePack ? (
              gates.architectureBlocked ? (
                <div className="border border-[color:var(--warning)] bg-[color:var(--panel-soft)] px-4 py-3 font-mono text-xs uppercase tracking-[0.18em] text-[color:var(--warning)]">
                  Answer clarifying questions before decomposing
                </div>
              ) : (
                <Link
                  href={`/projects/${runId}/decompose`}
                  className="border border-[color:var(--accent)] bg-[color:var(--accent)] px-4 py-3 font-mono text-xs uppercase tracking-[0.18em] text-white transition hover:bg-transparent hover:text-[color:var(--accent)]"
                >
                  Decompose project
                </Link>
              )
            ) : (
              <div className="border border-[color:var(--line)] px-4 py-3 font-mono text-xs uppercase tracking-[0.18em] text-[color:var(--muted)]">
                Architecture generates automatically after intake
              </div>
            )}
          </div>

          {architecturePack && gates.architectureBlocked ? (
            <div className="mt-6 border border-[color:var(--warning)] bg-[color:var(--panel-soft)] p-4">
              <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-[color:var(--warning)]">
                Architecture blocked
              </p>
              <p className="mt-3 text-sm leading-7 text-[color:var(--ink)]">
                Decomposition is blocked until architecture-shaping questions are answered through refinement.
              </p>
              <div className="mt-4 grid gap-3 sm:grid-cols-2">
                <div>
                  <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-[color:var(--muted)]">
                    Defaulted clarifications
                  </p>
                  <p className="mt-2 text-2xl font-semibold text-[color:var(--ink-strong)]">
                    {gates.unresolvedClarifications}
                  </p>
                </div>
                <div>
                  <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-[color:var(--muted)]">
                    Open questions
                  </p>
                  <p className="mt-2 text-2xl font-semibold text-[color:var(--ink-strong)]">
                    {gates.unresolvedOpenQuestions}
                  </p>
                </div>
              </div>
            </div>
          ) : null}

          <div className="mt-6 grid gap-4 lg:grid-cols-4">
            <div className="border border-[color:var(--line)] bg-[color:var(--panel-soft)] p-4">
              <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-[color:var(--muted)]">
                Refinement state
              </p>
              <div className="mt-3">
                <StatusBadge
                  label={
                    refinementRunning
                      ? run.run.execution?.status ?? "running"
                      : pendingRefinement
                        ? "pending_review"
                        : "idle"
                  }
                  tone={
                    refinementRunning
                      ? "accent"
                      : pendingRefinement
                        ? "default"
                        : "success"
                  }
                />
              </div>
              <p className="mt-3 text-sm leading-6 text-[color:var(--ink)]">
                {refinementRunning
                  ? "Claude refinement is currently running. The page will refresh automatically."
                  : pendingRefinement
                    ? "Your latest refinement request is saved but has not produced an assistant-side result yet."
                    : "No pending refinement request."}
              </p>
            </div>
            <div className="border border-[color:var(--line)] bg-[color:var(--panel-soft)] p-4">
              <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-[color:var(--muted)]">
                Active workflow
              </p>
              <p className="mt-3 break-words text-base font-semibold text-[color:var(--ink-strong)]">
                {run.run.execution?.workflow_name ?? "none"}
              </p>
              <p className="mt-2 font-mono text-xs uppercase tracking-[0.16em] text-[color:var(--muted)]">
                {run.run.execution?.backend ?? "idle"}
              </p>
            </div>
            <div className="border border-[color:var(--line)] bg-[color:var(--panel-soft)] p-4">
              <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-[color:var(--muted)]">
                Latest user request
              </p>
              <p className="mt-3 text-sm leading-6 text-[color:var(--ink)]">
                {latestUserMessage
                  ? formatDate(latestUserMessage.created_at)
                  : "No refinement prompt yet."}
              </p>
            </div>
            <div className="border border-[color:var(--line)] bg-[color:var(--panel-soft)] p-4">
              <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-[color:var(--muted)]">
                Architecture updated
              </p>
              <p className="mt-3 text-sm leading-6 text-[color:var(--ink)]">
                {architecturePack ? formatDate(architecturePack.created_at) : "Not generated yet."}
              </p>
            </div>
          </div>

          {run.run.execution?.status === "failed" && run.run.execution.error_message ? (
            <div className="mt-6 border border-[color:var(--danger)] bg-[color:var(--panel-soft)] p-4">
              <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-[color:var(--danger)]">
                Latest refinement failure
              </p>
              <p className="mt-3 whitespace-pre-wrap text-sm leading-7 text-[color:var(--ink)]">
                {run.run.execution.error_message}
              </p>
            </div>
          ) : null}

          {latestUserMessage ? (
            <div className="mt-6 border border-[color:var(--line)] bg-[color:var(--panel-soft)] p-4">
              <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-[color:var(--accent)]">
                Latest submitted refinement
              </p>
              <p className="mt-3 whitespace-pre-wrap text-sm leading-7 text-[color:var(--ink)]">
                {latestUserMessage.content}
              </p>
            </div>
          ) : null}

          {latestAssistantMessage ? (
            <div className="mt-6 border border-[color:var(--line)] bg-[color:var(--panel-soft)] p-4">
              <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-[color:var(--accent)]">
                Latest refinement result
              </p>
              <p className="mt-3 whitespace-pre-wrap text-sm leading-7 text-[color:var(--ink)]">
                {latestAssistantMessage.content}
              </p>
            </div>
          ) : null}

          <div className="mt-6 border border-[color:var(--line)] bg-[color:var(--panel-soft)] p-4">
            {architecturePack ? (
              <ArchitectureDiagram pack={architecturePack} />
            ) : (
              <div className="py-20 font-mono text-sm uppercase tracking-[0.16em] text-[color:var(--muted)]">
                No architecture wireframe yet.
              </div>
            )}
          </div>

          {architecturePack ? (
            <div className="mt-6 grid gap-4 lg:grid-cols-3">
              <div className="border border-[color:var(--line)] bg-[color:var(--panel-soft)] p-4">
                <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-[color:var(--muted)]">Components</p>
                <p className="mt-3 text-3xl font-semibold text-[color:var(--ink-strong)]">
                  {architecturePack.architecture.components.length}
                </p>
              </div>
              <div className="border border-[color:var(--line)] bg-[color:var(--panel-soft)] p-4">
                <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-[color:var(--muted)]">Flows</p>
                <p className="mt-3 text-3xl font-semibold text-[color:var(--ink-strong)]">
                  {architecturePack.architecture.data_flows.length}
                </p>
              </div>
              <div className="border border-[color:var(--line)] bg-[color:var(--panel-soft)] p-4">
                <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-[color:var(--muted)]">Open questions</p>
                <p className="mt-3 text-3xl font-semibold text-[color:var(--ink-strong)]">
                  {architecturePack.open_questions.length}
                </p>
              </div>
            </div>
          ) : null}
        </section>

        <section className="space-y-6">
          <section className="border border-[color:var(--line)] bg-[color:var(--panel)] p-6">
            <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-[color:var(--accent)]">
              Refinement Chat
            </p>
            <p className="mt-4 font-mono text-sm leading-7 text-[color:var(--muted)]">
              Send a simple correction, upload a new PRD, add fresh org constraints, add design
              guidelines, or combine all of them in one refinement pass.
            </p>

            <div className="mt-5 max-h-[420px] space-y-3 overflow-auto border border-[color:var(--line)] bg-[color:var(--panel-soft)] p-4">
              {(run.run.architecture_chat?.messages ?? []).map((message) => (
                <div
                  key={message.id}
                  className={`border px-4 py-4 ${
                    message.role === "user"
                      ? "border-[color:var(--accent)] text-[color:var(--ink-strong)]"
                      : "border-[color:var(--line)] text-[color:var(--ink)]"
                  }`}
                >
                  <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-[color:var(--muted)]">
                    {message.role}
                  </p>
                  <p className="mt-3 whitespace-pre-wrap text-sm leading-7">{message.content}</p>
                </div>
              ))}
            </div>

            <form
              action={sendArchitectureFeedbackAction}
              className="mt-5 space-y-4"
            >
              <input type="hidden" name="run_id" value={runId} />
              <input type="hidden" name="return_to" value={returnTo} />
              <textarea
                name="feedback"
                rows={5}
                disabled={gates.execActive}
                className="w-full border border-[color:var(--line)] bg-[color:var(--panel-soft)] px-4 py-3 text-sm leading-7 outline-none transition focus:border-[color:var(--accent)] disabled:cursor-not-allowed disabled:opacity-50"
                placeholder="Chat update: remove Strapi, replace with AWS-native content services, simplify the API surface, etc."
              />
              <div className="grid gap-4 md:grid-cols-2">
                <div>
                  <label className="block font-mono text-[11px] uppercase tracking-[0.18em] text-[color:var(--muted)]">
                    New PRD Text
                  </label>
                  <textarea
                    name="refinement_prd_text"
                    rows={4}
                    disabled={gates.execActive}
                    className="mt-2 w-full border border-[color:var(--line)] bg-[color:var(--panel-soft)] px-4 py-3 text-sm leading-7 outline-none transition focus:border-[color:var(--accent)] disabled:cursor-not-allowed disabled:opacity-50"
                    placeholder="Optional full or partial PRD update."
                  />
                </div>
                <div>
                  <label className="block font-mono text-[11px] uppercase tracking-[0.18em] text-[color:var(--muted)]">
                    Updated Org Constraints
                  </label>
                  <textarea
                    name="refinement_org_constraints_text"
                    rows={4}
                    disabled={gates.execActive}
                    className="mt-2 w-full border border-[color:var(--line)] bg-[color:var(--panel-soft)] px-4 py-3 text-sm leading-7 outline-none transition focus:border-[color:var(--accent)] disabled:cursor-not-allowed disabled:opacity-50"
                    placeholder="Optional natural-language constraints update."
                  />
                </div>
                <div>
                  <label className="block font-mono text-[11px] uppercase tracking-[0.18em] text-[color:var(--muted)]">
                    Updated Design Guidelines
                  </label>
                  <textarea
                    name="refinement_design_guidelines_text"
                    rows={4}
                    disabled={gates.execActive}
                    className="mt-2 w-full border border-[color:var(--line)] bg-[color:var(--panel-soft)] px-4 py-3 text-sm leading-7 outline-none transition focus:border-[color:var(--accent)] disabled:cursor-not-allowed disabled:opacity-50"
                    placeholder="Optional design or frontend guidance update."
                  />
                </div>
              </div>

              <div className="grid gap-4 md:grid-cols-3">
                <label className="block border border-[color:var(--line)] bg-[color:var(--panel-soft)] p-4">
                  <span className="block font-mono text-[11px] uppercase tracking-[0.18em] text-[color:var(--muted)]">
                    PRD file
                  </span>
                  <span className="mt-2 block text-sm leading-6 text-[color:var(--muted)]">
                    Upload a document to append to the PRD update above.
                  </span>
                  <input
                    name="refinement_prd_file"
                    type="file"
                    disabled={gates.execActive}
                    accept=".txt,.md,.markdown,.rtf,.docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                    className="mt-3 block w-full text-sm file:mr-3 file:border file:border-[color:var(--line)] file:bg-transparent file:px-3 file:py-1 file:font-mono file:text-[11px] file:uppercase file:tracking-[0.14em] disabled:cursor-not-allowed disabled:opacity-50"
                  />
                </label>
                <label className="block border border-[color:var(--line)] bg-[color:var(--panel-soft)] p-4">
                  <span className="block font-mono text-[11px] uppercase tracking-[0.18em] text-[color:var(--muted)]">
                    Org constraints file
                  </span>
                  <span className="mt-2 block text-sm leading-6 text-[color:var(--muted)]">
                    Upload natural-language org constraints to pair with the constraints update.
                  </span>
                  <input
                    name="refinement_org_constraints_file"
                    type="file"
                    disabled={gates.execActive}
                    accept=".txt,.md,.markdown,.rtf,.docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                    className="mt-3 block w-full text-sm file:mr-3 file:border file:border-[color:var(--line)] file:bg-transparent file:px-3 file:py-1 file:font-mono file:text-[11px] file:uppercase file:tracking-[0.14em] disabled:cursor-not-allowed disabled:opacity-50"
                  />
                </label>
                <label className="block border border-[color:var(--line)] bg-[color:var(--panel-soft)] p-4">
                  <span className="block font-mono text-[11px] uppercase tracking-[0.18em] text-[color:var(--muted)]">
                    Design guidelines file
                  </span>
                  <span className="mt-2 block text-sm leading-6 text-[color:var(--muted)]">
                    Upload design, frontend, or linting guidance for this refinement pass.
                  </span>
                  <input
                    name="refinement_design_guidelines_file"
                    type="file"
                    disabled={gates.execActive}
                    accept=".txt,.md,.markdown,.rtf,.docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                    className="mt-3 block w-full text-sm file:mr-3 file:border file:border-[color:var(--line)] file:bg-transparent file:px-3 file:py-1 file:font-mono file:text-[11px] file:uppercase file:tracking-[0.14em] disabled:cursor-not-allowed disabled:opacity-50"
                  />
                </label>
              </div>

              <button
                type="submit"
                disabled={gates.execActive}
                className="w-full border border-[color:var(--accent)] bg-[color:var(--accent)] px-4 py-3 font-mono text-xs uppercase tracking-[0.18em] text-white transition hover:bg-transparent hover:text-[color:var(--accent)] disabled:cursor-not-allowed disabled:opacity-40"
              >
                Submit refinement
              </button>
            </form>
          </section>

          {architecturePack ? (
            <section className="border border-[color:var(--line)] bg-[color:var(--panel)] p-6">
              <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-[color:var(--accent)]">
                Tradeoffs / Open Questions
              </p>
              <div className="mt-5 space-y-5">
                <div>
                  <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-[color:var(--muted)]">Tradeoffs</p>
                  <ul className="mt-3 space-y-2 text-sm leading-7 text-[color:var(--ink)]">
                    {[
                      ...architecturePack.architecture.tradeoffs.pros.map((item) => `Pro: ${item}`),
                      ...architecturePack.architecture.tradeoffs.cons.map((item) => `Con: ${item}`),
                      ...architecturePack.architecture.tradeoffs.risks.map((item) => `Risk: ${item}`),
                    ].map((item) => (
                      <li key={item}>{item}</li>
                    ))}
                  </ul>
                </div>
                <div>
                  <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-[color:var(--muted)]">Open questions</p>
                  <ul className="mt-3 space-y-2 text-sm leading-7 text-[color:var(--ink)]">
                    {(architecturePack.open_questions.length > 0
                      ? architecturePack.open_questions
                      : ["No open questions recorded."]
                    ).map((item) => (
                      <li key={item}>{item}</li>
                    ))}
                  </ul>
                </div>
              </div>
            </section>
          ) : null}
        </section>
      </div>
    </ConsoleChrome>
  );
}
