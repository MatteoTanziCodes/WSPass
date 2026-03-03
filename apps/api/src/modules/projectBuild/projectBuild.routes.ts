import type { FastifyInstance } from "fastify";
import { requireAgentAuth } from "../runs/auth";
import { createProjectBuildController } from "./projectBuild.controller";
import { ProjectBuildStore } from "./projectBuildStore";

export async function registerProjectBuildRoutes(app: FastifyInstance) {
  const store = new ProjectBuildStore();
  const controller = createProjectBuildController({ store });

  app.get("/project-build/config", { preHandler: requireAgentAuth }, controller.getConfig);
  app.patch("/project-build/config", { preHandler: requireAgentAuth }, controller.updateConfig);
  app.get("/project-build/secrets", { preHandler: requireAgentAuth }, controller.listSecrets);
  app.put("/project-build/secrets", { preHandler: requireAgentAuth }, controller.putSecret);
  app.delete("/project-build/secrets", { preHandler: requireAgentAuth }, controller.deleteSecret);
  app.get(
    "/project-build/secrets/value",
    { preHandler: requireAgentAuth },
    controller.getSecretValue
  );
}
