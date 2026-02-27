import { z } from "zod";
import { ArtifactMetadataSchema, RunDetailSchema, RunRecordSchema } from "./runs.schemas";
import { RunStatusSchema, RunStepSchema } from "@pass/shared";

// Response will include the newly created run record
export const CreateRunResponseSchema = z
  .object({
    run: RunDetailSchema,
  })
  .strict();

// Response will include an array of run records
export const ListRunsResponseSchema = z
  .object({
    total: z.number().int().nonnegative(), // Count of runs returned
    runs: z.array(RunRecordSchema),
  })
  .strict();

// Request params for fetching a specific run by ID
export const RunIdParamsSchema = z.object({ runId: z.uuid() }).strict();

// Response includes full run details and associated artifacts metadata
export const GetRunResponseSchema = z
  .object({
    run: RunDetailSchema,
    artifacts: z.array(ArtifactMetadataSchema),
  })
  .strict();

// Request body for updating a run's status and/or current step
export const UpdateRunRequestSchema = z
  .object({
    status: RunStatusSchema.optional(),
    current_step: RunStepSchema.optional(),
  })
  .strict()
  .refine((v) => v.status || v.current_step, { message: "Provide status and/or current_step" });

// Response includes the updated run details after applying the patch
export const UpdateRunResponseSchema = z.object({ run: RunDetailSchema }).strict();
