import type { FastifyInstance } from "fastify";
import { requireAgentAuth } from "./auth";
import { createRunsController } from "./runs.controller";
import { RunStore } from "./runStore";

export function registerRunsRoutes(app: FastifyInstance) {
  const runStore = new RunStore();
  const controller = createRunsController({ runStore });

  app.post("/runs", controller.createRun);
  app.get("/runs", controller.listRuns);
  app.get("/runs/:runId", controller.getRun);
  app.get("/runs/:runId/artifacts/:artifactName", controller.getArtifact);
  app.patch("/runs/:runId", controller.updateRun);

  app.post("/runs/:runId/dispatch", { preHandler: requireAgentAuth }, controller.dispatchRun);
  app.post(
    "/runs/:runId/dispatch/:workflowName",
    { preHandler: requireAgentAuth },
    controller.dispatchRun
  );
  app.patch(
    "/runs/:runId/execution",
    { preHandler: requireAgentAuth },
    controller.updateExecution
  );
  app.post(
    "/runs/:runId/artifacts",
    { preHandler: requireAgentAuth },
    controller.uploadArtifact
  );
  app.patch(
    "/runs/:runId/implementation-state",
    { preHandler: requireAgentAuth },
    controller.updateImplementationState
  );
}
