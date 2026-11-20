$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$logs = Join-Path $root 'work'
New-Item -ItemType Directory -Path $logs -Force | Out-Null

function Find-FreePort([int]$first, [int]$last, [Net.IPAddress]$bindAddress) {
  foreach ($candidate in $first..$last) {
    $listener = $null
    try {
      $listener = [Net.Sockets.TcpListener]::new($bindAddress, $candidate)
      $listener.Start()
      return $candidate
    } catch {
    } finally {
      if ($listener) { $listener.Stop() }
    }
  }
  throw "No free port in range $first-$last. Close another local development server and retry."
}

$apiPort = Find-FreePort 8000 8010 ([Net.IPAddress]::Loopback)
$webPort = Find-FreePort 3000 3010 ([Net.IPAddress]::Any)
$api = $null
$web = $null
try {
  $apiFile = Join-Path $root 'app.py'
  $apiArgs = '"{0}" {1}' -f $apiFile, $apiPort
  $api = Start-Process -FilePath 'python' -ArgumentList $apiArgs -WorkingDirectory $root -PassThru -WindowStyle Hidden -RedirectStandardOutput (Join-Path $logs 'api.log') -RedirectStandardError (Join-Path $logs 'api-error.log')
  Start-Sleep -Milliseconds 900
  $api.Refresh()
  if ($api.HasExited) { throw "The Python API stopped during startup. See work\api-error.log." }

  $nodeFile = Join-Path $root 'server.js'
  $webArgs = '"{0}" {1} {2}' -f $nodeFile, $webPort, $apiPort
  $web = Start-Process -FilePath 'node' -ArgumentList $webArgs -WorkingDirectory $root -PassThru -WindowStyle Hidden -RedirectStandardOutput (Join-Path $logs 'web.log') -RedirectStandardError (Join-Path $logs 'web-error.log')
  Start-Sleep -Milliseconds 700
  $web.Refresh()
  if ($web.HasExited) { throw "The Node web server stopped during startup. See work\web-error.log." }

  $url = "http://localhost:$webPort"
  Write-Host "Pathlight is running at $url" -ForegroundColor Green
  $lanAddresses = [Net.NetworkInformation.NetworkInterface]::GetAllNetworkInterfaces() |
    Where-Object { $_.OperationalStatus -eq 'Up' -and $_.NetworkInterfaceType -ne 'Loopback' } |
    ForEach-Object { $_.GetIPProperties().UnicastAddresses } |
    Where-Object { $_.Address.AddressFamily -eq [Net.Sockets.AddressFamily]::InterNetwork -and -not $_.Address.IsLoopback -and -not $_.Address.ToString().StartsWith('169.254.') } |
    ForEach-Object { $_.Address.ToString() } |
    Select-Object -Unique
  foreach ($address in $lanAddresses) {
    Write-Host "Phone on the same Wi-Fi: http://${address}:$webPort" -ForegroundColor Green
  }
  Write-Host 'Keep this terminal open while you use the app. Press Ctrl+C to stop it.' -ForegroundColor Cyan
  Write-Host 'Open the localhost URL on this PC, or the Wi-Fi URL on your phone.' -ForegroundColor Yellow
  while ($true) {
    Start-Sleep -Seconds 1
    $api.Refresh(); $web.Refresh()
    if ($api.HasExited) { throw 'The Python API stopped. Check work\api-error.log.' }
    if ($web.HasExited) { throw 'The Node server stopped. Check work\web-error.log.' }
  }
} finally {
  if ($web) { $web.Refresh(); if (-not $web.HasExited) { Stop-Process -Id $web.Id -Force } }
  if ($api) { $api.Refresh(); if (-not $api.HasExited) { Stop-Process -Id $api.Id -Force } }
}
