import path from "node:path";
import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";

import type {
  ArchitectureChatState,
  BuildOrchestrationState,
  DecompositionClarifyingQuestion,
  DecompositionReviewQuestionAnswerRequest,
  DecompositionReviewArtifact,
  DecompositionReviewState,
  DecompositionState,
  ImplementationIssueStateCollection,
  PlannerRunInput,
  RepoState,
  RunExecutionBackend,
  RunExecution,
  RunExecutionStatus,
  WorkflowName,
  IssueExecutionState,
} from "@pass/shared";
import { DecompositionClarifyingQuestionSchema, DecompositionReviewArtifactSchema } from "@pass/shared";
import { ArtifactsIndexSchema, ArtifactMetadataSchema, RunDetailSchema, RunsIndexSchema } from "./runs.schemas";
import type { ArtifactMetadata, RunDetail, RunRecord } from "./runs.schemas";
import {
  ensureDir,
  readJson,
  sha256Hex,
  sortRunsNewestFirst,
  writeJsonAtomic,
  writeTextAtomic,
} from "./jsonFileStorage";

/**
 * RunStore (filesystem MVP) - Business layer for runs.
 * Owns run persistence and deterministic indexing on disk (no DB).
 *
 * Repo-root folder model:
 * - runs/index.json (run history)
 * - runs/<runId>/run.json (per-run metadata + timestamps)
 * - runs/<runId>/artifacts/ (generated outputs + artifacts/index.json)
 */

export class RunNotFoundError extends Error {
  constructor(runId: string) {
    super(`Run not found: ${runId}`);
    this.name = "RunNotFoundError";
  }
}

export class RunConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RunConflictError";
  }
}

export class InvalidExecutionTransitionError extends Error {
  constructor(from: RunExecutionStatus, to: RunExecutionStatus) {
    super(`Invalid execution status transition: ${from} -> ${to}`);
    this.name = "InvalidExecutionTransitionError";
  }
}

type UpdateRunPatch = {
  status?: RunRecord["status"];
  current_step?: RunRecord["current_step"];
};

type UpdateExecutionPatch = {
  workflow_name?: WorkflowName;
  status: RunExecutionStatus;
  github_run_id?: number;
  github_run_url?: string;
  error_message?: string;
};

function toSafeFilename(name: string): string {
  return name.trim().toLowerCase().replace(/[^a-z0-9._-]+/g, "_");
}

function assertCanMoveExecution(from: RunExecutionStatus, to: RunExecutionStatus) {
  const allowed: Record<RunExecutionStatus, RunExecutionStatus[]> = {
    queued: ["dispatched", "failed"],
    dispatched: ["running", "failed"],
    running: ["succeeded", "failed"],
    succeeded: [],
    failed: [],
  };

  if (!allowed[from].includes(to)) {
    throw new InvalidExecutionTransitionError(from, to);
  }
}

export class RunStore {
  private readonly runsDir: string;
  private readonly indexPath: string;

  constructor(opts?: { runsDir?: string }) {
    const defaultRunsDir = path.resolve(__dirname, "../../../../../runs");
    const configuredRunsDir = opts?.runsDir ?? process.env.RUNS_DIR;
    this.runsDir = configuredRunsDir && configuredRunsDir.trim() ? configuredRunsDir : defaultRunsDir;
    this.indexPath = path.join(this.runsDir, "index.json");
  }

  async createRun(input: PlannerRunInput): Promise<RunDetail> {
    await ensureDir(this.runsDir);

    const now = new Date().toISOString();
    const run: RunDetail = RunDetailSchema.parse({
      run_id: randomUUID(),
      created_at: now,
      status: "created",
      current_step: "created",
      last_updated_at: now,
      step_timestamps: { created: now },
      input,
    });

    const runDir = this.getRunDir(run.run_id);
    await ensureDir(path.join(runDir, "artifacts"));
    await writeJsonAtomic(this.getRunPath(run.run_id), run);

    const index = await this.readOrInitIndex();
    const nextRuns = sortRunsNewestFirst([
      ...index.runs.filter((r) => r.run_id !== run.run_id),
      this.toRunRecord(run),
    ]);

    await writeJsonAtomic(this.indexPath, RunsIndexSchema.parse({ version: 1, runs: nextRuns }));
    return run;
  }

  async listRuns(): Promise<RunRecord[]> {
    const index = await this.readOrInitIndex();
    return sortRunsNewestFirst(index.runs);
  }

  async listRunSummaries(): Promise<
    Array<
      RunRecord & {
        input?: RunDetail["input"];
        execution?: RunDetail["execution"];
        repo_state?: RunDetail["repo_state"];
        decomposition_state?: RunDetail["decomposition_state"];
        decomposition_review_state?: RunDetail["decomposition_review_state"];
        build_state?: RunDetail["build_state"];
      }
    >
  > {
    const index = await this.readOrInitIndex();
    const summaries = await Promise.all(
      index.runs.map(async (record) => {
        const run = await this.getRun(record.run_id);
        return {
          run_id: run.run_id,
          created_at: run.created_at,
          status: run.status,
          current_step: run.current_step,
          last_updated_at: run.last_updated_at,
          input: run.input,
          execution: run.execution,
          repo_state: run.repo_state,
          decomposition_state: run.decomposition_state,
          decomposition_review_state: run.decomposition_review_state,
          build_state: run.build_state,
        };
      })
    );

    return summaries.sort(
      (left, right) =>
        new Date(right.last_updated_at).getTime() - new Date(left.last_updated_at).getTime()
    );
  }

  async getRun(runId: string): Promise<RunDetail> {
    try {
      return await readJson(this.getRunPath(runId), RunDetailSchema);
    } catch {
      throw new RunNotFoundError(runId);
    }
  }

  async deleteRun(runId: string): Promise<void> {
    await this.getRun(runId);

    await fs.rm(this.getRunDir(runId), { recursive: true, force: true });

    const index = await this.readOrInitIndex();
    const nextRuns = index.runs.filter((run) => run.run_id !== runId);
    await writeJsonAtomic(this.indexPath, RunsIndexSchema.parse({ version: 1, runs: nextRuns }));
  }

  async updateRun(runId: string, patch: UpdateRunPatch): Promise<RunDetail> {
    const existing = await this.getRun(runId);
    return this.persistRun({
      ...existing,
      ...patch,
      step_timestamps: this.nextStepTimestamps(existing, patch.current_step),
    });
  }

  async queueExecution(
    runId: string,
    workflowName: WorkflowName,
    backend: RunExecutionBackend = "github_actions"
  ): Promise<RunDetail> {
    const existing = await this.getRun(runId);

    if (!existing.input) {
      throw new RunConflictError("Cannot dispatch a run without persisted planner input.");
    }

    const status = existing.execution?.status;
    if (status && ["queued", "dispatched", "running"].includes(status)) {
      throw new RunConflictError(`Run execution is already active: ${status}`);
    }

    const now = new Date().toISOString();
    return this.persistRun({
      ...existing,
      execution: {
        backend,
        workflow_name: workflowName,
        status: "queued",
        requested_at: now,
      },
    });
  }

  async markExecutionDispatched(runId: string): Promise<RunDetail> {
    return this.updateExecution(runId, { status: "dispatched" });
  }

  async failExecution(runId: string, errorMessage: string): Promise<RunDetail> {
    const existing = await this.getRun(runId);
    const status = existing.execution?.status;

    if (!status) {
      throw new RunConflictError("Cannot fail execution before it exists.");
    }

    if (status === "succeeded" || status === "failed") {
      throw new RunConflictError(`Execution is already terminal: ${status}`);
    }

    return this.updateExecution(runId, { status: "failed", error_message: errorMessage });
  }

  async updateExecution(runId: string, patch: UpdateExecutionPatch): Promise<RunDetail> {
    const existing = await this.getRun(runId);
    const current = existing.execution;

    if (!current) {
      throw new RunConflictError("Execution has not been created for this run.");
    }

    assertCanMoveExecution(current.status, patch.status);

    const now = new Date().toISOString();
    const nextExecution: RunExecution = {
      ...current,
      ...patch,
      workflow_name: patch.workflow_name ?? current.workflow_name,
      started_at: patch.status === "running" ? current.started_at ?? now : current.started_at,
      completed_at:
        patch.status === "succeeded" || patch.status === "failed" ? now : current.completed_at,
    };

    if (patch.status !== "failed") {
      delete nextExecution.error_message;
    }

    return this.persistRun({
      ...existing,
      execution: nextExecution,
    });
  }

  async writeArtifact(
    runId: string,
    name: string,
    payload: unknown,
    contentType: "application/json" | "text/plain" | "text/markdown" = "application/json"
  ): Promise<ArtifactMetadata> {
    await this.getRun(runId);

    const artifactsDir = this.getArtifactsDir(runId);
    await ensureDir(artifactsDir);

    const safe = toSafeFilename(name) || "artifact";
    const createdAt = new Date().toISOString();

    let filename: string;
    let sha: string | undefined;

    if (contentType === "application/json") {
      filename = `${safe}.json`;
      const text = JSON.stringify(payload, null, 2) + "\n";
      sha = sha256Hex(text);
      await writeTextAtomic(path.join(artifactsDir, filename), text);
    } else {
      filename = contentType === "text/markdown" ? `${safe}.md` : `${safe}.txt`;
      const text = typeof payload === "string" ? payload : String(payload);
      sha = sha256Hex(text);
      await writeTextAtomic(path.join(artifactsDir, filename), text);
    }

    const meta: ArtifactMetadata = ArtifactMetadataSchema.parse({
      name,
      filename,
      content_type: contentType,
      sha256: sha,
      created_at: createdAt,
    });

    const index = await this.readOrInitArtifactsIndex(runId);
    const nextArtifacts = [...index.artifacts.filter((a) => a.name !== name), meta].sort((a, b) =>
      a.created_at !== b.created_at
        ? a.created_at < b.created_at
          ? 1
          : -1
        : a.name < b.name
          ? -1
          : a.name > b.name
            ? 1
            : 0
    );

    await writeJsonAtomic(
      this.getArtifactsIndexPath(runId),
      ArtifactsIndexSchema.parse({ version: 1, artifacts: nextArtifacts })
    );
    return meta;
  }

  async listArtifacts(runId: string): Promise<ArtifactMetadata[]> {
    await this.getRun(runId);
    const index = await this.readOrInitArtifactsIndex(runId);
    return index.artifacts;
  }

  async readArtifact(runId: string, name: string): Promise<{ artifact: ArtifactMetadata; payload: unknown }> {
    await this.getRun(runId);

    const index = await this.readOrInitArtifactsIndex(runId);
    const artifact = index.artifacts.find((candidate) => candidate.name === name);
    if (!artifact) {
      throw new RunConflictError(`Artifact not found for run ${runId}: ${name}`);
    }

    const filePath = path.join(this.getArtifactsDir(runId), artifact.filename);
    const raw = await fs.readFile(filePath, "utf8");
    const payload = artifact.content_type === "application/json" ? JSON.parse(raw) : raw;

    return { artifact, payload };
  }

  async listLogs(runId: string): Promise<Array<{ name: string; size_bytes: number; updated_at: string }>> {
    await this.getRun(runId);

    const logsDir = path.join(this.getRunDir(runId), "logs");
    try {
      const entries = await fs.readdir(logsDir, { withFileTypes: true });
      const files = await Promise.all(
        entries
          .filter((entry) => entry.isFile())
          .map(async (entry) => {
            const stats = await fs.stat(path.join(logsDir, entry.name));
            return {
              name: entry.name,
              size_bytes: stats.size,
              updated_at: stats.mtime.toISOString(),
            };
          })
      );

      return files.sort((left, right) => left.name.localeCompare(right.name));
    } catch (error: any) {
      if (error?.code === "ENOENT") {
        return [];
      }
      throw error;
    }
  }

  async readLog(runId: string, logName: string): Promise<{ name: string; payload: string }> {
    await this.getRun(runId);

    const safeName = path.basename(logName);
    const logsDir = path.join(this.getRunDir(runId), "logs");
    const filePath = path.join(logsDir, safeName);

    try {
      const payload = await fs.readFile(filePath, "utf8");
      return {
        name: safeName,
        payload,
      };
    } catch (error: any) {
      if (error?.code === "ENOENT") {
        throw new RunConflictError(`Log not found for run ${runId}: ${safeName}`);
      }
      throw error;
    }
  }

  async updateImplementationState(
    runId: string,
    implementationState: ImplementationIssueStateCollection
  ): Promise<RunDetail> {
    const existing = await this.getRun(runId);
    return this.persistRun({
      ...existing,
      implementation_state: implementationState,
    });
  }

  async updateBuildState(runId: string, buildState: BuildOrchestrationState): Promise<RunDetail> {
    const existing = await this.getRun(runId);
    return this.persistRun({
      ...existing,
      build_state: buildState,
    });
  }

  async updateIssueExecutionState(
    runId: string,
    issueId: string,
    issueState: IssueExecutionState
  ): Promise<RunDetail> {
    const existing = await this.getRun(runId);
    const currentBuildState = existing.build_state;
    if (!currentBuildState) {
      throw new RunConflictError("Build state has not been created for this run.");
    }

    const nextIssues = [
      ...currentBuildState.issues.filter((issue) => issue.issue_id !== issueId),
      issueState,
    ].sort((left, right) => left.issue_id.localeCompare(right.issue_id));

    return this.persistRun({
      ...existing,
      build_state: {
        ...currentBuildState,
        issues: nextIssues,
      },
    });
  }

  async resolveIssueRequirements(
    runId: string,
    issueId: string,
    requirements: Array<{ id: string; status: "open" | "provided" | "resolved"; resolved_at?: string }>
  ): Promise<RunDetail> {
    const existing = await this.getRun(runId);
    const currentBuildState = existing.build_state;
    if (!currentBuildState) {
      throw new RunConflictError("Build state has not been created for this run.");
    }

    const targetIssue = currentBuildState.issues.find((issue) => issue.issue_id === issueId);
    if (!targetIssue) {
      throw new RunConflictError(`Build issue state not found for run ${runId}: ${issueId}`);
    }

    const nextIssue: IssueExecutionState = {
      ...targetIssue,
      secret_requirements: targetIssue.secret_requirements.map((requirement) => {
        const patch = requirements.find((candidate) => candidate.id === requirement.id);
        return patch ? { ...requirement, status: patch.status, resolved_at: patch.resolved_at } : requirement;
      }),
      last_updated_at: new Date().toISOString(),
    };

    return this.updateIssueExecutionState(runId, issueId, nextIssue);
  }

  async answerIssueContextQuestions(
    runId: string,
    issueId: string,
    questions: Array<{
      id: string;
      status: "open" | "answered" | "resolved";
      answer?: string;
      answered_at?: string;
    }>
  ): Promise<RunDetail> {
    const existing = await this.getRun(runId);
    const currentBuildState = existing.build_state;
    if (!currentBuildState) {
      throw new RunConflictError("Build state has not been created for this run.");
    }

    const targetIssue = currentBuildState.issues.find((issue) => issue.issue_id === issueId);
    if (!targetIssue) {
      throw new RunConflictError(`Build issue state not found for run ${runId}: ${issueId}`);
    }

    const nextIssue: IssueExecutionState = {
      ...targetIssue,
      context_questions: targetIssue.context_questions.map((question) => {
        const patch = questions.find((candidate) => candidate.id === question.id);
        return patch
          ? {
              ...question,
              status: patch.status,
              answer: patch.answer,
              answered_at: patch.answered_at,
            }
          : question;
      }),
      last_updated_at: new Date().toISOString(),
    };

    return this.updateIssueExecutionState(runId, issueId, nextIssue);
  }

  async updateRepoState(runId: string, repoState: RepoState): Promise<RunDetail> {
    const existing = await this.getRun(runId);
    return this.persistRun({
      ...existing,
      repo_state: repoState,
    });
  }

  async updateArchitectureChat(runId: string, architectureChat: ArchitectureChatState): Promise<RunDetail> {
    const existing = await this.getRun(runId);
    return this.persistRun({
      ...existing,
      architecture_chat: architectureChat,
    });
  }

  async updateDecompositionState(runId: string, decompositionState: DecompositionState): Promise<RunDetail> {
    const existing = await this.getRun(runId);
    return this.persistRun({
      ...existing,
      decomposition_state: decompositionState,
    });
  }

  async updateDecompositionReviewState(
    runId: string,
    decompositionReviewState: DecompositionReviewState
  ): Promise<RunDetail> {
    const existing = await this.getRun(runId);
    return this.persistRun({
      ...existing,
      decomposition_review_state: decompositionReviewState,
    });
  }

  async answerDecompositionReviewQuestion(
    runId: string,
    answer: DecompositionReviewQuestionAnswerRequest
  ): Promise<RunDetail> {
    const existing = await this.getRun(runId);
    const reviewState = existing.decomposition_review_state;

    if (!reviewState) {
      throw new RunConflictError("Decomposition review state has not been created for this run.");
    }

    const now = new Date().toISOString();
    const updatedQuestions = [...reviewState.questions];
    const targetQuestionId = answer.question_id?.trim();
    const targetGapId = answer.gap_id?.trim();

    let targetIndex = targetQuestionId
      ? updatedQuestions.findIndex((question) => question.id === targetQuestionId)
      : -1;

    if (targetIndex === -1 && targetGapId) {
      targetIndex = updatedQuestions.findIndex((question) =>
        question.derived_from_gap_ids.includes(targetGapId)
      );
    }

    if (targetIndex >= 0) {
      updatedQuestions[targetIndex] = {
        ...updatedQuestions[targetIndex],
        status: "answered",
        answer: answer.answer,
        answered_at: now,
      };
    } else if (targetGapId) {
      const reviewArtifact = await this.readArtifact(runId, "decomposition_review");
      const parsedReview = DecompositionReviewArtifactSchema.parse(
        reviewArtifact.payload
      ) as DecompositionReviewArtifact;
      const targetGap = parsedReview.gaps.find((gap) => gap.id === targetGapId);

      if (!targetGap) {
        throw new RunConflictError(
          `Decomposition review gap not found for run ${runId}: ${targetGapId}`
        );
      }

      const synthesizedQuestion: DecompositionClarifyingQuestion =
        DecompositionClarifyingQuestionSchema.parse({
          id: `dq_gap_${targetGap.id}`,
          prompt: `Resolve coverage gap: ${targetGap.summary}`,
          rationale:
            targetGap.why_blocked ??
            targetGap.resolution_notes ??
            "The iterator still needs this missing information before it can safely complete issue generation.",
          status: "answered",
          answer: answer.answer,
          created_at: now,
          answered_at: now,
          related_requirement_ids: targetGap.affected_requirement_ids,
          related_components: targetGap.affected_components,
          derived_from_gap_ids: [targetGap.id],
          missing_information: targetGap.missing_information,
          evidence: targetGap.evidence,
          recommended_inputs: targetGap.recommended_inputs,
          expected_issue_outcomes: targetGap.expected_issue_outcomes,
        });

      updatedQuestions.push(synthesizedQuestion);
    } else {
      throw new RunConflictError(
        `Decomposition review question not found for run ${runId}: ${targetQuestionId ?? "unknown"}`
      );
    }

    return this.persistRun({
      ...existing,
      decomposition_review_state: {
        ...reviewState,
        status: "blocked",
        questions: updatedQuestions,
        open_question_count: updatedQuestions.filter((question) => question.status === "open").length,
        blocked_reason: updatedQuestions.some((question) => question.status === "open")
          ? reviewState.blocked_reason
          : undefined,
      },
    });
  }

  private async persistRun(run: RunDetail): Promise<RunDetail> {
    const now = new Date().toISOString();
    const validated = RunDetailSchema.parse({
      ...run,
      last_updated_at: now,
    });

    await writeJsonAtomic(this.getRunPath(validated.run_id), validated);

    const index = await this.readOrInitIndex();
    const nextRuns = sortRunsNewestFirst([
      ...index.runs.filter((r) => r.run_id !== validated.run_id),
      this.toRunRecord(validated),
    ]);
    await writeJsonAtomic(this.indexPath, RunsIndexSchema.parse({ version: 1, runs: nextRuns }));

    return validated;
  }

  private nextStepTimestamps(existing: RunDetail, step?: RunRecord["current_step"]) {
    const next = { ...(existing.step_timestamps ?? {}) };
    if (step) {
      next[step] ??= new Date().toISOString();
    }
    return next;
  }

  private toRunRecord(run: RunDetail): RunRecord {
    const { run_id, created_at, status, current_step, last_updated_at } = run;
    return { run_id, created_at, status, current_step, last_updated_at };
  }

  private async readOrInitIndex() {
    try {
      return await readJson(this.indexPath, RunsIndexSchema);
    } catch {
      await ensureDir(this.runsDir);
      const fresh = RunsIndexSchema.parse({ version: 1, runs: [] });
      await writeJsonAtomic(this.indexPath, fresh);
      return fresh;
    }
  }

  private async readOrInitArtifactsIndex(runId: string) {
    const idxPath = this.getArtifactsIndexPath(runId);
    try {
      return await readJson(idxPath, ArtifactsIndexSchema);
    } catch {
      await ensureDir(this.getArtifactsDir(runId));
      const fresh = ArtifactsIndexSchema.parse({ version: 1, artifacts: [] });
      await writeJsonAtomic(idxPath, fresh);
      return fresh;
    }
  }

  private getRunDir(runId: string) {
    return path.join(this.runsDir, runId);
  }

  private getRunPath(runId: string) {
    return path.join(this.getRunDir(runId), "run.json");
  }

  private getArtifactsDir(runId: string) {
    return path.join(this.getRunDir(runId), "artifacts");
  }

  private getArtifactsIndexPath(runId: string) {
    return path.join(this.getArtifactsDir(runId), "index.json");
  }
}
