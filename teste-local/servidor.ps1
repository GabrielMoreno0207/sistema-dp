# Prepara e inicia o SERVIDOR DE TESTE do Comunicacao DP nesta maquina.
#  - confere o Node.js
#  - instala as dependencias (primeira vez)
#  - cria backend\.env com a senha do DP aleatoria (se ainda nao existir)
#  - cria/atualiza o banco (npm run db:init)
#  - inicia o backend em modo desenvolvimento (Ctrl+C para parar)
# Opcoes:  -ZerarBanco   apaga o banco de teste antes (comeca do zero)
param([switch]$ZerarBanco)
$ErrorActionPreference = 'Stop'

$root = Resolve-Path (Join-Path $PSScriptRoot '..')
$backend = Join-Path $root 'backend'
$envFile = Join-Path $backend '.env'

function Write-Step($text) { Write-Host "`n== $text" -ForegroundColor Cyan }
function Get-EnvValue($name) {
  $line = Select-String -Path $envFile -Pattern "^$name=(.*)$" | Select-Object -First 1
  if ($line) { return $line.Matches[0].Groups[1].Value.Trim() } else { return $null }
}

Write-Step 'Conferindo o Node.js'
if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  throw 'Node.js nao encontrado. Instale o Node 22 LTS em https://nodejs.org e abra este script de novo.'
}
$nodeVersion = & node -v
if ([version]$nodeVersion.TrimStart('v') -lt [version]'22.13.0') {
  throw "Node $nodeVersion e antigo. Instale o Node 22.13 ou superior (https://nodejs.org)."
}
Write-Host "Node $nodeVersion OK"

Set-Location $backend

if (-not (Test-Path (Join-Path $backend 'node_modules'))) {
  Write-Step 'Instalando dependencias do backend (primeira vez, pode demorar)'
  npm install
  if ($LASTEXITCODE -ne 0) { throw 'Falha no npm install' }
}

if (-not (Test-Path $envFile)) {
  Write-Step 'Criando backend\.env de teste (senha aleatoria)'
  $pass = & node -e "console.log('Dp-' + require('crypto').randomBytes(9).toString('base64url'))"
  $content = @"
NODE_ENV=development
SERVER_HOST=0.0.0.0
SERVER_PORT=3000
LOG_LEVEL=info
DATABASE_PATH=./data/sistema-dp.db
ADMIN_USERNAME=admin
ADMIN_PASSWORD=$pass
ADMIN_NAME=Departamento Pessoal
SESSION_TTL_HOURS=12
"@
  # UTF-8 sem BOM (o BOM atrapalharia a leitura da primeira variavel)
  [IO.File]::WriteAllText($envFile, $content, (New-Object Text.UTF8Encoding $false))
}

if ($ZerarBanco) {
  Write-Step 'Apagando o banco de teste'
  Remove-Item (Join-Path $backend 'data') -Recurse -Force -ErrorAction SilentlyContinue
}

Write-Step 'Criando/atualizando o banco'
npm run --silent db:init
if ($LASTEXITCODE -ne 0) { throw 'Falha ao preparar o banco' }

$port = Get-EnvValue 'SERVER_PORT'; if (-not $port) { $port = '3000' }
$user = Get-EnvValue 'ADMIN_USERNAME'; if (-not $user) { $user = 'admin' }
$pass = Get-EnvValue 'ADMIN_PASSWORD'

Write-Step 'Pronto! Acesso de teste'
Write-Host "  Central do DP : http://localhost:$port/central"
Write-Host "  Usuario       : $user"
if ($pass) { Write-Host "  Senha         : $pass  (a do backend\.env; se ja trocou com set-password, use a nova)" }
else { Write-Host '  Senha         : (definida anteriormente; troque com: npm run set-password -- admin)' }
Write-Host '  Funcionarios  : cadastre na secao Funcionarios da Central (no 1o acesso o app pede para trocar a senha)'
$ips = Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue |
  Where-Object { $_.IPAddress -notlike '127.*' -and $_.IPAddress -notlike '169.254.*' } | Select-Object -ExpandProperty IPAddress
foreach ($ip in $ips) { Write-Host "  Outros PCs    : http://${ip}:$port  (libere a porta $port no firewall)" }
Write-Host "`nIniciando o servidor... (Ctrl+C para parar)" -ForegroundColor Yellow

# Abre a Central no navegador assim que o servidor responder
Start-Job -ArgumentList $port -ScriptBlock {
  param($p)
  for ($i = 0; $i -lt 30; $i++) {
    try { Invoke-RestMethod "http://localhost:$p/api/health" -TimeoutSec 1 | Out-Null; Start-Process "http://localhost:$p/central"; return } catch { Start-Sleep 1 }
  }
} | Out-Null

npm run dev
