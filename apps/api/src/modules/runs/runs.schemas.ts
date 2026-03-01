import { z } from "zod";
import {
  ImplementationIssueStateCollectionSchema,
  PlannerRunInputSchema,
  RunExecutionSchema,
  RunStatusSchema,
  RunStepSchema,
} from "@pass/shared";

/**
 * Schemas for run records and runs index file.
 * - Defines the shape of truth for run data
 * - Shared primitives kept here so store + controllers stay consistent.
 */


const RunIdSchema = z.uuid();
const IsoDateSchema = z.iso.datetime();

// Minimal run shape used in runs/index.json and GET /runs. The full run details are stored separately in a run-specific folder.
export const RunRecordSchema = z
  .object({
    run_id: RunIdSchema,
    created_at: IsoDateSchema,
    status: RunStatusSchema,
    current_step: RunStepSchema,
    last_updated_at: IsoDateSchema,
  })
  .strict();

export type RunRecord = z.infer<typeof RunRecordSchema>;

// The shape of the runs index file, which lists all runs with basic metadata for quick retrieval
export const RunsIndexSchema = z
  .object({
    version: z.literal(1),
    runs: z.array(RunRecordSchema).default([]),
  })
  .strict();

export type RunsIndex = z.infer<typeof RunsIndexSchema>;

// Maps step name -> ISO timestamp (first time we reached that step).
const StepTimestampsSchema = z
  .record(z.string(), IsoDateSchema)
  .default({})
  .superRefine((obj, ctx) => {
    for (const key of Object.keys(obj)) {
      if (!RunStepSchema.safeParse(key).success) {
        ctx.addIssue({ code: "custom", message: `Invalid step key: ${key}` });
      }
    }
  });

// Full run shape persisted to runs/<runId>/run.json.
export const RunDetailSchema = RunRecordSchema.extend({
  step_timestamps: StepTimestampsSchema, // Tracks when each step was first reached.
  input: PlannerRunInputSchema.optional(),
  execution: RunExecutionSchema.optional(),
  implementation_state: ImplementationIssueStateCollectionSchema.optional(),
}).strict();

export type RunDetail = z.infer<typeof RunDetailSchema>;

// Shape of each artifact's metadata entry stored in runs/<runId>/artifacts/index.json.
export const ArtifactMetadataSchema = z
  .object({
    name: z.string().min(1),
    filename: z.string().min(1),
    content_type: z.enum(["application/json", "text/plain", "text/markdown"]),
    sha256: z.string().regex(/^[a-f0-9]{64}$/).optional(),
    created_at: IsoDateSchema,
  })
  .strict();

export type ArtifactMetadata = z.infer<typeof ArtifactMetadataSchema>;

// Shape of list of artifacts stored in runs/<runId>/artifacts/index.json.
export const ArtifactsIndexSchema = z
  .object({
    version: z.literal(1),
    artifacts: z.array(ArtifactMetadataSchema).default([]),
  })
  .strict();

export type ArtifactsIndex = z.infer<typeof ArtifactsIndexSchema>;
