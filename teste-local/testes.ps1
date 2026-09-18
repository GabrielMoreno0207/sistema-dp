# Roda os TESTES AUTOMATIZADOS do backend (banco em memoria, nao mexe no banco de teste)
# e a checagem de tipos dos dois projetos.
$ErrorActionPreference = 'Stop'
$root = Resolve-Path (Join-Path $PSScriptRoot '..')
$failed = $false

function Invoke-Step($title, $folder, $script) {
  Write-Host "`n== $title" -ForegroundColor Cyan
  Push-Location (Join-Path $root $folder)
  try {
    if (-not (Test-Path 'node_modules')) { npm install | Out-Host }
    npm run --silent $script | Out-Host
    if ($LASTEXITCODE -ne 0) { $script:failed = $true; Write-Host "FALHOU: $title" -ForegroundColor Red }
    else { Write-Host "OK: $title" -ForegroundColor Green }
  } finally { Pop-Location }
}

Invoke-Step 'Testes automatizados da API (backend)' 'backend' 'test'
Invoke-Step 'Checagem de tipos (backend)' 'backend' 'typecheck'
Invoke-Step 'Checagem de tipos (desktop)' 'desktop' 'typecheck'

if ($failed) { Write-Host "`nAlgum passo falhou (veja acima)." -ForegroundColor Red; exit 1 }
Write-Host "`nTudo certo!" -ForegroundColor Green
