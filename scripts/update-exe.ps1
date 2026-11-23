param(
  [switch]$RebuildShell,
  [string]$Version = "0.4.0",
  [string]$Notes = "v0.4.0: Full balance overhaul (Arcade Stage 4/5, Roguelike waves/buffs, all 12 weapons & Geometry Trial Stage 4/5) + Native Zero-Stutter 2-Device Windows LAN Multiplayer (TCP_NODELAY + UDP auto-discovery) for BOTH Scratchpad Brawl & Geometry Brawl"
)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$releaseDir = Join-Path $root "release"
$appDir = Join-Path $releaseDir "app"
$backupRoot = Join-Path $releaseDir "backups"
$distDir = Join-Path $root "dist"
$exePath = Join-Path $releaseDir "InkbladeDuel.exe"

Write-Host "=== [1/4] 自动备份旧版资源 ===" -ForegroundColor Cyan
if (Test-Path $appDir) {
  $ts = Get-Date -Format "yyyyMMdd_HHmmss"
  $bk = Join-Path $backupRoot "app_$ts"
  New-Item -ItemType Directory -Force -Path $bk | Out-Null
  Copy-Item -Path (Join-Path $appDir "*") -Destination $bk -Recurse -Force
  Write-Host "已自动备份旧版到: $bk" -ForegroundColor Green
}

Write-Host "=== [2/4] 编译最新网页版游戏 (tsc + vite build) ===" -ForegroundColor Cyan
Push-Location $root
npm run build
if ($LASTEXITCODE -ne 0) { Pop-Location; throw "前端编译失败!" }
Pop-Location

if ($RebuildShell -or !(Test-Path $exePath)) {
  Write-Host "=== [3/4] 编译原生 Windows 桌面外壳 InkbladeDuel.exe ===" -ForegroundColor Cyan
  $icoPath = Join-Path $root "desktop\app.ico"
  if (!(Test-Path $icoPath)) {
    & (Join-Path $PSScriptRoot "generate-icon.ps1")
  }
  New-Item -ItemType Directory -Force -Path $releaseDir | Out-Null
  dotnet publish (Join-Path $root "desktop\InkbladeDesktop.csproj") `
    -c Release -r win-x64 --self-contained false `
    -o $releaseDir
  if ($LASTEXITCODE -ne 0) { throw "EXE 编译失败!" }
  Copy-Item $icoPath (Join-Path $releaseDir "app.ico") -Force
} else {
  Write-Host "=== [3/4] 桌面外壳 InkbladeDuel.exe 已存在，执行秒级热更新同步 ===" -ForegroundColor Cyan
}

Write-Host "=== [4/4] 同步最新游戏内容至 release/app 并生成版本清单 ===" -ForegroundColor Cyan
if (Test-Path $appDir) {
  Remove-Item -Path $appDir -Recurse -Force
}
New-Item -ItemType Directory -Force -Path $appDir | Out-Null
Copy-Item -Path (Join-Path $distDir "*") -Destination $appDir -Recurse -Force

$versionObj = @{
  version   = $Version
  buildTime = (Get-Date -Format "yyyy-MM-dd HH:mm:ss")
  notes     = $Notes
}
$versionObj | ConvertTo-Json -Depth 3 | Out-File -Encoding utf8 (Join-Path $appDir "version.json")

$cfgPath = Join-Path $releaseDir "update-config.json"
if (!(Test-Path $cfgPath)) {
  @{
    manifestUrl  = ""
    packageUrl   = ""
    localZipPath = ""
  } | ConvertTo-Json -Depth 3 | Out-File -Encoding utf8 $cfgPath
}

# Also pack an update zip for easy distribution to other PCs
$zipPath = Join-Path $releaseDir "inkblade-app-update.zip"
if (Test-Path $zipPath) { Remove-Item $zipPath -Force }
Compress-Archive -Path (Join-Path $appDir "*") -DestinationPath $zipPath -Force

Write-Host ""
Write-Host "更新完成！请直接双击运行: $exePath" -ForegroundColor Green
Write-Host "（如果游戏窗口已打开，直接按 F5 即可瞬间热重载最新版本！）" -ForegroundColor Yellow
