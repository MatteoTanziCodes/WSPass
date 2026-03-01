# Current Status

This document describes the current implementation state of WSPass, what is already working, what is still pending, and how to configure local `.env` values for the system as it exists today.

## Purpose

Use this document for:

- current delivery status
- local setup and testing
- understanding what is real versus planned
- configuring workflow and issue targets safely

Use [README.md](d:/Programming/Projects/WSPass/README.md) for the broader product vision and roadmap.

## What is implemented

The repository currently supports a working planning rail and a working implementation issue-sync rail.

### Shared contracts

- Shared `ArchitecturePack` schema exists in [pass2a.ts](d:/Programming/Projects/WSPass/packages/shared/src/schemas/pass2a.ts)
- Shared run and execution schemas exist in [runs.ts](d:/Programming/Projects/WSPass/packages/shared/src/schemas/runs.ts)
- Shared constants and workflow names are defined in `packages/shared`

### API

- Create runs with persisted PRD input
- List and fetch runs
- Persist run status and step state under `/runs/<runId>/`
- Persist workflow execution state
- Upload and fetch artifacts
- Persist implementation issue sync state
- Dispatch planner and implementation workflows
- Protect agent callback endpoints with bearer auth

Main API entrypoints live under:

- [server.ts](d:/Programming/Projects/WSPass/apps/api/src/server.ts)
- [runs.controller.ts](d:/Programming/Projects/WSPass/apps/api/src/modules/runs/runs.controller.ts)
- [runStore.ts](d:/Programming/Projects/WSPass/apps/api/src/modules/runs/runStore.ts)

### Planner rail

- Planner agent reads a run from the API
- Planner agent calls Anthropic
- Planner agent generates one architecture pack
- Planner output is validated against the shared schema
- Planner artifacts are uploaded back to the API

Planner implementation lives under:

- [planner.ts](d:/Programming/Projects/WSPass/apps/agents/src/cli/planner.ts)
- [runPlannerAgent.ts](d:/Programming/Projects/WSPass/apps/agents/src/planner/runPlannerAgent.ts)
- [llmClient.ts](d:/Programming/Projects/WSPass/apps/agents/src/providers/llmClient.ts)

### Implementation rail

- Implementation agent reads `architecture_pack`
- Implementation agent syncs GitHub issues from `implementation.github_issue_plan`
- Issue sync state is persisted back onto the run
- Summary artifacts are written for issue sync visibility

Implementation rail lives under:

- [implementation.ts](d:/Programming/Projects/WSPass/apps/agents/src/cli/implementation.ts)
- [runImplementationAgent.ts](d:/Programming/Projects/WSPass/apps/agents/src/implementation/runImplementationAgent.ts)
- [githubIssuesClient.ts](d:/Programming/Projects/WSPass/apps/agents/src/implementation/githubIssuesClient.ts)

### Workflow layer

- Planner workflow exists in [.github/workflows/phase1-planner.yml](d:/Programming/Projects/WSPass/.github/workflows/phase1-planner.yml)
- Implementation workflow exists in [.github/workflows/phase2-implementation.yml](d:/Programming/Projects/WSPass/.github/workflows/phase2-implementation.yml)
- Workflow dispatch repo and issue target repo are now separately configurable

## What has been tested

The following paths have been validated locally:

- `npm run typecheck`
- `npm run build`
- `npm run -w @pass/shared validate:samples`
- direct planner generation against Anthropic
- API-backed planner execution from run creation through exported artifacts
- implementation-agent issue sync into GitHub with persisted run state

### Known working outputs

Planner rail:

- `architecture_pack`
- `architecture_pack_summary`
- `architecture_pack_diagram`

Implementation rail:

- `implementation_issue_state`
- `implementation_issue_state_summary`

## What is pending

The following work is still planned or partially defined but not implemented end to end.

### Product and UI

- wireframe composer UI
- conversational refinement UI
- explicit architecture editing loop from the browser
- command center and coordination dashboard

### Coordination and execution control

- pending clarification queue model
- paused-agent state model
- live issue updates based on answered clarifications
- coordination API and persistence model

### Generation and delivery

- IaC generation
- service scaffolding
- repo bootstrap generation
- downstream repo creation for brand-new projects
- existing repo attachment when the user is extending an existing product
- repo configuration management such as settings, secrets, variables, and workflow updates
- documentation generation into downstream repos
- Confluence mirror

### Fleet and change operations

- fleet inventory
- dependency graph
- blast-radius estimates
- batching and rollout rings
- patch management rail
- test automation rail
- command center execution views

## Current limitations

- The web app is not yet the full product experience described in the roadmap.
- Local smoke testing still requires seeding execution state when GitHub workflow dispatch is bypassed.
- The implementation rail currently syncs GitHub issues but does not yet execute code changes in downstream repos.
- Coordination state is described in the contract directionally, but not yet implemented as a first-class runtime rail.
- Anthropic generation is working, but the planner client is intentionally split into multiple smaller generation steps for reliability.

## Current local configuration

The repo expects a root `.env` file.

The current entrypoints load `.env` from repo root:

- [server.ts](d:/Programming/Projects/WSPass/apps/api/src/server.ts)
- [planner.ts](d:/Programming/Projects/WSPass/apps/agents/src/cli/planner.ts)
- [implementation.ts](d:/Programming/Projects/WSPass/apps/agents/src/cli/implementation.ts)

### Recommended `.env` setup

For current usage, configure exactly:

- one local PASS API base URL
- one Anthropic API key and model
- one workflow source repo
- one issue target repo
- one GitHub PAT with the union of permissions needed for both workflow dispatch and target-repo operations

You do not need to set legacy fallback variables for normal local usage.

The simplest current setup is to reuse the same PAT in both:

- `PASS_GITHUB_WORKFLOW_TOKEN`
- `PASS_GITHUB_ISSUES_TOKEN`

That PAT should have access to:

- the workflow source repo, usually `WSPass`
- the downstream target repo, usually a test repo for current usage

If the eventual downstream-project rail is expected to create or modify repos, the PAT should be created with the broader set of permissions needed for that future behavior as well.

### Step 1: API settings

Set the local API values:

- `PASS_API_BASE_URL`
  local base URL used by the agents
- `PASS_API_PUBLIC_BASE_URL`
  callback base URL used by workflow dispatch
- `PASS_API_TOKEN`
  shared bearer token used by protected agent endpoints

Recommended values:

```env
PASS_API_BASE_URL=http://localhost:3001
PASS_API_PUBLIC_BASE_URL=http://localhost:3001
PASS_API_TOKEN=choose-a-random-secret
```

### Step 2: Anthropic settings

Set the planner provider values:

- `ANTHROPIC_API_KEY`
  your Anthropic key
- `ANTHROPIC_MODEL`
  current planner model
- `ANTHROPIC_BASE_URL`
  Anthropic API base URL
- `ANTHROPIC_VERSION`
  Anthropic API version header
- `ANTHROPIC_TIMEOUT_MS`
  request timeout for section generation

Recommended values:

```env
ANTHROPIC_API_KEY=your-anthropic-key
ANTHROPIC_MODEL=claude-sonnet-4-6
ANTHROPIC_BASE_URL=https://api.anthropic.com/v1
ANTHROPIC_VERSION=2023-06-01
ANTHROPIC_TIMEOUT_MS=45000
PASS_2A_VERSION=0.1.0
```

### Step 3: Planner token budgets

These values control the section-by-section Anthropic generation budgets:

- `ANTHROPIC_CORE_MAX_TOKENS`
- `ANTHROPIC_CLARIFICATIONS_MAX_TOKENS`
- `ANTHROPIC_WORKFLOWS_MAX_TOKENS`
- `ANTHROPIC_REQUIREMENTS_MAX_TOKENS`
- `ANTHROPIC_DOMAIN_MAX_TOKENS`
- `ANTHROPIC_ARCHITECTURE_MAX_TOKENS`
- `ANTHROPIC_REFINEMENT_MAX_TOKENS`
- `ANTHROPIC_IMPLEMENTATION_OVERVIEW_MAX_TOKENS`
- `ANTHROPIC_COVERAGE_MAX_TOKENS`

Recommended starting values:

```env
ANTHROPIC_CORE_MAX_TOKENS=350
ANTHROPIC_CLARIFICATIONS_MAX_TOKENS=450
ANTHROPIC_WORKFLOWS_MAX_TOKENS=500
ANTHROPIC_REQUIREMENTS_MAX_TOKENS=700
ANTHROPIC_DOMAIN_MAX_TOKENS=650
ANTHROPIC_ARCHITECTURE_MAX_TOKENS=800
ANTHROPIC_REFINEMENT_MAX_TOKENS=500
ANTHROPIC_IMPLEMENTATION_OVERVIEW_MAX_TOKENS=550
ANTHROPIC_COVERAGE_MAX_TOKENS=500
```

### Step 4: Workflow source repo

This is the repository that contains:

- `.github/workflows/phase1-planner.yml`
- `.github/workflows/phase2-implementation.yml`

For this repo, that is normally `WSPass`.

Set:

- `GITHUB_WORKFLOW_REPOSITORY`
  in `owner/repo` format
- `PASS_GITHUB_WORKFLOW_TOKEN`
  token with workflow or actions dispatch access to that repo
- `GITHUB_WORKFLOW_REF`
  branch or ref to dispatch against
- `GITHUB_PLANNER_WORKFLOW_FILE`
- `GITHUB_IMPLEMENTATION_WORKFLOW_FILE`

Example:

```env
GITHUB_WORKFLOW_REPOSITORY=owner/WSPass
PASS_GITHUB_WORKFLOW_TOKEN=github-token-with-required-access
GITHUB_WORKFLOW_REF=main
GITHUB_PLANNER_WORKFLOW_FILE=phase1-planner.yml
GITHUB_IMPLEMENTATION_WORKFLOW_FILE=phase2-implementation.yml
```

### Step 5: Issue target repo

This is the repository where the Implementation Agent should create or update issues.

For safe testing, this should usually be a disposable test repo, not `WSPass`.

Set:

- `GITHUB_ISSUES_REPOSITORY`
  in `owner/repo` format
- `PASS_GITHUB_ISSUES_TOKEN`
  usually the same PAT as `PASS_GITHUB_WORKFLOW_TOKEN`

Example:

```env
GITHUB_ISSUES_REPOSITORY=owner/test-target-repo
PASS_GITHUB_ISSUES_TOKEN=github-token-with-required-access
```

### Step 6: GitHub PAT permissions

For the current rails plus the planned downstream-repo functionality, the single PAT should be scoped so it can:

- dispatch workflows in `WSPass`
- create and update issues in the target repo
- eventually create or attach to downstream repos
- eventually update repo contents, pull requests, secrets, variables, and workflows when required

Recommended permission set for a personal account PAT:

- `Administration: write`
- `Contents: write`
- `Issues: write`
- `Pull requests: write`
- `Secrets: write`
- `Variables: write`

Add these if the downstream-project rail will need them:

- `Workflows: write`
- `Actions: write`
- `Environments: write`

### Step 7: Optional local override

`RUNS_DIR` is optional.

- leave it empty to use the repo-root `runs/` directory
- set it only if you want run state written elsewhere

### Complete current example

```env
# PASS API
PASS_API_BASE_URL=http://localhost:3001
PASS_API_PUBLIC_BASE_URL=http://localhost:3001
PASS_API_TOKEN=choose-a-random-secret

# Anthropic
ANTHROPIC_API_KEY=your-anthropic-key
ANTHROPIC_MODEL=claude-sonnet-4-6
ANTHROPIC_BASE_URL=https://api.anthropic.com/v1
ANTHROPIC_VERSION=2023-06-01
ANTHROPIC_TIMEOUT_MS=45000
PASS_2A_VERSION=0.1.0

# Planner section budgets
ANTHROPIC_CORE_MAX_TOKENS=350
ANTHROPIC_CLARIFICATIONS_MAX_TOKENS=450
ANTHROPIC_WORKFLOWS_MAX_TOKENS=500
ANTHROPIC_REQUIREMENTS_MAX_TOKENS=700
ANTHROPIC_DOMAIN_MAX_TOKENS=650
ANTHROPIC_ARCHITECTURE_MAX_TOKENS=800
ANTHROPIC_REFINEMENT_MAX_TOKENS=500
ANTHROPIC_IMPLEMENTATION_OVERVIEW_MAX_TOKENS=550
ANTHROPIC_COVERAGE_MAX_TOKENS=500

# Workflow source repo
GITHUB_WORKFLOW_REPOSITORY=owner/WSPass
PASS_GITHUB_WORKFLOW_TOKEN=github-token-with-required-access
GITHUB_WORKFLOW_REF=main
GITHUB_PLANNER_WORKFLOW_FILE=phase1-planner.yml
GITHUB_IMPLEMENTATION_WORKFLOW_FILE=phase2-implementation.yml

# Issue target repo
GITHUB_ISSUES_REPOSITORY=owner/test-target-repo
PASS_GITHUB_ISSUES_TOKEN=github-token-with-required-access

# Optional
RUNS_DIR=
```

### What you actually need to change

For most setups, only these fields need to be replaced with real values:

- `PASS_API_TOKEN`
- `ANTHROPIC_API_KEY`
- `GITHUB_WORKFLOW_REPOSITORY`
- `PASS_GITHUB_WORKFLOW_TOKEN`
- `GITHUB_ISSUES_REPOSITORY`
- `PASS_GITHUB_ISSUES_TOKEN`

In the simplest setup, `PASS_GITHUB_WORKFLOW_TOKEN` and `PASS_GITHUB_ISSUES_TOKEN` can be the same value.

## GitHub configuration rules

There are now two separate GitHub targets.

### Workflow source repository

This is the repository that contains:

- `phase1-planner.yml`
- `phase2-implementation.yml`

Configure it with:

- `GITHUB_WORKFLOW_REPOSITORY`
- or `GITHUB_WORKFLOW_OWNER` plus `GITHUB_WORKFLOW_REPO`

Optional token override:

- `PASS_GITHUB_WORKFLOW_TOKEN`
- or `GITHUB_WORKFLOW_TOKEN`

### Issue target repository

This is the repository where implementation issues should be created or updated.

Configure it with:

- `GITHUB_ISSUES_REPOSITORY`
- or `GITHUB_ISSUES_OWNER` plus `GITHUB_ISSUES_REPO`

Optional token override:

- `PASS_GITHUB_ISSUES_TOKEN`
- or `GITHUB_ISSUES_TOKEN`

### Backward compatibility

The code still falls back to legacy shared vars if the split vars are not set:

- `GITHUB_REPOSITORY`
- `GITHUB_OWNER`
- `GITHUB_REPO`
- `PASS_GITHUB_TOKEN`
- `GITHUB_TOKEN`

For current usage, prefer the split variables.

## Recommended local setup

If you are testing the system safely, use:

- workflow source repo = `WSPass`
- issue target repo = a separate disposable test repo
- same PAT copied into both GitHub token fields unless you deliberately want permission isolation

That lets the system orchestrate from this repo while writing implementation issues somewhere else.

## Current local test flow

### Build and validate

```bash
npm install
npm run typecheck
npm run build
npm run -w @pass/shared validate:samples
```

### Start the API

```bash
node apps/api/dist/server.js
```

### Create a run

Send a `POST` request to `/runs` with:

```json
{
  "prd_text": "Your PRD text here",
  "requested_by": "local-test"
}
```

### Run the planner locally

```bash
node apps/agents/dist/cli/planner.js --run-id=<run-id>
```

### Run the implementation agent locally

```bash
node apps/agents/dist/cli/implementation.js --run-id=<run-id>
```

## Suggested next work

1. Add a dedicated local smoke script so run creation, execution seeding, planner execution, and implementation execution can be tested without manual steps.
2. Add coordination-state persistence and pause or resume behavior.
3. Add a browser UI for architecture refinement and coordination visibility.
4. Add downstream repo generation and IaC scaffolding.
