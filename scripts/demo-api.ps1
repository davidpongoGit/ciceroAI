param([ValidateSet('start','stop')][string]$Action='start')
$ErrorActionPreference='Stop'
$workspacePath=(Resolve-Path (Join-Path $PSScriptRoot '..')).Path
Set-Location -LiteralPath $workspacePath
$pidPath=Join-Path $workspacePath 'runtime-data/demo-api.pid.json'
function Get-ValidatedDemoProcess($record){
  $runningProcess=Get-Process -Id ([int]$record.id) -ErrorAction SilentlyContinue
  if(!$runningProcess){return $null}
  $details=Get-CimInstance Win32_Process -Filter ('ProcessId = '+[int]$record.id)
  if($runningProcess.Path -ne $record.executable -or $record.workspace -ne $workspacePath -or $details.CommandLine -notlike '*apps/api/dist/server.js*' -or $details.CommandLine -notlike '*runtime-data/demo.env*'){throw 'Recorded PID does not belong to this workspace demo API; no process was stopped.'}
  return $runningProcess
}
if(Test-Path $pidPath){
  $record=Get-Content -LiteralPath $pidPath -Raw | ConvertFrom-Json
  $runningProcess=Get-ValidatedDemoProcess $record
  if($runningProcess){
    if($Action -eq 'stop'){Stop-Process -Id $runningProcess.Id;Remove-Item -LiteralPath $pidPath;Write-Output 'Workspace demo API stopped.';exit 0}
    Write-Output 'Workspace demo API is already running at http://127.0.0.1:3000.';exit 0
  }
  Remove-Item -LiteralPath $pidPath
}
if($Action -eq 'stop'){Write-Output 'No workspace demo API process is recorded.';exit 0}
if(!(Test-Path 'runtime-data/demo.env') -or !(Test-Path 'apps/api/dist/server.js')){throw 'Run the synthetic demo and build first.'}
$nodePath=Join-Path $workspacePath 'runtime-data/tools/node24/node.exe'
if(!(Test-Path $nodePath)){$nodePath=(Get-Command node).Source}
$demoProcess=Start-Process -FilePath $nodePath -ArgumentList '--env-file=runtime-data/demo.env','apps/api/dist/server.js' -WorkingDirectory $workspacePath -WindowStyle Hidden -RedirectStandardOutput (Join-Path $workspacePath 'runtime-data/demo-api.log') -RedirectStandardError (Join-Path $workspacePath 'runtime-data/demo-api.err.log') -PassThru
@{id=$demoProcess.Id;executable=$nodePath;workspace=$workspacePath}|ConvertTo-Json|Set-Content -Encoding UTF8 -LiteralPath $pidPath
for($attempt=0;$attempt -lt 10;$attempt++){
  Start-Sleep -Milliseconds 300
  $demoProcess.Refresh()
  if($demoProcess.HasExited){throw 'Demo API exited. Inspect ignored runtime-data/demo-api.err.log; no other process was stopped.'}
  try{$health=Invoke-RestMethod -Uri 'http://127.0.0.1:3000/health' -TimeoutSec 1;if($health.service -eq 'cai-api'){Write-Output 'Workspace demo API ready at http://127.0.0.1:3000. Copy API_TOKEN locally from runtime-data/demo.env.';exit 0}}catch{}
}
throw 'Demo API did not become healthy within the startup window.'
