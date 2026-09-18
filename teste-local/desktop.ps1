# Abre o APLICATIVO DESKTOP de teste conectado ao servidor de teste desta maquina.
# Rode antes o 1-iniciar-servidor-teste.cmd (em outra janela) e deixe-o aberto.
$ErrorActionPreference = 'Stop'

$root = Resolve-Path (Join-Path $PSScriptRoot '..')
$desktop = Join-Path $root 'desktop'
$backendEnv = Join-Path $root 'backend\.env'

function Write-Step($text) { Write-Host "`n== $text" -ForegroundColor Cyan }
function Get-BackendValue($name) {
  $line = Select-String -Path $backendEnv -Pattern "^$name=(.*)$" | Select-Object -First 1
  if ($line) { return $line.Matches[0].Groups[1].Value.Trim() } else { return $null }
}

if (-not (Test-Path $backendEnv)) { throw 'backend\.env nao existe. Rode primeiro o 1-iniciar-servidor-teste.cmd.' }
$port = Get-BackendValue 'SERVER_PORT'; if (-not $port) { $port = '3000' }

Set-Location $desktop

if (-not (Test-Path (Join-Path $desktop 'node_modules'))) {
  Write-Step 'Instalando dependencias do desktop (primeira vez, pode demorar alguns minutos)'
  npm install
  if ($LASTEXITCODE -ne 0) { throw 'Falha no npm install' }
}

Write-Step 'Configurando o app para o servidor de teste'
$desktopEnv = Join-Path $desktop '.env'
if (Test-Path $desktopEnv) { Copy-Item $desktopEnv "$desktopEnv.bak" -Force; Write-Host 'desktop\.env anterior guardado em desktop\.env.bak' }
$content = "SERVER_URL=http://localhost:$port`n"
[IO.File]::WriteAllText($desktopEnv, $content, (New-Object Text.UTF8Encoding $false))
# Configuracoes salvas pelo app de TESTE (tela Configuracoes) tem prioridade sobre o .env: limpa para usar o servidor de teste.
# O app de teste usa a pasta "Comunicacao DP-dev", separada do app instalado (que nao e tocado).
# (nome montado com [char] porque este arquivo e lido como ANSI pelo PowerShell 5.1)
$devFolder = 'Comunica' + [char]0x00E7 + [char]0x00E3 + 'o DP-dev'
$saved = Join-Path (Join-Path $env:APPDATA $devFolder) 'config.json'
if (Test-Path -LiteralPath $saved) { Remove-Item -LiteralPath $saved -Force; Write-Host 'Configuracoes antigas do app de teste limpas.' }
Write-Host "Servidor: http://localhost:$port"

try { Invoke-RestMethod "http://localhost:$port/api/health" -TimeoutSec 2 | Out-Null }
catch { Write-Host 'Atencao: o servidor de teste nao respondeu. O app vai ficar tentando reconectar ate ele subir.' -ForegroundColor Yellow }

Write-Step 'Abrindo o Comunicacao DP (feche esta janela ou Ctrl+C para parar)'
npm run dev
