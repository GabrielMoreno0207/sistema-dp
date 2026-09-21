@echo off
REM Abre o versionador (publica novas versões no servidor).
cd /d "%~dp0versionador"
if not exist node_modules (
  echo Instalando dependencias do versionador...
  call npm install
)
call npm start
