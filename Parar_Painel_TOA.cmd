@echo off
setlocal
chcp 65001 >nul
cd /d "%~dp0"

set "SILENT_ARG="
if /i "%~1"=="/silent" set "SILENT_ARG=-Silent"

if not defined SILENT_ARG (
  echo ========================================
  echo  DOMINIUM TOA / TEC1 - Encerrando
  echo ========================================
  echo.
)

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\stop-toa.ps1" %SILENT_ARG%

endlocal
