import type { FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import {
  ProjectBuildConfigResponseSchema,
  ProjectBuildQuerySchema,
  ProjectBuildSecretValueResponseSchema,
  ProjectBuildSecretsResponseSchema,
  ProjectSecretValueRequestSchema,
  UpdateProjectBuildConfigRequestSchema,
} from "./projectBuild.schemas";
import { ProjectBuildStore } from "./projectBuildStore";

export function createProjectBuildController(options: { store: ProjectBuildStore }) {
  const { store } = options;

  return {
    async getConfig(request: FastifyRequest, reply: FastifyReply) {
      try {
        const { project_key } = ProjectBuildQuerySchema.parse(request.query);
        const config = await store.getConfig(project_key);
        return reply.send(ProjectBuildConfigResponseSchema.parse({ config }));
      } catch (error) {
        if (error instanceof z.ZodError) {
          return reply.code(400).send({ error: "bad_request", issues: error.issues });
        }
        throw error;
      }
    },

    async updateConfig(request: FastifyRequest, reply: FastifyReply) {
      try {
        const { project_key } = ProjectBuildQuerySchema.parse(request.query);
        const body = UpdateProjectBuildConfigRequestSchema.parse(
          (request as { body?: unknown }).body
        );
        const config = await store.updateConfig(project_key, body);
        return reply.send(ProjectBuildConfigResponseSchema.parse({ config }));
      } catch (error) {
        if (error instanceof z.ZodError) {
          return reply.code(400).send({ error: "bad_request", issues: error.issues });
        }
        throw error;
      }
    },

    async listSecrets(request: FastifyRequest, reply: FastifyReply) {
      try {
        const { project_key } = ProjectBuildQuerySchema.parse(request.query);
        const secrets = await store.listSecrets(project_key);
        return reply.send(ProjectBuildSecretsResponseSchema.parse({ secrets }));
      } catch (error) {
        if (error instanceof z.ZodError) {
          return reply.code(400).send({ error: "bad_request", issues: error.issues });
        }
        throw error;
      }
    },

    async putSecret(request: FastifyRequest, reply: FastifyReply) {
      try {
        const { project_key } = ProjectBuildQuerySchema.parse(request.query);
        const body = ProjectSecretValueRequestSchema.parse((request as { body?: unknown }).body);
        const metadata = await store.putSecret({
          projectKey: project_key,
          name: body.name,
          value: body.value,
          kind: body.kind,
          provider: body.provider,
        });
        return reply.code(201).send(ProjectBuildSecretsResponseSchema.parse({ secrets: [metadata] }));
      } catch (error) {
        if (error instanceof z.ZodError) {
          return reply.code(400).send({ error: "bad_request", issues: error.issues });
        }
        throw error;
      }
    },

    async deleteSecret(request: FastifyRequest, reply: FastifyReply) {
      try {
        const { project_key, name } = ProjectBuildQuerySchema.parse(request.query);
        if (!name) {
          return reply.code(400).send({ error: "bad_request", message: "name is required" });
        }
        await store.deleteSecret(project_key, name);
        return reply.code(204).send();
      } catch (error) {
        if (error instanceof z.ZodError) {
          return reply.code(400).send({ error: "bad_request", issues: error.issues });
        }
        throw error;
      }
    },

    async getSecretValue(request: FastifyRequest, reply: FastifyReply) {
      try {
        const { project_key, name } = ProjectBuildQuerySchema.parse(request.query);
        if (!name) {
          return reply.code(400).send({ error: "bad_request", message: "name is required" });
        }
        const value = await store.getSecretValue(project_key, name);
        if (!value) {
          return reply.code(404).send({ error: "secret_not_found", message: `Secret not found: ${name}` });
        }
        return reply.send(ProjectBuildSecretValueResponseSchema.parse({ name, value }));
      } catch (error) {
        if (error instanceof z.ZodError) {
          return reply.code(400).send({ error: "bad_request", issues: error.issues });
        }
        throw error;
      }
    },
  };
}
