import type { FastifyInstance } from "fastify";
import { requireAgentAuth } from "./auth";
import { createRunsController } from "./runs.controller";
import { RunStore } from "./runStore";

export function registerRunsRoutes(app: FastifyInstance) {
  const runStore = new RunStore();
  const controller = createRunsController({ runStore });

  app.post("/runs", controller.createRun);  // Creates a new run and returns its record.
  app.get("/runs", controller.listRuns);  // Lists all runs with basic metadata from runs/index.json.
  app.get("/runs/:runId", controller.getRun);   // Fetches a specific run by ID, returning its details and artifacts metadata.
  app.get("/runs/:runId/artifacts/:artifactName", controller.getArtifact);  // Fetches a specific artifact by name for a given run, returning its metadata and payload.
  app.patch("/runs/:runId", controller.updateRun);  // Updates a run's status and/or current step, 

  app.post("/runs/:runId/dispatch", { preHandler: requireAgentAuth }, controller.dispatchRun);  // Dispatches a run for execution, returns the updated run details.
  app.post(
    "/runs/:runId/dispatch/:workflowName",
    { preHandler: requireAgentAuth },
    controller.dispatchRun
  );  // Dispatches a run for execution with a specific workflow, marking it as "dispatched" and returning the updated run details.
  app.patch(
    "/runs/:runId/execution",
    { preHandler: requireAgentAuth },
    controller.updateExecution
  );

  // Authenticated endpoints for agents to manage run state and artifacts during execution:
  app.post(
    "/runs/:runId/artifacts",
    { preHandler: requireAgentAuth },
    controller.uploadArtifact
  );
  app.patch(
    "/runs/:runId/repo-state",
    { preHandler: requireAgentAuth },
    controller.updateRepoState
  );
  app.patch(
    "/runs/:runId/architecture-chat",
    { preHandler: requireAgentAuth },
    controller.updateArchitectureChat
  );
  app.patch(
    "/runs/:runId/decomposition-state",
    { preHandler: requireAgentAuth },
    controller.updateDecompositionState
  );
  app.patch(
    "/runs/:runId/implementation-state",
    { preHandler: requireAgentAuth },
    controller.updateImplementationState
  );
}
