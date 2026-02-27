import type { FastifyInstance } from "fastify";
import { RunStore } from "./runStore";
import { createRunsController } from "./runs.controller";

// Registers the routes for run-related operations (creating a run, listing runs).
export function registerRunsRoutes(app: FastifyInstance) {
  
  const runStore = new RunStore();  // Single store instance per process
  const controller = createRunsController({ runStore });

  app.post("/runs", controller.createRun);          // Creates a new run and returns its record.
  app.get("/runs", controller.listRuns);            // Lists all runs with basic metadata from runs/index.json.
  app.get("/runs/:runId", controller.getRun);       // Fetches a specific run by ID, returning its details and artifacts metadata.
  app.patch("/runs/:runId", controller.updateRun);  // Updates a run's status and/or current step, returning the updated run details.
}