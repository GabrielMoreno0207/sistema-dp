@echo off
rem Abre o app desktop conectado ao servidor de teste (deixe o 1-iniciar-servidor-teste.cmd aberto).
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0teste-local\desktop.ps1"
pause
