[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$projectRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$dockerTemplate = Join-Path $projectRoot '.env.docker.example'
$localTemplate = Join-Path $projectRoot '.env.local.example'
$dockerEnv = Join-Path $projectRoot '.env.docker'
$localEnv = Join-Path $projectRoot '.env.local'

if ((Test-Path -LiteralPath $dockerEnv) -or (Test-Path -LiteralPath $localEnv)) {
    throw 'Configuracao existente detectada. Por seguranca, o script nao sobrescreve .env.docker nem .env.local.'
}

function New-DominiumSecret {
    $bytes = New-Object byte[] 48
    $generator = [System.Security.Cryptography.RandomNumberGenerator]::Create()
    try {
        $generator.GetBytes($bytes)
    }
    finally {
        $generator.Dispose()
    }
    return ([Convert]::ToBase64String($bytes) -replace '[+/=]', '')
}

$postgresPassword = New-DominiumSecret
$n8nKey = New-DominiumSecret
$ingestToken = New-DominiumSecret
$utf8NoBom = New-Object System.Text.UTF8Encoding($false)

$dockerContent = [IO.File]::ReadAllText($dockerTemplate)
$dockerContent = $dockerContent.Replace('TROQUE_ANTES_DE_USAR_POSTGRES', $postgresPassword)
$dockerContent = $dockerContent.Replace('TROQUE_ANTES_DE_USAR_N8N', $n8nKey)
$dockerContent = $dockerContent.Replace('TROQUE_ANTES_DE_USAR_INGESTAO', $ingestToken)
[IO.File]::WriteAllText($dockerEnv, $dockerContent, $utf8NoBom)

$localContent = [IO.File]::ReadAllText($localTemplate)
$localContent = $localContent.Replace('TROQUE_ANTES_DE_USAR_INGESTAO', $ingestToken)
[IO.File]::WriteAllText($localEnv, $localContent, $utf8NoBom)

Write-Host 'Arquivos .env.docker e .env.local criados com segredos aleatorios.' -ForegroundColor Green
Write-Host 'Os valores nao foram exibidos e os dois arquivos estao ignorados pelo Git.'

