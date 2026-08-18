@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo ========================================
echo  DOMINIUM TOA / TEC1 - Ambiente DEV
echo ========================================
echo.
where node >nul 2>&1 || (
  echo [ERRO] Node.js nao encontrado no PATH.
  echo Instale o Node.js e abra este arquivo novamente.
  pause
  exit /b 1
)

echo [1/2] Instalando dependencias do frontend...
call npm install
if errorlevel 1 (
  echo.
  echo [ERRO] npm install falhou.
  pause
  exit /b 1
)

echo.
echo [2/2] Abrindo servidor de desenvolvimento...
call npm run dev
