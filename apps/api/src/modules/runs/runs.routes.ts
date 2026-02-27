import type { FastifyInstance } from "fastify";

import { RunStore } from "./runStore";
import { createRunsController } from "./runs.controller";

// Registers the routes for run-related operations (creating a run, listing runs).
export async function registerRunsRoutes(app: FastifyInstance) {
  
  // Single store instance per process; filesystem-backed.
  const runStore = new RunStore();
  const controller = createRunsController({ runStore });

  app.post("/runs", controller.createRun);
  app.get("/runs", controller.listRuns);
}