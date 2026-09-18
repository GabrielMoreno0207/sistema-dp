@echo off
setlocal EnableDelayedExpansion
title Gerar APK - Comunicacao DP
rem Gera o instalador Android (APK) em mobile\dist\ComunicacaoDP-<versao>.apk
rem Requer o JDK 17 e o Android SDK em C:\android-dev (instalados na preparacao do projeto).
rem Use "gerar-apk.cmd --sem-pausa" para rodar sem esperar uma tecla no fim.

set "PAUSA=1"
if /i "%~1"=="--sem-pausa" set "PAUSA="

set "JAVA_HOME=C:\android-dev\jdk-17"
set "ANDROID_HOME=C:\android-dev\sdk"
set "ANDROID_SDK_ROOT=C:\android-dev\sdk"
set "PATH=%JAVA_HOME%\bin;%ANDROID_HOME%\platform-tools;%PATH%"

if not exist "%JAVA_HOME%\bin\java.exe" (
  echo JDK 17 nao encontrado em %JAVA_HOME%.
  goto :falha
)

cd /d "%~dp0"
set "PASTA=%CD%"
rem Caminho real do projeto, usado pelo metro.config.js (o Metro roda a partir da letra temporaria)
set "DP_REAL_ROOT=%PASTA%"
for /f "delims=" %%v in ('node -p "require('./package.json').version"') do set "VER=%%v"

rem O NDK/CMake nao aceitam espacos no caminho e o Windows limita caminhos a 260 caracteres:
rem compila a partir de uma letra de unidade temporaria apontando para esta pasta.

rem Desfaz letras que sobraram de uma compilacao interrompida (apontando para esta pasta),
rem para usar sempre a mesma letra (o Gradle guarda caminhos entre uma compilacao e outra).
for /f "tokens=1,2,*" %%a in ('subst') do (
  if /i "%%c"=="%PASTA%" (
    set "ANTIGA=%%a"
    subst !ANTIGA:~0,2! /d >nul 2>nul
  )
)

set "DRIVE="
for %%L in (R S T U V W Y Z) do (
  if not defined DRIVE if not exist %%L:\ set "DRIVE=%%L:"
)
if not defined DRIVE (
  echo Nenhuma letra de unidade livre para compilar.
  goto :falha
)
subst %DRIVE% "%PASTA%"
if not exist "%DRIVE%\android\gradlew.bat" (
  echo Nao foi possivel mapear %DRIVE% para %PASTA%.
  subst %DRIVE% /d >nul 2>nul
  goto :falha
)

rem Chama o Gradle pelo caminho completo (-p = pasta do projeto): nao depende da pasta atual
call "%DRIVE%\android\gradlew.bat" -p "%DRIVE%\android" assembleRelease -PreactNativeArchitectures=arm64-v8a,armeabi-v7a,x86_64
set "ERR=!ERRORLEVEL!"
subst %DRIVE% /d

if not "%ERR%"=="0" goto :falha

if not exist "%PASTA%\dist" mkdir "%PASTA%\dist"
copy /y "%PASTA%\android\app\build\outputs\apk\release\app-release.apk" "%PASTA%\dist\ComunicacaoDP-%VER%.apk" >nul
echo.
echo APK gerado: mobile\dist\ComunicacaoDP-%VER%.apk
if defined PAUSA pause
exit /b 0

:falha
echo.
echo Falha ao gerar o APK. Veja as mensagens acima.
if defined PAUSA pause
exit /b 1
