# Quick sanity checks for Step 2 run tracking (PowerShell-friendly).

$base = "http://localhost:3001"

# 1) Create a run (captures run_id)
$createBody = @{
  prd_text = "Build a PRD-to-architecture planner that generates one architecture, then lets the user refine it in a wireframe and chat interface."
  requested_by = "local-smoke-test"
} | ConvertTo-Json

$created = Invoke-RestMethod -Method Post -Uri "$base/runs" -ContentType "application/json" -Body $createBody
$runId = $created.run.run_id
"Created run_id: $runId"

# 2) List runs (should show total + runs[])
Invoke-RestMethod -Method Get -Uri "$base/runs"

# 3) Get run details (run + artifacts[])
Invoke-RestMethod -Method Get -Uri "$base/runs/$runId"

# 4) Update step/status
Invoke-RestMethod -Method Patch -Uri "$base/runs/$runId" -ContentType "application/json" -Body '{"current_step":"parse","status":"parsed"}'

# 5) Confirm update + step_timestamps
Invoke-RestMethod -Method Get -Uri "$base/runs/$runId"
