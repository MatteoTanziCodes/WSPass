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
  updateArchitectureChat,
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
  redirect(buildProjectRedirect(run.run_id, `/projects/${run.run_id}/architecture?project=${encodeURIComponent(projectKey)}`));
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
    | "phase2-implementation";

  if (!runId || !workflowName) {
    throw new Error("run_id and workflow_name are required.");
  }

  try {
    await dispatchWorkflow(runId, workflowName);
  } catch (error) {
    if (!isActiveExecutionConflict(error)) {
      throw error;
    }
  }
  revalidateRunPaths(runId);
  redirect(buildProjectRedirect(runId, returnTo));
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

  redirect(returnTo);
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
  redirect(buildProjectRedirect(runId, returnTo));
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

  const completedRun = await waitForWorkflowTerminal(
    runId,
    workflowName,
    150_000
  );
  ensureWorkflowSucceeded(completedRun, workflowName);
  revalidateRunPaths(runId);

  if (workflowName === "phase2-decomposition") {
    redirect(buildProjectRedirect(runId, returnTo));
  }

  if (isReviewReadyStatus(completedRun?.run.decomposition_review_state?.status)) {
    redirect(`/projects/${runId}/build`);
  }

  redirect(buildProjectRedirect(runId, returnTo));
}

export async function answerDecompositionReviewQuestionAction(formData: FormData) {
  const runId = String(formData.get("run_id") ?? "").trim();
  const questionId = String(formData.get("question_id") ?? "").trim();
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

  if (!runId || !questionId || !answer) {
    throw new Error("run_id, question_id, and answer are required.");
  }

  await answerDecompositionReviewQuestion(runId, {
    question_id: questionId,
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
    `Iterator clarification answer for ${questionId}:\n${answer}`,
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
    redirect(`/projects/${runId}/build`);
  }

  redirect(buildProjectRedirect(runId, returnTo));
}
