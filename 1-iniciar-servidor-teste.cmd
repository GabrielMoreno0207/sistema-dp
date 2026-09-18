@echo off
rem Prepara o banco e inicia o servidor de teste. Use "1-iniciar-servidor-teste.cmd -ZerarBanco" para comecar do zero.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0teste-local\servidor.ps1" %*
pause
