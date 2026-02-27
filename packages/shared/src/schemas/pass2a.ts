// packages/shared/src/schemas/pass2a.ts
import { z } from "zod";
import { COMPONENT_TYPES, OPTION_IDS, RUN_STATUSES, RUN_STEPS } from "../constants";

/* ----------------------------- Shared enums ------------------------------ */

export const OptionIdSchema = z.enum(OPTION_IDS);
export type OptionId = z.infer<typeof OptionIdSchema>;

export const ComponentTypeSchema = z.enum(COMPONENT_TYPES);
export type ComponentType = z.infer<typeof ComponentTypeSchema>;

export const RunStatusSchema = z.enum(RUN_STATUSES);
export type RunStatus = z.infer<typeof RunStatusSchema>;

export const RunStepSchema = z.enum(RUN_STEPS);
export type RunStep = z.infer<typeof RunStepSchema>;

/* ----------------------------- Org Constraints --------------------------- */
/**
 * Org constraints are parsed from YAML (org.yml), validated BEFORE any model call,
 * and defaulted deterministically.
 */
export const OrgConstraintsSchema = z
  .object({
    strictness: z.enum(["strict", "prefer"]).default("prefer"),

    stack: z
      .object({
        language: z.enum(["typescript", "python", "java", "go"]).default("typescript"),
        web: z.enum(["nextjs", "react", "none"]).default("nextjs"),
        api: z.enum(["fastify", "express", "nestjs"]).default("fastify"),
        primary_db: z.enum(["postgres", "mysql", "sqlite", "dynamodb"]).default("postgres"),
      })
      .default({ language: "typescript", web: "nextjs", api: "fastify", primary_db: "postgres" }),

    cloud: z
      .object({
        provider: z.enum(["aws", "gcp", "azure", "none"]).default("aws"),
        allowed_services: z.array(z.string().min(1)).default(["rds", "s3", "sqs"]),
      })
      .default({ provider: "aws", allowed_services: ["rds", "s3", "sqs"] }),

    architecture_preference: z
      .enum(["monolith", "api_worker", "microservices", "no_preference"])
      .default("no_preference"),

    naming: z
      .object({
        service_prefix: z
          .string()
          .min(1)
          .max(32)
          .regex(/^[a-z][a-z0-9-]*$/)
          .default("pass"),
      })
      .default({ service_prefix: "pass" }),

    security: z
      .object({
        allow_public_db: z.boolean().default(false),
      })
      .default({ allow_public_db: false }),
  })
  .strict();

export type OrgConstraints = z.infer<typeof OrgConstraintsSchema>;