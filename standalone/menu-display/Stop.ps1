$ErrorActionPreference = 'Stop'
$runtime = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot 'runtime/node.exe'))
Get-CimInstance Win32_Process -Filter "Name='node.exe'" | Where-Object {
  $_.ExecutablePath -eq $runtime -and $_.CommandLine -match 'server\.mjs'
} | ForEach-Object { Stop-Process -Id $_.ProcessId }
