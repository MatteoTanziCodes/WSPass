# Interactive local smoke script for the current WSPass rail:
# PRD input -> planner -> repo resolution

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

function Import-DotEnv {
  param(
    [Parameter(Mandatory = $true)]
    [string]$Path
  )

  if (-not (Test-Path $Path)) {
    throw ".env file not found at $Path"
  }

  Get-Content $Path | ForEach-Object {
    $line = $_.Trim()
    if (-not $line -or $line.StartsWith("#")) {
      return
    }

    $parts = $line -split "=", 2
    if ($parts.Length -ne 2) {
      return
    }

    $name = $parts[0].Trim()
    $value = $parts[1]
    [Environment]::SetEnvironmentVariable($name, $value, "Process")
  }
}

function Read-PrdText {
  Write-Host "Paste the PRD text. Enter a single line with __END__ when finished."
  $lines = New-Object System.Collections.Generic.List[string]

  while ($true) {
    $line = Read-Host
    if ($line -eq "__END__") {
      break
    }
    $lines.Add($line)
  }

  $prdText = ($lines -join [Environment]::NewLine).Trim()
  if (-not $prdText) {
    throw "PRD text is required."
  }

  return $prdText
}

function Read-RepoTarget {
  while ($true) {
    $choice = (Read-Host "Does the target repo already exist? Enter existing or new").Trim().ToLowerInvariant()
    if ($choice -eq "existing") {
      $repository = (Read-Host "Enter the existing repo as owner/repo").Trim()
      if (-not $repository -or $repository -notmatch "^[^/]+/[^/]+$") {
        Write-Host "Repository must be in owner/repo format."
        continue
      }

      return @{
        mode = "use_existing_repo"
        repository = $repository
      }
    }

    if ($choice -eq "new") {
      $name = (Read-Host "Enter the new repo name").Trim()
      if (-not $name) {
        Write-Host "Repo name is required."
        continue
      }

      $visibility = (Read-Host "Visibility? Enter private or public [private]").Trim().ToLowerInvariant()
      if (-not $visibility) {
        $visibility = "private"
      }
      if ($visibility -notin @("private", "public")) {
        Write-Host "Visibility must be private or public."
        continue
      }

      $target = @{
        mode = "create_new_repo"
        name = $name
        visibility = $visibility
      }

      return $target
    }

    Write-Host "Please enter existing or new."
  }
}

function Ensure-BuildArtifacts {
  Write-Host "Building shared, API, and agents..."
  npm run build -w @pass/shared | Out-Host
  npm run build -w @pass/api | Out-Host
  npm run build -w @pass/agents | Out-Host
}

function Get-ApiBaseUrlCandidates {
  param(
    [Parameter(Mandatory = $true)]
    [string]$BaseUrl
  )

  $uri = [Uri]$BaseUrl
  $candidates = New-Object System.Collections.Generic.List[string]
  $candidates.Add($BaseUrl.TrimEnd("/"))

  if ($uri.Host -eq "localhost") {
    $builder = [System.UriBuilder]::new($uri)
    $builder.Host = "127.0.0.1"
    $candidates.Add($builder.Uri.GetLeftPart([System.UriPartial]::Authority).TrimEnd("/"))
  } elseif ($uri.Host -eq "127.0.0.1") {
    $builder = [System.UriBuilder]::new($uri)
    $builder.Host = "localhost"
    $candidates.Add($builder.Uri.GetLeftPart([System.UriPartial]::Authority).TrimEnd("/"))
  }

  return $candidates | Select-Object -Unique
}

function Test-ApiHealth {
  param(
    [Parameter(Mandatory = $true)]
    [string]$BaseUrl
  )

  foreach ($candidate in Get-ApiBaseUrlCandidates -BaseUrl $BaseUrl) {
    try {
      $health = Invoke-RestMethod -Method Get -Uri "$candidate/health" -TimeoutSec 2
      if ($health.ok) {
        return $candidate
      }
    } catch {
      continue
    }
  }

  return $null
}

function Ensure-ApiRunning {
  $baseUrl = $env:PASS_API_BASE_URL
  if (-not $baseUrl) {
    throw "PASS_API_BASE_URL is required."
  }

  $uri = [Uri]$baseUrl
  $port = if ($uri.IsDefaultPort) {
    if ($uri.Scheme -eq "https") { 443 } else { 80 }
  } else {
    $uri.Port
  }

  for ($attempt = 0; $attempt -lt 3; $attempt += 1) {
    $resolvedBaseUrl = Test-ApiHealth -BaseUrl $baseUrl
    if ($resolvedBaseUrl) {
      if ($resolvedBaseUrl -ne $baseUrl) {
        Write-Host "API already running at $resolvedBaseUrl"
        $env:PASS_API_BASE_URL = $resolvedBaseUrl
      } else {
        Write-Host "API already running at $baseUrl"
      }
      return
    }

    if ($attempt -lt 2) {
      Start-Sleep -Seconds 1
    }
  }

  $listeners = @(Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue)
  if ($listeners.Count -gt 0) {
    $processIds = $listeners | Select-Object -ExpandProperty OwningProcess -Unique
    $processNames = @()
    foreach ($processId in $processIds) {
      try {
        $processNames += (Get-Process -Id $processId -ErrorAction Stop).ProcessName
      } catch {
        $processNames += "PID $processId"
      }
    }

    $healthUrls = Get-ApiBaseUrlCandidates -BaseUrl $baseUrl | ForEach-Object { "$_/health" }
    throw "Port $port is already in use by: $($processNames -join ', '). The API health check did not succeed for any of: $($healthUrls -join ', ')."
  }

  Write-Host "API not running. Starting local API server..."

  $root = Split-Path -Parent $PSScriptRoot
  $logPath = Join-Path $root "tmp-api.log"
  $errPath = Join-Path $root "tmp-api.err.log"

  Start-Process -FilePath "cmd.exe" `
    -ArgumentList "/c", "cd /d $root && start /b node apps\api\dist\server.js > `"$logPath`" 2> `"$errPath`"" `
    -WindowStyle Hidden | Out-Null

  for ($index = 0; $index -lt 20; $index += 1) {
    Start-Sleep -Seconds 1
    $resolvedBaseUrl = Test-ApiHealth -BaseUrl $baseUrl
    if ($resolvedBaseUrl) {
      if ($resolvedBaseUrl -ne $baseUrl) {
        $env:PASS_API_BASE_URL = $resolvedBaseUrl
      }
      Write-Host "API started at $resolvedBaseUrl"
      return
    }
  }

  $errorDetails = ""
  if (Test-Path $errPath) {
    $errorDetails = (Get-Content $errPath -Raw).Trim()
  }

  if ($errorDetails) {
    throw "API did not become ready at $baseUrl. Server error output: $errorDetails"
  }

  throw "API did not become ready at $baseUrl"
}

function Create-Run {
  param(
    [Parameter(Mandatory = $true)]
    [string]$PrdText,
    [Parameter(Mandatory = $true)]
    [hashtable]$RepoTarget
  )

  $body = @{
    prd_text = $PrdText
    requested_by = "interactive-smoke"
    repo_target = $RepoTarget
  } | ConvertTo-Json -Depth 6

  $run = Invoke-RestMethod -Method Post -Uri "$($env:PASS_API_BASE_URL)/runs" -ContentType "application/json" -Body $body
  return $run.run.run_id
}

function Seed-Execution {
  param(
    [Parameter(Mandatory = $true)]
    [string]$RunId,
    [Parameter(Mandatory = $true)]
    [string]$WorkflowName
  )

  @"
require('dotenv/config');
const { RunStore } = require('./apps/api/dist/modules/runs/runStore.js');
(async () => {
  const store = new RunStore();
  await store.queueExecution('$RunId', '$WorkflowName');
  await store.markExecutionDispatched('$RunId');
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
"@ | node | Out-Host
}

function Get-ArtifactSummary {
  param(
    [Parameter(Mandatory = $true)]
    [string]$RunId
  )

  return Invoke-RestMethod -Method Get -Uri "$($env:PASS_API_BASE_URL)/runs/$RunId"
}

$root = Split-Path -Parent $PSScriptRoot
Import-DotEnv -Path (Join-Path $root ".env")
Push-Location $root
try {
  if (-not $env:PASS_API_TOKEN) {
    throw "PASS_API_TOKEN must be set in .env"
  }
  if (-not $env:ANTHROPIC_API_KEY) {
    throw "ANTHROPIC_API_KEY must be set in .env"
  }
  if (-not $env:PASS_GITHUB_WORKFLOW_TOKEN) {
    throw "PASS_GITHUB_WORKFLOW_TOKEN must be set in .env"
  }

  $prdText = Read-PrdText
  $repoTarget = Read-RepoTarget

  Ensure-BuildArtifacts
  Ensure-ApiRunning

  $runId = Create-Run -PrdText $prdText -RepoTarget $repoTarget
  Write-Host "Created run: $runId"

  Write-Host "Running planner..."
  Seed-Execution -RunId $runId -WorkflowName "phase1-planner"
  node apps/agents/dist/cli/planner.js --run-id=$runId | Out-Host

  Write-Host "Resolving target repo..."
  Seed-Execution -RunId $runId -WorkflowName "phase2-repo-provision"
  node apps/agents/dist/cli/repoProvision.js --run-id=$runId | Out-Host

  $result = Get-ArtifactSummary -RunId $runId

  Write-Host ""
  Write-Host "Planning run completed."
  Write-Host "Run ID: $($result.run.run_id)"
  Write-Host "Final workflow: $($result.run.execution.workflow_name)"
  Write-Host "Execution status: $($result.run.execution.status)"
  if ($result.run.repo_state) {
    Write-Host "Target repo: $($result.run.repo_state.repository)"
  }
  Write-Host "Artifacts:"
  $result.artifacts | ForEach-Object { Write-Host " - $($_.name)" }
  Write-Host ""
  Write-Host "GitHub issues were not created. Review and refine the architecture pack before running the implementation rail."
} finally {
  Pop-Location
}
