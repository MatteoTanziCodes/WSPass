import type { FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";

import {
  GetRunResponseSchema,
  ListRunsResponseSchema,
  RunIdParamsSchema,
  UpdateRunRequestSchema,
  UpdateRunResponseSchema,
} from "./runs.dtos";
import type { RunStore } from "./runStore";
import { RunNotFoundError } from "./runStore";


/**
 * Controller for handling run-related API requests.
 * - Implements the logic for creating a new run and listing existing runs.
 * - Validates input and output using Zod schemas defined in runs.dto.ts
 */


// Contructs the runs controller with its dependencies (currently just the RunStore).
export function createRunsController(deps: { runStore: RunStore }) {
  const { runStore } = deps;

  return {

    // Handler for creating a new run; returns the created run record.
    async createRun(_req: FastifyRequest, reply: FastifyReply) {
      const run = await runStore.createRun(); // Creates run folder + run.json + index entry.
      return reply.code(201).send({ run });
    },

    // Handler for listing all runs; returns an array of run records.
    async listRuns(_request: FastifyRequest, reply: FastifyReply) {
      // Always reads from runs/index.json (required baseline history).
      const runs = await runStore.listRuns();

      const response = ListRunsResponseSchema.parse({ total: runs.length, runs });
      return reply.send(response);
    },

    // Handler for fetching a specific run by ID; returns run details and artifacts metadata.
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

    // Handler for updating a run's status and/or current step; returns the updated run details.
    async updateRun(request: FastifyRequest, reply: FastifyReply) {
      try {
        const { runId } = RunIdParamsSchema.parse(request.params);
        const patch = UpdateRunRequestSchema.parse((request as any).body);
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
  };
}