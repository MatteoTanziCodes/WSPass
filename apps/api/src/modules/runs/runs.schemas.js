"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ArtifactsIndexSchema = exports.ArtifactMetadataSchema = exports.RunDetailSchema = exports.RunsIndexSchema = exports.RunRecordSchema = void 0;
const zod_1 = require("zod");
const shared_1 = require("@pass/shared");
/**
 * Schemas for run records and runs index file.
 * - Defines the shape of truth for run data
 * - Shared primitives kept here so store + controllers stay consistent.
 */
const RunIdSchema = zod_1.z.uuid();
const IsoDateSchema = zod_1.z.iso.datetime();
// Minimal run shape used in runs/index.json and GET /runs. The full run details are stored separately in a run-specific folder.
exports.RunRecordSchema = zod_1.z
    .object({
    run_id: RunIdSchema,
    created_at: IsoDateSchema,
    status: shared_1.RunStatusSchema,
    current_step: shared_1.RunStepSchema,
    last_updated_at: IsoDateSchema,
})
    .strict();
// The shape of the runs index file, which lists all runs with basic metadata for quick retrieval
exports.RunsIndexSchema = zod_1.z
    .object({
    version: zod_1.z.literal(1),
    runs: zod_1.z.array(exports.RunRecordSchema).default([]),
})
    .strict();
// Maps step name -> ISO timestamp (first time we reached that step).
const StepTimestampsSchema = zod_1.z
    .record(zod_1.z.string(), IsoDateSchema)
    .default({})
    .superRefine((obj, ctx) => {
    for (const key of Object.keys(obj)) {
        if (!shared_1.RunStepSchema.safeParse(key).success) {
            ctx.addIssue({ code: "custom", message: `Invalid step key: ${key}` });
        }
    }
});
// Full run shape persisted to runs/<runId>/run.json.
exports.RunDetailSchema = exports.RunRecordSchema.extend({
    step_timestamps: StepTimestampsSchema, // Tracks when each step was first reached.
    input: shared_1.PlannerRunInputSchema.optional(),
    execution: shared_1.RunExecutionSchema.optional(),
    repo_state: shared_1.RepoStateSchema.optional(),
    architecture_chat: shared_1.ArchitectureChatStateSchema.optional(),
    decomposition_state: shared_1.DecompositionStateSchema.optional(),
    decomposition_review_state: shared_1.DecompositionReviewStateSchema.optional(),
    implementation_state: shared_1.ImplementationIssueStateCollectionSchema.optional(),
    build_state: shared_1.BuildOrchestrationStateSchema.optional(),
}).strict();
// Shape of each artifact's metadata entry stored in runs/<runId>/artifacts/index.json.
exports.ArtifactMetadataSchema = zod_1.z
    .object({
    name: zod_1.z.string().min(1),
    filename: zod_1.z.string().min(1),
    content_type: zod_1.z.enum(["application/json", "text/plain", "text/markdown"]),
    sha256: zod_1.z.string().regex(/^[a-f0-9]{64}$/).optional(),
    created_at: IsoDateSchema,
})
    .strict();
// Shape of list of artifacts stored in runs/<runId>/artifacts/index.json.
exports.ArtifactsIndexSchema = zod_1.z
    .object({
    version: zod_1.z.literal(1),
    artifacts: zod_1.z.array(exports.ArtifactMetadataSchema).default([]),
})
    .strict();
