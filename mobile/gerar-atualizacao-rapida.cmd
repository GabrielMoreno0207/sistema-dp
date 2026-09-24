@echo off
rem Gera o pacote da atualizacao rapida (so o JavaScript) em mobile\dist\ComunicacaoDP-rapida-<versao>.zip
rem Publique no versionador, aba [ mobile ota ]. Veja scripts\gerar-atualizacao-rapida.js
cd /d "%~dp0"
node scripts\gerar-atualizacao-rapida.js
if /i not "%~1"=="--sem-pausa" pause
