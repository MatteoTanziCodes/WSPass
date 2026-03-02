import { z } from "zod";

export const IntegrationProviderSchema = z.enum([
  "github",
  "anthropic",
  "vercel",
  "stripe",
]);
export type IntegrationProvider = z.infer<typeof IntegrationProviderSchema>;

export const IntegrationStatusSchema = z.enum([
  "connected",
  "disconnected",
  "invalid",
]);
export type IntegrationStatus = z.infer<typeof IntegrationStatusSchema>;

export const IntegrationConnectionSchema = z
  .object({
    provider: IntegrationProviderSchema,
    status: IntegrationStatusSchema,
    connected_at: z.string().datetime().optional(),
    display_name: z.string().min(1).optional(), // e.g. GitHub username, Vercel team
    token_hint: z.string().min(1).optional(),   // last 4 chars only, never full token
    validated_at: z.string().datetime().optional(),
    validation_error: z.string().min(1).optional(),
  })
  .strict();
export type IntegrationConnection = z.infer<typeof IntegrationConnectionSchema>;

export const IntegrationsIndexSchema = z
  .object({
    version: z.literal(1),
    connections: z.array(IntegrationConnectionSchema).default([]),
  })
  .strict();
export type IntegrationsIndex = z.infer<typeof IntegrationsIndexSchema>;