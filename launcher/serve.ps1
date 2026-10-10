# JARVIS-X local launcher for Windows — needs nothing installed (uses built-in PowerShell).
# Serves this folder on http://localhost:8765 (or the next free port) and opens your browser.
$ErrorActionPreference = 'Stop'
$root = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$types = @{ '.html'='text/html; charset=utf-8'; '.js'='text/javascript; charset=utf-8'; '.mjs'='text/javascript; charset=utf-8'; '.css'='text/css; charset=utf-8'; '.json'='application/json'; '.webmanifest'='application/manifest+json'; '.svg'='image/svg+xml'; '.png'='image/png'; '.jpg'='image/jpeg'; '.ico'='image/x-icon'; '.woff2'='font/woff2'; '.wav'='audio/wav'; '.mp3'='audio/mpeg'; '.md'='text/markdown; charset=utf-8'; '.txt'='text/plain; charset=utf-8' }
$listener = $null
foreach ($p in 8765..8785) {
  try { $l = New-Object System.Net.HttpListener; $l.Prefixes.Add("http://localhost:$p/"); $l.Start(); $listener = $l; $port = $p; break } catch { }
}
if (-not $listener) { Write-Host 'Could not open a local port (8765-8785).'; Read-Host 'Press Enter to close'; exit 1 }
$url = "http://localhost:$port/"
Write-Host ""
Write-Host "  JARVIS-X is running at $url"
Write-Host "  Keep this window open while you use it. Close it to stop."
Write-Host ""
Start-Process $url
while ($listener.IsListening) {
  try {
    $ctx = $listener.GetContext()
    $path = [System.Uri]::UnescapeDataString($ctx.Request.Url.AbsolutePath)
    if ($path.EndsWith('/')) { $path += 'index.html' }
    $res = $ctx.Response
    $file = [System.IO.Path]::GetFullPath((Join-Path $root ($path.TrimStart('/') -replace '/', '\')))
    $blocked = $path -match '^/(server|data|node_modules|\.git|\.env)(/|$)'
    if ($blocked -or -not $file.StartsWith($root) -or -not (Test-Path $file -PathType Leaf)) {
      $res.StatusCode = 404; $b = [Text.Encoding]::UTF8.GetBytes('Not found'); $res.OutputStream.Write($b, 0, $b.Length)
    } else {
      $ext = [System.IO.Path]::GetExtension($file).ToLower()
      $res.ContentType = if ($types.ContainsKey($ext)) { $types[$ext] } else { 'application/octet-stream' }
      $res.Headers.Add('Cache-Control', 'no-cache')
      $bytes = [System.IO.File]::ReadAllBytes($file)
      $res.ContentLength64 = $bytes.Length
      $res.OutputStream.Write($bytes, 0, $bytes.Length)
    }
    $res.OutputStream.Close()
  } catch { }
}
