import type { FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";

import {
  AnswerDecompositionReviewQuestionRequestSchema,
  AnswerDecompositionReviewQuestionResponseSchema,
  CreateRunRequestSchema,
  CreateRunResponseSchema,
  DeleteRunResponseSchema,
  DispatchRunParamsSchema,
  DispatchRunResponseSchema,
  GetArtifactParamsSchema,
  GetArtifactResponseSchema,
  GetRunResponseSchema,
  ListRunsResponseSchema,
  RunIdParamsSchema,
  UpdateExecutionRequestSchema,
  UpdateExecutionResponseSchema,
  UpdateArchitectureChatRequestSchema,
  UpdateArchitectureChatResponseSchema,
  UpdateDecompositionReviewStateRequestSchema,
  UpdateDecompositionReviewStateResponseSchema,
  UpdateDecompositionStateRequestSchema,
  UpdateDecompositionStateResponseSchema,
  UpdateImplementationStateRequestSchema,
  UpdateImplementationStateResponseSchema,
  UpdateRepoStateRequestSchema,
  UpdateRepoStateResponseSchema,
  UpdateRunRequestSchema,
  UpdateRunResponseSchema,
  UploadArtifactRequestSchema,
  UploadArtifactResponseSchema,
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

  async function assertArchitectureClarificationsResolved(runId: string) {
    const artifact = await runStore.readArtifact(runId, "architecture_pack");
    const pack = ArchitecturePackSchema.parse(artifact.payload);
    const hasDefaultedClarifications = pack.clarifications.some((item) => item.default_used);
    const hasOpenQuestions = pack.open_questions.length > 0;

    if (hasDefaultedClarifications || hasOpenQuestions) {
      throw new RunConflictError(
        "Cannot proceed beyond architecture while clarifying questions remain unanswered."
      );
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
        | "phase2-implementation" =
        "phase1-planner";

      try {
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

        if (
          workflowName === "phase2-decomposition" ||
          workflowName === "phase2-decomposition-iterator" ||
          workflowName === "phase1-architecture-refinement"
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
          });
        } else {
          const githubActionsClient = new GitHubActionsClient();
          await githubActionsClient.dispatchWorkflow({
            workflowName,
            runId,
            apiBaseUrl: resolveApiBaseUrl(request),
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
          }
          return reply.code(500).send({ error: "server_misconfigured", message: err.message });
        }
        if (err instanceof LocalWorkflowRunnerError) {
          if (queued) {
            await runStore.failExecution(runId, err.message);
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
