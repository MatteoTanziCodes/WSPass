import { z } from "zod";
import { RunStatusSchema, RunStepSchema } from "@pass/shared";

/**
 * Schemas for run records and runs index file.
 * - Defines the shape of truth for run data
 */

// Shared primitives kept here so store + controllers stay consistent.
const RunIdSchema = z.uuid();
const IsoDateSchema = z.iso.datetime();

// A single run record in the runs index. The full run details are stored separately in a run-specific folder.
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