# ====================================================================
# resetar-demo.ps1 — Restaura o banco de dados da demo ao estado inicial
# ====================================================================

$SCRIPT_DIR = Split-Path -Parent $MyInvocation.MyCommand.Path
$SERVER_DIR = Join-Path $SCRIPT_DIR "server"
$DEMO_PYTHON = Join-Path $SCRIPT_DIR ".venv\Scripts\python.exe"
if (-not (Test-Path $DEMO_PYTHON)) { $DEMO_PYTHON = "python" }

Write-Host "Resetando ambiente de demonstração..." -ForegroundColor Yellow

try {
    # Tenta resetar via endpoint HTTP do servidor se estiver em execução
    $res = Invoke-RestMethod -Uri "http://localhost:4747/mock/reset" -Method Post -TimeoutSec 3 -ErrorAction Stop
    Write-Host "✓ Banco de dados resetado via API: $($res.message)" -ForegroundColor Green
} catch {
    # Se o servidor estiver parado, reseta diretamente pelo script Python
    & $DEMO_PYTHON -c "import sys; sys.path.insert(0, '$($SERVER_DIR.Replace('\', '/'))'); import server; server.init_db(); server.reset_demo_data()"
    Write-Host "✓ Banco de dados SQLite resetado e re-populado com os perfis de Carlos Silva e Vitor Maia." -ForegroundColor Green
}

Write-Host ""
Write-Host "Perfis disponíveis no estado inicial:" -ForegroundColor Cyan
Write-Host "  🚗 Motorista: Carlos Silva (Toyota Corolla Cinza · 0x1563...5508)" -ForegroundColor Gray
Write-Host "  👤 Passageiro: Vitor Maia (0x19E7...ff2A)" -ForegroundColor Gray
Write-Host ""
Write-Host "Pronto para gravar um novo take da demonstração!" -ForegroundColor Green
Write-Host "Se quiser voltar ao onboarding no celular, use 'Sair / Remover Identidade' no Perfil." -ForegroundColor Gray
