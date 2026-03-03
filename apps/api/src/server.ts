import { config as loadDotenv } from "dotenv";
import { resolve } from "node:path";
import Fastify from "fastify";
import fastifyStatic from "@fastify/static";
import { registerRunsRoutes } from "./modules/runs/runs.routes";
import { registerIntegrationRoutes } from "./modules/integrations/integrations.routes"; 
import { registerBrandAssetRoutes } from "./modules/brandAssets/brandAssets.routes";
import { registerProjectObservabilityRoutes } from "./modules/projectObservability/projectObservability.routes";
import { registerProjectBuildRoutes } from "./modules/projectBuild/projectBuild.routes";


loadDotenv({ path: resolve(__dirname, "../../../.env") });

async function start() {
  const app = Fastify({ logger: true });

  // Needed for brand asset file downloads
  await app.register(fastifyStatic, {
    root: resolve(process.cwd(), "data/brand-assets/files"),
    prefix: "/static/",
    serve: false, // We serve manually via sendFile, not auto-routing
  });

  app.get("/health", async () => ({ ok: true }));

  // Registers the minimal run-tracking API (Step 2).
  await registerRunsRoutes(app);

  await registerIntegrationRoutes(app);

  await registerProjectObservabilityRoutes(app);
  await registerProjectBuildRoutes(app);

  await registerBrandAssetRoutes(app);

  const port = Number(process.env.PORT ?? 3001);
  const host = "0.0.0.0";

  app.listen({ port, host });
}

start().catch((err) => {
  console.error(err);
  process.exit(1);
});
