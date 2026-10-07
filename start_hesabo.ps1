# ============================================================
#  HESABO — start n8n with a public HTTPS tunnel (cloudflared)
#  Run from PowerShell:   powershell -ExecutionPolicy Bypass -File .\start_hesabo.ps1
#  Stop with Ctrl+C (the tunnel is closed automatically).
# ============================================================
$ErrorActionPreference = "Continue"
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $here

# 1) cloudflared.exe (free, no account) — downloaded once into this folder
$cfExe = Join-Path $here "cloudflared.exe"
if (-not (Test-Path $cfExe)) {
  Write-Host "Downloading cloudflared (one time, ~20 MB)..." -ForegroundColor Cyan
  Invoke-WebRequest -Uri "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-amd64.exe" -OutFile $cfExe
}

# 2) start the tunnel in the background and wait for its public URL
$log = Join-Path $env:TEMP "cloudflared_hesabo.log"
Remove-Item $log -ErrorAction SilentlyContinue
$cf = Start-Process -FilePath $cfExe -ArgumentList "tunnel --url http://localhost:5678 --no-autoupdate" -RedirectStandardError $log -PassThru -WindowStyle Hidden
$url = $null
for ($i = 0; $i -lt 60 -and -not $url; $i++) {
  Start-Sleep -Seconds 1
  if (Test-Path $log) {
    $m = Select-String -Path $log -Pattern "https://[a-z0-9-]+\.trycloudflare\.com" | Select-Object -First 1
    if ($m) { $url = $m.Matches[0].Value }
  }
}
if (-not $url) {
  Write-Host "Could not get a tunnel URL. cloudflared log:" -ForegroundColor Red
  if (Test-Path $log) { Get-Content $log }
  Stop-Process -Id $cf.Id -ErrorAction SilentlyContinue
  exit 1
}
Write-Host ""
Write-Host "=================================================" -ForegroundColor Green
Write-Host "  Public URL (Telegram webhook): $url" -ForegroundColor Green
Write-Host "  n8n editor:                    http://localhost:5678" -ForegroundColor Green
Write-Host "=================================================" -ForegroundColor Green
Write-Host ""

# 3) start n8n pointing its webhooks at the tunnel
$env:N8N_WEBHOOK_URL = "$url/"
$env:WEBHOOK_URL = "$url/"
$env:N8N_EDITOR_BASE_URL = "http://localhost:5678/"
try {
  npx --yes n8n@2.41.6 start
} finally {
  Stop-Process -Id $cf.Id -ErrorAction SilentlyContinue
  Write-Host "Tunnel closed." -ForegroundColor Yellow
}
