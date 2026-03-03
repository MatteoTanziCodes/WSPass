import type { FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import {
  ProjectObservabilityQuerySchema,
  ProjectObservabilityResponseSchema,
  UpdateProjectObservabilityConfigRequestSchema,
  UpdateProjectObservabilityConfigResponseSchema,
} from "./projectObservability.dtos";
import { ProjectObservabilityStore } from "./projectObservabilityStore";
import { RunNotFoundError } from "../runs/runStore";

export function createProjectObservabilityController(options: {
  store: ProjectObservabilityStore;
}) {
  const { store } = options;

  return {
    async getProjectObservability(request: FastifyRequest, reply: FastifyReply) {
      try {
        const { project_key } = ProjectObservabilityQuerySchema.parse(request.query);
        const summary = await store.getProjectSummary(project_key);
        return reply.send(ProjectObservabilityResponseSchema.parse(summary));
      } catch (error) {
        if (error instanceof RunNotFoundError) {
          return reply.code(404).send({ error: "project_not_found", message: error.message });
        }
        if (error instanceof z.ZodError) {
          return reply.code(400).send({ error: "bad_request", issues: error.issues });
        }
        throw error;
      }
    },

    async updateProjectObservabilityConfig(request: FastifyRequest, reply: FastifyReply) {
      try {
        const { project_key } = ProjectObservabilityQuerySchema.parse(request.query);
        const body = UpdateProjectObservabilityConfigRequestSchema.parse(
          (request as { body?: unknown }).body
        );
        const budget = await store.updateBudget(project_key, body);
        return reply.send(
          UpdateProjectObservabilityConfigResponseSchema.parse({ budget })
        );
      } catch (error) {
        if (error instanceof z.ZodError) {
          return reply.code(400).send({ error: "bad_request", issues: error.issues });
        }
        throw error;
      }
    },

    async exportProjectObservability(request: FastifyRequest, reply: FastifyReply) {
      try {
        const { project_key } = ProjectObservabilityQuerySchema.parse(request.query);
        const bundle = await store.exportProject(project_key);
        return reply
          .header("Content-Type", "application/zip")
          .header(
            "Content-Disposition",
            `attachment; filename="${bundle.filename}"`
          )
          .send(bundle.buffer);
      } catch (error) {
        if (error instanceof RunNotFoundError) {
          return reply.code(404).send({ error: "project_not_found", message: error.message });
        }
        if (error instanceof z.ZodError) {
          return reply.code(400).send({ error: "bad_request", issues: error.issues });
        }
        throw error;
      }
    },
  };
}
