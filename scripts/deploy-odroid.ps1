param(
  [string]$ProjectRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path,
  [string]$ConfigPath = (Join-Path (Resolve-Path (Join-Path $PSScriptRoot "..")).Path ".env.odroid"),
  [string]$SshPassword,
  [string]$SudoPassword,
  [switch]$SkipHealthCheck
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

function Read-KeyValueFile {
  param([string]$Path)

  if (-not (Test-Path $Path)) {
    throw "설정 파일을 찾을 수 없습니다: $Path"
  }

  $result = @{}
  foreach ($line in Get-Content $Path) {
    $trimmed = $line.Trim()
    if (-not $trimmed -or $trimmed.StartsWith("#")) {
      continue
    }

    $pair = $trimmed -split "=", 2
    if ($pair.Count -ne 2) {
      continue
    }
    $result[$pair[0]] = $pair[1]
  }
  return $result
}

function ConvertTo-PlainText {
  param([Security.SecureString]$SecureString)

  $bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($SecureString)
  try {
    return [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr)
  }
  finally {
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr)
  }
}

function Escape-ShellSingleQuoted {
  param([string]$Value)

  return $Value -replace "'", "'""'""'"
}

$config = Read-KeyValueFile -Path $ConfigPath

$remoteHost = $config["ODROID_HOST"]
$remoteUser = $config["ODROID_USER"]
$remotePort = $config["ODROID_SSH_PORT"]
$remoteAppDir = $config["ODROID_APP_DIR"]
$publicWebPort = $config["PUBLIC_WEB_PORT"]
$publicApiPort = $config["PUBLIC_API_PORT"]

if (-not $SshPassword) {
  $securePassword = Read-Host "ODROID SSH 비밀번호" -AsSecureString
  $SshPassword = ConvertTo-PlainText -SecureString $securePassword
}

if (-not $SudoPassword) {
  $secureSudoPassword = Read-Host "ODROID sudo 비밀번호" -AsSecureString
  $SudoPassword = ConvertTo-PlainText -SecureString $secureSudoPassword
}

$plink = (Get-Command plink -ErrorAction Stop).Source
$pscp = (Get-Command pscp -ErrorAction Stop).Source
$archivePath = Join-Path $env:TEMP "parking-radar-odroid-deploy.tgz"
$remoteArchive = "/tmp/parking-radar-odroid-deploy.tgz"
$remoteTarget = "$remoteUser@$remoteHost"

Push-Location $ProjectRoot
try {
  if (Test-Path $archivePath) {
    Remove-Item $archivePath -Force
  }

  $tarArgs = @(
    "--exclude=.git",
    "--exclude=.env",
    "--exclude=.env.*",
    "--exclude=.next",
    "--exclude=node_modules",
    "--exclude=coverage",
    "--exclude=dist",
    "--exclude=.pytest_cache",
    "--exclude=__pycache__",
    "--exclude=data",
    "-czf",
    $archivePath,
    "."
  )

  & tar.exe @tarArgs
  if ($LASTEXITCODE -ne 0) {
    throw "배포 아카이브 생성에 실패했습니다."
  }
}
finally {
  Pop-Location
}

& $plink -batch -P $remotePort -pw $SshPassword $remoteTarget "mkdir -p '$remoteAppDir'"
if ($LASTEXITCODE -ne 0) {
  throw "원격 디렉터리 생성에 실패했습니다."
}

& $pscp -batch -P $remotePort -pw $SshPassword $archivePath "${remoteTarget}:$remoteArchive"
if ($LASTEXITCODE -ne 0) {
  throw "원격 서버로 아카이브 업로드에 실패했습니다."
}

$escapedAppDir = Escape-ShellSingleQuoted -Value $remoteAppDir
$escapedArchive = Escape-ShellSingleQuoted -Value $remoteArchive
$escapedSudoPassword = Escape-ShellSingleQuoted -Value $SudoPassword
$remoteScript = @"
set -euo pipefail
mkdir -p '$escapedAppDir'
tar -xzf '$escapedArchive' -C '$escapedAppDir'
chmod +x '$escapedAppDir/deploy/odroid/remote-deploy.sh'
APP_DIR='$escapedAppDir' ENV_FILE='.env.odroid' COMPOSE_FILE='docker-compose.odroid.yml' SUDO_PASSWORD='$escapedSudoPassword' '$escapedAppDir/deploy/odroid/remote-deploy.sh'
rm -f '$escapedArchive'
"@
$remoteScriptBase64 = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($remoteScript))

& $plink -batch -P $remotePort -pw $SshPassword $remoteTarget "printf '%s' '$remoteScriptBase64' | base64 -d | bash"
if ($LASTEXITCODE -ne 0) {
  throw "원격 배포 실행에 실패했습니다."
}

if (-not $SkipHealthCheck) {
  $webUrl = "http://$remoteHost`:$publicWebPort"
  $apiUrl = "http://$remoteHost`:$publicApiPort/health"

  $webStatus = (Invoke-WebRequest -Uri $webUrl -UseBasicParsing -TimeoutSec 20).StatusCode
  $apiHealth = Invoke-RestMethod -Uri $apiUrl -Method Get -TimeoutSec 20

  Write-Host "웹 상태: $webStatus"
  Write-Host "API 상태: $($apiHealth.status)"
}

Write-Host "ODROID M1S 배포가 완료되었습니다."
