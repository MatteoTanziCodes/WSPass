type ProjectIdentityRun = {
  run_id: string;
  repo_state?: {
    repository?: string;
  };
  input?: {
    repo_target?: {
      repository?: string;
      name?: string;
    };
  };
};

export function deriveProjectKeyFromRun(run: ProjectIdentityRun) {
  return (
    run.repo_state?.repository?.trim() ||
    run.input?.repo_target?.repository?.trim() ||
    run.input?.repo_target?.name?.trim() ||
    run.run_id
  );
}

export function deriveProjectLabelFromRun(run: ProjectIdentityRun) {
  return (
    run.repo_state?.repository?.trim() ||
    run.input?.repo_target?.repository?.trim() ||
    run.input?.repo_target?.name?.trim() ||
    "Untitled project"
  );
}
