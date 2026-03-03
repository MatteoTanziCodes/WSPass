"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.UpdateIssueContextQuestionsResponseSchema = exports.UpdateIssueContextQuestionsRequestSchema = exports.UpdateIssueRequirementsResponseSchema = exports.UpdateIssueRequirementsRequestSchema = exports.UpdateIssueExecutionStateResponseSchema = exports.UpdateIssueExecutionStateRequestSchema = exports.UpdateBuildStateResponseSchema = exports.UpdateBuildStateRequestSchema = exports.AnswerDecompositionReviewQuestionResponseSchema = exports.AnswerDecompositionReviewQuestionRequestSchema = exports.UpdateDecompositionReviewStateResponseSchema = exports.UpdateDecompositionReviewStateRequestSchema = exports.UpdateDecompositionStateResponseSchema = exports.UpdateDecompositionStateRequestSchema = exports.UpdateArchitectureChatResponseSchema = exports.UpdateArchitectureChatRequestSchema = exports.UpdateRepoStateResponseSchema = exports.UpdateRepoStateRequestSchema = exports.UpdateImplementationStateResponseSchema = exports.UpdateImplementationStateRequestSchema = exports.ListRunLogsResponseSchema = exports.GetArtifactResponseSchema = exports.GetRunLogParamsSchema = exports.GetArtifactParamsSchema = exports.UploadArtifactResponseSchema = exports.UploadArtifactRequestSchema = exports.UpdateExecutionResponseSchema = exports.UpdateExecutionRequestSchema = exports.IssueExecutionParamsSchema = exports.DispatchRunParamsSchema = exports.DispatchRunRequestSchema = exports.DispatchRunResponseSchema = exports.UpdateRunResponseSchema = exports.UpdateRunRequestSchema = exports.DeleteRunResponseSchema = exports.GetRunResponseSchema = exports.RunIdParamsSchema = exports.ListRunsResponseSchema = exports.RunListItemSchema = exports.CreateRunResponseSchema = exports.CreateRunRequestSchema = void 0;
const zod_1 = require("zod");
const runs_schemas_1 = require("./runs.schemas");
const shared_1 = require("@pass/shared");
exports.CreateRunRequestSchema = shared_1.PlannerRunInputSchema;
// Response will include the newly created run record
exports.CreateRunResponseSchema = zod_1.z
    .object({
    run: runs_schemas_1.RunDetailSchema,
})
    .strict();
exports.RunListItemSchema = runs_schemas_1.RunRecordSchema.extend({
    input: shared_1.PlannerRunInputSchema.optional(),
    execution: shared_1.RunExecutionSchema.optional(),
    repo_state: shared_1.RepoStateSchema.optional(),
    decomposition_state: shared_1.DecompositionStateSchema.optional(),
    decomposition_review_state: shared_1.DecompositionReviewStateSchema.optional(),
    build_state: shared_1.BuildOrchestrationStateSchema.optional(),
}).strict();
// Response will include an array of run records
exports.ListRunsResponseSchema = zod_1.z
    .object({
    total: zod_1.z.number().int().nonnegative(), // Count of runs returned
    runs: zod_1.z.array(exports.RunListItemSchema),
})
    .strict();
// Request params for fetching a specific run by ID
exports.RunIdParamsSchema = zod_1.z.object({ runId: zod_1.z.uuid() }).strict();
// Response includes full run details and associated artifacts metadata
exports.GetRunResponseSchema = zod_1.z
    .object({
    run: runs_schemas_1.RunDetailSchema,
    artifacts: zod_1.z.array(runs_schemas_1.ArtifactMetadataSchema),
})
    .strict();
exports.DeleteRunResponseSchema = zod_1.z
    .object({
    run_id: zod_1.z.uuid(),
    deleted: zod_1.z.literal(true),
})
    .strict();
// Request body for updating a run's status and/or current step
exports.UpdateRunRequestSchema = zod_1.z
    .object({
    status: shared_1.RunStatusSchema.optional(),
    current_step: shared_1.RunStepSchema.optional(),
})
    .strict()
    .refine((v) => v.status || v.current_step, { message: "Provide status and/or current_step" });
// Response includes the updated run details after applying the patch
exports.UpdateRunResponseSchema = zod_1.z.object({ run: runs_schemas_1.RunDetailSchema }).strict();
exports.DispatchRunResponseSchema = zod_1.z
    .object({
    run_id: zod_1.z.uuid(),
    execution: shared_1.RunExecutionSchema,
})
    .strict();
exports.DispatchRunRequestSchema = zod_1.z
    .object({
    issue_id: zod_1.z.string().min(1).optional(),
})
    .strict();
exports.DispatchRunParamsSchema = zod_1.z
    .object({
    runId: zod_1.z.uuid(),
    workflowName: shared_1.WorkflowNameSchema,
})
    .strict();
exports.IssueExecutionParamsSchema = zod_1.z
    .object({
    runId: zod_1.z.uuid(),
    issueId: zod_1.z.string().min(1),
})
    .strict();
exports.UpdateExecutionRequestSchema = zod_1.z
    .object({
    status: zod_1.z.enum(["running", "succeeded", "failed"]),
    github_run_id: zod_1.z.number().int().positive().optional(),
    github_run_url: zod_1.z.string().url().optional(),
    error_message: zod_1.z.string().min(1).optional(),
})
    .strict();
exports.UpdateExecutionResponseSchema = zod_1.z.object({ run: runs_schemas_1.RunDetailSchema }).strict();
exports.UploadArtifactRequestSchema = zod_1.z
    .object({
    name: zod_1.z.string().min(1),
    content_type: zod_1.z.enum(["application/json", "text/plain", "text/markdown"]),
    payload: zod_1.z.unknown(),
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
exports.UploadArtifactResponseSchema = zod_1.z
    .object({
    artifact: runs_schemas_1.ArtifactMetadataSchema,
})
    .strict();
exports.GetArtifactParamsSchema = zod_1.z
    .object({
    runId: zod_1.z.uuid(),
    artifactName: zod_1.z.string().min(1),
})
    .strict();
exports.GetRunLogParamsSchema = zod_1.z
    .object({
    runId: zod_1.z.uuid(),
    logName: zod_1.z.string().min(1),
})
    .strict();
exports.GetArtifactResponseSchema = zod_1.z
    .object({
    artifact: runs_schemas_1.ArtifactMetadataSchema,
    payload: zod_1.z.union([zod_1.z.string(), zod_1.z.record(zod_1.z.string(), zod_1.z.unknown()), zod_1.z.array(zod_1.z.unknown())]),
})
    .strict();
exports.ListRunLogsResponseSchema = zod_1.z
    .object({
    logs: zod_1.z.array(zod_1.z
        .object({
        name: zod_1.z.string().min(1),
        size_bytes: zod_1.z.number().int().nonnegative(),
        updated_at: zod_1.z.string().datetime(),
    })
        .strict()),
})
    .strict();
exports.UpdateImplementationStateRequestSchema = shared_1.ImplementationIssueStateCollectionSchema;
exports.UpdateImplementationStateResponseSchema = zod_1.z
    .object({
    run: runs_schemas_1.RunDetailSchema,
})
    .strict();
exports.UpdateRepoStateRequestSchema = shared_1.RepoStateSchema;
exports.UpdateRepoStateResponseSchema = zod_1.z
    .object({
    run: runs_schemas_1.RunDetailSchema,
})
    .strict();
exports.UpdateArchitectureChatRequestSchema = shared_1.ArchitectureChatStateSchema;
exports.UpdateArchitectureChatResponseSchema = zod_1.z
    .object({
    run: runs_schemas_1.RunDetailSchema,
})
    .strict();
exports.UpdateDecompositionStateRequestSchema = shared_1.DecompositionStateSchema;
exports.UpdateDecompositionStateResponseSchema = zod_1.z
    .object({
    run: runs_schemas_1.RunDetailSchema,
})
    .strict();
exports.UpdateDecompositionReviewStateRequestSchema = shared_1.DecompositionReviewStateSchema;
exports.UpdateDecompositionReviewStateResponseSchema = zod_1.z
    .object({
    run: runs_schemas_1.RunDetailSchema,
})
    .strict();
exports.AnswerDecompositionReviewQuestionRequestSchema = shared_1.DecompositionReviewQuestionAnswerRequestSchema;
exports.AnswerDecompositionReviewQuestionResponseSchema = zod_1.z
    .object({
    run: runs_schemas_1.RunDetailSchema,
})
    .strict();
exports.UpdateBuildStateRequestSchema = shared_1.BuildOrchestrationStateSchema;
exports.UpdateBuildStateResponseSchema = zod_1.z
    .object({
    run: runs_schemas_1.RunDetailSchema,
})
    .strict();
exports.UpdateIssueExecutionStateRequestSchema = shared_1.IssueExecutionStateSchema;
exports.UpdateIssueExecutionStateResponseSchema = zod_1.z
    .object({
    run: runs_schemas_1.RunDetailSchema,
})
    .strict();
exports.UpdateIssueRequirementsRequestSchema = zod_1.z
    .object({
    requirements: zod_1.z.array(shared_1.ProjectSecretRequirementSchema.pick({
        id: true,
        status: true,
        resolved_at: true,
    })),
})
    .strict();
exports.UpdateIssueRequirementsResponseSchema = zod_1.z
    .object({
    run: runs_schemas_1.RunDetailSchema,
})
    .strict();
exports.UpdateIssueContextQuestionsRequestSchema = zod_1.z
    .object({
    questions: zod_1.z.array(shared_1.IssueContextQuestionSchema.pick({
        id: true,
        status: true,
        answer: true,
        answered_at: true,
    })),
})
    .strict();
exports.UpdateIssueContextQuestionsResponseSchema = zod_1.z
    .object({
    run: runs_schemas_1.RunDetailSchema,
})
    .strict();
