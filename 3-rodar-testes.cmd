@echo off
rem Roda os testes automatizados e a checagem de tipos.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0teste-local\testes.ps1"
pause
