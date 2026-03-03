import type { FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";

import {
  AnswerDecompositionReviewQuestionRequestSchema,
  AnswerDecompositionReviewQuestionResponseSchema,
  CreateRunRequestSchema,
  CreateRunResponseSchema,
  DeleteRunResponseSchema,
  DispatchRunRequestSchema,
  DispatchRunParamsSchema,
  DispatchRunResponseSchema,
  GetArtifactParamsSchema,
  GetArtifactResponseSchema,
  GetRunLogParamsSchema,
  GetRunResponseSchema,
  ListRunLogsResponseSchema,
  ListRunsResponseSchema,
  RunIdParamsSchema,
  UpdateExecutionRequestSchema,
  UpdateExecutionResponseSchema,
  UpdateArchitectureChatRequestSchema,
  UpdateArchitectureChatResponseSchema,
  UpdateBuildStateRequestSchema,
  UpdateBuildStateResponseSchema,
  UpdateDecompositionReviewStateRequestSchema,
  UpdateDecompositionReviewStateResponseSchema,
  UpdateDecompositionStateRequestSchema,
  UpdateDecompositionStateResponseSchema,
  UpdateIssueContextQuestionsRequestSchema,
  UpdateIssueContextQuestionsResponseSchema,
  UpdateIssueExecutionStateRequestSchema,
  UpdateIssueExecutionStateResponseSchema,
  UpdateIssueRequirementsRequestSchema,
  UpdateIssueRequirementsResponseSchema,
  UpdateImplementationStateRequestSchema,
  UpdateImplementationStateResponseSchema,
  UpdateRepoStateRequestSchema,
  UpdateRepoStateResponseSchema,
  UpdateRunRequestSchema,
  UpdateRunResponseSchema,
  UploadArtifactRequestSchema,
  UploadArtifactResponseSchema,
  IssueExecutionParamsSchema,
} from "./runs.dtos";
import {
  GitHubActionsConfigError,
  GitHubActionsDispatchError,
  GitHubActionsClient,
} from "./githubActionsClient";
import {
  LocalWorkflowRunner,
  LocalWorkflowRunnerError,
  shouldUseLocalWorkflowExecution,
} from "./localWorkflowRunner";
import type { RunStore } from "./runStore";
import {
  InvalidExecutionTransitionError,
  RunConflictError,
  RunNotFoundError,
} from "./runStore";
import { ArchitecturePackSchema } from "@pass/shared";

function resolveApiBaseUrl(request: FastifyRequest) {
  return process.env.PASS_API_PUBLIC_BASE_URL ?? `${request.protocol}://${request.headers.host}`;
}

export function createRunsController(deps: {
  runStore: RunStore;
}) {
  const { runStore } = deps;

  async function ensureBuildStateStarted(runId: string) {
    const run = await runStore.getRun(runId);
    const now = new Date().toISOString();
    const currentBuildState = run.build_state;

    if (currentBuildState?.status === "running" || currentBuildState?.status === "planning") {
      return;
    }

    await runStore.updateBuildState(runId, {
      status: "planning",
      started_at: currentBuildState?.started_at ?? now,
      completed_at: undefined,
      current_ring: currentBuildState?.current_ring ?? 0,
      max_parallel_workers: currentBuildState?.max_parallel_workers ?? 3,
      issues: currentBuildState?.issues ?? [],
      blocked_reason: undefined,
      summary: "Starting build orchestrator.",
      audit_artifact_name: currentBuildState?.audit_artifact_name,
    });
  }

  async function failBuildState(runId: string, reason: string) {
    const run = await runStore.getRun(runId);
    const now = new Date().toISOString();
    const currentBuildState = run.build_state;

    await runStore.updateBuildState(runId, {
      status: "failed",
      started_at: currentBuildState?.started_at ?? now,
      completed_at: now,
      current_ring: currentBuildState?.current_ring ?? 0,
      max_parallel_workers: currentBuildState?.max_parallel_workers ?? 3,
      issues: currentBuildState?.issues ?? [],
      blocked_reason: reason,
      summary: reason,
      audit_artifact_name: currentBuildState?.audit_artifact_name,
    });
    await runStore.updateRun(runId, {
      status: "failed",
      current_step: "build",
    });
  }

  async function assertArchitectureClarificationsResolved(runId: string) {
    const artifact = await runStore.readArtifact(runId, "architecture_pack");
    const pack = ArchitecturePackSchema.parse(artifact.payload);
    const hasOpenQuestions = pack.open_questions.length > 0;

    if (hasOpenQuestions) {
      throw new RunConflictError("Cannot proceed beyond architecture while open questions remain unanswered.");
    }
  }

  return {
    async createRun(request: FastifyRequest, reply: FastifyReply) {
      try {
        const input = CreateRunRequestSchema.parse((request as { body?: unknown }).body);
        const run = await runStore.createRun(input);
        return reply.code(201).send(CreateRunResponseSchema.parse({ run }));
      } catch (err: any) {
        if (err instanceof z.ZodError) {
          return reply.code(400).send({ error: "bad_request", issues: err.issues });
        }
        throw err;
      }
    },

    async listRuns(_request: FastifyRequest, reply: FastifyReply) {
      const runs = await runStore.listRunSummaries();
      return reply.send(ListRunsResponseSchema.parse({ total: runs.length, runs }));
    },

    async getRun(request: FastifyRequest, reply: FastifyReply) {
      try {
        const { runId } = RunIdParamsSchema.parse(request.params);
        const run = await runStore.getRun(runId);
        const artifacts = await runStore.listArtifacts(runId);
        return reply.send(GetRunResponseSchema.parse({ run, artifacts }));
      } catch (err: any) {
        if (err instanceof RunNotFoundError) {
          return reply.code(404).send({ error: "run_not_found", message: err.message });
        }
        if (err instanceof z.ZodError) {
          return reply.code(400).send({ error: "bad_request", issues: err.issues });
        }
        throw err;
      }
    },

    async deleteRun(request: FastifyRequest, reply: FastifyReply) {
      try {
        const { runId } = RunIdParamsSchema.parse(request.params);
        await runStore.deleteRun(runId);
        return reply.send(DeleteRunResponseSchema.parse({ run_id: runId, deleted: true }));
      } catch (err: any) {
        if (err instanceof RunNotFoundError) {
          return reply.code(404).send({ error: "run_not_found", message: err.message });
        }
        if (err instanceof z.ZodError) {
          return reply.code(400).send({ error: "bad_request", issues: err.issues });
        }
        throw err;
      }
    },

    async updateRun(request: FastifyRequest, reply: FastifyReply) {
      try {
        const { runId } = RunIdParamsSchema.parse(request.params);
        const patch = UpdateRunRequestSchema.parse((request as { body?: unknown }).body);
        const run = await runStore.updateRun(runId, patch);
        return reply.send(UpdateRunResponseSchema.parse({ run }));
      } catch (err: any) {
        if (err instanceof RunNotFoundError) {
          return reply.code(404).send({ error: "run_not_found", message: err.message });
        }
        if (err instanceof z.ZodError) {
          return reply.code(400).send({ error: "bad_request", issues: err.issues });
        }
        throw err;
      }
    },

    async dispatchRun(request: FastifyRequest, reply: FastifyReply) {
      let runId = "";
      let queued = false;
      let workflowName:
        | "phase1-planner"
        | "phase1-architecture-refinement"
        | "phase2-repo-provision"
        | "phase2-decomposition"
        | "phase2-decomposition-iterator"
        | "phase2-implementation"
        | "phase3-build-orchestrator"
        | "phase3-issue-execution"
        | "phase3-pr-supervisor" =
        "phase1-planner";
      let issueId: string | undefined;

      try {
        const body = DispatchRunRequestSchema.parse((request as { body?: unknown }).body ?? {});
        issueId = body.issue_id;
        if ((request.params as Record<string, unknown>)?.workflowName) {
          const params = DispatchRunParamsSchema.parse(request.params);
          runId = params.runId;
          workflowName = params.workflowName;
        } else {
          runId = RunIdParamsSchema.parse(request.params).runId;
        }

        if (workflowName === "phase2-implementation") {
          await runStore.readArtifact(runId, "architecture_pack");
          const run = await runStore.getRun(runId);
          if (!run.repo_state) {
            throw new RunConflictError("Cannot dispatch implementation before target repo is resolved.");
          }
          if (!run.decomposition_review_state || run.decomposition_review_state.status !== "build_ready") {
            throw new RunConflictError("Cannot dispatch implementation before decomposition review is build-ready.");
          }
        }

        if (workflowName === "phase3-build-orchestrator") {
          await runStore.readArtifact(runId, "architecture_pack");
          const run = await runStore.getRun(runId);
          if (!run.repo_state) {
            throw new RunConflictError("Cannot start build before target repo is resolved.");
          }
          if (!run.decomposition_review_state || run.decomposition_review_state.status !== "synced") {
            throw new RunConflictError("Cannot start build before issues are synced.");
          }
          if (!run.implementation_state?.issues.length) {
            throw new RunConflictError("Cannot start build without synced implementation issues.");
          }
          await ensureBuildStateStarted(runId);
        }

        if (workflowName === "phase3-issue-execution" || workflowName === "phase3-pr-supervisor") {
          if (!issueId) {
            throw new RunConflictError(`${workflowName} requires issue_id.`);
          }
          const run = await runStore.getRun(runId);
          const issueExists = run.build_state?.issues.some((issue) => issue.issue_id === issueId);
          if (!issueExists) {
            throw new RunConflictError(`Issue ${issueId} is not part of this run's build state.`);
          }
        }

        if (
          workflowName === "phase2-decomposition" ||
          workflowName === "phase2-decomposition-iterator" ||
          workflowName === "phase1-architecture-refinement" ||
          workflowName === "phase3-issue-execution" ||
          workflowName === "phase3-pr-supervisor"
        ) {
          await runStore.readArtifact(runId, "architecture_pack");
        }

        if (workflowName === "phase1-architecture-refinement") {
          // Can't refine without a pack
          await runStore.readArtifact(runId, "architecture_pack");
        }

        if (workflowName === "phase2-repo-provision") {
          // Can't provision a repo without architecture
          await runStore.readArtifact(runId, "architecture_pack");
          await assertArchitectureClarificationsResolved(runId);
        }

        if (workflowName === "phase2-decomposition") {
          // Check repo is resolved
          const run = await runStore.getRun(runId);
          await assertArchitectureClarificationsResolved(runId);
          if (!run.repo_state) {
            throw new RunConflictError("Cannot generate decomposition before target repo is resolved.");
          }
        }

        if (workflowName === "phase2-decomposition-iterator") {
          const run = await runStore.getRun(runId);
          await assertArchitectureClarificationsResolved(runId);
          if (!run.repo_state) {
            throw new RunConflictError("Cannot review decomposition before target repo is resolved.");
          }
        }

        const useLocalExecution = shouldUseLocalWorkflowExecution();
        await runStore.queueExecution(
          runId,
          workflowName,
          useLocalExecution ? "local_process" : "github_actions"
        );
        queued = true;

        if (useLocalExecution) {
          const localWorkflowRunner = new LocalWorkflowRunner({ runStore });
          await localWorkflowRunner.dispatchWorkflow({
            workflowName,
            runId,
            issueId,
          });
        } else {
          const githubActionsClient = new GitHubActionsClient();
          await githubActionsClient.dispatchWorkflow({
            workflowName,
            runId,
            apiBaseUrl: resolveApiBaseUrl(request),
            issueId,
          });
        }

        const dispatchedRun = await runStore.markExecutionDispatched(runId);
        return reply.send(
          DispatchRunResponseSchema.parse({
            run_id: runId,
            execution: dispatchedRun.execution,
          })
        );
      } catch (err: any) {
        if (err instanceof GitHubActionsDispatchError) {
          const failedRun = await runStore.failExecution(runId, err.message);
          if (workflowName === "phase3-build-orchestrator") {
            await failBuildState(runId, err.message);
          }
          return reply
            .code(502)
            .send({ error: "dispatch_failed", message: err.message, execution: failedRun.execution });
        }
        if (err instanceof RunNotFoundError) {
          return reply.code(404).send({ error: "run_not_found", message: err.message });
        }
        if (err instanceof RunConflictError) {
          return reply.code(409).send({ error: "run_conflict", message: err.message });
        }
        if (err instanceof GitHubActionsConfigError) {
          if (queued) {
            await runStore.failExecution(runId, err.message);
            if (workflowName === "phase3-build-orchestrator") {
              await failBuildState(runId, err.message);
            }
          }
          return reply.code(500).send({ error: "server_misconfigured", message: err.message });
        }
        if (err instanceof LocalWorkflowRunnerError) {
          if (queued) {
            await runStore.failExecution(runId, err.message);
            if (workflowName === "phase3-build-orchestrator") {
              await failBuildState(runId, err.message);
            }
          }
          return reply.code(500).send({ error: "local_dispatch_failed", message: err.message });
        }
        if (err instanceof z.ZodError) {
          return reply.code(400).send({ error: "bad_request", issues: err.issues });
        }
        throw err;
      }
    },

    async getArtifact(request: FastifyRequest, reply: FastifyReply) {
      try {
        const { runId, artifactName } = GetArtifactParamsSchema.parse(request.params);
        const artifact = await runStore.readArtifact(runId, artifactName);
        return reply.send(GetArtifactResponseSchema.parse(artifact));
      } catch (err: any) {
        if (err instanceof RunNotFoundError) {
          return reply.code(404).send({ error: "run_not_found", message: err.message });
        }
        if (err instanceof RunConflictError) {
          return reply.code(404).send({ error: "artifact_not_found", message: err.message });
        }
        if (err instanceof z.ZodError) {
          return reply.code(400).send({ error: "bad_request", issues: err.issues });
        }
        throw err;
      }
    },

    async listRunLogs(request: FastifyRequest, reply: FastifyReply) {
      try {
        const { runId } = RunIdParamsSchema.parse(request.params);
        const logs = await runStore.listLogs(runId);
        return reply.send(ListRunLogsResponseSchema.parse({ logs }));
      } catch (err: any) {
        if (err instanceof RunNotFoundError) {
          return reply.code(404).send({ error: "run_not_found", message: err.message });
        }
        if (err instanceof z.ZodError) {
          return reply.code(400).send({ error: "bad_request", issues: err.issues });
        }
        throw err;
      }
    },

    async getRunLog(request: FastifyRequest, reply: FastifyReply) {
      try {
        const { runId, logName } = GetRunLogParamsSchema.parse(request.params);
        const log = await runStore.readLog(runId, logName);
        return reply.type("text/plain; charset=utf-8").send(log.payload);
      } catch (err: any) {
        if (err instanceof RunNotFoundError) {
          return reply.code(404).send({ error: "run_not_found", message: err.message });
        }
        if (err instanceof RunConflictError) {
          return reply.code(404).send({ error: "log_not_found", message: err.message });
        }
        if (err instanceof z.ZodError) {
          return reply.code(400).send({ error: "bad_request", issues: err.issues });
        }
        throw err;
      }
    },

    async updateExecution(request: FastifyRequest, reply: FastifyReply) {
      try {
        const { runId } = RunIdParamsSchema.parse(request.params);
        const patch = UpdateExecutionRequestSchema.parse((request as { body?: unknown }).body);
        const run = await runStore.updateExecution(runId, patch);
        return reply.send(UpdateExecutionResponseSchema.parse({ run }));
      } catch (err: any) {
        if (err instanceof RunNotFoundError) {
          return reply.code(404).send({ error: "run_not_found", message: err.message });
        }
        if (err instanceof RunConflictError) {
          return reply.code(409).send({ error: "run_conflict", message: err.message });
        }
        if (err instanceof InvalidExecutionTransitionError) {
          return reply.code(400).send({ error: "bad_transition", message: err.message });
        }
        if (err instanceof z.ZodError) {
          return reply.code(400).send({ error: "bad_request", issues: err.issues });
        }
        throw err;
      }
    },

    async uploadArtifact(request: FastifyRequest, reply: FastifyReply) {
      try {
        const { runId } = RunIdParamsSchema.parse(request.params);
        const body = UploadArtifactRequestSchema.parse((request as { body?: unknown }).body);
        const artifact = await runStore.writeArtifact(
          runId,
          body.name,
          body.payload,
          body.content_type
        );
        return reply.code(201).send(UploadArtifactResponseSchema.parse({ artifact }));
      } catch (err: any) {
        if (err instanceof RunNotFoundError) {
          return reply.code(404).send({ error: "run_not_found", message: err.message });
        }
        if (err instanceof z.ZodError) {
          return reply.code(400).send({ error: "bad_request", issues: err.issues });
        }
        throw err;
      }
    },

    async updateImplementationState(request: FastifyRequest, reply: FastifyReply) {
      try {
        const { runId } = RunIdParamsSchema.parse(request.params);
        const body = UpdateImplementationStateRequestSchema.parse((request as { body?: unknown }).body);
        const run = await runStore.updateImplementationState(runId, body);
        return reply.send(UpdateImplementationStateResponseSchema.parse({ run }));
      } catch (err: any) {
        if (err instanceof RunNotFoundError) {
          return reply.code(404).send({ error: "run_not_found", message: err.message });
        }
        if (err instanceof z.ZodError) {
          return reply.code(400).send({ error: "bad_request", issues: err.issues });
        }
        throw err;
      }
    },

    async updateRepoState(request: FastifyRequest, reply: FastifyReply) {
      try {
        const { runId } = RunIdParamsSchema.parse(request.params);
        const body = UpdateRepoStateRequestSchema.parse((request as { body?: unknown }).body);
        const run = await runStore.updateRepoState(runId, body);
        return reply.send(UpdateRepoStateResponseSchema.parse({ run }));
      } catch (err: any) {
        if (err instanceof RunNotFoundError) {
          return reply.code(404).send({ error: "run_not_found", message: err.message });
        }
        if (err instanceof z.ZodError) {
          return reply.code(400).send({ error: "bad_request", issues: err.issues });
        }
        throw err;
      }
    },

    async updateArchitectureChat(request: FastifyRequest, reply: FastifyReply) {
      try {
        const { runId } = RunIdParamsSchema.parse(request.params);
        const body = UpdateArchitectureChatRequestSchema.parse((request as { body?: unknown }).body);
        const run = await runStore.updateArchitectureChat(runId, body);
        return reply.send(UpdateArchitectureChatResponseSchema.parse({ run }));
      } catch (err: any) {
        if (err instanceof RunNotFoundError) {
          return reply.code(404).send({ error: "run_not_found", message: err.message });
        }
        if (err instanceof z.ZodError) {
          return reply.code(400).send({ error: "bad_request", issues: err.issues });
        }
        throw err;
      }
    },

    async updateDecompositionState(request: FastifyRequest, reply: FastifyReply) {
      try {
        const { runId } = RunIdParamsSchema.parse(request.params);
        const body = UpdateDecompositionStateRequestSchema.parse((request as { body?: unknown }).body);
        const run = await runStore.updateDecompositionState(runId, body);
        return reply.send(UpdateDecompositionStateResponseSchema.parse({ run }));
      } catch (err: any) {
        if (err instanceof RunNotFoundError) {
          return reply.code(404).send({ error: "run_not_found", message: err.message });
        }
        if (err instanceof z.ZodError) {
          return reply.code(400).send({ error: "bad_request", issues: err.issues });
        }
        throw err;
      }
    },

    async updateDecompositionReviewState(request: FastifyRequest, reply: FastifyReply) {
      try {
        const { runId } = RunIdParamsSchema.parse(request.params);
        const body = UpdateDecompositionReviewStateRequestSchema.parse((request as { body?: unknown }).body);
        const run = await runStore.updateDecompositionReviewState(runId, body);
        return reply.send(UpdateDecompositionReviewStateResponseSchema.parse({ run }));
      } catch (err: any) {
        if (err instanceof RunNotFoundError) {
          return reply.code(404).send({ error: "run_not_found", message: err.message });
        }
        if (err instanceof z.ZodError) {
          return reply.code(400).send({ error: "bad_request", issues: err.issues });
        }
        throw err;
      }
    },

    async updateBuildState(request: FastifyRequest, reply: FastifyReply) {
      try {
        const { runId } = RunIdParamsSchema.parse(request.params);
        const body = UpdateBuildStateRequestSchema.parse((request as { body?: unknown }).body);
        const run = await runStore.updateBuildState(runId, body);
        return reply.send(UpdateBuildStateResponseSchema.parse({ run }));
      } catch (err: any) {
        if (err instanceof RunNotFoundError) {
          return reply.code(404).send({ error: "run_not_found", message: err.message });
        }
        if (err instanceof z.ZodError) {
          return reply.code(400).send({ error: "bad_request", issues: err.issues });
        }
        throw err;
      }
    },

    async updateIssueExecutionState(request: FastifyRequest, reply: FastifyReply) {
      try {
        const { runId, issueId } = IssueExecutionParamsSchema.parse(request.params);
        const body = UpdateIssueExecutionStateRequestSchema.parse((request as { body?: unknown }).body);
        const run = await runStore.updateIssueExecutionState(runId, issueId, body);
        return reply.send(UpdateIssueExecutionStateResponseSchema.parse({ run }));
      } catch (err: any) {
        if (err instanceof RunNotFoundError) {
          return reply.code(404).send({ error: "run_not_found", message: err.message });
        }
        if (err instanceof RunConflictError) {
          return reply.code(409).send({ error: "run_conflict", message: err.message });
        }
        if (err instanceof z.ZodError) {
          return reply.code(400).send({ error: "bad_request", issues: err.issues });
        }
        throw err;
      }
    },

    async updateIssueRequirements(request: FastifyRequest, reply: FastifyReply) {
      try {
        const { runId, issueId } = IssueExecutionParamsSchema.parse(request.params);
        const body = UpdateIssueRequirementsRequestSchema.parse((request as { body?: unknown }).body);
        const run = await runStore.resolveIssueRequirements(runId, issueId, body.requirements);
        return reply.send(UpdateIssueRequirementsResponseSchema.parse({ run }));
      } catch (err: any) {
        if (err instanceof RunNotFoundError) {
          return reply.code(404).send({ error: "run_not_found", message: err.message });
        }
        if (err instanceof RunConflictError) {
          return reply.code(409).send({ error: "run_conflict", message: err.message });
        }
        if (err instanceof z.ZodError) {
          return reply.code(400).send({ error: "bad_request", issues: err.issues });
        }
        throw err;
      }
    },

    async updateIssueContextQuestions(request: FastifyRequest, reply: FastifyReply) {
      try {
        const { runId, issueId } = IssueExecutionParamsSchema.parse(request.params);
        const body = UpdateIssueContextQuestionsRequestSchema.parse((request as { body?: unknown }).body);
        const run = await runStore.answerIssueContextQuestions(runId, issueId, body.questions);
        return reply.send(UpdateIssueContextQuestionsResponseSchema.parse({ run }));
      } catch (err: any) {
        if (err instanceof RunNotFoundError) {
          return reply.code(404).send({ error: "run_not_found", message: err.message });
        }
        if (err instanceof RunConflictError) {
          return reply.code(409).send({ error: "run_conflict", message: err.message });
        }
        if (err instanceof z.ZodError) {
          return reply.code(400).send({ error: "bad_request", issues: err.issues });
        }
        throw err;
      }
    },

    async answerDecompositionReviewQuestion(request: FastifyRequest, reply: FastifyReply) {
      try {
        const { runId } = RunIdParamsSchema.parse(request.params);
        const body = AnswerDecompositionReviewQuestionRequestSchema.parse((request as { body?: unknown }).body);
        const run = await runStore.answerDecompositionReviewQuestion(runId, body);
        return reply.send(AnswerDecompositionReviewQuestionResponseSchema.parse({ run }));
      } catch (err: any) {
        if (err instanceof RunNotFoundError) {
          return reply.code(404).send({ error: "run_not_found", message: err.message });
        }
        if (err instanceof RunConflictError) {
          return reply.code(409).send({ error: "run_conflict", message: err.message });
        }
        if (err instanceof z.ZodError) {
          return reply.code(400).send({ error: "bad_request", issues: err.issues });
        }
        throw err;
      }
    },
  };
}
