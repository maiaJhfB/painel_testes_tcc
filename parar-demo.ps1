. (Join-Path $PSScriptRoot 'processos-demo.ps1')
foreach ($name in @('server','web')) {
    $recordPath=Join-Path $DemoRuntime "$name.process.json"
    if (-not (Test-Path -LiteralPath $recordPath)) { continue }
    $record=Get-Content -LiteralPath $recordPath -Raw | ConvertFrom-Json
    $owned=Get-OwnedDemoProcess $record
    if (-not $owned) {
        Write-Warning "Registro $name ausente, antigo ou sem identidade verificavel; nenhum processo foi encerrado."
        continue
    }
    $owned.Kill()
    $owned.WaitForExit()
    Remove-Item -LiteralPath $recordPath
    Write-Host "Servico $name desta copia encerrado."
}
