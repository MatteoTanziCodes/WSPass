import type { FastifyReply, FastifyRequest } from "fastify";

import { CreateRunRequestSchema, CreateRunResponseSchema, ListRunsResponseSchema } from "./runs.dto";
import type { RunStore } from "./runStore";

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
    async createRun(request: FastifyRequest, reply: FastifyReply) {
      
      // Validate input (optional in Step 2) to keep boundaries deterministic.
      const body = CreateRunRequestSchema.parse((request as any).body);

      const run = await runStore.createRun({
        prdText: body?.prdText,
        orgYaml: body?.orgYaml,
      });

      const response = CreateRunResponseSchema.parse({ run });
      return reply.code(201).send(response);
    },

    // Handler for listing all runs; returns an array of run records.
    async listRuns(_request: FastifyRequest, reply: FastifyReply) {
      // Always reads from runs/index.json (required baseline history).
      const runs = await runStore.listRuns();

      const response = ListRunsResponseSchema.parse({ total: runs.length, runs });
      return reply.send(response);
    },
  };
}