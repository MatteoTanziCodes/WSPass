"use server";

import path from "node:path";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { ArchitectureChatStateSchema } from "@pass/shared";
import { isReviewReadyStatus } from "./lib/consoleData";
import {
  answerDecompositionReviewQuestion,
  ApiRequestError,
  createRun,
  deleteRun,
  dispatchWorkflow,
  getRun,
  putProjectBuildSecret,
  updateProjectObservabilityBudget,
  updateArchitectureChat,
  updateIssueContextQuestions,
  updateIssueRequirements,
} from "./lib/passApi";

const DOCX_MIME_TYPE =
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const SUPPORTED_NATURAL_LANGUAGE_FILE_EXTENSIONS = new Set([
  ".txt",
  ".md",
  ".markdown",
  ".rtf",
  ".docx",
]);

function buildProjectRedirect(runId: string, fallbackPath?: string) {
  return fallbackPath?.trim() || `/projects/${runId}/architecture`;
}

function withNavigationNonce(target: string) {
  const trimmed = target.trim();
  if (!trimmed) {
    return trimmed;
  }

  const separator = trimmed.includes("?") ? "&" : "?";
  return `${trimmed}${separator}nav=${Date.now()}`;
}

function isActiveExecutionConflict(error: unknown) {
  return (
    error instanceof ApiRequestError &&
    error.status === 409 &&
    error.body.includes("Run execution is already active")
  );
}

function isLocalhostUrl(value?: string) {
  if (!value) {
    return false;
  }

  try {
    const url = new URL(value);
    return ["localhost", "127.0.0.1", "::1"].includes(url.hostname);
  } catch {
    return false;
  }
}

function shouldWaitForWorkflowChain() {
  const mode = (process.env.PASS_LOCAL_WORKFLOW_MODE ?? "").trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(mode)) {
    return true;
  }
  if (["0", "false", "no", "off"].includes(mode)) {
    return false;
  }

  return (
    isLocalhostUrl(process.env.PASS_API_BASE_URL) ||
    isLocalhostUrl(process.env.PASS_API_PUBLIC_BASE_URL)
  );
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseNullableUsdValue(raw: FormDataEntryValue | null) {
  const text = String(raw ?? "").trim();
  if (!text) {
    return null;
  }

  const value = Number(text);
  if (!Number.isFinite(value) || value < 0) {
    throw new Error("Budget thresholds must be non-negative numbers.");
  }

  return value;
}

async function waitForWorkflowTerminal(
  runId: string,
  workflowName:
    | "phase1-planner"
    | "phase1-architecture-refinement"
    | "phase2-repo-provision"
    | "phase2-decomposition"
    | "phase2-decomposition-iterator"
    | "phase2-implementation",
  timeoutMs = 120_000
) {
  if (!shouldWaitForWorkflowChain()) {
    return null;
  }

  const startedAt = Date.now();
  let sawWorkflow = false;

  while (Date.now() - startedAt < timeoutMs) {
    const run = await getRun(runId);
    if (!run) {
      return null;
    }

    if (run.run.execution?.workflow_name === workflowName) {
      sawWorkflow = true;
      if (["succeeded", "failed"].includes(run.run.execution.status)) {
        return run;
      }
    } else if (sawWorkflow) {
      return run;
    }

    await sleep(1500);
  }

  return null;
}

function ensureWorkflowSucceeded(
  run: Awaited<ReturnType<typeof getRun>> | null,
  workflowName: string
) {
  if (!run) {
    return;
  }

  if (
    run.run.execution?.workflow_name === workflowName &&
    run.run.execution.status === "failed"
  ) {
    throw new Error(run.run.execution.error_message || `${workflowName} failed.`);
  }
}

function revalidateRunPaths(runId: string) {
  revalidatePath("/");
  revalidatePath("/projects");
  revalidatePath("/maintenance");
  revalidatePath(`/projects/${runId}/architecture`);
  revalidatePath(`/projects/${runId}/decompose`);
  revalidatePath(`/projects/${runId}/build`);
  revalidatePath(`/projects/${runId}/maintenance`);
}

async function readNaturalLanguageInput(
  formData: FormData,
  textField: string,
  fileField: string
) {
  const inlineText = String(formData.get(textField) ?? "").trim();
  const fileValue = formData.get(fileField);

  if (!fileValue || typeof fileValue === "string") {
    return {
      text: inlineText || undefined,
      fileName: undefined as string | undefined,
    };
  }

  const fileText = await extractNaturalLanguageFileText(fileValue);
  const text = [inlineText, fileText].filter(Boolean).join("\n\n");

  return {
    text: text || undefined,
    fileName: fileValue.size > 0 ? fileValue.name : undefined,
  };
}

async function extractNaturalLanguageFileText(file: File) {
  const extension = path.extname(file.name).toLowerCase();

  if (
    extension &&
    !SUPPORTED_NATURAL_LANGUAGE_FILE_EXTENSIONS.has(extension) &&
    file.type !== DOCX_MIME_TYPE
  ) {
    throw new Error(
      `Unsupported file type for ${file.name}. Use .txt, .md, .markdown, .rtf, or .docx.`
    );
  }

  if (extension === ".docx" || file.type === DOCX_MIME_TYPE) {
    const mammoth = await import("mammoth");
    const buffer = Buffer.from(await file.arrayBuffer());
    const result = await mammoth.extractRawText({ buffer });
    const text = result.value.replace(/\r/g, "").trim();

    if (!text) {
      throw new Error(`The .docx file ${file.name} did not contain readable text.`);
    }

    return text;
  }

  return (await file.text()).trim();
}

export async function createRunAction(formData: FormData) {
  const prdInput = await readNaturalLanguageInput(formData, "prd_text", "prd_file");
  const orgConstraintsInput = await readNaturalLanguageInput(
    formData,
    "org_constraints_text",
    "org_constraints_file"
  );
  const designGuidelinesInput = await readNaturalLanguageInput(
    formData,
    "design_guidelines_text",
    "design_guidelines_file"
  );
  const repoMode = String(formData.get("repo_mode") ?? "existing").trim();

  if (!prdInput.text) {
    throw new Error("PRD text or PRD file is required.");
  }

  if (repoMode === "new" && !String(formData.get("repo_name") ?? "").trim()) {
    throw new Error("A new repo name is required when creating a repo.");
  }

  if (repoMode !== "new" && !String(formData.get("existing_repository") ?? "").trim()) {
    throw new Error("Select an existing repository.");
  }

  const repoTarget =
    repoMode === "new"
      ? {
          mode: "create_new_repo" as const,
          name: String(formData.get("repo_name") ?? "").trim(),
          visibility: (String(formData.get("repo_visibility") ?? "private").trim() || "private") as
            | "private"
            | "public",
        }
      : {
          mode: "use_existing_repo" as const,
          repository: String(formData.get("existing_repository") ?? "").trim(),
          name: String(formData.get("repo_name") ?? "").trim() || undefined,
          visibility: (String(formData.get("repo_visibility") ?? "").trim() || undefined) as
            | "private"
            | "public"
            | undefined,
        };

  const run = await createRun({
    prd_text: prdInput.text,
    prd_file_name: prdInput.fileName,
    requested_by: "dashboard",
    repo_target: repoTarget,
    org_constraints_text: orgConstraintsInput.text,
    org_constraints_file_name: orgConstraintsInput.fileName,
    design_guidelines_text: designGuidelinesInput.text,
    design_guidelines_file_name: designGuidelinesInput.fileName,
  });

  const projectKey =
    repoTarget.mode === "use_existing_repo"
      ? repoTarget.repository
      : repoTarget.name;
  await dispatchWorkflow(run.run_id, "phase1-planner");
  revalidatePath("/");
  redirect(
    withNavigationNonce(
      buildProjectRedirect(
        run.run_id,
        `/projects/${run.run_id}/architecture?project=${encodeURIComponent(projectKey)}`
      )
    )
  );
}

// Dispatch workflows
export async function dispatchWorkflowAction(formData: FormData) {
  const runId = String(formData.get("run_id") ?? "").trim();
  const returnTo = String(formData.get("return_to") ?? "").trim() || undefined;
  const workflowName = String(formData.get("workflow_name") ?? "").trim() as
    | "phase1-planner"
    | "phase1-architecture-refinement"
    | "phase2-repo-provision"
    | "phase2-decomposition"
    | "phase2-decomposition-iterator"
    | "phase2-implementation"
    | "phase3-build-orchestrator"
    | "phase3-issue-execution"
    | "phase3-pr-supervisor";
  const issueId = String(formData.get("issue_id") ?? "").trim() || undefined;

  if (!runId || !workflowName) {
    throw new Error("run_id and workflow_name are required.");
  }

  try {
    await dispatchWorkflow(runId, workflowName, issueId ? { issueId } : undefined);
  } catch (error) {
    if (!isActiveExecutionConflict(error)) {
      throw error;
    }
  }
  revalidateRunPaths(runId);
  redirect(withNavigationNonce(buildProjectRedirect(runId, returnTo)));
}

export async function deleteProjectAction(formData: FormData) {
  const returnTo = String(formData.get("return_to") ?? "").trim() || "/maintenance";
  const runIds = String(formData.get("run_ids") ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);

  if (runIds.length === 0) {
    throw new Error("At least one run is required to delete a project.");
  }

  await Promise.all(runIds.map((runId) => deleteRun(runId)));

  revalidatePath("/");
  revalidatePath("/projects");
  revalidatePath("/maintenance");
  for (const runId of runIds) {
    revalidateRunPaths(runId);
  }

  redirect(withNavigationNonce(returnTo));
}

export async function updateProjectObservabilityBudgetAction(formData: FormData) {
  const projectKey = String(formData.get("project_key") ?? "").trim();
  const returnTo = String(formData.get("return_to") ?? "").trim() || "/maintenance";

  if (!projectKey) {
    throw new Error("project_key is required.");
  }

  const warningUsd = parseNullableUsdValue(formData.get("warning_usd"));
  const criticalUsd = parseNullableUsdValue(formData.get("critical_usd"));

  if (
    warningUsd !== null &&
    criticalUsd !== null &&
    criticalUsd < warningUsd
  ) {
    throw new Error("Critical threshold must be greater than or equal to warning threshold.");
  }

  await updateProjectObservabilityBudget(projectKey, {
    warning_usd: warningUsd,
    critical_usd: criticalUsd,
  });

  revalidatePath("/maintenance");
  revalidatePath(returnTo);
  redirect(withNavigationNonce(returnTo));
}

// Send refinement feedback
export async function sendArchitectureFeedbackAction(formData: FormData) {
  const runId = String(formData.get("run_id") ?? "").trim();
  const returnTo = String(formData.get("return_to") ?? "").trim() || undefined;
  const content = String(formData.get("feedback") ?? "").trim();
  const prdInput = await readNaturalLanguageInput(formData, "refinement_prd_text", "refinement_prd_file");
  const orgConstraintsInput = await readNaturalLanguageInput(
    formData,
    "refinement_org_constraints_text",
    "refinement_org_constraints_file"
  );
  const designGuidelinesInput = await readNaturalLanguageInput(
    formData,
    "refinement_design_guidelines_text",
    "refinement_design_guidelines_file"
  );

  if (!runId) {
    throw new Error("run_id is required.");
  }

  const run = await getRun(runId);
  if (!run) {
    throw new Error("Run not found.");
  }

  const currentState = ArchitectureChatStateSchema.parse(
    run.run.architecture_chat ?? {
      updated_at: new Date().toISOString(),
      messages: [],
    }
  );

  const messageParts = [content];
  if (prdInput.text) {
    messageParts.push(`New PRD context:\n${prdInput.text}`);
  }
  if (orgConstraintsInput.text) {
    messageParts.push(`Updated org constraints:\n${orgConstraintsInput.text}`);
  }
  if (designGuidelinesInput.text) {
    messageParts.push(`Updated design guidelines:\n${designGuidelinesInput.text}`);
  }
  const combinedContent = messageParts.filter(Boolean).join("\n\n");

  if (!combinedContent.trim()) {
    throw new Error("Provide a chat update, PRD update, org constraints update, or design guidelines update.");
  }

  const nextState = ArchitectureChatStateSchema.parse({
    updated_at: new Date().toISOString(),
    messages: [
      ...currentState.messages,
      {
        id: `user_${Date.now()}`,
        role: "user",
        content: combinedContent,
        created_at: new Date().toISOString(),
      },
    ],
  });

  await updateArchitectureChat(runId, nextState);
  try {
    await dispatchWorkflow(runId, "phase1-architecture-refinement");
  } catch (error) {
    if (!isActiveExecutionConflict(error)) {
      throw error;
    }
  }
  revalidateRunPaths(runId);
  redirect(withNavigationNonce(buildProjectRedirect(runId, returnTo)));
}

export async function runBuildReadinessAction(formData: FormData) {
  const runId = String(formData.get("run_id") ?? "").trim();
  const returnTo = String(formData.get("return_to") ?? "").trim() || undefined;
  if (!runId) {
    throw new Error("run_id is required.");
  }

  const initialRun = await getRun(runId);
  if (!initialRun) {
    throw new Error("Run not found.");
  }

  const hasDecompositionDraft = initialRun.artifacts.some(
    (artifact) => artifact.name === "decomposition_plan"
  );
  const workflowName = hasDecompositionDraft
    ? "phase2-decomposition-iterator"
    : "phase2-decomposition";

  try {
    await dispatchWorkflow(runId, workflowName);
  } catch (error) {
    if (!isActiveExecutionConflict(error)) {
      throw error;
    }
  }
  revalidateRunPaths(runId);
  redirect(withNavigationNonce(buildProjectRedirect(runId, returnTo)));
}

export async function answerDecompositionReviewQuestionAction(formData: FormData) {
  const runId = String(formData.get("run_id") ?? "").trim();
  const questionId = String(formData.get("question_id") ?? "").trim();
  const gapId = String(formData.get("gap_id") ?? "").trim();
  const returnTo = String(formData.get("return_to") ?? "").trim() || undefined;
  const answer = String(formData.get("answer") ?? "").trim();
  const prdInput = await readNaturalLanguageInput(
    formData,
    "iterator_prd_text",
    "iterator_prd_file"
  );
  const orgConstraintsInput = await readNaturalLanguageInput(
    formData,
    "iterator_org_constraints_text",
    "iterator_org_constraints_file"
  );
  const designGuidelinesInput = await readNaturalLanguageInput(
    formData,
    "iterator_design_guidelines_text",
    "iterator_design_guidelines_file"
  );

  if (!runId || (!questionId && !gapId) || !answer) {
    throw new Error("run_id, answer, and either question_id or gap_id are required.");
  }

  await answerDecompositionReviewQuestion(runId, {
    question_id: questionId || undefined,
    gap_id: gapId || undefined,
    answer,
    prd_text: prdInput.text,
    org_constraints_text: orgConstraintsInput.text,
    design_guidelines_text: designGuidelinesInput.text,
  });

  const run = await getRun(runId);
  if (!run) {
    throw new Error("Run not found.");
  }

  const currentState = ArchitectureChatStateSchema.parse(
    run.run.architecture_chat ?? {
      updated_at: new Date().toISOString(),
      messages: [],
    }
  );

  const messageParts = [
    `Iterator clarification answer for ${questionId || gapId}:\n${answer}`,
  ];
  if (prdInput.text) {
    messageParts.push(`New PRD context:\n${prdInput.text}`);
  }
  if (orgConstraintsInput.text) {
    messageParts.push(`Updated org constraints:\n${orgConstraintsInput.text}`);
  }
  if (designGuidelinesInput.text) {
    messageParts.push(`Updated design guidelines:\n${designGuidelinesInput.text}`);
  }

  const nextState = ArchitectureChatStateSchema.parse({
    updated_at: new Date().toISOString(),
    messages: [
      ...currentState.messages,
      {
        id: `user_${Date.now()}`,
        role: "user",
        content: messageParts.join("\n\n"),
        created_at: new Date().toISOString(),
      },
    ],
  });

  await updateArchitectureChat(runId, nextState);

  for (const workflowName of [
    "phase1-architecture-refinement",
    "phase2-decomposition",
    "phase2-decomposition-iterator",
  ] as const) {
    try {
      await dispatchWorkflow(runId, workflowName);
    } catch (error) {
      if (!isActiveExecutionConflict(error)) {
        throw error;
      }
    }

    const completedRun = await waitForWorkflowTerminal(runId, workflowName, 150_000);
    ensureWorkflowSucceeded(completedRun, workflowName);
  }

  const finalRun = await getRun(runId);
  revalidateRunPaths(runId);

  if (isReviewReadyStatus(finalRun?.run.decomposition_review_state?.status)) {
    redirect(withNavigationNonce(`/projects/${runId}/build`));
  }

  redirect(withNavigationNonce(buildProjectRedirect(runId, returnTo)));
}

export async function startBuildAction(formData: FormData) {
  const runId = String(formData.get("run_id") ?? "").trim();
  const returnTo = String(formData.get("return_to") ?? "").trim() || `/projects/${runId}/build`;

  if (!runId) {
    throw new Error("run_id is required.");
  }

  try {
    await dispatchWorkflow(runId, "phase3-build-orchestrator");
  } catch (error) {
    if (!isActiveExecutionConflict(error)) {
      throw error;
    }
  }

  revalidateRunPaths(runId);
  redirect(withNavigationNonce(returnTo));
}

export async function rerunIssueExecutionAction(formData: FormData) {
  const runId = String(formData.get("run_id") ?? "").trim();
  const issueId = String(formData.get("issue_id") ?? "").trim();
  const returnTo = String(formData.get("return_to") ?? "").trim() || `/projects/${runId}/build`;

  if (!runId || !issueId) {
    throw new Error("run_id and issue_id are required.");
  }

  const run = await getRun(runId);
  const issue = run?.run.build_state?.issues.find((candidate) => candidate.issue_id === issueId);
  if (!issue) {
    throw new Error(`Issue ${issueId} is not tracked in this run's build state.`);
  }

  const workflowName =
    issue.status === "pr_open" || issue.status === "testing" || issue.status === "fixing"
      ? "phase3-pr-supervisor"
      : "phase3-issue-execution";

  try {
    await dispatchWorkflow(runId, workflowName, { issueId });
  } catch (error) {
    if (!isActiveExecutionConflict(error)) {
      throw error;
    }
  }

  revalidateRunPaths(runId);
  redirect(withNavigationNonce(returnTo));
}

export async function resolveProjectSecretRequirementAction(formData: FormData) {
  const runId = String(formData.get("run_id") ?? "").trim();
  const issueId = String(formData.get("issue_id") ?? "").trim();
  const requirementId = String(formData.get("requirement_id") ?? "").trim();
  const projectKey = String(formData.get("project_key") ?? "").trim();
  const name = String(formData.get("name") ?? "").trim();
  const kind = String(formData.get("kind") ?? "").trim() as
    | "integration"
    | "project_secret"
    | "project_variable";
  const providerRaw = String(formData.get("provider") ?? "").trim();
  const value = String(formData.get("value") ?? "").trim();
  const returnTo = String(formData.get("return_to") ?? "").trim() || `/projects/${runId}/build`;

  if (!runId || !issueId || !requirementId || !projectKey || !name || !kind) {
    throw new Error("run_id, issue_id, requirement_id, project_key, name, and kind are required.");
  }

  if (kind === "integration") {
    throw new Error("Integration requirements must be resolved through the admin panel.");
  }

  if (!value) {
    throw new Error("A secret or variable value is required.");
  }

  const provider =
    providerRaw === "github" ||
    providerRaw === "anthropic" ||
    providerRaw === "stripe" ||
    providerRaw === "sentry" ||
    providerRaw === "other"
      ? providerRaw
      : undefined;

  await putProjectBuildSecret(projectKey, {
    name,
    value,
    kind,
    provider,
  });

  await updateIssueRequirements(runId, issueId, [
    {
      id: requirementId,
      status: "resolved",
      resolved_at: new Date().toISOString(),
    },
  ]);

  try {
    await dispatchWorkflow(runId, "phase3-issue-execution", { issueId });
  } catch (error) {
    if (!isActiveExecutionConflict(error)) {
      throw error;
    }
  }

  revalidateRunPaths(runId);
  redirect(withNavigationNonce(returnTo));
}

export async function answerIssueContextQuestionAction(formData: FormData) {
  const runId = String(formData.get("run_id") ?? "").trim();
  const issueId = String(formData.get("issue_id") ?? "").trim();
  const questionId = String(formData.get("question_id") ?? "").trim();
  const answer = String(formData.get("answer") ?? "").trim();
  const returnTo = String(formData.get("return_to") ?? "").trim() || `/projects/${runId}/build`;

  if (!runId || !issueId || !questionId || !answer) {
    throw new Error("run_id, issue_id, question_id, and answer are required.");
  }

  await updateIssueContextQuestions(runId, issueId, [
    {
      id: questionId,
      status: "answered",
      answer,
      answered_at: new Date().toISOString(),
    },
  ]);

  try {
    await dispatchWorkflow(runId, "phase3-issue-execution", { issueId });
  } catch (error) {
    if (!isActiveExecutionConflict(error)) {
      throw error;
    }
  }

  revalidateRunPaths(runId);
  redirect(withNavigationNonce(returnTo));
}
