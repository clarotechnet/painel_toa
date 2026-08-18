param(
    [ValidateSet('session','collector')]
    [string]$Mode = 'session',
    [int]$TimeoutSeconds = 120
)

$ErrorActionPreference = 'SilentlyContinue'
$started = Get-Date
$deadline = $started.AddSeconds([Math]::Max(5, $TimeoutSeconds))
$lastState = ''
$lastError = ''
$lastRecords = 0
$lastPrinted = [DateTime]::MinValue

while ((Get-Date) -lt $deadline) {
    try {
        $health = Invoke-RestMethod -UseBasicParsing -TimeoutSec 3 'http://127.0.0.1:8765/api/v1/health'
        $items = @($health.collector.items)
        if ($Mode -eq 'session') {
            $item = $items | Where-Object { $_.collector -eq 'toa-session' } | Select-Object -First 1
            if ($null -ne $item) {
                $lastState = [string]$item.state
                $lastError = [string]$item.last_error
                if ($item.state -eq 'online') {
                    Write-Host '[OK] Sessao TOA autenticada e Console de Alocacao pronta.'
                    exit 0
                }
            }
        }
        else {
            $item = $items | Where-Object { $_.collector -eq 'toa-time-get' } | Select-Object -First 1
            if ($null -ne $item) {
                $lastState = [string]$item.state
                $lastError = [string]$item.last_error
                $lastRecords = [int]($item.records)
                if (($item.state -in @('online','degraded')) -and $lastRecords -gt 0) {
                    Write-Host ("[OK] Coletor TOA entregou {0} atividades." -f $lastRecords)
                    exit 0
                }
            }
        }
    }
    catch {
        $lastError = $_.Exception.Message
    }

    $now = Get-Date
    if (($now - $lastPrinted).TotalSeconds -ge 5) {
        $elapsed = [int](($now - $started).TotalSeconds)
        $stateText = if ($lastState) { $lastState } else { 'aguardando heartbeat' }
        if ($Mode -eq 'session') {
            if ($lastError) {
                Write-Host ("  [{0}s] Sessao TOA: {1} | {2}" -f $elapsed, $stateText, $lastError)
            }
            else {
                Write-Host ("  [{0}s] Sessao TOA: {1}" -f $elapsed, $stateText)
            }
        }
        else {
            if ($lastError) {
                Write-Host ("  [{0}s] Coletor: {1} | registros: {2} | {3}" -f $elapsed, $stateText, $lastRecords, $lastError)
            }
            else {
                Write-Host ("  [{0}s] Coletor: {1} | registros: {2}" -f $elapsed, $stateText, $lastRecords)
            }
        }
        $lastPrinted = $now
    }
    Start-Sleep -Milliseconds 700
}

if ($Mode -eq 'session') {
    Write-Host ("[ERRO] Sessao TOA nao ficou pronta. Estado: {0}" -f ($lastState -replace '^$','sem resposta'))
}
else {
    Write-Host ("[ERRO] Coletor TOA nao entregou atividades. Estado: {0}; registros: {1}" -f ($lastState -replace '^$','sem resposta'), $lastRecords)
}
if ($lastError) {
    Write-Host ("[DETALHE] {0}" -f $lastError)
}
exit 1
