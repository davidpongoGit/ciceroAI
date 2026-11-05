param([ValidateSet('start', 'stop', 'test', 'e2e','demo')][string]$Action = 'start')
$ErrorActionPreference = 'Stop'
$workspacePath = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
Set-Location -LiteralPath $workspacePath
if(Test-Path (Join-Path $workspacePath 'runtime-data/tools/node24/node.exe')){$env:PATH=(Join-Path $workspacePath 'runtime-data/tools/node24')+';'+$env:PATH}
$binaryPath = Join-Path $workspacePath 'runtime-data/tools/pg18/package/native/bin'
$clusterPath = Join-Path $workspacePath 'runtime-data/postgres18'
$passwordPath = Join-Path $workspacePath 'runtime-data/postgres-password.txt'
$envPath = Join-Path $workspacePath 'runtime-data/local-postgres.env'

if ($Action -eq 'stop') {
  & (Join-Path $binaryPath 'pg_ctl.exe') -D $clusterPath -m fast -w stop
  exit $LASTEXITCODE
}
if (!(Test-Path (Join-Path $binaryPath 'postgres.exe'))) {
  New-Item -ItemType Directory -Force 'runtime-data/tools/pg18' | Out-Null
  npm pack '@embedded-postgres/windows-x64@18.6.0-beta.19' --pack-destination runtime-data/tools --ignore-scripts --silent
  if ($LASTEXITCODE -ne 0) { throw 'PostgreSQL binary download failed.' }
  tar -xzf runtime-data/tools/embedded-postgres-windows-x64-18.6.0-beta.19.tgz -C runtime-data/tools/pg18
  if ($LASTEXITCODE -ne 0) { throw 'PostgreSQL binary extraction failed.' }
}
if (!(Test-Path (Join-Path $clusterPath 'PG_VERSION'))) {
  $localPassword = node -p "require('node:crypto').randomBytes(32).toString('hex')"
  [System.IO.File]::WriteAllText($passwordPath, $localPassword)
  & (Join-Path $binaryPath 'initdb.exe') -D $clusterPath -U cai_local --pwfile=$passwordPath --auth=scram-sha-256 --encoding=UTF8 --locale=C
  if ($LASTEXITCODE -ne 0) { throw 'Database initialisation failed.' }
  [System.IO.File]::WriteAllText($envPath, "DATABASE_URL=postgresql://cai_local:$localPassword@127.0.0.1:55432/postgres`n")
}
if (!(Test-Path $envPath)) { throw 'Local database configuration is missing; no existing cluster will be overwritten.' }
& (Join-Path $binaryPath 'pg_ctl.exe') -D $clusterPath status *> $null
if ($LASTEXITCODE -ne 0) {
  & (Join-Path $binaryPath 'pg_ctl.exe') -D $clusterPath -l (Join-Path $workspacePath 'runtime-data/postgres.log') -o '-h 127.0.0.1 -p 55432' -w start
  if ($LASTEXITCODE -ne 0) { throw 'PostgreSQL startup failed; inspect the ignored local log.' }
}
Write-Output 'Local PostgreSQL ready on 127.0.0.1:55432. Credentials remain in ignored runtime-data.'
if ($Action -eq 'test' -or $Action -eq 'e2e' -or $Action -eq 'demo') {
  $env:DATABASE_URL = ([System.IO.File]::ReadAllText($envPath).Trim() -replace '^DATABASE_URL=', '')
  if ($Action -eq 'demo') { npm run demo } elseif ($Action -eq 'e2e') { npm run test:e2e } else { npm run test:integration }
  exit $LASTEXITCODE
}
