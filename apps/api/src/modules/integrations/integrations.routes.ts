import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireAgentAuth } from "../runs/auth";
import { IntegrationProviderSchema } from "@pass/shared";
import { IntegrationStore } from "./integrationStore";
import {
  deleteSecret,
  retrieveSecret,
  storeSecret,
  tokenHint,
} from "./encryptedSecretStore";
import { validateToken } from "./integrationValidator";

export async function registerIntegrationRoutes(app: FastifyInstance) {
  const store = new IntegrationStore();

  // GET /admin/integrations — list all providers + their connection metadata
  // Public (no agent auth) so the admin UI can read it without PASS_API_TOKEN
  app.get("/admin/integrations", async (_req, reply) => {
    const connections = await store.listConnections();
    return reply.send({ connections });
  });

  // PUT /admin/integrations/:provider — connect (or update) a token
  app.put(
    "/admin/integrations/:provider",
    { preHandler: requireAgentAuth },
    async (req, reply) => {
      const { provider } = z.object({ provider: IntegrationProviderSchema }).parse(req.params);
      const { token } = z.object({ token: z.string().min(1) }).parse(req.body);

      const validation = await validateToken(provider, token);
      await storeSecret(provider, token);

      const now = new Date().toISOString();
      await store.upsertConnection({
        provider,
        status: validation.ok ? "connected" : "invalid",
        connected_at: now,
        display_name: validation.ok ? validation.displayName : undefined,
        token_hint: tokenHint(token),
        validated_at: now,
        validation_error: validation.ok ? undefined : validation.error,
      });

      const connection = await store.getConnection(provider);
      return reply.send({ connection });
    }
  );

  // DELETE /admin/integrations/:provider — disconnect
  app.delete(
    "/admin/integrations/:provider",
    { preHandler: requireAgentAuth },
    async (req, reply) => {
      const { provider } = z.object({ provider: IntegrationProviderSchema }).parse(req.params);
      await deleteSecret(provider);
      await store.removeConnection(provider);
      return reply.send({ provider, disconnected: true });
    }
  );

  // POST /admin/integrations/:provider/validate — re-validate without changing token
  app.post(
    "/admin/integrations/:provider/validate",
    { preHandler: requireAgentAuth },
    async (req, reply) => {
      const { provider } = z.object({ provider: IntegrationProviderSchema }).parse(req.params);
      const token = await retrieveSecret(provider);
      if (!token) {
        return reply.code(404).send({ error: "not_connected", message: `${provider} is not connected.` });
      }

      const validation = await validateToken(provider, token);
      const now = new Date().toISOString();
      const existing = await store.getConnection(provider);

      await store.upsertConnection({
        provider,
        status: validation.ok ? "connected" : "invalid",
        connected_at: existing?.connected_at,
        display_name: validation.ok ? validation.displayName : existing?.display_name,
        token_hint: existing?.token_hint,
        validated_at: now,
        validation_error: validation.ok ? undefined : validation.error,
      });

      const connection = await store.getConnection(provider);
      return reply.send({ connection });
    }
  );

  // GET /integrations/:provider/token — server-to-server only, returns raw token
  // This is what agents call to get a token instead of reading env directly
  app.get(
    "/integrations/:provider/token",
    { preHandler: requireAgentAuth },
    async (req, reply) => {
      const { provider } = z.object({ provider: IntegrationProviderSchema }).parse(req.params);
      const token = await retrieveSecret(provider);
      if (!token) {
        // Fall back gracefully — agents can still use env vars
        return reply.code(404).send({ error: "not_found", message: `No stored token for ${provider}.` });
      }
      return reply.send({ provider, token });
    }
  );
}