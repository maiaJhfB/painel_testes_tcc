param(
    [switch]$SemExpo,
    [switch]$NaoAbrirPainel,
    [ValidateRange(1024,65535)][int]$PortaApi = 4748,
    [ValidateRange(1024,65535)][int]$PortaWeb = 8086
)
. (Join-Path $PSScriptRoot 'processos-demo.ps1')
$previous = @{}
$staleRecords = @()
foreach ($serviceName in @('server','web')) {
    $recordPath = Join-Path $DemoRuntime "$serviceName.process.json"
    if (Test-Path -LiteralPath $recordPath) {
        try { $record = Get-Content -LiteralPath $recordPath -Raw | ConvertFrom-Json }
        catch { throw 'Registro de servico invalido; confira a sessao anterior antes de iniciar.' }
        $identity = Get-DemoProcessState $record
        if ($identity.state -in @('Absent','ReusedPid')) {
            $staleRecords += @{path=$recordPath;record=$record;hash=(Get-FileHash -LiteralPath $recordPath).Hash}
        } elseif ($identity.state -eq 'Owned') {
            $previous[$serviceName] = $record
        } else {
            throw 'Existe registro de sessao sem identidade verificavel. Nenhum processo ou arquivo foi alterado. Confira a sessao anterior antes de arquivar manualmente seu registro .runtime/*.process.json.'
        }
    }
}
if ($previous.Count -gt 0) {
    if (-not $previous.server -or $previous.server.port -ne $PortaApi -or
        (-not $SemExpo -and (-not $previous.web -or $previous.web.port -ne $PortaWeb -or $previous.web.instance -ne $previous.server.instance))) {
        throw 'Existe sessao ativa parcial ou com outras portas. Use parar-demo.bat antes de iniciar outra; os processos foram preservados.'
    }
    try {
        $health = Invoke-RestMethod "http://127.0.0.1:$PortaApi/health" -TimeoutSec 3
        if (-not $health.ok -or $health.server -ne 'cooperativa-dev-server' -or $health.demo_version -ne 'ride-fare-v6' -or
            $health.port -ne $PortaApi -or $health.instance_id -ne $previous.server.instance) { throw 'API divergente' }
        if (-not $SemExpo) {
            $page = Invoke-WebRequest "http://127.0.0.1:$PortaWeb/" -UseBasicParsing -TimeoutSec 3
            if ($page.StatusCode -ne 200 -or $page.Headers.Server -notmatch 'CooperativaDemoWeb/' -or $page.Content -notmatch 'expo|root') { throw 'Web divergente' }
        }
        foreach ($entry in $previous.GetEnumerator()) {
            if ((Get-DemoProcessState $entry.Value).state -ne 'Owned') { throw 'Processo mudou' }
            try { $listeners = @(Get-NetTCPConnection -LocalPort $entry.Value.port -State Listen -ErrorAction Stop) }
            catch { $listeners = @() }
            if ($listeners.Count -gt 0 -and $listeners.OwningProcess -notcontains $entry.Value.processId) { throw 'Listener divergente' }
        }
    } catch { throw 'A sessao registrada nao confirmou sua saude/identidade. Nenhum processo ou arquivo foi alterado. Confira os logs ou use parar-demo.bat antes de tentar novamente.' }
    Write-Host "Demo ja esta pronta: http://localhost:$PortaApi/panel" -ForegroundColor Green
    if (-not $NaoAbrirPainel) { Start-Process "http://localhost:$PortaApi/panel" }
    return
}
if ($PortaApi -eq $PortaWeb -and -not $SemExpo) { throw 'API e web precisam de portas diferentes.' }
# Verificar antes de instalar, exportar ou inicializar dados. Nunca encerrar ocupantes.
Assert-DemoPortFree $PortaApi
if (-not $SemExpo) { Assert-DemoPortFree $PortaWeb }
foreach ($stale in $staleRecords) {
    if ((Get-FileHash -LiteralPath $stale.path).Hash -ne $stale.hash -or
        (Get-DemoProcessState $stale.record).state -notin @('Absent','ReusedPid')) { throw 'Registro mudou durante a conferencia; tente novamente.' }
}
foreach ($stale in $staleRecords) {
    $archiveDir = Join-Path $DemoRuntime 'previous-processes'
    New-Item -ItemType Directory -Force -Path $archiveDir | Out-Null
    $archivePath = Join-Path $archiveDir ((Split-Path $stale.path -Leaf) + '.' + [guid]::NewGuid().ToString('N') + '.json')
    if (-not ([IO.Path]::GetFullPath($stale.path).StartsWith($DemoRuntime + '\', [StringComparison]::OrdinalIgnoreCase)) -or
        -not ([IO.Path]::GetFullPath($archivePath).StartsWith($DemoRuntime + '\', [StringComparison]::OrdinalIgnoreCase))) { throw 'Arquivo fora do runtime reservado.' }
    Move-Item -LiteralPath $stale.path -Destination $archivePath
    Write-Host 'Registro de processo encerrado arquivado; nenhum processo foi finalizado.'
}
New-Item -ItemType Directory -Force -Path $DemoRuntime | Out-Null
$env:TEMP = Join-Path $DemoRuntime 'temp'
$env:TMP = $env:TEMP
New-Item -ItemType Directory -Force -Path $env:TEMP | Out-Null
$python = Join-Path $DemoRoot '.venv\Scripts\python.exe'
if (-not (Test-Path -LiteralPath $python)) {
    & python -m venv (Join-Path $DemoRoot '.venv')
    if ($LASTEXITCODE -ne 0) { throw 'Falha ao preparar o Python local.' }
}
& $python -c "import flask"
if ($LASTEXITCODE -ne 0) {
    & $python -m pip install -r (Join-Path $DemoRoot 'server\requirements.txt')
    if ($LASTEXITCODE -ne 0) { throw 'Falha ao instalar Flask.' }
}
# O launcher de venv no Windows pode criar outro processo Python. Executar o
# interpretador real com os pacotes desta venv permite registrar o handle exato.
$runtimePython = (& $python -c "import sys; print(sys._base_executable)").Trim()
if ($LASTEXITCODE -ne 0 -or -not $runtimePython) { throw 'Interpretador Python nao encontrado.' }
$env:PYTHONPATH = Join-Path $DemoRoot '.venv\Lib\site-packages'
$env:PYTHONDONTWRITEBYTECODE = '1'
$env:DEV_SERVER_PORT = "$PortaApi"
$env:DEMO_WEB_PORT = "$PortaWeb"
$env:DEMO_INSTANCE_ID = [guid]::NewGuid().ToString('N')
$env:EXPO_PUBLIC_DEV_SERVER_URL = "http://localhost:$PortaApi"
$env:EXPO_NO_TELEMETRY = '1'
$env:CI = '1'
$webOutput = Join-Path $DemoRuntime 'web'
if (-not $SemExpo) {
    Push-Location (Join-Path $DemoRoot 'mobile')
    try {
        if (-not (Test-Path 'node_modules\.bin\expo.cmd')) {
            & npm.cmd ci --no-audit --no-fund --legacy-peer-deps --cache (Join-Path $DemoRuntime 'npm-cache')
            if ($LASTEXITCODE -ne 0) { throw 'Falha ao instalar dependencias mobile.' }
        }
        # Exporta a versao atual e serve o bundle em background, sem Metro concorrente.
        & .\node_modules\.bin\expo.cmd export --platform web --clear --output-dir $webOutput
        if ($LASTEXITCODE -ne 0) { throw 'Falha ao compilar a versao web.' }
    } finally { Pop-Location }
}
$startedHere = @()
try {
    $serverPath = Join-Path $DemoRoot 'server\server.py'
    $api = Start-Process -FilePath $runtimePython -ArgumentList "-S `"$serverPath`" --port $PortaApi" -WorkingDirectory $DemoRoot -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $DemoRuntime 'server.log') -RedirectStandardError (Join-Path $DemoRuntime 'server-error.log')
    $startedHere += $api
    Save-DemoProcess $api 'server' $env:DEMO_INSTANCE_ID $PortaApi
    $ready = $false
    for ($attempt=0; $attempt -lt 30; $attempt++) {
        if ($api.HasExited) { throw 'API encerrou; consulte .runtime/server-error.log.' }
        try {
            $health = Invoke-RestMethod "http://127.0.0.1:$PortaApi/health" -TimeoutSec 1
            if ($health.ok -and $health.server -eq 'cooperativa-dev-server' -and $health.demo_version -eq 'ride-fare-v6' -and $health.instance_id -eq $env:DEMO_INSTANCE_ID) { $ready=$true; break }
        } catch {}
        Start-Sleep -Milliseconds 200
    }
    if (-not $ready) { throw 'API nao confirmou a instancia iniciada.' }
    if (-not $SemExpo) {
        $webScript = Join-Path $DemoRoot 'docker\web_server.py'
        $web = Start-Process -FilePath $runtimePython -ArgumentList "-S `"$webScript`" --port $PortaWeb --root `"$webOutput`"" -WorkingDirectory $DemoRoot -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $DemoRuntime 'web.log') -RedirectStandardError (Join-Path $DemoRuntime 'web-error.log')
        $startedHere += $web
        Save-DemoProcess $web 'web' $env:DEMO_INSTANCE_ID $PortaWeb
        $webReady=$false
        for ($attempt=0; $attempt -lt 30; $attempt++) {
            if ($web.HasExited) { throw 'Web encerrou; consulte .runtime/web-error.log.' }
            try {
                $page=Invoke-WebRequest "http://127.0.0.1:$PortaWeb/" -UseBasicParsing -TimeoutSec 1
                if ($page.StatusCode -eq 200 -and $page.Content -match 'expo|root') { $webReady=$true; break }
            } catch {}
            Start-Sleep -Milliseconds 200
        }
        if (-not $webReady) { throw 'Bundle web nao ficou pronto.' }
    }
} catch {
    # Somente handles criados nesta chamada; nunca procura processos por porta.
    foreach ($created in $startedHere) { if (-not $created.HasExited) { $created.Kill(); $created.WaitForExit() } }
    foreach ($serviceName in @('server','web')) {
        $recordPath = Join-Path $DemoRuntime "$serviceName.process.json"
        if (Test-Path -LiteralPath $recordPath) {
            $failedRecord = Get-Content -LiteralPath $recordPath -Raw | ConvertFrom-Json
            if ($failedRecord.instance -eq $env:DEMO_INSTANCE_ID) { Remove-Item -LiteralPath $recordPath }
        }
    }
    throw
}
Write-Host "Demo atualizada pronta: http://localhost:$PortaApi/panel" -ForegroundColor Green
Write-Host 'Contas de demonstracao: Demo@123. Para encerrar, use atualizado\parar-demo.bat.'
if (-not $NaoAbrirPainel) { Start-Process "http://localhost:$PortaApi/panel" }
