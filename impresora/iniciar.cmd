@echo off
rem Resplandor - arranca el agente de la impresora de la caja.
rem Doble clic, o un acceso directo a este archivo en shell:startup para que arranque con Windows.
rem Si el agente se cae por algo inesperado, lo vuelve a abrir a los 10 segundos.
rem Archivo ASCII a proposito: la consola de Windows no siempre lee bien las tildes de un .cmd.
chcp 65001 >nul
title Resplandor - impresora de la caja
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo No encuentro Node.js en este PC. Instala Node 22 LTS desde https://nodejs.org
  echo y vuelve a abrir este archivo.
  echo.
  pause
  exit /b 1
)

:inicio
node agente.mjs %*
set CODIGO=%errorlevel%
if "%CODIGO%"=="0" exit /b 0
if "%CODIGO%"=="2" (
  echo.
  echo Hay que arreglar config.json ^(mira el mensaje de arriba^). No reintento.
  echo.
  pause
  exit /b 2
)
echo.
echo El agente se detuvo ^(codigo %CODIGO%^). Reintento en 10 segundos. Cierra esta ventana para salir.
timeout /t 10 /nobreak >nul
goto inicio
