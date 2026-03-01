# Runs (filesystem run tracking)

This module is the “run history + artifacts” backbone for PASS-2A.

A **run** is one attempt at generating a planning rail from a PRD: one architecture, one implementation rail, and the refinement context needed to keep later implementation agents aligned. For the MVP, I’m keeping this **filesystem-only** (no DB, no dashboard) so the demo stays tight and deterministic.

## Current state

✅ Implemented
- Filesystem-backed run tracking (no DB):
  - `runs/index.json` (run history)
  - `runs/<runId>/run.json` (per-run record + `step_timestamps`)
  - `runs/<runId>/artifacts/` + `artifacts/index.json` (artifact manifest)
- API endpoints:
  - `POST /runs` (create a planner run with PRD input)
  - `GET /runs` (list runs + `total`)
  - `GET /runs/:runId` (run details + generated planning artifacts)
  - `PATCH /runs/:runId` (update `status` / `current_step`, records step timestamps once)
- Deterministic ordering + schema validation on read/write + atomic file writes

🚧 Not implemented yet (next steps)
- Rich conversational refinement history and persisted wireframe edits
- GitHub issue synchronization for implementation rails
- Implementation-agent pause and resume state surfaced through a coordination panel
- Frontend wizard UI to create runs, review the generated architecture, and refine it in wireframe/chat (Step 3)
- Any database/dashboard/SSE tracing (explicitly out of scope for MVP)

## What gets written to disk (repo root)

By default, run data is stored under:

- `WSPASS/runs/index.json`  
  Minimal run history (newest-first). This is what `GET /runs` reads.

- `WSPASS/runs/<runId>/run.json`  
  Full run record, including `step_timestamps` (when each step was first reached).

- `WSPASS/runs/<runId>/artifacts/`  
  Generated planning outputs live here (`architecture_pack.json`, markdown summary, Mermaid diagram, and future issue-plan / refinement artifacts).  
  We also maintain `artifacts/index.json` as a manifest so we don’t have to scan the folder.

> Note: `runs/` is runtime output and is gitignored (`/runs/`). The source code for this module *is* committed.

## Why it’s built this way

- **Deterministic + schema-validated:** every read/write is validated with Zod so corrupted/invalid files don’t silently poison state.
- **Atomic writes:** JSON files are written safely to avoid partially-written output if the process crashes.
- **No platform creep:** filesystem artifacts now, can upgrade later if needed.

## API Endpoints

- `POST /runs`  
  Creates a new planner run from PRD input, writes `run.json`, and updates `runs/index.json`.

- `GET /runs`  
  Returns `{ total, runs }` from `runs/index.json` (newest-first), showing planning runs for architecture plus implementation rail generation.

- `GET /runs/:runId`  
  Returns `{ run, artifacts }` (run metadata plus generated architecture and implementation-planning artifacts).

- `PATCH /runs/:runId`  
  Updates a run’s `status` and/or `current_step`, and records step timestamps the first time a run reaches parse, plan generation, or export.

## Config (optional)

If you want to change where runs are written, set:

- `RUNS_DIR=<absolute path>`

Default behavior is anchored to the repo root so the output location doesn’t depend on where you start the server.

## Quick test (PowerShell)

Start the API:
```powershell
npm run dev -w @pass/api
````

Run the sanity script:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\test-runs.ps1
```
