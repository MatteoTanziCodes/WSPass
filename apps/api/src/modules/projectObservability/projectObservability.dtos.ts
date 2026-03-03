import { z } from "zod";
import {
  ProjectObservabilityBudgetSchema,
  ProjectObservabilitySummarySchema,
} from "./projectObservability.schemas";

export const ProjectObservabilityQuerySchema = z
  .object({
    project_key: z.string().min(1),
  })
  .strict();

export const UpdateProjectObservabilityConfigRequestSchema = z
  .object({
    warning_usd: z.number().nonnegative().nullable(),
    critical_usd: z.number().nonnegative().nullable(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (
      value.warning_usd !== null &&
      value.critical_usd !== null &&
      value.critical_usd < value.warning_usd
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["critical_usd"],
        message: "critical_usd must be greater than or equal to warning_usd",
      });
    }
  });

export const ProjectObservabilityResponseSchema = ProjectObservabilitySummarySchema;

export const UpdateProjectObservabilityConfigResponseSchema = z
  .object({
    budget: ProjectObservabilityBudgetSchema,
  })
  .strict();
