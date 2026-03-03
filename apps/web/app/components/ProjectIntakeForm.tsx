"use client";

import { useEffect, useMemo, useState } from "react";
import { createRunAction } from "../actions";
import { FormSubmitButton } from "./FormSubmitButton";
import type { GitHubRepository } from "../lib/github";

function repoShortName(fullName: string) {
  const parts = fullName.split("/");
  return parts[parts.length - 1] ?? fullName;
}

export function ProjectIntakeForm(props: { repositories: GitHubRepository[] }) {
  const { repositories } = props;
  const [repoMode, setRepoMode] = useState<"new" | "existing">("new");
  const [selectedExistingRepository, setSelectedExistingRepository] = useState("");
  const [repoVisibility, setRepoVisibility] = useState<"private" | "public">("private");

  const selectedRepo = useMemo(
    () => repositories.find((repo) => repo.full_name === selectedExistingRepository),
    [repositories, selectedExistingRepository]
  );
  const existingVisibilityLabel = selectedRepo
    ? selectedRepo.private
      ? "Private"
      : "Public"
    : "Not selected";
  const repoNameLabel = repoMode === "existing" ? "Edit Repo Name" : "New Repo Name";
  const repoVisibilityLabel =
    repoMode === "existing" ? "Edit Repo Visibility" : "New Repo Visibility";

  useEffect(() => {
    if (repoMode === "existing" && selectedRepo) {
      setRepoVisibility(selectedRepo.private ? "private" : "public");
      return;
    }

    if (repoMode === "new") {
      setRepoVisibility((current) => current || "private");
    }
  }, [repoMode, selectedRepo]);

  return (
    <form
      action={createRunAction}
      className="space-y-5 border border-[color:var(--line)] bg-[color:var(--panel-soft)] p-5"
    >
      <div>
        <label
          htmlFor="prd_text"
          className="block font-mono text-[11px] uppercase tracking-[0.18em] text-[color:var(--muted)]"
        >
          PRD Text
        </label>
        <textarea
          id="prd_text"
          name="prd_text"
          rows={9}
          className="mt-2 w-full border border-[color:var(--line)] bg-transparent px-4 py-3 text-sm leading-6 text-[color:var(--ink-strong)] outline-none transition focus:border-[color:var(--accent)]"
          placeholder="Paste the product requirements in natural language."
        />
        <p className="mt-2 font-mono text-[11px] uppercase tracking-[0.14em] text-[color:var(--muted)]">
          Provide either PRD text or a PRD file.
        </p>
      </div>

      <div>
        <label
          htmlFor="prd_file"
          className="block font-mono text-[11px] uppercase tracking-[0.18em] text-[color:var(--muted)]"
        >
          PRD File
        </label>
        <input
          id="prd_file"
          name="prd_file"
          type="file"
          accept=".txt,.md,.markdown,.rtf,.docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
          className="mt-2 block w-full border border-[color:var(--line)] bg-transparent px-4 py-3 text-sm file:mr-3 file:border file:border-[color:var(--line)] file:bg-[color:var(--panel-strong)] file:px-3 file:py-1 file:font-mono file:text-[11px] file:uppercase file:tracking-[0.14em]"
        />
        <p className="mt-2 font-mono text-[11px] uppercase tracking-[0.14em] text-[color:var(--muted)]">
          Supports .txt, .md, .rtf, and .docx
        </p>
      </div>

      <div>
        <label
          htmlFor="org_constraints_text"
          className="block font-mono text-[11px] uppercase tracking-[0.18em] text-[color:var(--muted)]"
        >
          Org Constraints
        </label>
        <textarea
          id="org_constraints_text"
          name="org_constraints_text"
          rows={5}
          className="mt-2 w-full border border-[color:var(--line)] bg-transparent px-4 py-3 text-sm leading-6 text-[color:var(--ink-strong)] outline-none transition focus:border-[color:var(--accent)]"
          placeholder="Describe preferred cloud, compliance, stack, security, or internal standards in plain English."
        />
      </div>

      <div>
        <label
          htmlFor="org_constraints_file"
          className="block font-mono text-[11px] uppercase tracking-[0.18em] text-[color:var(--muted)]"
        >
          Org Constraints File
        </label>
        <input
          id="org_constraints_file"
          name="org_constraints_file"
          type="file"
          accept=".txt,.md,.markdown,.rtf,.docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
          className="mt-2 block w-full border border-[color:var(--line)] bg-transparent px-4 py-3 text-sm file:mr-3 file:border file:border-[color:var(--line)] file:bg-[color:var(--panel-strong)] file:px-3 file:py-1 file:font-mono file:text-[11px] file:uppercase file:tracking-[0.14em]"
        />
        <p className="mt-2 font-mono text-[11px] uppercase tracking-[0.14em] text-[color:var(--muted)]">
          Supports .txt, .md, .rtf, and .docx
        </p>
      </div>

      <div>
        <label
          htmlFor="design_guidelines_text"
          className="block font-mono text-[11px] uppercase tracking-[0.18em] text-[color:var(--muted)]"
        >
          Design Guidelines
        </label>
        <textarea
          id="design_guidelines_text"
          name="design_guidelines_text"
          rows={5}
          className="mt-2 w-full border border-[color:var(--line)] bg-transparent px-4 py-3 text-sm leading-6 text-[color:var(--ink-strong)] outline-none transition focus:border-[color:var(--accent)]"
          placeholder="Describe visual direction, color guidance, typography, accessibility, linting, or frontend standards in plain English."
        />
      </div>

      <div>
        <label
          htmlFor="design_guidelines_file"
          className="block font-mono text-[11px] uppercase tracking-[0.18em] text-[color:var(--muted)]"
        >
          Design Guidelines File
        </label>
        <input
          id="design_guidelines_file"
          name="design_guidelines_file"
          type="file"
          accept=".txt,.md,.markdown,.rtf,.docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
          className="mt-2 block w-full border border-[color:var(--line)] bg-transparent px-4 py-3 text-sm file:mr-3 file:border file:border-[color:var(--line)] file:bg-[color:var(--panel-strong)] file:px-3 file:py-1 file:font-mono file:text-[11px] file:uppercase file:tracking-[0.14em]"
        />
        <p className="mt-2 font-mono text-[11px] uppercase tracking-[0.14em] text-[color:var(--muted)]">
          Supports .txt, .md, .rtf, and .docx
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <div>
          <label
            htmlFor="repo_mode"
            className="block font-mono text-[11px] uppercase tracking-[0.18em] text-[color:var(--muted)]"
          >
            Repo Mode
          </label>
          <select
            id="repo_mode"
            name="repo_mode"
            value={repoMode}
            onChange={(event) => setRepoMode(event.target.value as "new" | "existing")}
            className="mt-2 w-full border border-[color:var(--line)] bg-transparent px-4 py-3 text-sm outline-none transition focus:border-[color:var(--accent)]"
          >
            <option value="new">Create new repo</option>
            <option value="existing">Use existing repo</option>
          </select>
        </div>
        <div>
          <label
            htmlFor="repo_visibility"
            className="block font-mono text-[11px] uppercase tracking-[0.18em] text-[color:var(--muted)]"
          >
            {repoVisibilityLabel}
          </label>
          <select
            id="repo_visibility"
            name="repo_visibility"
            value={repoVisibility}
            onChange={(event) => setRepoVisibility(event.target.value as "private" | "public")}
            className="mt-2 w-full border border-[color:var(--line)] bg-transparent px-4 py-3 text-sm outline-none transition focus:border-[color:var(--accent)]"
          >
            <option value="private">Private</option>
            <option value="public">Public</option>
          </select>
          {repoMode === "existing" ? (
            <p className="mt-2 font-mono text-[11px] uppercase tracking-[0.14em] text-[color:var(--muted)]">
              Current visibility: {existingVisibilityLabel}
            </p>
          ) : null}
        </div>
      </div>

      <div>
        <label
          htmlFor="existing_repository"
          className="block font-mono text-[11px] uppercase tracking-[0.18em] text-[color:var(--muted)]"
        >
          Existing Repo
        </label>
        <select
          id="existing_repository"
          name="existing_repository"
          value={selectedExistingRepository}
          onChange={(event) => setSelectedExistingRepository(event.target.value)}
          className="mt-2 w-full border border-[color:var(--line)] bg-transparent px-4 py-3 text-sm outline-none transition focus:border-[color:var(--accent)]"
        >
          <option value="">Select a reachable repository</option>
          {repositories.map((repo) => (
            <option key={repo.id} value={repo.full_name}>
              {repo.full_name}
            </option>
          ))}
        </select>
        <p className="mt-2 font-mono text-[11px] uppercase tracking-[0.14em] text-[color:var(--muted)]">
          {repositories.length} repos visible to the configured token
        </p>
        {repoMode === "existing" && selectedRepo ? (
          <p className="mt-2 font-mono text-[11px] uppercase tracking-[0.14em] text-[color:var(--muted)]">
            Current repo: {selectedRepo.full_name} // {existingVisibilityLabel}
          </p>
        ) : null}
      </div>

      <div>
        <label
          htmlFor="repo_name"
          className="block font-mono text-[11px] uppercase tracking-[0.18em] text-[color:var(--muted)]"
        >
          {repoNameLabel}
        </label>
        <input
          id="repo_name"
          name="repo_name"
          className="mt-2 w-full border border-[color:var(--line)] bg-transparent px-4 py-3 text-sm outline-none transition focus:border-[color:var(--accent)]"
          placeholder={repoMode === "existing" ? selectedRepo ? repoShortName(selectedRepo.full_name) : "existing-repo-name" : "project-name"}
        />
        {repoMode === "existing" ? (
          <p className="mt-2 font-mono text-[11px] uppercase tracking-[0.14em] text-[color:var(--muted)]">
            Leave blank to keep the current repo name.
          </p>
        ) : null}
      </div>

      <FormSubmitButton
        idleLabel="Create Project"
        pendingLabel="Creating project..."
        className="w-full border border-[color:var(--accent)] bg-[color:var(--accent)] px-4 py-3 font-mono text-sm uppercase tracking-[0.18em] text-white transition hover:bg-transparent hover:text-[color:var(--accent)] disabled:cursor-not-allowed disabled:opacity-50"
      />
    </form>
  );
}
