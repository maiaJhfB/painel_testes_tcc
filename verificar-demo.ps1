$ErrorActionPreference = "Stop"

$demoDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$mobileDir = Join-Path $demoDir "mobile"
$serverDir = Join-Path $demoDir "server"
$demoPython = Join-Path $demoDir ".venv\Scripts\python.exe"
$localTempDir = Join-Path $demoDir ".runtime\temp"
New-Item -ItemType Directory -Path $localTempDir -Force | Out-Null
$env:TEMP = $localTempDir
$env:TMP = $localTempDir

if (-not (Test-Path $demoPython)) {
    $demoPython = "python"
}

Write-Host "Verificando servidor, painel e fluxo da corrida..." -ForegroundColor Cyan
& $demoPython -m unittest discover -s $serverDir -p "test_*.py" -v
if ($LASTEXITCODE -ne 0) { throw "A verificação do servidor falhou." }

Write-Host "Verificando o aplicativo mobile..." -ForegroundColor Cyan
Push-Location $mobileDir
try {
    & node .\scripts\check-routes.cjs
    if ($LASTEXITCODE -ne 0) { throw "A verificacao das rotas do Expo Router falhou." }
    & .\node_modules\.bin\tsc.cmd --noEmit
    if ($LASTEXITCODE -ne 0) { throw "A verificação TypeScript falhou." }
    & .\node_modules\.bin\jest.cmd --runInBand
    if ($LASTEXITCODE -ne 0) { throw "Os testes mobile falharam." }
    Write-Host "Verificando a sessão web em resolução mobile..." -ForegroundColor Cyan
    & .\node_modules\.bin\expo.cmd export --platform web --output-dir (Join-Path $demoDir ".runtime\verify-web")
    if ($LASTEXITCODE -ne 0) { throw "A compilação da sessão web falhou." }
} finally {
    Pop-Location
}

Write-Host "✓ Ambiente demo aprovado para gravação." -ForegroundColor Green
