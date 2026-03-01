import type { FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";

import {
  CreateRunRequestSchema,
  CreateRunResponseSchema,
  DispatchRunParamsSchema,
  DispatchRunResponseSchema,
  GetArtifactParamsSchema,
  GetArtifactResponseSchema,
  GetRunResponseSchema,
  ListRunsResponseSchema,
  RunIdParamsSchema,
  UpdateExecutionRequestSchema,
  UpdateExecutionResponseSchema,
  UpdateImplementationStateRequestSchema,
  UpdateImplementationStateResponseSchema,
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
import type { RunStore } from "./runStore";
import {
  InvalidExecutionTransitionError,
  RunConflictError,
  RunNotFoundError,
} from "./runStore";

function resolveApiBaseUrl(request: FastifyRequest) {
  return process.env.PASS_API_PUBLIC_BASE_URL ?? `${request.protocol}://${request.headers.host}`;
}

export function createRunsController(deps: {
  runStore: RunStore;
}) {
  const { runStore } = deps;

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
      const runs = await runStore.listRuns();
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
      let workflowName: "phase1-planner" | "phase2-implementation" = "phase1-planner";

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
        }

        await runStore.queueExecution(runId, workflowName);
        queued = true;

        const githubActionsClient = new GitHubActionsClient();
        await githubActionsClient.dispatchWorkflow({
          workflowName,
          runId,
          apiBaseUrl: resolveApiBaseUrl(request),
        });

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
  };
}
