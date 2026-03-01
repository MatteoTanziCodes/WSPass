import {
  approveDecompositionAction,
  createRunAction,
  dispatchWorkflowAction,
  sendArchitectureFeedbackAction,
} from "./actions";
import { ArchitectureDiagram } from "./components/ArchitectureDiagram";
import { DarkModeToggle } from "./components/DarkModeToggle";
import { LiveRefreshShell } from "./components/LiveRefreshShell";
import { listAccessibleRepositories } from "./lib/github";
import { getArchitecturePack, getDecompositionPlan, getRun, listRuns } from "./lib/passApi";

function formatDate(value?: string) {
  if (!value) {
    return "n/a";
  }
  return new Date(value).toLocaleString();
}

function StatusBadge({ label }: { label: string }) {
  return (
    <span className="inline-flex rounded-full border border-[color:var(--line)] bg-[color:var(--panel-strong)] px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-[color:var(--ink)]">
      {label.replaceAll("_", " ")}
    </span>
  );
}

type RunEnvelope = NonNullable<Awaited<ReturnType<typeof getRun>>>;

function deriveProjectKey(run: RunEnvelope) {
  return (
    run.run.repo_state?.repository ??
    run.run.input?.repo_target?.repository ??
    run.run.input?.repo_target?.name ??
    run.run.run_id
  );
}

function deriveProjectLabel(run: RunEnvelope) {
  return run.run.repo_state?.repository ?? run.run.input?.repo_target?.repository ?? run.run.input?.repo_target?.name ?? "Untitled project";
}

function buildProjectGroups(runs: RunEnvelope[]) {
  const grouped = new Map<
    string,
    {
      key: string;
      label: string;
      repoUrl?: string;
      latest: RunEnvelope;
      runs: RunEnvelope[];
    }
  >();

  for (const run of runs) {
    const key = deriveProjectKey(run);
    const existing = grouped.get(key);
    if (!existing) {
      grouped.set(key, {
        key,
        label: deriveProjectLabel(run),
        repoUrl: run.run.repo_state?.html_url,
        latest: run,
        runs: [run],
      });
      continue;
    }

    existing.runs.push(run);
    if (new Date(run.run.last_updated_at).getTime() > new Date(existing.latest.run.last_updated_at).getTime()) {
      existing.latest = run;
      existing.label = deriveProjectLabel(run);
      existing.repoUrl = run.run.repo_state?.html_url ?? existing.repoUrl;
    }
  }

  return [...grouped.values()]
    .map((project) => ({
      ...project,
      runs: project.runs.sort(
        (left, right) =>
          new Date(right.run.last_updated_at).getTime() - new Date(left.run.last_updated_at).getTime()
      ),
    }))
    .sort(
      (left, right) =>
        new Date(right.latest.run.last_updated_at).getTime() -
        new Date(left.latest.run.last_updated_at).getTime()
    );
}

function deriveGates(run: RunEnvelope, hasArchitecturePack: boolean, hasDecompositionPlan: boolean) {
  const execActive = ["queued", "dispatched", "running"].includes(
    run.run.execution?.status ?? ""
  );
  const repoResolved = Boolean(run.run.repo_state);
  const decompStatus = run.run.decomposition_state?.status;
  const decompApproved = decompStatus === "approved";
  const decompDraft = decompStatus === "draft";

  return {
    execActive,                    // something is already running
    canRunPlanner: !execActive,
    canRefineArchitecture: !execActive && hasArchitecturePack,
    canResolveRepo: !execActive && hasArchitecturePack,
    canDecompose: !execActive && hasArchitecturePack && repoResolved,
    canApproveDecomposition: !execActive && decompDraft,
    canSyncIssues: !execActive && decompApproved && repoResolved,
    decompIsStale: hasArchitecturePack && decompStatus === "not_started" && hasDecompositionPlan,
  };
}

function PipelineTimeline({ run }: { run: RunEnvelope["run"] }) {
  const steps = [
    { key: "created",                label: "Created" },
    { key: "plan",                    label: "Architecture" },
    { key: "repo",                    label: "Repo" },
    { key: "decompose",               label: "Decompose" },
    { key: "approve",                 label: "Approved" },
    { key: "export",                  label: "Issues synced" },
  ] as const;

  return (
    <div className="flex items-center gap-1 overflow-x-auto">
      {steps.map((step, i) => {
        const reached = Boolean(run.step_timestamps?.[step.key]);
        const isCurrent = run.current_step === step.key;
        return (
          <div key={step.key} className="flex items-center gap-1">
            {i > 0 && <div className={`h-px w-5 ${reached ? "bg-[color:var(--accent)]" : "bg-[color:var(--line)]"}`} />}
            <div
              title={run.step_timestamps?.[step.key] ? new Date(run.step_timestamps[step.key]).toLocaleString() : "Not reached"}
              className={`rounded-full px-2 py-1 text-[10px] font-semibold uppercase tracking-wide whitespace-nowrap ${
                isCurrent  ? "bg-[color:var(--accent)] text-white" :
                reached    ? "bg-[color:var(--panel-strong)] text-[color:var(--ink-strong)]" :
                             "bg-transparent text-[color:var(--muted)] opacity-50"
              }`}
            >
              {step.label}
            </div>
          </div>
        );
      })}
    </div>
  );
}

export default async function Home(props: {
  searchParams?: Promise<{ runId?: string; project?: string }>;
}) {
  const searchParams = (await props.searchParams) ?? {};
  const runs = await listRuns();
  const detailedRuns = (await Promise.all(runs.map((run) => getRun(run.run_id)))).filter(
    (run): run is RunEnvelope => Boolean(run)
  );
  const projects = buildProjectGroups(detailedRuns);
  const repositories = await listAccessibleRepositories();

  const selectedRunFromQuery = searchParams.runId
    ? detailedRuns.find((run) => run.run.run_id === searchParams.runId)
    : undefined;
  const selectedProject =
    (selectedRunFromQuery && projects.find((project) => project.runs.some((run) => run.run.run_id === selectedRunFromQuery.run.run_id))) ??
    (searchParams.project ? projects.find((project) => project.key === searchParams.project) : undefined) ??
    projects[0];
  const selectedRunResponse =
    (searchParams.runId
      ? selectedProject?.runs.find((run) => run.run.run_id === searchParams.runId)
      : undefined) ??
    selectedProject?.latest ??
    null;

  const selectedRunId = selectedRunResponse?.run.run_id;
  const selectedProjectKey = selectedProject?.key;
  const architecturePack = selectedRunId ? await getArchitecturePack(selectedRunId) : null;
  const decompositionPlan = selectedRunId ? await getDecompositionPlan(selectedRunId) : null;
  const gates = selectedRunResponse
  ? deriveGates(
      selectedRunResponse,
      Boolean(architecturePack),
      Boolean(decompositionPlan)
    )
  : null;

  return (
    <div className="min-h-screen bg-[color:var(--bg)] text-[color:var(--ink)]">
      <div className="mx-auto flex min-h-screen max-w-[1720px] flex-col gap-6 px-4 py-4 lg:px-6 xl:px-8 2xl:flex-row 2xl:items-start 2xl:py-6">
        <aside className="w-full rounded-[28px] border border-[color:var(--line)] bg-[color:var(--panel)] p-4 shadow-[0_30px_80px_rgba(13,17,23,0.08)] lg:p-5 2xl:sticky 2xl:top-6 2xl:max-w-[360px] 2xl:self-start">
          <div className="mb-2 flex items-center justify-end gap-2">
            <DarkModeToggle />
          </div>
          
          <div className="mb-6">
            <p className="text-[11px] font-semibold uppercase tracking-[0.26em] text-[color:var(--accent-ink)]">
              WSPass
            </p>
            <h1 className="mt-3 text-3xl font-semibold tracking-[-0.04em] text-[color:var(--ink-strong)]">
              Project Console
            </h1>
            <p className="mt-3 text-sm leading-6 text-[color:var(--muted)]">
              Navigate by repository or project context, not raw run IDs. The latest architecture, refinement
              thread, decomposition plan, and delivery actions all stay anchored to that project.
            </p>
          </div>

          <div className="grid gap-6 xl:grid-cols-[minmax(0,0.98fr)_minmax(0,1.02fr)] 2xl:grid-cols-1">
            <form
              action={createRunAction}
              className="space-y-4 rounded-[24px] border border-[color:var(--line)] bg-[color:var(--panel-soft)] p-4"
            >
              <div>
                <label
                  htmlFor="prd_text"
                  className="mb-2 block text-xs font-semibold uppercase tracking-[0.18em] text-[color:var(--muted)]"
                >
                  PRD
                </label>
                <textarea
                  id="prd_text"
                  name="prd_text"
                  rows={8}
                  required
                  className="w-full rounded-[20px] border border-[color:var(--line)] bg-white/70 px-4 py-3 text-sm leading-6 outline-none transition focus:border-[color:var(--accent)] focus:bg-white"
                  placeholder="Paste the plaintext PRD here."
                />
              </div>
              <div>
                <label
                  htmlFor="org_constraints_yaml"
                  className="mb-2 block text-xs font-semibold uppercase tracking-[0.18em] text-[color:var(--muted)]"
                >
                  Org Constraints <span className="normal-case font-normal opacity-60">(optional YAML)</span>
                </label>
                <textarea
                  id="org_constraints_yaml"
                  name="org_constraints_yaml"
                  rows={3}
                  className="w-full rounded-[20px] border border-[color:var(--line)] bg-white/70 px-4 py-3 font-mono text-xs leading-6 outline-none transition focus:border-[color:var(--accent)] focus:bg-white dark:bg-black/20"
                  placeholder={"preferred_cloud: aws\npreferred_iac: terraform..."}
                />
              </div>

              <div>
                <label
                  htmlFor="repo_mode"
                  className="mb-2 block text-xs font-semibold uppercase tracking-[0.18em] text-[color:var(--muted)]"
                >
                  Repo Mode
                </label>
                <select
                  id="repo_mode"
                  name="repo_mode"
                  defaultValue="existing"
                  className="w-full rounded-2xl border border-[color:var(--line)] bg-white/70 px-4 py-3 text-sm outline-none transition focus:border-[color:var(--accent)] focus:bg-white"
                >
                  <option value="existing">Use existing repo</option>
                  <option value="new">Create new repo</option>
                </select>
              </div>

              <div>
                <label
                  htmlFor="existing_repository"
                  className="mb-2 block text-xs font-semibold uppercase tracking-[0.18em] text-[color:var(--muted)]"
                >
                  Existing Repo
                </label>
                <select
                  id="existing_repository"
                  name="existing_repository"
                  className="w-full rounded-2xl border border-[color:var(--line)] bg-white/70 px-4 py-3 text-sm outline-none transition focus:border-[color:var(--accent)] focus:bg-white"
                >
                  <option value="">Select a repo the token can access</option>
                  {repositories.map((repo) => (
                    <option key={repo.id} value={repo.full_name}>
                      {repo.full_name}
                    </option>
                  ))}
                </select>
                <p className="mt-2 text-xs text-[color:var(--muted)]">
                  {repositories.length > 0
                    ? `${repositories.length} reachable repositories loaded from GitHub.`
                    : "No repositories could be loaded from GitHub with the current token."}
                </p>
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <label
                    htmlFor="repo_name"
                    className="mb-2 block text-xs font-semibold uppercase tracking-[0.18em] text-[color:var(--muted)]"
                  >
                    New Repo Name
                  </label>
                  <input
                    id="repo_name"
                    name="repo_name"
                    className="w-full rounded-2xl border border-[color:var(--line)] bg-white/70 px-4 py-3 text-sm outline-none transition focus:border-[color:var(--accent)] focus:bg-white"
                    placeholder="storefront-platform"
                  />
                </div>
                <div>
                  <label
                    htmlFor="repo_visibility"
                    className="mb-2 block text-xs font-semibold uppercase tracking-[0.18em] text-[color:var(--muted)]"
                  >
                    Visibility
                  </label>
                  <select
                    id="repo_visibility"
                    name="repo_visibility"
                    defaultValue="private"
                    className="w-full rounded-2xl border border-[color:var(--line)] bg-white/70 px-4 py-3 text-sm outline-none transition focus:border-[color:var(--accent)] focus:bg-white"
                  >
                    <option value="private">Private</option>
                    <option value="public">Public</option>
                  </select>
                </div>
              </div>

              <button
                type="submit"
                className="w-full rounded-full bg-[color:var(--accent)] px-5 py-3 text-sm font-semibold text-white transition hover:bg-[color:var(--accent-ink)]"
              >
                Create project run
              </button>
            </form>

            <div className="min-w-0">
              <div className="mb-3 flex items-center justify-between">
                <h2 className="text-sm font-semibold uppercase tracking-[0.18em] text-[color:var(--muted)]">
                  Projects
                </h2>
                <span className="text-xs text-[color:var(--muted)]">{projects.length}</span>
              </div>
              <div className="grid gap-3 sm:grid-cols-2 2xl:grid-cols-1">
                {projects.map((project) => {
                  const active = selectedProjectKey === project.key;
                  return (
                    <a
                      key={project.key}
                      href={`/?project=${encodeURIComponent(project.key)}&runId=${project.latest.run.run_id}`}
                      className={`block rounded-[24px] border px-4 py-4 transition ${
                        active
                          ? "border-[color:var(--accent)] bg-[color:var(--panel-strong)]"
                          : "border-[color:var(--line)] bg-[color:var(--panel-soft)] hover:border-[color:var(--accent)]/60"
                      }`}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="truncate text-sm font-semibold text-[color:var(--ink-strong)]">{project.label}</p>
                          <p className="mt-1 text-xs text-[color:var(--muted)]">
                            {project.runs.length} run{project.runs.length === 1 ? "" : "s"} · latest {formatDate(project.latest.run.last_updated_at)}
                          </p>
                        </div>
                        <StatusBadge label={project.latest.run.status} />
                      </div>
                    </a>
                  );
                })}
              </div>
            </div>
          </div>
        </aside>

        <main className="min-w-0 flex-1">
          {selectedRunResponse && selectedProject ? (
            <LiveRefreshShell
              executionStatus={selectedRunResponse.run.execution?.status}
              workflowName={selectedRunResponse.run.execution?.workflow_name}
            >
              {selectedRunResponse.run.execution?.status === "failed" && (
                <div className="rounded-[24px] border border-red-300/60 bg-red-50 px-5 py-4 text-sm text-red-800">
                  <p className="font-semibold">Last workflow failed</p>
                  <p className="mt-1 font-mono text-xs opacity-80">
                    {selectedRunResponse.run.execution.workflow_name} · {selectedRunResponse.run.execution.error_message ?? "No error message recorded"}
                  </p>
                  {selectedRunResponse.run.execution.github_run_url && (
                    <a
                      href={selectedRunResponse.run.execution.github_run_url}
                      target="_blank"
                      rel="noreferrer"
                      className="mt-2 inline-block text-xs font-semibold underline"
                    >
                      View GitHub Actions log →
                    </a>
                  )}
                </div>
              )}
              <div className="space-y-6">
                <section className="rounded-[32px] border border-[color:var(--line)] bg-[color:var(--panel)] p-6 shadow-[0_40px_100px_rgba(13,17,23,0.09)]">
                  <div className="flex flex-col gap-6 xl:flex-row xl:items-start xl:justify-between">
                    <div className="max-w-3xl">
                      <p className="text-[11px] font-semibold uppercase tracking-[0.26em] text-[color:var(--accent-ink)]">
                        Project Overview
                      </p>
                      <h2 className="mt-3 break-words text-3xl font-semibold tracking-[-0.05em] text-[color:var(--ink-strong)] lg:text-4xl">
                        {selectedProject.label}
                      </h2>
                      <p className="mt-4 text-sm leading-7 text-[color:var(--muted)]">
                        {architecturePack?.prd.summary ??
                          "Generate the architecture, refine it live through the agent chat, resolve the target repo, then approve decomposition before syncing any issues."}
                      </p>
                    </div>

                    <div className="grid gap-3 [grid-template-columns:repeat(auto-fit,minmax(170px,1fr))]">
                      <div className="min-w-0 rounded-[24px] border border-[color:var(--line)] bg-[color:var(--panel-soft)] px-4 py-4">
                        <p className="text-xs uppercase tracking-[0.16em] text-[color:var(--muted)]">Project status</p>
                        <p className="mt-3 break-words text-lg font-semibold text-[color:var(--ink-strong)]">
                          {selectedRunResponse.run.status.replaceAll("_", " ")}
                        </p>
                      </div>
                      <div className="min-w-0 rounded-[24px] border border-[color:var(--line)] bg-[color:var(--panel-soft)] px-4 py-4">
                        <p className="text-xs uppercase tracking-[0.16em] text-[color:var(--muted)]">Current step</p>
                        <p className="mt-3 break-words text-lg font-semibold text-[color:var(--ink-strong)]">
                          {selectedRunResponse.run.current_step}
                        </p>
                      </div>
                      <div className="min-w-0 rounded-[24px] border border-[color:var(--line)] bg-[color:var(--panel-soft)] px-4 py-4">
                        <p className="text-xs uppercase tracking-[0.16em] text-[color:var(--muted)]">Active workflow</p>
                        <p className="mt-3 break-words text-sm font-semibold text-[color:var(--ink-strong)]">
                          {selectedRunResponse.run.execution?.workflow_name ?? "not dispatched"}
                        </p>
                      </div>
                      <div className="min-w-0 rounded-[24px] border border-[color:var(--line)] bg-[color:var(--panel-soft)] px-4 py-4">
                        <p className="text-xs uppercase tracking-[0.16em] text-[color:var(--muted)]">Target repo</p>
                        <p className="mt-3 break-all text-sm font-semibold text-[color:var(--ink-strong)]">
                          {selectedRunResponse.run.repo_state?.repository ??
                            selectedRunResponse.run.input?.repo_target?.repository ??
                            selectedRunResponse.run.input?.repo_target?.name ??
                            "not resolved"}
                        </p>
                      </div>
                    </div>
                  </div>

                  <div className="mt-4">
                    <PipelineTimeline run={selectedRunResponse.run} />
                  </div>

                  <div className="mt-6 grid gap-4 xl:grid-cols-[1.2fr_0.8fr]">
                    <div className="rounded-[24px] border border-[color:var(--line)] bg-[color:var(--panel-soft)] p-4">
                      <p className="text-xs uppercase tracking-[0.16em] text-[color:var(--muted)]">Run history for this project</p>
                      <div className="mt-4 grid gap-3 sm:grid-cols-2 2xl:grid-cols-3">
                        {selectedProject.runs.map((run) => {
                          const active = run.run.run_id === selectedRunResponse.run.run_id;
                          return (
                            <a
                              key={run.run.run_id}
                              href={`/?project=${encodeURIComponent(selectedProject.key)}&runId=${run.run.run_id}`}
                              className={`rounded-[18px] border px-4 py-3 text-sm transition ${
                                active
                                  ? "border-[color:var(--accent)] bg-white text-[color:var(--ink-strong)]"
                                  : "border-[color:var(--line)] bg-transparent text-[color:var(--muted)] hover:border-[color:var(--accent)]/60"
                              }`}
                            >
                              <div className="font-semibold">{formatDate(run.run.created_at)}</div>
                              <div className="mt-1 text-xs uppercase tracking-[0.16em]">{run.run.status}</div>
                            </a>
                          );
                        })}
                      </div>
                    </div>

                    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-1 2xl:grid-cols-2">
                      {[
                        { workflow: "phase1-planner",               label: "Generate architecture", canRun: gates?.canRunPlanner },
                        { workflow: "phase2-repo-provision",         label: "Resolve repo",          canRun: gates?.canResolveRepo },
                        { workflow: "phase2-decomposition",          label: "Generate decomposition",canRun: gates?.canDecompose },
                        { workflow: "phase2-implementation",         label: "Sync approved issues",  canRun: gates?.canSyncIssues },
                      ].map(({ workflow, label, canRun }) => (
                        <form key={workflow} action={dispatchWorkflowAction}>
                          <input type="hidden" name="run_id" value={selectedRunResponse.run.run_id} />
                          <input type="hidden" name="project_key" value={selectedProject.key} />
                          <input type="hidden" name="workflow_name" value={workflow} />
                          <button
                            type="submit"
                            disabled={!canRun}
                            title={!canRun ? (gates?.execActive ? "A workflow is already running" : "Prerequisites not met") : undefined}
                            className="w-full rounded-full border border-[color:var(--line)] bg-[color:var(--panel-soft)] px-4 py-2 text-sm font-semibold text-[color:var(--ink-strong)] transition hover:border-[color:var(--accent)] hover:text-[color:var(--accent-ink)] disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:border-[color:var(--line)] disabled:hover:text-[color:var(--ink-strong)]"
                          >
                            {label}
                          </button>
                        </form>
                      ))}

                      <form action={approveDecompositionAction}>
                        <input type="hidden" name="run_id" value={selectedRunResponse.run.run_id} />
                        <input type="hidden" name="project_key" value={selectedProject.key} />
                        <button
                          type="submit"
                          disabled={!gates?.canApproveDecomposition}
                          title={!gates?.canApproveDecomposition ? "Decomposition must be in draft state to approve" : undefined}
                          className="w-full rounded-full bg-[color:var(--accent-ink)] px-4 py-2 text-sm font-semibold text-white transition hover:bg-[color:var(--accent)] disabled:cursor-not-allowed disabled:opacity-40"
                        >
                          Approve decomposition
                        </button>
                      </form>
                    </div>
                  </div>
                </section>

                <section className="grid gap-6 [@media(min-width:1680px)]:grid-cols-[1.62fr_0.82fr]">
                  <div className="rounded-[32px] border border-[color:var(--line)] bg-[color:var(--panel)] p-6 shadow-[0_40px_100px_rgba(13,17,23,0.08)]">
                    <div className="flex items-center justify-between gap-4">
                      <div>
                        <p className="text-[11px] font-semibold uppercase tracking-[0.26em] text-[color:var(--accent-ink)]">
                          Architecture Wireframe
                        </p>
                        <h3 className="mt-2 text-2xl font-semibold tracking-[-0.04em] text-[color:var(--ink-strong)]">
                          {architecturePack?.architecture.name ?? "No architecture generated yet"}
                        </h3>
                      </div>
                      {architecturePack && <StatusBadge label="live diagram" />}
                    </div>

                    {architecturePack ? (
                      <>
                        <p className="mt-4 max-w-4xl text-sm leading-7 text-[color:var(--muted)]">
                          {architecturePack.architecture.description}
                        </p>
                        <div className="mt-6">
                          <ArchitectureDiagram pack={architecturePack} />
                        </div>
                        <div className="mt-6 grid gap-4 xl:grid-cols-2">
                          <div className="rounded-[24px] border border-[color:var(--line)] bg-[color:var(--panel-soft)] p-4">
                            <p className="text-xs uppercase tracking-[0.16em] text-[color:var(--muted)]">Data flows</p>
                            <ul className="mt-4 space-y-3 text-sm leading-6 text-[color:var(--ink-strong)]">
                              {architecturePack.architecture.data_flows.length > 0 ? (
                                architecturePack.architecture.data_flows.map((flow) => <li key={flow}>{flow}</li>)
                              ) : (
                                <li>No data flows generated yet.</li>
                              )}
                            </ul>
                          </div>
                          <div className="rounded-[24px] border border-[color:var(--line)] bg-[color:var(--panel-soft)] p-4">
                            <p className="text-xs uppercase tracking-[0.16em] text-[color:var(--muted)]">Tradeoffs</p>
                            <ul className="mt-4 space-y-3 text-sm leading-6 text-[color:var(--ink-strong)]">
                              {[
                                ...architecturePack.architecture.tradeoffs.pros.map((item) => `Pro: ${item}`),
                                ...architecturePack.architecture.tradeoffs.cons.map((item) => `Con: ${item}`),
                                ...architecturePack.architecture.tradeoffs.risks.map((item) => `Risk: ${item}`),
                              ].map((item) => (
                                <li key={item}>{item}</li>
                              ))}
                            </ul>
                          </div>
                        </div>
                      </>
                    ) : (
                      <p className="mt-6 text-sm leading-7 text-[color:var(--muted)]">
                        Dispatch the planner to generate the first architecture pack. Once it exists, this area will
                        render it as a layered diagram and update automatically while workflows are still running.
                      </p>
                    )}
                  </div>

                  <div className="space-y-6">
                    <section className="rounded-[32px] border border-[color:var(--line)] bg-[color:var(--panel)] p-6 shadow-[0_40px_100px_rgba(13,17,23,0.08)]">
                      <p className="text-[11px] font-semibold uppercase tracking-[0.26em] text-[color:var(--accent-ink)]">
                        Architecture Chat
                      </p>
                      <h3 className="mt-2 text-2xl font-semibold tracking-[-0.04em] text-[color:var(--ink-strong)]">
                        Refine live
                      </h3>
                      <p className="mt-3 text-sm leading-7 text-[color:var(--muted)]">
                        Submit changing feature requirements or architecture corrections here. The refinement workflow
                        updates the architecture pack and this diagram will refresh automatically while it runs.
                      </p>
                      <div className="mt-5 max-h-[360px] space-y-3 overflow-auto pr-1">
                        {(selectedRunResponse.run.architecture_chat?.messages ?? []).map((message) => (
                          <div
                            key={message.id}
                            className={`rounded-[22px] px-4 py-4 text-sm leading-6 ${
                              message.role === "user"
                                ? "bg-[color:var(--accent)] text-white"
                                : "border border-[color:var(--line)] bg-[color:var(--panel-soft)] text-[color:var(--ink-strong)]"
                            }`}
                          >
                            <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.16em] opacity-80">
                              {message.role}
                            </p>
                            <p>{message.content}</p>
                          </div>
                        ))}
                      </div>
                      <form action={sendArchitectureFeedbackAction} className="mt-5 space-y-3">
                        <input type="hidden" name="run_id" value={selectedRunResponse.run.run_id} />
                        <input type="hidden" name="project_key" value={selectedProject.key} />
                        <textarea
                          name="feedback"
                          rows={5}
                          required
                          className="w-full rounded-[22px] border border-[color:var(--line)] bg-[color:var(--panel-soft)] px-4 py-3 text-sm leading-6 outline-none transition focus:border-[color:var(--accent)]"
                          placeholder="Add a new feature, point out an issue in the architecture, or change the project requirements."
                        />
                        <button
                          type="submit"
                          className="w-full rounded-full bg-[color:var(--accent)] px-5 py-3 text-sm font-semibold text-white transition hover:bg-[color:var(--accent-ink)]"
                        >
                          Send refinement request
                        </button>
                      </form>
                    </section>

                    <section className="rounded-[32px] border border-[color:var(--line)] bg-[color:var(--panel)] p-6 shadow-[0_40px_100px_rgba(13,17,23,0.08)]">
                      <p className="text-[11px] font-semibold uppercase tracking-[0.26em] text-[color:var(--accent-ink)]">
                        Decomposition
                      </p>
                      <h3 className="mt-2 text-2xl font-semibold tracking-[-0.04em] text-[color:var(--ink-strong)]">
                        Async work map
                      </h3>
                      {gates?.decompIsStale && (
                        <div className="mt-4 rounded-[18px] border border-amber-300/60 bg-amber-50 px-4 py-3 text-sm text-amber-800">
                          ⚠ Architecture was refined — regenerate decomposition to keep it in sync.
                        </div>
                      )}
                      {decompositionPlan ? (
                        <>
                          <p className="mt-4 text-sm leading-7 text-[color:var(--muted)]">{decompositionPlan.summary}</p>
                          <div className="mt-4 flex flex-wrap gap-2">
                            <StatusBadge label={selectedRunResponse.run.decomposition_state?.status ?? "draft"} />
                            <StatusBadge label={`${decompositionPlan.work_items.length} items`} />
                          </div>
                          <div className="mt-5 max-h-[360px] space-y-3 overflow-auto pr-1">
                            {decompositionPlan.work_items.map((item) => (
                              <div
                                key={item.id}
                                className="rounded-[22px] border border-[color:var(--line)] bg-[color:var(--panel-soft)] px-4 py-4"
                              >
                                <div className="flex items-start justify-between gap-3">
                                  <div>
                                    <p className="text-sm font-semibold text-[color:var(--ink-strong)]">{item.title}</p>
                                    <p className="mt-1 text-xs uppercase tracking-[0.16em] text-[color:var(--muted)]">
                                      {item.category} / {item.size} / {item.component}
                                    </p>
                                  </div>
                                  <span className="text-xs text-[color:var(--muted)]">{item.id}</span>
                                </div>
                                <p className="mt-3 text-sm leading-6 text-[color:var(--muted)]">{item.summary}</p>
                              </div>
                            ))}
                          </div>
                        </>
                      ) : (
                        <p className="mt-4 text-sm leading-7 text-[color:var(--muted)]">
                          Generate decomposition after the architecture is stable. This backlog should be approved
                          before GitHub issue sync and implementation.
                        </p>
                      )}
                    </section>
                  </div>
                </section>
              </div>
            </LiveRefreshShell>
          ) : (
            <section className="rounded-[32px] border border-[color:var(--line)] bg-[color:var(--panel)] p-10 shadow-[0_40px_100px_rgba(13,17,23,0.08)]">
              <p className="text-[11px] font-semibold uppercase tracking-[0.26em] text-[color:var(--accent-ink)]">
                No project selected
              </p>
              <h2 className="mt-3 text-4xl font-semibold tracking-[-0.05em] text-[color:var(--ink-strong)]">
                Start from a PRD
              </h2>
              <p className="mt-4 max-w-2xl text-sm leading-7 text-[color:var(--muted)]">
                Use the project console on the left to create a planning run. Once a project exists, this dashboard
                will keep its architecture, refinement thread, decomposition plan, and delivery actions anchored to the
                repo context instead of a single run.
              </p>
            </section>
          )}
        </main>
      </div>
    </div>
  );
}
