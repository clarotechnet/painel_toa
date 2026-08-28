@echo off
setlocal
chcp 65001 >nul
cd /d "%~dp0"

rem Sempre limpa uma execucao anterior deste projeto antes de iniciar.
call "%~dp0Parar_Painel_TOA.cmd" /silent >nul 2>&1

where node >nul 2>&1 || (
  echo [ERRO] Node.js nao encontrado no PATH.
  echo Instale o Node.js e tente novamente.
  pause
  exit /b 1
)
where python >nul 2>&1 || (
  echo [ERRO] Python nao encontrado no PATH.
  echo Instale o Python e tente novamente.
  pause
  exit /b 1
)

python -c "import edge_tts" >nul 2>&1 || (
  echo [INFO] Instalando suporte a voz neural (edge-tts)...
  python -m pip install edge-tts >nul 2>&1
)

node scripts\build.mjs
if errorlevel 1 (
  echo.
  echo [ERRO] Nao foi possivel gerar a pasta dist.
  pause
  exit /b 1
)

if not exist "data" mkdir "data"

echo [1/7] Validando a credencial TOA protegida deste Windows...
python -B backend\toa\ensure_credentials.py
if errorlevel 1 (
  echo.
  echo [ERRO] A credencial TOA nao foi configurada.
  echo Execute npm start novamente quando puder informar o login.
  pause
  exit /b 1
)

echo [2/7] Iniciando o servidor local e a API auto-recuperavel...
powershell -NoProfile -Command "$p=@(Get-CimInstance Win32_Process).Where({ $_.ProcessId -ne $PID -and $_.Name -eq 'python.exe' -and $_.CommandLine -like '*app_server_watchdog.py*' }); if (-not $p) { Start-Process -WindowStyle Hidden -FilePath 'python' -ArgumentList '-B','backend\toa\app_server_watchdog.py' -WorkingDirectory '%CD%' -RedirectStandardOutput 'data\dominium-app-watchdog.out.log' -RedirectStandardError 'data\dominium-app-watchdog.err.log' }"
powershell -NoProfile -Command "$limite=(Get-Date).AddSeconds(25); $ok=$false; while ((Get-Date) -lt $limite -and -not $ok) { try { $r=Invoke-WebRequest -UseBasicParsing -TimeoutSec 2 'http://127.0.0.1:8765/api/v1/health'; $ok=($r.StatusCode -eq 200) } catch { Start-Sleep -Milliseconds 350 } }; if (-not $ok) { exit 1 }"
if errorlevel 1 (
  echo [ERRO] O servidor local nao respondeu corretamente na porta 8765.
  call "%~dp0Parar_Painel_TOA.cmd" /silent >nul 2>&1
  echo Consulte data\dominium-app.stderr.log e data\dominium-app-watchdog.log.
  pause
  exit /b 1
)

echo [3/7] Iniciando a sessao TOA dedicada...
powershell -NoProfile -Command "$p=@(Get-CimInstance Win32_Process).Where({ $_.ProcessId -ne $PID -and $_.Name -eq 'python.exe' -and $_.CommandLine -like '*toa_session_watchdog.py*' }); if (-not $p) { Start-Process -WindowStyle Hidden -FilePath 'python' -ArgumentList '-B','backend\toa\toa_session_watchdog.py' -WorkingDirectory '%CD%' -RedirectStandardOutput 'data\toa-session.out.log' -RedirectStandardError 'data\toa-session.err.log' }"

echo [4/7] Aguardando o Chrome TOA dedicado ficar disponivel...
powershell -NoProfile -Command "$limite=(Get-Date).AddSeconds(45); while ((Get-Date) -lt $limite -and -not (Get-NetTCPConnection -LocalPort 9341 -State Listen -ErrorAction SilentlyContinue)) { Start-Sleep -Milliseconds 500 }; if (-not (Get-NetTCPConnection -LocalPort 9341 -State Listen -ErrorAction SilentlyContinue)) { exit 1 }"
if errorlevel 1 (
  echo [ERRO] A sessao TOA nao abriu a porta 9341.
  call "%~dp0Parar_Painel_TOA.cmd" /silent >nul 2>&1
  pause
  exit /b 1
)

echo [5/7] Aguardando login e Console de Alocacao ficarem prontos...
echo       O Chrome dedicado fica visivel durante o login e sera minimizado quando autenticar.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\wait-toa-ready.ps1" -Mode session -TimeoutSeconds 180
if errorlevel 1 (
  echo.
  echo Ultimas mensagens da sessao:
  powershell -NoProfile -Command "if (Test-Path 'data\toa-session.out.log') { Get-Content 'data\toa-session.out.log' -Tail 12 }; if (Test-Path 'data\toa-session.err.log') { Get-Content 'data\toa-session.err.log' -Tail 12 }"
  call "%~dp0Parar_Painel_TOA.cmd" /silent >nul 2>&1
  echo.
  echo O sistema foi encerrado para nao deixar servidor ou Chrome presos.
  pause
  exit /b 1
)

echo [6/7] Iniciando o coletor Time/get e a ponte visual...
powershell -NoProfile -Command "$p=@(Get-CimInstance Win32_Process).Where({ $_.ProcessId -ne $PID -and $_.Name -eq 'node.exe' -and $_.CommandLine -like '*toa-monitor-collector.mjs*' }); if (-not $p) { Start-Process -WindowStyle Hidden -FilePath 'node' -ArgumentList 'scripts\toa-monitor-collector.mjs' -WorkingDirectory '%CD%' -RedirectStandardOutput 'data\toa-monitor-collector.out.log' -RedirectStandardError 'data\toa-monitor-collector.err.log' }; $b=@(Get-CimInstance Win32_Process).Where({ $_.ProcessId -ne $PID -and $_.Name -eq 'node.exe' -and $_.CommandLine -like '*toa-live-bridge.mjs*' }); if (-not $b) { Start-Process -WindowStyle Hidden -FilePath 'node' -ArgumentList 'scripts\toa-live-bridge.mjs' -WorkingDirectory '%CD%' -RedirectStandardOutput 'data\toa-live-bridge.out.log' -RedirectStandardError 'data\toa-live-bridge.err.log' }"

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\wait-toa-ready.ps1" -Mode collector -TimeoutSeconds 180
if errorlevel 1 (
  echo.
  echo Ultimas mensagens do coletor:
  powershell -NoProfile -Command "if (Test-Path 'data\toa-monitor-collector.out.log') { Get-Content 'data\toa-monitor-collector.out.log' -Tail 15 }; if (Test-Path 'data\toa-monitor-collector.err.log') { Get-Content 'data\toa-monitor-collector.err.log' -Tail 15 }"
  call "%~dp0Parar_Painel_TOA.cmd" /silent >nul 2>&1
  echo.
  echo O sistema foi encerrado para nao deixar servidor ou Chrome presos.
  pause
  exit /b 1
)

echo [7/7] Coleta confirmada. Abrindo o painel...
start "" "http://127.0.0.1:8765/"
endlocal
