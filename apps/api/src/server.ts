import { config as loadDotenv } from "dotenv";
import { resolve } from "node:path";
import Fastify from "fastify";
import { registerRunsRoutes } from "./modules/runs/runs.routes";

loadDotenv({ path: resolve(__dirname, "../../../.env") });

async function start() {
  const app = Fastify({ logger: true });

  app.get("/health", async () => ({ ok: true }));

  // Registers the minimal run-tracking API (Step 2).
  await registerRunsRoutes(app);

  const port = Number(process.env.PORT ?? 3001);
  const host = "0.0.0.0";

  app.listen({ port, host });
}

start().catch((err) => {
  console.error(err);
  process.exit(1);
});
