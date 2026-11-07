param([string]$ConfigPath = (Join-Path $PSScriptRoot '..\..\development\host-agent.local.json'))
$agentScript = Join-Path $PSScriptRoot 'agent.mjs'
if (-not (Test-Path -LiteralPath $ConfigPath)) { throw 'Create the private host-agent configuration first.' }
$agentConfig = (Resolve-Path -LiteralPath $ConfigPath).Path
$nodeExecutable = (Get-Command node -ErrorAction Stop).Source
Start-Process -FilePath $nodeExecutable -ArgumentList @('"' + $agentScript + '"', '"' + $agentConfig + '"') -WindowStyle Hidden
