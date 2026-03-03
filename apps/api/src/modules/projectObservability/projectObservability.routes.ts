import type { FastifyInstance } from "fastify";
import { requireAgentAuth } from "../runs/auth";
import { RunStore } from "../runs/runStore";
import { createProjectObservabilityController } from "./projectObservability.controller";
import { ProjectObservabilityStore } from "./projectObservabilityStore";

export async function registerProjectObservabilityRoutes(app: FastifyInstance) {
  const runStore = new RunStore();
  const store = new ProjectObservabilityStore({ runStore });
  const controller = createProjectObservabilityController({ store });

  app.get(
    "/project-observability",
    { preHandler: requireAgentAuth },
    controller.getProjectObservability
  );
  app.patch(
    "/project-observability/config",
    { preHandler: requireAgentAuth },
    controller.updateProjectObservabilityConfig
  );
  app.get(
    "/project-observability/export",
    { preHandler: requireAgentAuth },
    controller.exportProjectObservability
  );
}
