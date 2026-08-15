param(
  [ValidateSet('start', 'status', 'reset', 'stop', 'fail-ai')]
  [string]$Action = 'status'
)

$ErrorActionPreference = 'Stop'
$workspace = Split-Path -Parent $PSScriptRoot
$uatRoot = Join-Path $workspace '.uat'
$logDir = Join-Path $uatRoot 'logs'
$mongoData = Join-Path $uatRoot 'mongo-data'
$mongoExe = 'C:\Program Files\MongoDB\Server\8.0\bin\mongod.exe'
$mongoUri = 'mongodb://127.0.0.1:27018/vietvoyage_browser_uat?replicaSet=uatrs'
$chromaName = 'vietvoyage-uat-chroma'
$nodeExe = 'C:\Program Files\nodejs\node.exe'

function Wait-Http([string]$Url, [int]$Seconds = 45) {
  $deadline = (Get-Date).AddSeconds($Seconds)
  do {
    Start-Sleep -Milliseconds 750
    try {
      $response = Invoke-WebRequest -Uri $Url -UseBasicParsing -TimeoutSec 3
      if ($response.StatusCode -eq 200) { return }
    } catch {}
  } until ((Get-Date) -gt $deadline)
  throw "Timed out waiting for $Url"
}

function Wait-AiIndexHealthy([int]$Seconds = 120) {
  $deadline = (Get-Date).AddSeconds($Seconds)
  do {
    Start-Sleep -Seconds 1
    try {
      $health = Invoke-RestMethod -Uri 'http://127.0.0.1:4000/health' -TimeoutSec 5
      if (
        $health.capabilities.mongo.status -eq 'healthy' -and
        $health.capabilities.chroma.status -eq 'reachable' -and
        $health.capabilities.index.status -eq 'healthy'
      ) { return }
    } catch {}
  } until ((Get-Date) -gt $deadline)
  throw 'AI service started, but Mongo/Chroma/index did not become healthy.'
}

function Get-TrackedProcessId([string]$Name) {
  $path = Join-Path $uatRoot "$Name.pid"
  if (!(Test-Path -LiteralPath $path)) { return $null }
  $value = Get-Content -LiteralPath $path -ErrorAction SilentlyContinue
  if ($value -match '^\d+$') { return [int]$value }
  return $null
}

function Test-PortOwned([int]$Port, [int]$ProcessId) {
  return [bool](Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue |
    Where-Object { $_.OwningProcess -eq $ProcessId })
}

function Assert-PortAvailableOrTracked([string]$Name, [int]$Port) {
  $listeners = @(Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue)
  if ($listeners.Count -eq 0) { return $false }
  $processId = Get-TrackedProcessId $Name
  if ($processId -and (Test-PortOwned $Port $processId)) { return $true }
  throw "Port $Port is occupied by a process not tracked as UAT $Name."
}

function Stop-TrackedProcess([string]$Name, [int]$Port, [string]$ExpectedProcess) {
  $processId = Get-TrackedProcessId $Name
  if (!$processId) { return }
  $process = Get-Process -Id $processId -ErrorAction SilentlyContinue
  if (!$process) { return }
  if ($process.ProcessName -ne $ExpectedProcess -or !(Test-PortOwned $Port $processId)) {
    throw "Refusing to stop unverified process $processId for $Name."
  }
  Stop-Process -Id $processId
}

function Assert-DockerReady {
  $previousErrorAction = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  docker info 2>&1 | Out-Null
  $dockerExitCode = $LASTEXITCODE
  $ErrorActionPreference = $previousErrorAction
  if ($dockerExitCode -ne 0) { throw 'Docker Desktop is not running.' }
  $standardStack = @(
    'vietvoyage-backend-1',
    'vietvoyage-frontend-1',
    'vietvoyage-tour-ai-service-1',
    'vietvoyage-chromadb-1',
    'vietvoyage-ngrok-1'
  )
  $running = @(docker ps --format '{{.Names}}')
  $conflicts = @($running | Where-Object { $standardStack -contains $_ })
  if ($conflicts.Count -gt 0) {
    throw "The standard Compose stack is running ($($conflicts -join ', ')). Run: docker compose --profile ai stop"
  }
}

function Start-Mongo {
  if (Assert-PortAvailableOrTracked 'mongo' 27018) { return }
  if (!(Test-Path -LiteralPath $mongoExe)) { throw "MongoDB executable not found: $mongoExe" }
  New-Item -ItemType Directory -Force -Path $uatRoot, $logDir, $mongoData | Out-Null
  $process = Start-Process -FilePath $mongoExe `
    -ArgumentList @(
      '--dbpath', $mongoData,
      '--port', '27018',
      '--bind_ip', '127.0.0.1',
      '--replSet', 'uatrs',
      '--logpath', (Join-Path $logDir 'mongo.log'),
      '--logappend'
    ) `
    -WindowStyle Hidden `
    -PassThru
  Set-Content -LiteralPath (Join-Path $uatRoot 'mongo.pid') -Value $process.Id
  $deadline = (Get-Date).AddSeconds(30)
  do { Start-Sleep -Milliseconds 500 } until (
    (Test-PortOwned 27018 $process.Id) -or (Get-Date) -gt $deadline
  )
  if (!(Test-PortOwned 27018 $process.Id)) { throw 'MongoDB UAT did not start on port 27018.' }
}

function Start-Chroma {
  Assert-DockerReady
  $containers = @(docker ps -a --format '{{.Names}}')
  if ($containers -contains $chromaName) {
    $running = @(docker ps --format '{{.Names}}')
    if (!($running -contains $chromaName)) { docker start $chromaName | Out-Null }
  } else {
    if (Get-NetTCPConnection -LocalPort 8000 -State Listen -ErrorAction SilentlyContinue) {
      throw 'Port 8000 is occupied by a non-UAT process.'
    }
    docker run -d --name $chromaName -p 127.0.0.1:8000:8000 chromadb/chroma:latest | Out-Null
  }
  if ($LASTEXITCODE -ne 0) { throw 'Unable to start the UAT Chroma container.' }
  Wait-Http 'http://127.0.0.1:8000/api/v2/heartbeat'
}

function Seed-Uat([switch]$Reset) {
  $previousMongoUri = $env:MONGO_URI
  $previousNodeEnv = $env:NODE_ENV
  try {
    $env:MONGO_URI = $mongoUri
    $env:NODE_ENV = 'development'
    $arguments = @(Join-Path $workspace 'backend/scripts/seed-browser-uat.mjs')
    if ($Reset) { $arguments += '--reset' }
    & $nodeExe @arguments
    if ($LASTEXITCODE -ne 0) { throw 'UAT fixture seed failed.' }
  } finally {
    $env:MONGO_URI = $previousMongoUri
    $env:NODE_ENV = $previousNodeEnv
  }
}

function Start-Applications {
  New-Item -ItemType Directory -Force -Path $logDir | Out-Null

  if (!(Assert-PortAvailableOrTracked 'ai' 4000)) {
    $env:MONGO_URI = $mongoUri
    $env:CHROMA_URL = 'http://127.0.0.1:8000'
    $env:CHROMA_COLLECTION = 'tour_vectors_browser_uat'
    $env:AI_SERVICE_PORT = '4000'
    $env:AUTO_RECONCILE_INDEX = 'true'
    $process = Start-Process -FilePath $nodeExe `
      -ArgumentList 'src/server.js' `
      -WorkingDirectory (Join-Path $workspace 'ai/tour-ai-service') `
      -WindowStyle Hidden `
      -RedirectStandardOutput (Join-Path $logDir 'ai.stdout.log') `
      -RedirectStandardError (Join-Path $logDir 'ai.stderr.log') `
      -PassThru
    Set-Content -LiteralPath (Join-Path $uatRoot 'ai.pid') -Value $process.Id
  }
  Wait-Http 'http://127.0.0.1:4000/health' 90
  Wait-AiIndexHealthy

  if (!(Assert-PortAvailableOrTracked 'backend' 5000)) {
    $env:MONGO_URI = $mongoUri
    $env:AI_SERVICE_URL = 'http://127.0.0.1:4000/api/ai'
    $env:CHAT_TRACE_LOGGING = 'true'
    $env:PORT = '5000'
    $env:CLIENT_URL = 'http://127.0.0.1:5173'
    $env:CORS_ORIGINS = 'http://127.0.0.1:5173,http://localhost:5173'
    $process = Start-Process -FilePath $nodeExe `
      -ArgumentList 'server.js' `
      -WorkingDirectory (Join-Path $workspace 'backend') `
      -WindowStyle Hidden `
      -RedirectStandardOutput (Join-Path $logDir 'backend.stdout.log') `
      -RedirectStandardError (Join-Path $logDir 'backend.stderr.log') `
      -PassThru
    Set-Content -LiteralPath (Join-Path $uatRoot 'backend.pid') -Value $process.Id
  }
  Wait-Http 'http://127.0.0.1:5000/'

  if (!(Assert-PortAvailableOrTracked 'frontend' 5173)) {
    $process = Start-Process -FilePath $nodeExe `
      -ArgumentList 'node_modules/vite/bin/vite.js --host 127.0.0.1 --port 5173' `
      -WorkingDirectory (Join-Path $workspace 'TTTN') `
      -WindowStyle Hidden `
      -RedirectStandardOutput (Join-Path $logDir 'frontend.stdout.log') `
      -RedirectStandardError (Join-Path $logDir 'frontend.stderr.log') `
      -PassThru
    Set-Content -LiteralPath (Join-Path $uatRoot 'frontend.pid') -Value $process.Id
  }
  Wait-Http 'http://127.0.0.1:5173/ai-assistant'
}

function Stop-Applications {
  Stop-TrackedProcess 'frontend' 5173 'node'
  Stop-TrackedProcess 'backend' 5000 'node'
  Stop-TrackedProcess 'ai' 4000 'node'
}

function Show-Status {
  $ports = 27018, 8000, 4000, 5000, 5173
  foreach ($port in $ports) {
    $listener = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue |
      Select-Object -First 1
    Write-Output ("PORT {0}: {1}" -f $port, $(if ($listener) { 'LISTENING' } else { 'DOWN' }))
  }
  try {
    $health = Invoke-RestMethod -Uri 'http://127.0.0.1:4000/health' -TimeoutSec 5
    Write-Output ("AI: {0}; Mongo: {1}; Chroma: {2}; Index: {3}; Provider: {4}; Fallback active: {5}" -f `
      $health.status,
      $health.capabilities.mongo.status,
      $health.capabilities.chroma.status,
      $health.capabilities.index.status,
      $health.capabilities.provider.status,
      $health.capabilities.fallback.active)
  } catch {
    Write-Output 'AI health: unavailable'
  }
  Write-Output 'Frontend: http://127.0.0.1:5173/ai-assistant'
}

switch ($Action) {
  'start' {
    Start-Mongo
    Start-Chroma
    Seed-Uat
    Start-Applications
    Show-Status
  }
  'reset' {
    Stop-Applications
    Start-Mongo
    Assert-DockerReady
    $containers = @(docker ps -a --format '{{.Names}}')
    if ($containers -contains $chromaName) {
      $actualName = docker inspect --format '{{.Name}}' $chromaName
      if ($actualName -ne "/$chromaName") { throw 'Unexpected Chroma reset target.' }
      docker rm -f $chromaName | Out-Null
    }
    Start-Chroma
    Seed-Uat -Reset
    Start-Applications
    Show-Status
  }
  'stop' {
    Stop-Applications
    $containers = @(docker ps --format '{{.Names}}')
    if ($containers -contains $chromaName) { docker stop $chromaName | Out-Null }
    Stop-TrackedProcess 'mongo' 27018 'mongod'
    Write-Output 'Stopped isolated Browser UAT services. Data remains under .uat and the stopped Chroma container.'
  }
  'fail-ai' {
    Stop-TrackedProcess 'ai' 4000 'node'
    Write-Output 'Stopped only the isolated AI service. Run the start action to restore it.'
  }
  'status' { Show-Status }
}
