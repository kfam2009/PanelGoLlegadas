# PanelGo Llegadas - inicia el programa y abre el panel.
# Doble clic en Iniciar.cmd. Se puede volver a ejecutar: si hay una version vieja corriendo, la reinicia.
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$port = 5200
$data = Join-Path $root 'data'
New-Item -ItemType Directory -Force -Path $data, (Join-Path $root 'tools') | Out-Null
$version = (Get-Content (Join-Path $root 'package.json') -Raw | ConvertFrom-Json).version

try {
  # 1) Node.js (el del sistema o el que trae Codex)
  $node = $null
  $cmd = Get-Command node -ErrorAction SilentlyContinue
  if ($cmd) { $node = $cmd.Source }
  if (-not $node) {
    $codex = Join-Path $env:USERPROFILE '.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe'
    if (Test-Path $codex) { $node = $codex }
  }
  if (-not $node) { throw 'Falta Node.js. Instalarlo desde https://nodejs.org (version LTS) y volver a abrir Iniciar.cmd.' }

  # 3) Si ya corre la misma version, no se toca; si es otra, se reinicia
  $running = $null
  try { $running = Invoke-RestMethod "http://127.0.0.1:$port/api/estado" -TimeoutSec 2 } catch {}
  if ($running -and $running.version -eq $version) { Write-Host "PanelGo Llegadas $version ya estaba corriendo." }
  else {
    if ($running) {
      Write-Host "Reiniciando (habia version $($running.version))..."
      Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue }
      Start-Sleep -Milliseconds 800
    }
    Start-Process -FilePath $node -ArgumentList @('"' + (Join-Path $root 'server.mjs') + '"') -WorkingDirectory $root -WindowStyle Hidden `
      -RedirectStandardOutput (Join-Path $data 'inicio.log') -RedirectStandardError (Join-Path $data 'inicio-error.log') | Out-Null
    $ok = $false
    for ($i = 0; $i -lt 40 -and -not $ok; $i++) { Start-Sleep -Milliseconds 250; try { $r = Invoke-RestMethod "http://127.0.0.1:$port/api/estado" -TimeoutSec 1; $ok = $r.version -eq $version } catch {} }
    if (-not $ok) { throw ('No arranco. Ver ' + (Join-Path $data 'inicio-error.log')) }
    Write-Host "PanelGo Llegadas $version funcionando." -ForegroundColor Green
  }
  Start-Process "http://127.0.0.1:$port/"
  $ips = (Get-NetIPAddress -AddressFamily IPv4 | Where-Object { $_.IPAddress -notlike '127.*' -and $_.IPAddress -notlike '169.254.*' }).IPAddress
  Write-Host "`nDesde el celular (misma red):"; $ips | ForEach-Object { Write-Host "  http://${_}:$port/" }
  Write-Host "Si el celular no entra, ejecutar una vez PermitirCelular.cmd"
  Start-Sleep -Seconds 4
} catch {
  Write-Host $_.Exception.Message -ForegroundColor Red
  Read-Host "`nEnter para cerrar"
}
