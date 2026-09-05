$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot
$envPath = Join-Path (Split-Path $PSScriptRoot -Parent) '.env.local'
if (-not (Test-Path $envPath)) { throw '.env.local nao encontrado.' }

$cfg = @{}
foreach ($line in Get-Content $envPath) {
  if ($line -match '^\s*([A-Za-z_][A-Za-z0-9_]*)=(.*)$') {
    $cfg[$matches[1]] = $matches[2].Trim().Trim('"').Trim("'")
  }
}
$mobile = [string]$cfg['DOMINIUM_MOBILE_TOKEN']
$collector = [string]$cfg['DOMINIUM_TELEMETRY_COLLECTOR_TOKEN']
if (-not $mobile -or -not $collector) { throw 'Tokens mobile ausentes em .env.local.' }

Write-Host 'Validando autenticacao Cloudflare...'
npx wrangler whoami
if ($LASTEXITCODE -ne 0) { throw 'Cloudflare nao autenticado. Execute: npx wrangler login' }

Write-Host 'Aplicando migracoes D1...'
npm run db:remote
if ($LASTEXITCODE -ne 0) { throw 'Falha na migracao D1.' }
Write-Host 'Atualizando segredos exclusivos do mobile...'
$mobile | npx wrangler secret put DOMINIUM_MOBILE_TOKEN
if ($LASTEXITCODE -ne 0) { throw 'Falha ao gravar DOMINIUM_MOBILE_TOKEN.' }
$collector | npx wrangler secret put DOMINIUM_TELEMETRY_COLLECTOR_TOKEN
if ($LASTEXITCODE -ne 0) { throw 'Falha ao gravar token do coletor mobile.' }

Write-Host 'Publicando Worker...'
npm run deploy
if ($LASTEXITCODE -ne 0) { throw 'Falha no deploy do Worker.' }

$base = 'https://dominium-toa-bridge.dominium-toa-cloud-bridge.workers.dev'
$health = Invoke-RestMethod "$base/health" -TimeoutSec 15
if ($health.ok -ne $true) { throw 'Health do Worker falhou.' }
try {
  Invoke-WebRequest "$base/v1/telemetry" -Method Post -ContentType 'application/json' -Body '{}' -UseBasicParsing -TimeoutSec 15 | Out-Null
  throw 'Endpoint de telemetria aceitou requisicao sem token.'
} catch {
  if (-not $_.Exception.Response -or [int]$_.Exception.Response.StatusCode -ne 401) { throw }
}
Write-Host 'OK: Worker publicado, D1 migrado e /v1/telemetry protegido.'
