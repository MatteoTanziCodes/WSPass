import { z } from "zod";
import { ArtifactMetadataSchema, RunDetailSchema, RunRecordSchema } from "./runs.schemas";
import {
  ImplementationIssueStateCollectionSchema,
  PlannerRunInputSchema,
  RunExecutionSchema,
  RunStatusSchema,
  RunStepSchema,
  WorkflowNameSchema,
} from "@pass/shared";

export const CreateRunRequestSchema = PlannerRunInputSchema;

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

export const DispatchRunResponseSchema = z
  .object({
    run_id: z.uuid(),
    execution: RunExecutionSchema,
  })
  .strict();

export const DispatchRunParamsSchema = z
  .object({
    runId: z.uuid(),
    workflowName: WorkflowNameSchema,
  })
  .strict();

export const UpdateExecutionRequestSchema = z
  .object({
    status: z.enum(["running", "succeeded", "failed"]),
    github_run_id: z.number().int().positive().optional(),
    github_run_url: z.string().url().optional(),
    error_message: z.string().min(1).optional(),
  })
  .strict();

export const UpdateExecutionResponseSchema = z.object({ run: RunDetailSchema }).strict();

export const UploadArtifactRequestSchema = z
  .object({
    name: z.string().min(1),
    content_type: z.enum(["application/json", "text/plain", "text/markdown"]),
    payload: z.unknown(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.content_type !== "application/json" && typeof value.payload !== "string") {
      ctx.addIssue({
        code: "custom",
        path: ["payload"],
        message: "payload must be a string for text/plain and text/markdown artifacts",
      });
    }
  });

export const UploadArtifactResponseSchema = z
  .object({
    artifact: ArtifactMetadataSchema,
  })
  .strict();

export const GetArtifactParamsSchema = z
  .object({
    runId: z.uuid(),
    artifactName: z.string().min(1),
  })
  .strict();

export const GetArtifactResponseSchema = z
  .object({
    artifact: ArtifactMetadataSchema,
    payload: z.union([z.string(), z.record(z.string(), z.unknown()), z.array(z.unknown())]),
  })
  .strict();

export const UpdateImplementationStateRequestSchema = ImplementationIssueStateCollectionSchema;

export const UpdateImplementationStateResponseSchema = z
  .object({
    run: RunDetailSchema,
  })
  .strict();
