@echo off
setlocal
chcp 65001 >nul
cd /d "%~dp0"

echo =======================================================
echo          INICIANDO DOMINIUM TOA / TEC1
echo =======================================================
echo.

call "%~dp0Abrir_Painel_TOA.cmd"

endlocal
