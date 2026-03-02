import Link from "next/link";
import { notFound } from "next/navigation";
import {
  answerDecompositionReviewQuestionAction,
  dispatchWorkflowAction,
  runBuildReadinessAction,
} from "../../../actions";
import { ConsoleChrome } from "../../../components/ConsoleChrome";
import { StatusBadge } from "../../../components/StatusBadge";
import {
  deriveDecompositionReviewTone,
  deriveDecompositionStatusTone,
  formatDate,
  getRunConsoleData,
  isReviewReadyStatus,
} from "../../../lib/consoleData";

function buttonClass(primary = false) {
  return primary
    ? "border border-[color:var(--accent)] bg-[color:var(--accent)] px-4 py-3 font-mono text-xs uppercase tracking-[0.18em] text-white transition hover:bg-transparent hover:text-[color:var(--accent)] disabled:cursor-not-allowed disabled:opacity-40"
    : "border border-[color:var(--line-strong)] px-4 py-3 font-mono text-xs uppercase tracking-[0.18em] text-[color:var(--ink-strong)] transition hover:border-[color:var(--accent)] hover:text-[color:var(--accent)] disabled:cursor-not-allowed disabled:opacity-40";
}

export default async function DecomposePage(props: {
  params: Promise<{ runId: string }>;
}) {
  const { runId } = await props.params;
  const data = await getRunConsoleData(runId);

  if (!data) {
    notFound();
  }

  const { run, decompositionPlan, decompositionReview, gates, projectLabel } = data;
  const returnTo = `/projects/${runId}/decompose`;
  const repoTarget = run.run.repo_state ?? run.run.input?.repo_target;
  const reviewStatus = run.run.decomposition_review_state?.status ?? "not_started";
  const decompositionRunning =
    run.run.execution?.workflow_name === "phase2-decomposition" &&
    ["queued", "dispatched", "running"].includes(run.run.execution.status);
  const iteratorRunning =
    run.run.execution?.workflow_name === "phase2-decomposition-iterator" &&
    ["queued", "dispatched", "running"].includes(run.run.execution.status);
  const repoProvisionRunning =
    run.run.execution?.workflow_name === "phase2-repo-provision" &&
    ["queued", "dispatched", "running"].includes(run.run.execution.status);
  const openQuestions =
    run.run.decomposition_review_state?.questions.filter((question) => question.status === "open") ?? [];
  const remainingGaps = decompositionReview?.gaps ?? [];
  const hasDecompositionDraft = Boolean(decompositionPlan);
  const primaryActionLabel = hasDecompositionDraft ? "Build" : "Decompose project";
  const reviewSummary =
    decompositionReview?.summary ??
    (run.run.execution?.status === "failed"
      ? `No iterator review summary yet because the latest workflow failed: ${run.run.execution.error_message ?? "unknown error"}`
      : "No iterator review summary yet.");

  return (
    <ConsoleChrome run={run.run} projectLabel={projectLabel}>
      <div className="grid gap-6 2xl:grid-cols-[0.85fr_1.15fr]">
        <section className="space-y-6">
          <section className="border border-[color:var(--line)] bg-[color:var(--panel)] p-6">
            <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-[color:var(--accent)]">
              03 // Decompose
            </p>
            <h1 className="mt-4 text-3xl font-semibold tracking-[-0.05em] text-[color:var(--ink-strong)]">
              Repo resolution and build readiness
            </h1>
            <p className="mt-4 max-w-[70ch] font-mono text-sm leading-7 text-[color:var(--muted)]">
              Resolve the target repository, then let the iterator review and amend the decomposition
              until the project is build-ready. If ambiguity remains, clarifying questions will appear below.
            </p>

            {gates.architectureBlocked ? (
              <div className="mt-6 border border-[color:var(--warning)] bg-[color:var(--panel-soft)] p-4">
                <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-[color:var(--warning)]">
                  Blocked by architecture clarifications
                </p>
                <p className="mt-3 text-sm leading-7 text-[color:var(--ink)]">
                  This stage is locked until the architecture step has no unanswered clarifications or open questions.
                </p>
              </div>
            ) : null}

            <div className="mt-6 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              <div className="border border-[color:var(--line)] bg-[color:var(--panel-soft)] p-4 md:col-span-2 xl:col-span-1">
                <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-[color:var(--muted)]">
                  Repo target
                </p>
                <p className="mt-3 break-all text-base font-semibold leading-8 text-[color:var(--ink-strong)] sm:text-lg">
                  {repoTarget?.repository ?? repoTarget?.name ?? "Not specified"}
                </p>
                <p className="mt-2 break-words font-mono text-xs uppercase tracking-[0.16em] text-[color:var(--muted)]">
                  {repoTarget?.mode?.replaceAll("_", " ") ?? "No repo target"}
                </p>
              </div>
              <div className="border border-[color:var(--line)] bg-[color:var(--panel-soft)] p-4">
                <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-[color:var(--muted)]">
                  Decomposition status
                </p>
                <div className="mt-3">
                  <StatusBadge
                    label={run.run.decomposition_state?.status ?? "not_started"}
                    tone={deriveDecompositionStatusTone(run.run.decomposition_state?.status)}
                  />
                </div>
                <p className="mt-2 font-mono text-xs uppercase tracking-[0.16em] text-[color:var(--muted)]">
                  {run.run.decomposition_state?.work_item_count ?? 0} work items
                </p>
              </div>
              <div className="border border-[color:var(--line)] bg-[color:var(--panel-soft)] p-4">
                <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-[color:var(--muted)]">
                  Build readiness
                </p>
                <div className="mt-3">
                  <StatusBadge
                    label={reviewStatus}
                    tone={deriveDecompositionReviewTone(reviewStatus)}
                  />
                </div>
                <p className="mt-2 font-mono text-xs uppercase tracking-[0.16em] text-[color:var(--muted)]">
                  {run.run.decomposition_review_state?.iteration_count ?? 0} iterations
                </p>
              </div>
            </div>

            <div className="mt-6 grid gap-4 md:grid-cols-2">
              <div className="border border-[color:var(--line)] bg-[color:var(--panel-soft)] p-4">
                <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-[color:var(--muted)]">
                  Active workflow
                </p>
                <p className="mt-3 text-base font-semibold text-[color:var(--ink-strong)]">
                  {run.run.execution?.workflow_name ?? "none"}
                </p>
                <p className="mt-2 font-mono text-xs uppercase tracking-[0.16em] text-[color:var(--muted)]">
                  {run.run.execution?.status ?? "idle"}
                </p>
              </div>
              <div className="border border-[color:var(--line)] bg-[color:var(--panel-soft)] p-4">
                <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-[color:var(--muted)]">
                  Output state
                </p>
                <p className="mt-3 text-base font-semibold text-[color:var(--ink-strong)]">
                  {decompositionPlan
                    ? isReviewReadyStatus(reviewStatus)
                      ? "Build-ready"
                      : iteratorRunning
                        ? "Reviewing build readiness"
                        : decompositionRunning
                          ? "Generating decomposition"
                          : "Draft generated"
                    : iteratorRunning
                      ? "Generating and reviewing"
                      : decompositionRunning
                        ? "Generating decomposition"
                      : repoProvisionRunning
                        ? "Resolving repo first"
                        : "No output yet"}
                </p>
                <p className="mt-2 text-sm leading-6 text-[color:var(--ink)]">
                  {isReviewReadyStatus(reviewStatus)
                    ? "Iterator review completed cleanly. You can move to the build phase."
                    : decompositionPlan
                      ? "The decomposition plan artifact is available below."
                    : gates.architectureBlocked
                      ? "Return to architecture, answer the pending questions, and rerun refinement before decomposition."
                    : iteratorRunning
                      ? "The iterator is reviewing coverage, auto-amending obvious gaps, and checking whether the project is build-ready."
                    : decompositionRunning
                      ? "The agent is reading the current architecture pack and producing work items now."
                      : repoProvisionRunning
                        ? "Repo resolution is still running, so decomposition cannot produce a plan yet."
                        : run.run.execution?.status === "failed"
                          ? "The latest workflow failed. Review the error details below."
                          : "Click the action above to generate the first decomposition draft."}
                </p>
              </div>
            </div>

            {run.run.execution?.status === "failed" && run.run.execution.error_message ? (
              <div className="mt-6 border border-[color:var(--danger)] bg-[color:var(--panel-soft)] p-4">
                <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-[color:var(--danger)]">
                  Latest decomposition failure
                </p>
                <p className="mt-3 whitespace-pre-wrap text-sm leading-7 text-[color:var(--ink)]">
                  {run.run.execution.error_message}
                </p>
              </div>
            ) : null}

            <div className="mt-6 flex flex-wrap gap-3">
              {!run.run.repo_state ? (
                <form action={dispatchWorkflowAction}>
                  <input type="hidden" name="run_id" value={runId} />
                  <input type="hidden" name="workflow_name" value="phase2-repo-provision" />
                  <input type="hidden" name="return_to" value={returnTo} />
                  <button
                    type="submit"
                    disabled={!gates.canResolveRepo}
                    className={buttonClass(true)}
                  >
                    Resolve target repo
                  </button>
                </form>
              ) : isReviewReadyStatus(reviewStatus) ? (
                <>
                  <Link href={`/projects/${runId}/build`} className={buttonClass(true)}>
                    Continue to coding / testing
                  </Link>
                  {decompositionReview?.result !== "clean" ? (
                    <form action={runBuildReadinessAction}>
                      <input type="hidden" name="run_id" value={runId} />
                      <input type="hidden" name="return_to" value={returnTo} />
                      <button
                        type="submit"
                        disabled={!gates.canBuildReview}
                        className={buttonClass(false)}
                      >
                        Re-run build readiness
                      </button>
                    </form>
                  ) : null}
                </>
              ) : (
                <form action={runBuildReadinessAction}>
                  <input type="hidden" name="run_id" value={runId} />
                  <input type="hidden" name="return_to" value={returnTo} />
                  <button
                    type="submit"
                    disabled={!gates.canBuildReview}
                    className={buttonClass(true)}
                  >
                    {primaryActionLabel}
                  </button>
                </form>
              )}
            </div>
          </section>

          <section className="border border-[color:var(--line)] bg-[color:var(--panel)] p-6">
            <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-[color:var(--accent)]">
              Coverage Review
            </p>
            <div className="mt-5 grid gap-4 md:grid-cols-3">
              <div className="border border-[color:var(--line)] bg-[color:var(--panel-soft)] p-4">
                <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-[color:var(--muted)]">
                  Gaps
                </p>
                <p className="mt-3 text-3xl font-semibold text-[color:var(--ink-strong)]">
                  {run.run.decomposition_review_state?.gap_count ?? 0}
                </p>
              </div>
              <div className="border border-[color:var(--line)] bg-[color:var(--panel-soft)] p-4">
                <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-[color:var(--muted)]">
                  Open questions
                </p>
                <p className="mt-3 text-3xl font-semibold text-[color:var(--ink-strong)]">
                  {run.run.decomposition_review_state?.open_question_count ?? 0}
                </p>
              </div>
              <div className="border border-[color:var(--line)] bg-[color:var(--panel-soft)] p-4">
                <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-[color:var(--muted)]">
                  Last reviewed
                </p>
                <p className="mt-3 text-base font-semibold text-[color:var(--ink-strong)]">
                  {formatDate(run.run.decomposition_review_state?.last_reviewed_at)}
                </p>
              </div>
            </div>
            <div className="mt-5 border border-[color:var(--line)] bg-[color:var(--panel-soft)] p-4">
              <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-[color:var(--muted)]">
                Latest iterator summary
              </p>
              <p className="mt-3 whitespace-pre-wrap text-sm leading-7 text-[color:var(--ink)]">
                {reviewSummary}
              </p>
              {decompositionReview?.amendments_applied.length ? (
                <ul className="mt-4 space-y-2 text-sm leading-6 text-[color:var(--ink)]">
                  {decompositionReview.amendments_applied.map((item) => (
                    <li key={item}>- {item}</li>
                  ))}
                </ul>
              ) : null}
            </div>

            {remainingGaps.length > 0 ? (
              <div className="mt-5 border border-[color:var(--danger)] bg-[color:var(--panel-soft)] p-4">
                <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-[color:var(--danger)]">
                  Remaining gaps
                </p>
                <div className="mt-4 space-y-4">
                  {remainingGaps.map((gap) => (
                    <div
                      key={gap.id}
                      className="border border-[color:var(--line)] bg-[color:var(--panel)] p-4"
                    >
                      <div className="flex flex-wrap items-center gap-3">
                        <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-[color:var(--danger)]">
                          {gap.id}
                        </p>
                        <StatusBadge label={gap.severity} tone={gap.severity === "high" ? "danger" : gap.severity === "medium" ? "accent" : "default"} />
                        <span className="font-mono text-[11px] uppercase tracking-[0.18em] text-[color:var(--muted)]">
                          {gap.type.replaceAll("_", " ")}
                        </span>
                      </div>
                      <p className="mt-3 text-sm leading-7 text-[color:var(--ink-strong)]">
                        {gap.summary}
                      </p>
                      {gap.resolution_notes ? (
                        <p className="mt-2 text-sm leading-7 text-[color:var(--ink)]">
                          {gap.resolution_notes}
                        </p>
                      ) : null}
                      <div className="mt-4 grid gap-4 md:grid-cols-2">
                        <div>
                          <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-[color:var(--muted)]">
                            Affected requirements
                          </p>
                          <p className="mt-2 break-words font-mono text-xs uppercase tracking-[0.14em] text-[color:var(--ink)]">
                            {gap.affected_requirement_ids.length > 0
                              ? gap.affected_requirement_ids.join(", ")
                              : "none"}
                          </p>
                        </div>
                        <div>
                          <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-[color:var(--muted)]">
                            Affected components
                          </p>
                          <p className="mt-2 break-words font-mono text-xs uppercase tracking-[0.14em] text-[color:var(--ink)]">
                            {gap.affected_components.length > 0
                              ? gap.affected_components.join(", ")
                              : "none"}
                          </p>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ) : null}
          </section>

          {openQuestions.length > 0 ? (
            <section className="border border-[color:var(--warning)] bg-[color:var(--panel)] p-6">
              <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-[color:var(--warning)]">
                Clarifying Questions
              </p>
              <p className="mt-4 max-w-[72ch] font-mono text-sm leading-7 text-[color:var(--muted)]">
                Iterator review is blocked. Answer these questions and the system will rerun refinement,
                decomposition, and coverage review automatically.
              </p>
              <div className="mt-5 space-y-5">
                {openQuestions.map((question) => (
                  <form
                    key={question.id}
                    action={answerDecompositionReviewQuestionAction}
                    className="border border-[color:var(--line)] bg-[color:var(--panel-soft)] p-4"
                  >
                    <input type="hidden" name="run_id" value={runId} />
                    <input type="hidden" name="question_id" value={question.id} />
                    <input type="hidden" name="return_to" value={returnTo} />
                    <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-[color:var(--warning)]">
                      {question.id}
                    </p>
                    <p className="mt-3 text-base font-semibold text-[color:var(--ink-strong)]">
                      {question.prompt}
                    </p>
                    <p className="mt-2 text-sm leading-7 text-[color:var(--ink)]">
                      {question.rationale}
                    </p>
                    <textarea
                      name="answer"
                      rows={4}
                      disabled={!gates.canAnswerReviewQuestions}
                      className="mt-4 w-full border border-[color:var(--line)] bg-[color:var(--panel)] px-4 py-3 text-sm leading-7 outline-none transition focus:border-[color:var(--accent)] disabled:cursor-not-allowed disabled:opacity-50"
                      placeholder="Answer the clarifying question here."
                    />
                    <div className="mt-4 grid gap-4 md:grid-cols-3">
                      <div>
                        <label className="block font-mono text-[11px] uppercase tracking-[0.18em] text-[color:var(--muted)]">
                          PRD update
                        </label>
                        <textarea
                          name="iterator_prd_text"
                          rows={3}
                          disabled={!gates.canAnswerReviewQuestions}
                          className="mt-2 w-full border border-[color:var(--line)] bg-[color:var(--panel)] px-4 py-3 text-sm leading-7 outline-none transition focus:border-[color:var(--accent)] disabled:cursor-not-allowed disabled:opacity-50"
                          placeholder="Optional PRD update."
                        />
                      </div>
                      <div>
                        <label className="block font-mono text-[11px] uppercase tracking-[0.18em] text-[color:var(--muted)]">
                          Org constraints update
                        </label>
                        <textarea
                          name="iterator_org_constraints_text"
                          rows={3}
                          disabled={!gates.canAnswerReviewQuestions}
                          className="mt-2 w-full border border-[color:var(--line)] bg-[color:var(--panel)] px-4 py-3 text-sm leading-7 outline-none transition focus:border-[color:var(--accent)] disabled:cursor-not-allowed disabled:opacity-50"
                          placeholder="Optional org constraints update."
                        />
                      </div>
                      <div>
                        <label className="block font-mono text-[11px] uppercase tracking-[0.18em] text-[color:var(--muted)]">
                          Design guidelines update
                        </label>
                        <textarea
                          name="iterator_design_guidelines_text"
                          rows={3}
                          disabled={!gates.canAnswerReviewQuestions}
                          className="mt-2 w-full border border-[color:var(--line)] bg-[color:var(--panel)] px-4 py-3 text-sm leading-7 outline-none transition focus:border-[color:var(--accent)] disabled:cursor-not-allowed disabled:opacity-50"
                          placeholder="Optional design guidance update."
                        />
                      </div>
                    </div>
                    <div className="mt-4 grid gap-4 md:grid-cols-3">
                      <label className="block border border-[color:var(--line)] bg-[color:var(--panel)] p-4">
                        <span className="block font-mono text-[11px] uppercase tracking-[0.18em] text-[color:var(--muted)]">
                          PRD file
                        </span>
                        <input
                          name="iterator_prd_file"
                          type="file"
                          disabled={!gates.canAnswerReviewQuestions}
                          accept=".txt,.md,.markdown,.rtf,.docx"
                          className="mt-3 block w-full text-sm file:mr-3 file:border file:border-[color:var(--line)] file:bg-transparent file:px-3 file:py-1 file:font-mono file:text-[11px] file:uppercase file:tracking-[0.14em] disabled:cursor-not-allowed disabled:opacity-50"
                        />
                      </label>
                      <label className="block border border-[color:var(--line)] bg-[color:var(--panel)] p-4">
                        <span className="block font-mono text-[11px] uppercase tracking-[0.18em] text-[color:var(--muted)]">
                          Org constraints file
                        </span>
                        <input
                          name="iterator_org_constraints_file"
                          type="file"
                          disabled={!gates.canAnswerReviewQuestions}
                          accept=".txt,.md,.markdown,.rtf,.docx"
                          className="mt-3 block w-full text-sm file:mr-3 file:border file:border-[color:var(--line)] file:bg-transparent file:px-3 file:py-1 file:font-mono file:text-[11px] file:uppercase file:tracking-[0.14em] disabled:cursor-not-allowed disabled:opacity-50"
                        />
                      </label>
                      <label className="block border border-[color:var(--line)] bg-[color:var(--panel)] p-4">
                        <span className="block font-mono text-[11px] uppercase tracking-[0.18em] text-[color:var(--muted)]">
                          Design guidelines file
                        </span>
                        <input
                          name="iterator_design_guidelines_file"
                          type="file"
                          disabled={!gates.canAnswerReviewQuestions}
                          accept=".txt,.md,.markdown,.rtf,.docx"
                          className="mt-3 block w-full text-sm file:mr-3 file:border file:border-[color:var(--line)] file:bg-transparent file:px-3 file:py-1 file:font-mono file:text-[11px] file:uppercase file:tracking-[0.14em] disabled:cursor-not-allowed disabled:opacity-50"
                        />
                      </label>
                    </div>
                    <button
                      type="submit"
                      disabled={!gates.canAnswerReviewQuestions}
                      className="mt-4 border border-[color:var(--accent)] bg-[color:var(--accent)] px-4 py-3 font-mono text-xs uppercase tracking-[0.18em] text-white transition hover:bg-transparent hover:text-[color:var(--accent)] disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      Submit answer
                    </button>
                  </form>
                ))}
              </div>
            </section>
          ) : null}

          <section className="border border-[color:var(--line)] bg-[color:var(--panel)] p-6">
            <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-[color:var(--accent)]">
              Target Repo
            </p>
            <div className="mt-5 grid gap-4 md:grid-cols-2">
              <div className="border border-[color:var(--line)] bg-[color:var(--panel-soft)] p-4">
                <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-[color:var(--muted)]">
                  Repository
                </p>
                <p className="mt-3 break-all text-base font-semibold text-[color:var(--ink-strong)]">
                  {run.run.repo_state?.repository ?? "Unresolved"}
                </p>
              </div>
              <div className="border border-[color:var(--line)] bg-[color:var(--panel-soft)] p-4">
                <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-[color:var(--muted)]">
                  Visibility
                </p>
                <p className="mt-3 text-base font-semibold text-[color:var(--ink-strong)]">
                  {run.run.repo_state?.visibility ?? repoTarget?.visibility ?? "n/a"}
                </p>
              </div>
              <div className="border border-[color:var(--line)] bg-[color:var(--panel-soft)] p-4">
                <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-[color:var(--muted)]">
                  Status
                </p>
                <p className="mt-3 text-base font-semibold text-[color:var(--ink-strong)]">
                  {run.run.repo_state?.status ?? "awaiting repo provision"}
                </p>
              </div>
              <div className="border border-[color:var(--line)] bg-[color:var(--panel-soft)] p-4">
                <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-[color:var(--muted)]">
                  Configured
                </p>
                <p className="mt-3 text-base font-semibold text-[color:var(--ink-strong)]">
                  {formatDate(run.run.repo_state?.configured_at)}
                </p>
              </div>
            </div>
          </section>
        </section>

        <section className="border border-[color:var(--line)] bg-[color:var(--panel)]">
          <div className="border-b border-[color:var(--line)] px-6 py-4">
            <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-[color:var(--accent)]">
              Decomposition Draft
            </p>
            <p className="mt-2 font-mono text-sm leading-7 text-[color:var(--muted)]">
              Small async work units for agents. The iterator reviews this draft before build can begin.
            </p>
          </div>

          {decompositionPlan ? (
            <>
              <div className="border-b border-[color:var(--line)] px-6 py-4">
                <p className="text-base leading-7 text-[color:var(--ink)]">
                  {decompositionPlan.summary}
                </p>
              </div>
              <div className="hidden xl:block">
                <div className="grid grid-cols-[180px_minmax(0,1.7fr)_120px_100px_220px] border-b border-[color:var(--line)] px-6 py-3 font-mono text-[11px] uppercase tracking-[0.18em] text-[color:var(--muted)]">
                  <span>ID</span>
                  <span>Work item</span>
                  <span>Category</span>
                  <span>Size</span>
                  <span>Dependencies</span>
                </div>
                {decompositionPlan.work_items.map((item) => (
                  <div
                    key={item.id}
                    className="grid grid-cols-[180px_minmax(0,1.7fr)_120px_100px_220px] gap-4 border-b border-[color:var(--line)] px-6 py-4"
                  >
                    <div className="break-all font-mono text-xs uppercase tracking-[0.16em] text-[color:var(--muted)]">
                      {item.id}
                    </div>
                    <div className="min-w-0">
                      <p className="text-base font-semibold text-[color:var(--ink-strong)]">
                        {item.title}
                      </p>
                      <p className="mt-2 text-sm leading-6 text-[color:var(--ink)]">
                        {item.summary}
                      </p>
                    </div>
                    <div className="font-mono text-xs uppercase tracking-[0.16em] text-[color:var(--ink)]">
                      {item.category}
                    </div>
                    <div className="font-mono text-xs uppercase tracking-[0.16em] text-[color:var(--ink)]">
                      {item.size}
                    </div>
                    <div className="break-all font-mono text-xs uppercase tracking-[0.16em] text-[color:var(--muted)]">
                      {item.depends_on.length > 0 ? item.depends_on.join(", ") : "none"}
                    </div>
                  </div>
                ))}
              </div>
              <div className="xl:hidden">
                {decompositionPlan.work_items.map((item) => (
                  <div key={item.id} className="border-b border-[color:var(--line)] px-6 py-5">
                    <div className="grid gap-4 sm:grid-cols-2">
                      <div>
                        <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-[color:var(--muted)]">
                          ID
                        </p>
                        <p className="mt-2 break-all font-mono text-xs uppercase tracking-[0.14em] text-[color:var(--ink)]">
                          {item.id}
                        </p>
                      </div>
                      <div className="grid grid-cols-2 gap-4 sm:justify-items-end">
                        <div>
                          <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-[color:var(--muted)]">
                            Category
                          </p>
                          <p className="mt-2 font-mono text-xs uppercase tracking-[0.14em] text-[color:var(--ink)]">
                            {item.category}
                          </p>
                        </div>
                        <div>
                          <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-[color:var(--muted)]">
                            Size
                          </p>
                          <p className="mt-2 font-mono text-xs uppercase tracking-[0.14em] text-[color:var(--ink)]">
                            {item.size}
                          </p>
                        </div>
                      </div>
                    </div>

                    <div className="mt-4">
                      <p className="text-lg font-semibold text-[color:var(--ink-strong)]">
                        {item.title}
                      </p>
                      <p className="mt-3 text-sm leading-7 text-[color:var(--ink)]">
                        {item.summary}
                      </p>
                    </div>

                    <div className="mt-4">
                      <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-[color:var(--muted)]">
                        Dependencies
                      </p>
                      <p className="mt-2 break-all font-mono text-xs uppercase tracking-[0.14em] text-[color:var(--muted)]">
                        {item.depends_on.length > 0 ? item.depends_on.join(", ") : "none"}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            </>
          ) : (
            <div className="px-6 py-12">
              <p className="font-mono text-sm uppercase tracking-[0.16em] text-[color:var(--muted)]">
                {iteratorRunning
                  ? "Iterator review is running."
                  : decompositionRunning
                    ? "Decomposition is running."
                  : repoProvisionRunning
                    ? "Waiting for repo resolution."
                    : "No decomposition draft yet."}
              </p>
              <p className="mt-4 max-w-[60ch] text-sm leading-7 text-[color:var(--ink)]">
                  {iteratorRunning
                    ? "The iterator is checking decomposition coverage, removing stale work, adding obvious missing slices, and deciding whether the project is build-ready."
                  : decompositionRunning
                    ? "The agent reads the current architecture_pack artifact, generates a decomposition_plan artifact, and this table will populate automatically when that artifact is written."
                  : gates.architectureBlocked
                    ? "Architecture clarifications are still unresolved, so decomposition cannot start yet."
                  : repoProvisionRunning
                    ? "This stage cannot produce work items until the target repository has been resolved."
                    : "Once you trigger Build, the iterator will generate or refresh decomposition as needed and this table will populate automatically."}
              </p>
            </div>
          )}
        </section>
      </div>
    </ConsoleChrome>
  );
}
