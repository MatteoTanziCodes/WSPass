import { z } from "zod";
import { ProjectBuildConfigSchema, QualityCommandConfigSchema } from "@pass/shared";

export const ProjectBuildQuerySchema = z
  .object({
    project_key: z.string().min(1),
    name: z.string().min(1).optional(),
  })
  .strict();

export const ProjectSecretMetadataSchema = z
  .object({
    name: z.string().min(1),
    kind: z.enum(["integration", "project_secret", "project_variable"]),
    provider: z.enum(["github", "anthropic", "stripe", "sentry", "other"]).optional(),
    updated_at: z.string().datetime(),
    hint: z.string().min(1).optional(),
  })
  .strict();

export const ProjectSecretValueRequestSchema = z
  .object({
    name: z.string().min(1),
    value: z.string().min(1),
    kind: z.enum(["integration", "project_secret", "project_variable"]),
    provider: z.enum(["github", "anthropic", "stripe", "sentry", "other"]).optional(),
  })
  .strict();

export const ProjectBuildConfigIndexSchema = z.record(z.string(), ProjectBuildConfigSchema);

export const UpdateProjectBuildConfigRequestSchema = z
  .object({
    quality_commands: QualityCommandConfigSchema.partial().optional(),
    warning_defaults: z.array(z.string().min(1)).optional(),
    critical_defaults: z.array(z.string().min(1)).optional(),
  })
  .strict();

export const ProjectBuildConfigResponseSchema = z
  .object({
    config: ProjectBuildConfigSchema,
  })
  .strict();

export const ProjectBuildSecretsResponseSchema = z
  .object({
    secrets: z.array(ProjectSecretMetadataSchema),
  })
  .strict();

export const ProjectBuildSecretValueResponseSchema = z
  .object({
    name: z.string().min(1),
    value: z.string().min(1),
  })
  .strict();
