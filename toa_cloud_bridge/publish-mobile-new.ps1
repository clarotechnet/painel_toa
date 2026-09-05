Set-Location $PSScriptRoot
$config = 'wrangler.mobile.jsonc'
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
if ($LASTEXITCODE -ne 0) { throw 'Cloudflare nao autenticado.' }

Write-Host 'Aplicando migracoes D1 mobile...'
npx wrangler d1 migrations apply dominium-mobile-telemetry --remote --config $config
if ($LASTEXITCODE -ne 0) { throw 'Falha na migracao D1 mobile.' }
Write-Host 'Atualizando segredos mobile...'
$mobile | npx wrangler secret put DOMINIUM_MOBILE_TOKEN --config $config
if ($LASTEXITCODE -ne 0) { throw 'Falha ao gravar DOMINIUM_MOBILE_TOKEN.' }
$collector | npx wrangler secret put DOMINIUM_TELEMETRY_COLLECTOR_TOKEN --config $config
if ($LASTEXITCODE -ne 0) { throw 'Falha ao gravar token do coletor mobile.' }

Write-Host 'Publicando Worker mobile...'
npx wrangler deploy --config $config
if ($LASTEXITCODE -ne 0) { throw 'Falha no deploy do Worker mobile.' }

Write-Host 'WORKER_MOBILE_PUBLICADO'
