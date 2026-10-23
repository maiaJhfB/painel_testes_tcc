param(
    [string]$Destination = ""
)

$ErrorActionPreference = "Stop"
$source = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
if (-not $Destination) {
    $Destination = Join-Path "C:\programming" ("cooperativa-demo-apk-" + (Get-Date -Format "yyyyMMdd-HHmmss"))
}
$destinationPath = [System.IO.Path]::GetFullPath($Destination)
if ($destinationPath -eq $source -or $destinationPath.StartsWith($source + [System.IO.Path]::DirectorySeparatorChar)) {
    throw "Escolha uma pasta de build fora do projeto mobile."
}

Write-Host "Copiando fontes para $destinationPath ..." -ForegroundColor Cyan
robocopy $source $destinationPath /E /XD node_modules .expo .git /XF *.apk *.aab /NFL /NDL /NJH /NJS | Out-Null
if ($LASTEXITCODE -ge 8) { throw "Falha ao copiar o projeto (robocopy $LASTEXITCODE)." }

Push-Location $destinationPath
try {
    Write-Host "Instalando dependências do build..." -ForegroundColor Cyan
    npm ci --ignore-scripts --no-audit --no-fund
    if ($LASTEXITCODE -ne 0) { throw "npm ci falhou." }

    # O EAS exige um repositório Git próprio; a cópia fica fora do .git do TCC.
    # node_modules precisa ficar fora do commit e do arquivo enviado.
    if (-not (Test-Path ".gitignore")) {
        @("node_modules/", ".expo/", "android/", "ios/", "*.apk", "*.aab", ".DS_Store", "Thumbs.db") |
            Set-Content -LiteralPath ".gitignore" -Encoding utf8
    }
    if (-not (Test-Path ".git")) {
        git init -q
        git add -A
        git -c user.name="Cooperativa Demo" -c user.email="demo@local" commit -q -m "Build do APK da demonstração"
    }

    Write-Host "Enviando build Android (perfil preview)..." -ForegroundColor Cyan
    npx --yes eas-cli build --platform android --profile preview --non-interactive
} finally {
    Pop-Location
}
