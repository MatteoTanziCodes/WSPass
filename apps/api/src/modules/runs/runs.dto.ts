import { z } from "zod";
import { RunRecordSchema } from "./runs.schemas";

/* ----------------------------- Create Run --------------------------- */

// Request is optional for Step 2; moreso reserved for Step 3 wiring.
export const CreateRunRequestSchema = z
  .object({
    prdText: z.string().min(1).optional(),
    orgYaml: z.string().min(1).optional(),
  })
  .strict()
  .optional();

// Response will include the newly created run record
export const CreateRunResponseSchema = z
  .object({
    run: RunRecordSchema,
  })
  .strict();

export type CreateRunRequest = z.infer<typeof CreateRunRequestSchema>;
export type CreateRunResponse = z.infer<typeof CreateRunResponseSchema>;

/* ----------------------------- List Run --------------------------- */

// Response will include an array of run records
export const ListRunsResponseSchema = z
  .object({
    total: z.number().int().nonnegative(), // Count of runs returned (useful for UI/paging later).
    runs: z.array(RunRecordSchema),
  })
  .strict();

export type ListRunsResponse = z.infer<typeof ListRunsResponseSchema>;