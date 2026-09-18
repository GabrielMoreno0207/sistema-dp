@echo off
setlocal
title Backup do banco - Comunicacao DP
rem Copia o banco do sistema para C:\backup-dp com a data no nome.
rem Funciona com o servico rodando (usa VACUUM INTO, que respeita as gravacoes em andamento).
rem Agende no Agendador de Tarefas: diario, de madrugada, "Iniciar em" = pasta backend.

set "DESTINO=C:\backup-dp"
set "BANCO=%~dp0data\sistema-dp.db"
if not "%~1"=="" set "DESTINO=%~1"

if not exist "%BANCO%" (
  echo Banco nao encontrado em %BANCO%
  exit /b 1
)
if not exist "%DESTINO%" mkdir "%DESTINO%"

for /f "delims=" %%d in ('powershell -NoProfile -Command "Get-Date -Format yyyy-MM-dd_HHmm"') do set "DATA=%%d"
set "ARQUIVO=%DESTINO%\sistema-dp-%DATA%.db"

node -e "const {DatabaseSync}=require('node:sqlite'); const o=process.argv[1], d=process.argv[2]; new DatabaseSync(o,{readOnly:true}).exec('VACUUM INTO ' + JSON.stringify(d.replace(/\\/g,'/')).replace(/\"/g,String.fromCharCode(39)));" "%BANCO%" "%ARQUIVO%"
if errorlevel 1 (
  echo Falha ao gerar o backup.
  exit /b 1
)

echo Backup gerado: %ARQUIVO%

rem Anexos dos comunicados: copia so o que mudou (robocopy retorna 0-7 em caso de sucesso)
set "ANEXOS=%~dp0data\uploads"
if exist "%ANEXOS%" (
  robocopy "%ANEXOS%" "%DESTINO%\anexos" /MIR /NFL /NDL /NJH /NJS /R:1 /W:1 >nul
  if errorlevel 8 (echo Falha ao copiar os anexos de %ANEXOS%) else (echo Anexos copiados: %DESTINO%\anexos)
)

rem Apaga backups com mais de 30 dias
powershell -NoProfile -Command "Get-ChildItem '%DESTINO%\sistema-dp-*.db' | Where-Object { $_.LastWriteTime -lt (Get-Date).AddDays(-30) } | Remove-Item -Force"
exit /b 0
