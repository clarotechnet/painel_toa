param(
    [string]$Destination = 'C:\Dominium\TOA-TechNet-Bridge'
)

$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$source = Join-Path $projectRoot 'toa-bridge'
$manifestPath = Join-Path $source 'manifest.json'

if (-not (Test-Path -LiteralPath $manifestPath -PathType Leaf)) {
    throw "Extensao TOA TechNet Bridge nao encontrada em: $source"
}

$manifest = Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json
if ($manifest.name -ne 'TOA TechNet Bridge' -or $manifest.version -ne '2.6.2') {
    throw "Pacote inesperado: $($manifest.name) $($manifest.version)"
}

New-Item -ItemType Directory -Path $Destination -Force | Out-Null
Copy-Item -Path (Join-Path $source '*') -Destination $Destination -Recurse -Force

$installedManifest = Join-Path $Destination 'manifest.json'
if (-not (Test-Path -LiteralPath $installedManifest -PathType Leaf)) {
    throw 'A copia da extensao nao foi concluida.'
}

Write-Host ''
Write-Host "TOA TechNet Bridge $($manifest.version) instalada em:" -ForegroundColor Green
Write-Host $Destination -ForegroundColor Cyan
Write-Host ''
Write-Host 'Agora abra chrome://extensions, ative o Modo do desenvolvedor e use Carregar sem compactacao.'
Write-Host 'Selecione a pasta acima. Depois abra Detalhes > Opcoes da extensao.'
Write-Host 'O Worker e o coletor central-toa ja aparecem preenchidos. Informe apenas a chave privada e ative a coleta.'
Write-Host 'A chave permanece no armazenamento local do Chrome e nao e copiada para este projeto.'
