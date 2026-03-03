import { z } from "zod";
import {
  ProjectObservabilityBudgetSchema,
  ProjectObservabilitySummarySchema,
} from "@pass/shared";

export const ProjectObservabilityConfigIndexSchema = z
  .record(z.string(), ProjectObservabilityBudgetSchema)
  .default({});

export type ProjectObservabilityConfigIndex = z.infer<
  typeof ProjectObservabilityConfigIndexSchema
>;

export { ProjectObservabilityBudgetSchema, ProjectObservabilitySummarySchema };
