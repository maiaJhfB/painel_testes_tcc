param([ValidateRange(1024,65535)][int]$PortaApi=4748)
. (Join-Path $PSScriptRoot 'processos-demo.ps1')
$recordPath=Join-Path $DemoRuntime 'server.process.json'
if (-not (Test-Path -LiteralPath $recordPath)) { throw 'Inicie esta copia antes de resetar.' }
$record=Get-Content -LiteralPath $recordPath -Raw | ConvertFrom-Json
if (-not (Get-OwnedDemoProcess $record)) { throw 'Processo desta copia nao comprovado; dados preservados.' }
$health=Invoke-RestMethod "http://127.0.0.1:$PortaApi/health" -TimeoutSec 3
if ($health.instance_id -ne $record.instance) { throw 'API pertence a outra instancia; dados preservados.' }
Invoke-RestMethod "http://127.0.0.1:$PortaApi/mock/reset" -Method Post -TimeoutSec 5
