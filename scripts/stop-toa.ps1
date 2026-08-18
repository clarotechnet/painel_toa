param(
    [switch]$Silent
)

$ErrorActionPreference = 'SilentlyContinue'

$managedPatterns = @(
    'app_server_watchdog.py',
    'toa_session_watchdog.py',
    'toa_session_supervisor.py',
    'toa-monitor-collector.mjs',
    'toa-live-bridge.mjs'
)

function Stop-ProcessTree([int]$ProcessId) {
    if ($ProcessId -le 0 -or $ProcessId -eq $PID) {
        return
    }
    & taskkill.exe /PID $ProcessId /T /F 2>$null | Out-Null
}

function Stop-ManagedWorkers {
    $processes = Get-CimInstance Win32_Process | Where-Object {
        $name = [string]$_.Name
        $commandLine = [string]$_.CommandLine
        $supportedProcess = $name -in @('python.exe', 'pythonw.exe', 'node.exe')
        $matchesProject = $false
        foreach ($pattern in $managedPatterns) {
            if ($commandLine -like "*$pattern*") {
                $matchesProject = $true
                break
            }
        }
        $supportedProcess -and $matchesProject
    }

    foreach ($process in $processes) {
        Stop-ProcessTree -ProcessId ([int]$process.ProcessId)
    }
}

# O watchdog precisa morrer primeiro para nao recriar o supervisor enquanto
# os demais processos estao sendo encerrados. A segunda passada cobre qualquer
# processo que tenha sido recriado exatamente durante a primeira varredura.
Stop-ManagedWorkers
Start-Sleep -Milliseconds 700
Stop-ManagedWorkers

# Encerra somente o processo que ocupa a porta da API local do projeto.
$listeners = Get-NetTCPConnection -LocalPort 8765 -State Listen
foreach ($listener in $listeners) {
    if ($listener.OwningProcess) {
        Stop-ProcessTree -ProcessId ([int]$listener.OwningProcess)
    }
}

# Encerra somente o Chrome dedicado ao TOA. O Chrome pessoal nao usa esta porta.
$toaChrome = Get-CimInstance Win32_Process | Where-Object {
    $_.Name -eq 'chrome.exe' -and
    ([string]$_.CommandLine -like '*--remote-debugging-port=9341*')
}
foreach ($process in $toaChrome) {
    Stop-ProcessTree -ProcessId ([int]$process.ProcessId)
}

Start-Sleep -Milliseconds 400
Remove-Item -Force 'data\toa-live-bridge.pid', 'data\toa-monitor-collector.pid'

if (-not $Silent) {
    Write-Host 'Sistema encerrado.'
    Write-Host 'O Chrome pessoal foi preservado; somente o Chrome dedicado do TOA foi fechado.'
}
