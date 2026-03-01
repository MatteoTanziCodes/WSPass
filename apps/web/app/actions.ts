"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { ArchitectureChatStateSchema } from "@pass/shared";
import {
  approveDecomposition,
  createRun,
  dispatchWorkflow,
  getRun,
  updateArchitectureChat,
} from "./lib/passApi";

function buildProjectRedirect(runId: string, projectKey?: string) {
  const search = new URLSearchParams({ runId });
  if (projectKey) {
    search.set("project", projectKey);
  }
  return `/?${search.toString()}`;
}

export async function createRunAction(formData: FormData) {
  const prdText = String(formData.get("prd_text") ?? "").trim();
  const repoMode = String(formData.get("repo_mode") ?? "existing").trim();

  if (!prdText) {
    throw new Error("PRD text is required.");
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
        };

  const run = await createRun({
    prd_text: prdText,
    requested_by: "dashboard",
    repo_target: repoTarget,
  });

  const projectKey =
    repoTarget.mode === "use_existing_repo"
      ? repoTarget.repository
      : repoTarget.name;
  await dispatchWorkflow(run.run_id, "phase1-planner");
  revalidatePath("/");
  redirect(buildProjectRedirect(run.run_id, projectKey));
}

export async function dispatchWorkflowAction(formData: FormData) {
  const runId = String(formData.get("run_id") ?? "").trim();
  const projectKey = String(formData.get("project_key") ?? "").trim() || undefined;
  const workflowName = String(formData.get("workflow_name") ?? "").trim() as
    | "phase1-planner"
    | "phase1-architecture-refinement"
    | "phase2-repo-provision"
    | "phase2-decomposition"
    | "phase2-implementation";

  if (!runId || !workflowName) {
    throw new Error("run_id and workflow_name are required.");
  }

  await dispatchWorkflow(runId, workflowName);
  revalidatePath("/");
  redirect(buildProjectRedirect(runId, projectKey));
}

export async function sendArchitectureFeedbackAction(formData: FormData) {
  const runId = String(formData.get("run_id") ?? "").trim();
  const projectKey = String(formData.get("project_key") ?? "").trim() || undefined;
  const content = String(formData.get("feedback") ?? "").trim();

  if (!runId || !content) {
    throw new Error("run_id and feedback are required.");
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

  const nextState = ArchitectureChatStateSchema.parse({
    updated_at: new Date().toISOString(),
    messages: [
      ...currentState.messages,
      {
        id: `user_${Date.now()}`,
        role: "user",
        content,
        created_at: new Date().toISOString(),
      },
    ],
  });

  await updateArchitectureChat(runId, nextState);
  await dispatchWorkflow(runId, "phase1-architecture-refinement");
  revalidatePath("/");
  redirect(buildProjectRedirect(runId, projectKey));
}

export async function approveDecompositionAction(formData: FormData) {
  const runId = String(formData.get("run_id") ?? "").trim();
  const projectKey = String(formData.get("project_key") ?? "").trim() || undefined;
  if (!runId) {
    throw new Error("run_id is required.");
  }

  await approveDecomposition(runId, "dashboard");
  revalidatePath("/");
  redirect(buildProjectRedirect(runId, projectKey));
}
