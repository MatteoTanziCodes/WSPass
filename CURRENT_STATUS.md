# Current Status

This document describes the current implementation state of WSPass, what is already working, what is still pending, and how to configure local `.env` values for the system as it exists today.

## Purpose

Use this document for:

- current delivery status
- local setup and testing
- understanding what is real versus planned
- configuring workflow and downstream target-repo settings safely

Use [README.md](d:/Programming/Projects/WSPass/README.md) for the broader product vision and roadmap.

## What is implemented

The repository currently supports a working planning rail and a working implementation issue-sync rail.
It now also supports a working repo-resolution rail for attaching to an existing downstream repo or creating a new one.
It also includes a first-stage dashboard and a dedicated decomposition rail between architecture and issue sync.
The dashboard enforces pipeline gates, surfaces execution errors with workflow links, and includes a pipeline progress timeline.
The decomposition state machine is complete and all four statuses are in use: `not_started`, `draft`, `approved`, and `synced`.

The intended user input surface is intentionally small:

- PRD text
- optional org constraints YAML
- whether the target repo exists already
- new repo name if the repo does not exist
- new repo visibility if the repo does not exist

Descriptions, repo bootstrap docs, issue plans, and other delivery artifacts are expected to be agent-generated from that input.

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
- Enforce prerequisite checks before workflow dispatch and return 409 with a message when prerequisites are not met

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
- Planner initializes architecture chat state for refinement

Planner implementation lives under:

- [planner.ts](d:/Programming/Projects/WSPass/apps/agents/src/cli/planner.ts)
- [runPlannerAgent.ts](d:/Programming/Projects/WSPass/apps/agents/src/planner/runPlannerAgent.ts)
- [llmClient.ts](d:/Programming/Projects/WSPass/apps/agents/src/providers/llmClient.ts)

### Architecture refinement rail

- Architecture refinement agent reads the current architecture pack and architecture chat state
- Refinement requests are submitted from the dashboard chat
- The refinement agent updates `architecture_pack`, summary, diagram, and chat history
- Decomposition state is reset when architecture changes

Architecture refinement lives under:

- [architectureRefinement.ts](d:/Programming/Projects/WSPass/apps/agents/src/cli/architectureRefinement.ts)
- [runArchitectureRefinementAgent.ts](d:/Programming/Projects/WSPass/apps/agents/src/architecture/runArchitectureRefinementAgent.ts)

### Decomposition rail

- Decomposition agent reads the finalized architecture pack
- Decomposition agent generates a granular backlog artifact of very small work items
- Decomposition state is persisted onto the run as `draft`, then `approved`, then `synced`
- Decomposition state resets to `not_started` when architecture is refined after generation
- Implementation issue sync is gated on decomposition approval

Decomposition rail lives under:

- [decomposition.ts](d:/Programming/Projects/WSPass/apps/agents/src/cli/decomposition.ts)
- [runDecompositionAgent.ts](d:/Programming/Projects/WSPass/apps/agents/src/decomposition/runDecompositionAgent.ts)

### Implementation rail

- Implementation agent reads `architecture_pack`
- Implementation agent syncs GitHub issues from the approved decomposition plan
- Issue sync state is persisted back onto the run
- Summary artifacts are written for issue sync visibility
- After issue sync completes, decomposition state is set to `synced`

At the moment, issue sync exists as a runtime capability, but the intended product flow is to use it only after the architecture and decomposition have been reviewed and approved.

Implementation rail lives under:

- [implementation.ts](d:/Programming/Projects/WSPass/apps/agents/src/cli/implementation.ts)
- [runImplementationAgent.ts](d:/Programming/Projects/WSPass/apps/agents/src/implementation/runImplementationAgent.ts)
- [githubIssuesClient.ts](d:/Programming/Projects/WSPass/apps/agents/src/implementation/githubIssuesClient.ts)

### Workflow layer

- Planner workflow exists in [.github/workflows/phase1-planner.yml](d:/Programming/Projects/WSPass/.github/workflows/phase1-planner.yml)
- Architecture refinement workflow exists in [.github/workflows/phase1-architecture-refinement.yml](d:/Programming/Projects/WSPass/.github/workflows/phase1-architecture-refinement.yml)
- Repo provisioning workflow exists in [.github/workflows/phase2-repo-provision.yml](d:/Programming/Projects/WSPass/.github/workflows/phase2-repo-provision.yml)
- Decomposition workflow exists in [.github/workflows/phase2-decomposition.yml](d:/Programming/Projects/WSPass/.github/workflows/phase2-decomposition.yml)
- Implementation workflow exists in [.github/workflows/phase2-implementation.yml](d:/Programming/Projects/WSPass/.github/workflows/phase2-implementation.yml)
- Workflow dispatch repo and downstream target repo are now separately configurable

### Dashboard

- The placeholder web app has been replaced with a first-stage dashboard
- The dashboard can create runs, list repos the GitHub token can access, dispatch workflows, show the current architecture, accept chat refinement input, and display decomposition output
- Org constraints YAML can be supplied at run creation time
- Action buttons are gated on pipeline state and show disabled with a hover tooltip when prerequisites are not met
- An error banner appears when a workflow fails, showing the error message and a direct link to the GitHub Actions run
- A pipeline timeline shows step progress with timestamps (Created → Architecture → Repo → Decompose → Approved → Synced)
- A stale decomposition warning appears when architecture has been refined after the last decomposition was generated
- The decomposition status badge is color-coded: neutral for `not_started`, orange for `draft`, green for `approved`, blue for `synced`
- Dark mode is available via a toggle in the sidebar and persists across sessions
- The dashboard is server-driven and currently refresh-based, not real-time

## What has been tested

The following paths have been validated locally:

- `npm run typecheck`
- `npm run build`
- `npm run -w @pass/shared validate:samples`
- direct planner generation against Anthropic
- API-backed planner execution from run creation through exported artifacts
- API-backed repo resolution onto a run with persisted `repo_state`
- implementation-agent issue sync into GitHub with persisted run state
- repo-wide typecheck and build after adding the dashboard, architecture refinement rail, and decomposition rail

The following paths have been validated end to end against live GitHub Actions:

- Phase 1 planner: `architecture_pack`, summary, and diagram artifacts generated and persisted; dashboard renders architecture diagram, data flows, and tradeoffs
- Phase 2 decomposition: `decomposition_plan` generated and persisted; dashboard renders the async work map
- Decomposition approval: run moves to `approved` state and persists across refresh
- Actions-to-API communication: runners authenticate and write back through `PASS_API_PUBLIC_BASE_URL`

### Known working outputs

Planner rail:

- `architecture_pack`
- `architecture_pack_summary`
- `architecture_pack_diagram`
- `architecture_chat`

Repo resolution rail:

- `repo_state`
- `repo_state_summary`

Decomposition rail:

- `decomposition_plan`
- `decomposition_plan_summary`

Implementation rail:

- `implementation_issue_state`
- `implementation_issue_state_summary`

## What is pending

The following work is still planned or partially defined but not implemented end to end.

### Product and UI

- wireframe composer UI
- explicit architecture editing loop from the browser
- live dashboard updates without manual refresh
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
- The dashboard currently renders architecture cards, refinement chat, and decomposition output, but does not yet provide a true drag-and-edit wireframe composer.
- Repo resolution currently supports attaching to an existing repo and personal-account repo creation logic, but it does not yet configure secrets, variables, workflows, or repo contents.
- New repo descriptions are now derived automatically from the PRD when the user does not supply additional metadata.
- Coordination state is described in the contract directionally, but not yet implemented as a first-class runtime rail.
- Anthropic generation is working, but the planner client is intentionally split into multiple smaller generation steps for reliability.
- The dashboard is refresh-based; it does not yet poll or stream workflow progress in real time.

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
- one optional fallback issue target repo
- one GitHub PAT used for every GitHub operation
- optional repo-provision workflow file override if you do not want to use the default workflow filename
- optional refinement and decomposition workflow file overrides

You do not need to set legacy fallback variables for normal local usage.

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

When running workflows via GitHub Actions, the runner cannot reach `localhost`. Set `PASS_API_PUBLIC_BASE_URL` to a publicly reachable URL (e.g. an ngrok tunnel) and add it as a GitHub repo variable alongside `PASS_API_TOKEN` and `ANTHROPIC_API_KEY` as repo secrets.

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
ANTHROPIC_TIMEOUT_MS=90000
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
- `ANTHROPIC_ARCHITECTURE_REFINEMENT_MAX_TOKENS`
- `ANTHROPIC_IMPLEMENTATION_OVERVIEW_MAX_TOKENS`
- `ANTHROPIC_DECOMPOSITION_MAX_TOKENS`
- `ANTHROPIC_COVERAGE_MAX_TOKENS`

Recommended starting values:

```env
ANTHROPIC_CORE_MAX_TOKENS=350
ANTHROPIC_CLARIFICATIONS_MAX_TOKENS=450
ANTHROPIC_WORKFLOWS_MAX_TOKENS=500
ANTHROPIC_REQUIREMENTS_MAX_TOKENS=1000
ANTHROPIC_DOMAIN_MAX_TOKENS=650
ANTHROPIC_ARCHITECTURE_MAX_TOKENS=1200
ANTHROPIC_REFINEMENT_MAX_TOKENS=500
ANTHROPIC_ARCHITECTURE_REFINEMENT_MAX_TOKENS=5000
ANTHROPIC_IMPLEMENTATION_OVERVIEW_MAX_TOKENS=550
ANTHROPIC_DECOMPOSITION_MAX_TOKENS=5000
ANTHROPIC_COVERAGE_MAX_TOKENS=1200
```

### Step 4: Workflow source repo

This is the repository that contains:

- `.github/workflows/phase1-planner.yml`
- `.github/workflows/phase1-architecture-refinement.yml`
- `.github/workflows/phase2-decomposition.yml`
- `.github/workflows/phase2-implementation.yml`

For this repo, that is normally `WSPass`.

Set:

- `GITHUB_WORKFLOW_REPOSITORY`
  in `owner/repo` format
- `PASS_GITHUB_WORKFLOW_TOKEN`
  token used for workflow dispatch, repo provisioning, and issue sync
- `GITHUB_WORKFLOW_REF`
  branch or ref to dispatch against
- `GITHUB_ARCHITECTURE_REFINEMENT_WORKFLOW_FILE`
- `GITHUB_DECOMPOSITION_WORKFLOW_FILE`
- `GITHUB_REPO_PROVISION_WORKFLOW_FILE`
- `GITHUB_PLANNER_WORKFLOW_FILE`
- `GITHUB_IMPLEMENTATION_WORKFLOW_FILE`

Example:

```env
GITHUB_WORKFLOW_REPOSITORY=owner/WSPass
PASS_GITHUB_WORKFLOW_TOKEN=github-token-with-required-access
GITHUB_WORKFLOW_REF=main
GITHUB_ARCHITECTURE_REFINEMENT_WORKFLOW_FILE=phase1-architecture-refinement.yml
GITHUB_DECOMPOSITION_WORKFLOW_FILE=phase2-decomposition.yml
GITHUB_REPO_PROVISION_WORKFLOW_FILE=phase2-repo-provision.yml
GITHUB_PLANNER_WORKFLOW_FILE=phase1-planner.yml
GITHUB_IMPLEMENTATION_WORKFLOW_FILE=phase2-implementation.yml
```

### Step 5: Issue target repo

This is the repository where the Implementation Agent should create or update issues.

For safe testing, this should usually be a disposable test repo, not `WSPass`.

If the run input includes `repo_target`, that modular input takes precedence and `GITHUB_ISSUES_REPOSITORY` is not required as a fallback for that run.

Set:

- `GITHUB_ISSUES_REPOSITORY`
  in `owner/repo` format

Example:

```env
GITHUB_ISSUES_REPOSITORY=owner/test-target-repo
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
ANTHROPIC_TIMEOUT_MS=90000
PASS_2A_VERSION=0.1.0

# Planner section budgets
ANTHROPIC_CORE_MAX_TOKENS=350
ANTHROPIC_CLARIFICATIONS_MAX_TOKENS=450
ANTHROPIC_WORKFLOWS_MAX_TOKENS=500
ANTHROPIC_REQUIREMENTS_MAX_TOKENS=1000
ANTHROPIC_DOMAIN_MAX_TOKENS=650
ANTHROPIC_ARCHITECTURE_MAX_TOKENS=1200
ANTHROPIC_REFINEMENT_MAX_TOKENS=500
ANTHROPIC_ARCHITECTURE_REFINEMENT_MAX_TOKENS=5000
ANTHROPIC_IMPLEMENTATION_OVERVIEW_MAX_TOKENS=550
ANTHROPIC_DECOMPOSITION_MAX_TOKENS=5000
ANTHROPIC_COVERAGE_MAX_TOKENS=1200

# Workflow source repo
GITHUB_WORKFLOW_REPOSITORY=owner/WSPass
PASS_GITHUB_WORKFLOW_TOKEN=github-token-with-required-access
GITHUB_WORKFLOW_REF=main
GITHUB_ARCHITECTURE_REFINEMENT_WORKFLOW_FILE=phase1-architecture-refinement.yml
GITHUB_DECOMPOSITION_WORKFLOW_FILE=phase2-decomposition.yml
GITHUB_REPO_PROVISION_WORKFLOW_FILE=phase2-repo-provision.yml
GITHUB_PLANNER_WORKFLOW_FILE=phase1-planner.yml
GITHUB_IMPLEMENTATION_WORKFLOW_FILE=phase2-implementation.yml

# Optional issue target fallback
GITHUB_ISSUES_REPOSITORY=owner/test-target-repo

# Optional
RUNS_DIR=
```

### What you actually need to change

For most setups, only these fields need to be replaced with real values:

- `PASS_API_TOKEN`
- `ANTHROPIC_API_KEY`
- `GITHUB_WORKFLOW_REPOSITORY`
- `PASS_GITHUB_WORKFLOW_TOKEN`
- `GITHUB_ISSUES_REPOSITORY` only if you want a default fallback repo when `repo_target` is not provided

## GitHub configuration rules

There are now two separate GitHub targets.

### Workflow source repository

This is the repository that contains:

- `phase1-planner.yml`
- `phase2-implementation.yml`

Configure it with:

- `GITHUB_WORKFLOW_REPOSITORY`
- or `GITHUB_WORKFLOW_OWNER` plus `GITHUB_WORKFLOW_REPO`

Primary token:

- `PASS_GITHUB_WORKFLOW_TOKEN`

Legacy fallback:

- `GITHUB_WORKFLOW_TOKEN`

### Issue target repository

This is the repository where implementation issues should be created or updated.

Configure it with:

- `GITHUB_ISSUES_REPOSITORY`
- or `GITHUB_ISSUES_OWNER` plus `GITHUB_ISSUES_REPO`

No separate issue token is needed. Implementation issue sync uses the same workflow PAT.

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
- one PAT in `PASS_GITHUB_WORKFLOW_TOKEN`

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

Only do this after the architecture has been reviewed and you are ready to synchronize the approved backlog into GitHub issues.

### Run the architecture refinement agent locally

```bash
node apps/agents/dist/cli/architectureRefinement.js --run-id=<run-id>
```

### Run the decomposition agent locally

```bash
node apps/agents/dist/cli/decomposition.js --run-id=<run-id>
```

### Run the repo-provisioning agent locally

```bash
node apps/agents/dist/cli/repoProvision.js --run-id=<run-id>
```

## Suggested next work

1. Smoke-test the architecture refinement workflow end to end against live GitHub Actions.
2. Add live dashboard polling or streaming so workflow progress updates without manual refresh.
3. Add coordination-state persistence and pause or resume behavior.
4. Upgrade the dashboard into a true editable wireframe surface.
5. Add downstream repo generation and IaC scaffolding.