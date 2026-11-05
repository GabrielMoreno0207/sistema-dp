@echo off
REM Abre o versionador (publica novas versoes no servidor).
REM
REM O "npm start" mantinha este terminal aberto junto do aplicativo. Agora o
REM electron.exe e chamado direto com "start" e este console fecha na hora.
REM Para abrir sem nem piscar o terminal, use o versionador.vbs ao lado.
cd /d "%~dp0versionador"
if not exist node_modules (
  echo Instalando dependencias do versionador...
  call npm install
)
start "" "%~dp0versionador\node_modules\electron\dist\electron.exe" "%~dp0versionador"
