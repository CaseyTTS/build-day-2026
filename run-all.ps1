<#
Build Day 2026: run every drop's tests and demos in mock (stand-in) mode, then print a pass/fail summary.
Works in Windows PowerShell 5.1 and PowerShell 7+ (Windows, macOS, Linux). No keys, no model calls.

Usage (from any folder):
  powershell -ExecutionPolicy Bypass -File .\run-all.ps1 -Repo C:\path\to\build-day-2026
  pwsh -File ./run-all.ps1 -Repo ~/lab/build-day-2026
  add -Quick to skip npm ci / pip install when they already ran once.

#>
param(
  [string]$Repo = (Get-Location).Path,
  [switch]$Quick
)
$ErrorActionPreference = 'Continue'
$onWindows = ($PSVersionTable.PSEdition -eq 'Desktop') -or $IsWindows

if (-not (Test-Path (Join-Path $Repo '01-triage')) -or -not (Test-Path (Join-Path $Repo '06-finale'))) {
  Write-Host "Not the build-day-2026 folder: $Repo"; exit 2
}
$Repo = (Resolve-Path $Repo).Path

# Force mock / stand-in mode for every drop, whatever is set in this session.
$env:TRIAGE_PROVIDER = 'mock'; $env:RAG_PROVIDER = 'mock'; $env:HARNESS_PLANNER = 'mock'
$env:HARNESS_APPROVE = 'deny'; $env:MODEL_PROVIDER = 'standin'
foreach ($v in 'SCORER','RAG_MIN_SCORE','TRIAGE_REVIEW_BELOW','HARNESS_SANDBOX','HARNESS_LOG') { Remove-Item "Env:$v" -ErrorAction SilentlyContinue }

# npm.cmd on Windows avoids the npm.ps1 shim (execution policy, and it swallows "--").
$Npm = if ($onWindows) { 'npm.cmd' } else { 'npm' }

# Find Python 3.10+ (py launcher first on Windows; skips the Microsoft Store stub).
$Py = $null
$candidates = if ($onWindows) { @(@('py','-3'), @('python'), @('python3')) } else { @(@('python3'), @('python')) }
foreach ($c in $candidates) {
  $exe = $c[0]; $pre = @($c | Select-Object -Skip 1)
  if (-not (Get-Command $exe -ErrorAction SilentlyContinue)) { continue }
  & $exe @pre -c 'import sys; sys.exit(0 if sys.version_info >= (3,10) else 1)' *> $null
  if ($LASTEXITCODE -eq 0) { $Py = $c; break }
}
if (-not $Py) { Write-Host 'Python 3.10+ not found (3.13 recommended). Install from python.org and tick "Add python.exe to PATH".'; exit 2 }
if (-not (Get-Command node -ErrorAction SilentlyContinue)) { Write-Host 'Node.js not found (24 recommended, 22+ required).'; exit 2 }

$LogDir = Join-Path ([System.IO.Path]::GetTempPath()) 'build-day-run-all'
New-Item -ItemType Directory -Force -Path $LogDir | Out-Null
$pyExe = $Py[0]; $pyPre = @($Py | Select-Object -Skip 1)
Write-Host "Build Day run-all | repo: $Repo"
Write-Host ("python: {0} | node: {1} | npm: {2}" -f ((& $pyExe @pyPre --version) 2>&1), (node --version), (& $Npm --version))
Write-Host "logs: $LogDir`n"

$Results = New-Object System.Collections.Generic.List[string]
$script:Fails = 0
$Warns = New-Object System.Collections.Generic.List[string]
function Warn-Skips([string]$Name, [int]$Skipped) {
  if ($Skipped -gt 0) {
    $Warns.Add("WARN ${Name}: $Skipped test(s) skipped; a skipped test proved nothing (see its log for the reason)")
    Write-Host "  WARN ${Name}: $Skipped test(s) skipped"
  }
}
function Record([string]$Name, [string]$Status, [string]$Detail) {
  $line = '{0,-34} {1,-5} {2}' -f $Name, $Status, $Detail
  $Results.Add($line); Write-Host "  $line"
  if ($Status -ne 'PASS') { $script:Fails++ }
}
# Run a command, capture all output to a log, PASS only if exit 0 AND the output has the expected text.
function Step([string]$Name, [string]$Log, [string]$Want, [scriptblock]$Cmd) {
  & $Cmd *> $Log
  $code = $LASTEXITCODE
  $hit = Select-String -Path $Log -Pattern $Want | Select-Object -Last 1
  if ($code -ne 0) { Record $Name 'FAIL' "(exit $code, see $Log)" }
  elseif (-not $hit) { Record $Name 'FAIL' "(no '$Want' in output, see $Log)" }
  else { $t = $hit.Line.Trim(); if ($t.Length -gt 70) { $t = $t.Substring(0,70) }; Record $Name 'PASS' $t }
}
function VenvPy([string]$Dir) {
  $w = Join-Path $Dir '.venv\Scripts\python.exe'; $u = Join-Path $Dir '.venv/bin/python'
  if (Test-Path $w) { return $w } else { return $u }
}

function Run-PythonDrop([string]$D, [scriptblock]$Demo) {
  $dir = Join-Path $Repo $D; Set-Location $dir; Write-Host "== $D"
  if (-not (Test-Path '.venv')) {
    & $pyExe @pyPre -m venv .venv *> (Join-Path $LogDir "$D-venv.log")
    if ($LASTEXITCODE -ne 0) { Record "$D setup" 'FAIL' '(venv)'; return }
  }
  $vpy = VenvPy $dir
  & $vpy -c 'import pytest' *> $null
  if (-not $Quick -or $LASTEXITCODE -ne 0) {
    & $vpy -m pip install -q -r requirements-dev.txt *> (Join-Path $LogDir "$D-pip.log")
    if ($LASTEXITCODE -ne 0) { Record "$D setup" 'FAIL' "(pip, see $LogDir)"; return }
  }
  $log = Join-Path $LogDir "$D-test.log"
  & $vpy -m pytest -q -p no:cacheprovider *> $log
  $sum = (Select-String -Path $log -Pattern '\d+ (passed|failed)' -AllMatches | ForEach-Object { $_.Matches.Value }) -join ' '
  $code = $LASTEXITCODE
  $skm = Select-String -Path $log -Pattern '(\d+) skipped' | Select-Object -Last 1
  $sk = if ($skm) { [int]$skm.Matches[0].Groups[1].Value } else { 0 }
  if ($code -eq 0) { Record "$D tests" 'PASS' "$sum, $sk skipped"; Warn-Skips "$D tests" $sk } else { Record "$D tests" 'FAIL' "$sum (see $log)" }
  & $Demo $vpy $D
}

function Run-NodeDrop([string]$D, [object[]]$Demos) {
  $dir = Join-Path $Repo $D; Set-Location $dir; Write-Host "== $D"
  if (-not $Quick -or -not (Test-Path 'node_modules')) {
    & $Npm ci --no-audit --no-fund *> (Join-Path $LogDir "$D-npm-ci.log")
    if ($LASTEXITCODE -ne 0) { Record "$D setup" 'FAIL' "(npm ci, see $LogDir)"; return }
  }
  $log = Join-Path $LogDir "$D-test.log"
  & $Npm test *> $log
  $code = $LASTEXITCODE
  $pass = (Select-String -Path $log -Pattern '\bpass (\d+)\s*$' | Select-Object -Last 1)
  $fail = (Select-String -Path $log -Pattern '\bfail (\d+)\s*$' | Select-Object -Last 1)
  $p = if ($pass) { $pass.Matches[0].Groups[1].Value } else { '?' }
  $f = if ($fail) { $fail.Matches[0].Groups[1].Value } else { '?' }
  $skm = Select-String -Path $log -Pattern '\bskipped (\d+)\s*$' | Select-Object -Last 1
  $sk = if ($skm) { [int]$skm.Matches[0].Groups[1].Value } else { 0 }
  if ($code -eq 0) { Record "$D tests" 'PASS' "$p passed, $sk skipped"; Warn-Skips "$D tests" $sk }
  else {
    Record "$D tests" 'FAIL' "$p passed, $f failed (see $log)"
  }
  $n = 0
  foreach ($demo in $Demos) {
    $n++
    Step "$D demo ${n}: $($demo[0])" (Join-Path $LogDir "$D-demo-$n.log") $demo[1] $demo[2]
  }
}

Run-PythonDrop '01-triage' { param($vpy, $D)
  Step "$D demo (run samples)" (Join-Path $LogDir "$D-demo.log") '13 items, 5 auto-routed, 8 sent to a person' { & $vpy triage.py run samples.jsonl } }
Run-PythonDrop '02-rag' { param($vpy, $D)
  Step "$D demo (index/ask/eval)" (Join-Path $LogDir "$D-demo.log") 'retrieval: 5/5 correct' {
    & $vpy rag.py index docs/; if ($LASTEXITCODE) { return }
    & $vpy rag.py ask "My VPN won't connect, what should I check first?"; if ($LASTEXITCODE) { return }
    & $vpy rag.py ask 'When are accruals posted?' --groups everyone; if ($LASTEXITCODE) { return }
    & $vpy rag.py eval questions.jsonl } }
Run-PythonDrop '03-harness' { param($vpy, $D)
  Step "$D demo (gate, deny mode)" (Join-Path $LogDir "$D-demo.log") 'write_file +not-approved' { & $vpy harness.py } }

# Drop 4: build once, then run the CLI directly (writes to out/, which git ignores; samples/ stays untouched).
Run-NodeDrop '04-interview' @(
  ,@('bot interview -> out/',  'Wrote out[\\/]bot-transcript.json',  { & $Npm run build; if ($LASTEXITCODE) { return }; node dist/src/cli.js bot out })
  ,@('team interview -> out/', 'Wrote out[\\/]team-transcript.json', { node dist/src/cli.js team out })
)
Run-NodeDrop '05-homelab' @(
  ,@('npm run lint', 'eslint', { & $Npm run lint })
  ,@('npm run demo', 'place: ', { & $Npm run demo })
)
# Drop 6: run the CLI with node directly (avoids how PowerShell handles "--" when passing args through npm).
Run-NodeDrop '06-finale' @(
  ,@('npm run check:playbooks', 'OK: playbook "scheduling" passed', { & $Npm run check:playbooks })
  ,@('npm run demo', 'scheduling[\\/]denied[\\/]summary.md', { & $Npm run demo })
  ,@('marketing --approve', 'marketing[\\/]approved[\\/]summary.md', { & $Npm run build; if ($LASTEXITCODE) { return }; node dist/src/cli.js --playbook marketing --approve })
)

Set-Location $Repo
Write-Host "`n================ SUMMARY ================"
$Results | ForEach-Object { Write-Host $_ }
Write-Host '========================================='
$Warns | ForEach-Object { Write-Host $_ }
if ($script:Fails -eq 0 -and $Warns.Count -gt 0) { Write-Host "GREEN WITH WARNINGS ($($Results.Count) checks, $($Warns.Count) WARN)"; exit 0 }
if ($script:Fails -eq 0) { Write-Host "ALL GREEN ($($Results.Count) checks)"; exit 0 }
else { Write-Host "$($script:Fails) of $($Results.Count) checks FAILED. Open the log named next to each FAIL."; exit 1 }
