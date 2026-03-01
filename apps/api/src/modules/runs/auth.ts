import type { FastifyReply, FastifyRequest } from "fastify";

export async function requireAgentAuth(request: FastifyRequest, reply: FastifyReply) {
  const expectedToken = process.env.PASS_API_TOKEN;
  if (!expectedToken) {
    return reply
      .code(500)
      .send({ error: "server_misconfigured", message: "PASS_API_TOKEN is not configured." });
  }

  const header = request.headers.authorization;
  const actualToken = header?.startsWith("Bearer ") ? header.slice("Bearer ".length) : undefined;

  if (!actualToken || actualToken !== expectedToken) {
    return reply.code(401).send({ error: "unauthorized", message: "Bearer token required." });
  }
}
