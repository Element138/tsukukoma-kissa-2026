param([switch]$ServerOnly)
$ErrorActionPreference = 'Stop'
$runtime = Join-Path $PSScriptRoot 'runtime/node.exe'
$runtimeArgs = @('server.mjs')
if (-not $ServerOnly) { $runtimeArgs += '--open' }
Start-Process -FilePath $runtime -ArgumentList $runtimeArgs -WorkingDirectory $PSScriptRoot -WindowStyle Hidden
