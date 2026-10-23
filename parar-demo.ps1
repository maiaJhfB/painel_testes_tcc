# ====================================================================
# parar-demo.ps1 — Encerra os serviços do ambiente demo de forma segura
# ====================================================================

Write-Host "Encerrando serviços do ambiente demo..." -ForegroundColor Yellow

$SCRIPT_DIR = Split-Path -Parent $MyInvocation.MyCommand.Path
$RUNTIME_DIR = Join-Path $SCRIPT_DIR ".runtime"
$SERVER_PID_FILE = Join-Path $RUNTIME_DIR "server.pid"
$DEMO_PYTHON = Join-Path $SCRIPT_DIR ".venv\Scripts\python.exe"

# 1. Encerrar primeiro o PID que foi registrado pelo inicializador da demo.
if (Test-Path $SERVER_PID_FILE) {
    $serverPid = [int](Get-Content $SERVER_PID_FILE -Raw)
    $process = Get-Process -Id $serverPid -ErrorAction SilentlyContinue
    if ($process) {
        $commandLine = (Get-CimInstance Win32_Process -Filter "ProcessId = $serverPid" -ErrorAction SilentlyContinue).CommandLine
        if ($commandLine -like "*ambiente-demo*server.py*") {
            Write-Host "Parando servidor demo (PID $serverPid)..." -ForegroundColor Gray
            Stop-Process -Id $serverPid -Force -ErrorAction SilentlyContinue
        }
    }
    Remove-Item -LiteralPath $SERVER_PID_FILE -Force -ErrorAction SilentlyContinue
}
Remove-Item -LiteralPath (Join-Path $RUNTIME_DIR "server.ready") -Force -ErrorAction SilentlyContinue

# 1b. Recupera também um servidor órfão da própria demo caso o PID salvo
# tenha ficado desatualizado após uma interrupção do terminal.
$demoServerPorts = Get-NetTCPConnection -LocalPort 4747 -State Listen -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess -Unique
foreach ($serverPidToKill in $demoServerPorts) {
    $serverProcess = Get-Process -Id $serverPidToKill -ErrorAction SilentlyContinue
    $isOwnedDemoServer = $serverProcess -and $serverProcess.Path -eq $DEMO_PYTHON
    if (-not $isOwnedDemoServer) {
        try {
            $commandLine = (Get-CimInstance Win32_Process -Filter "ProcessId = $serverPidToKill" -ErrorAction Stop).CommandLine
            $isOwnedDemoServer = $commandLine -like "*ambiente-demo*server.py*"
        } catch {}
    }
    if ($isOwnedDemoServer) {
        Write-Host "Parando servidor demo órfão (PID $serverPidToKill)..." -ForegroundColor Gray
        Stop-Process -Id $serverPidToKill -Force -ErrorAction SilentlyContinue
    }
}

# 2. Encerrar somente o Metro que usa a porta reservada da demo.
$demoMetroPorts = Get-NetTCPConnection -LocalPort 8085 -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess -Unique
foreach ($pidToKill in $demoMetroPorts) {
    if ($pidToKill -gt 0) {
        $commandLine = (Get-CimInstance Win32_Process -Filter "ProcessId = $pidToKill" -ErrorAction SilentlyContinue).CommandLine
        if ($commandLine -like "*ambiente-demo*" -or $commandLine -like "*--port 8085*") {
            Write-Host "Parando Metro demo (PID $pidToKill)..." -ForegroundColor Gray
            Stop-Process -Id $pidToKill -Force -ErrorAction SilentlyContinue
        }
    }
}

Write-Host "✓ Ambiente demo encerrado com sucesso." -ForegroundColor Green
Write-Host "  (Processos de QA nas portas 8082 e 8787 foram preservados intactos)." -ForegroundColor Gray
