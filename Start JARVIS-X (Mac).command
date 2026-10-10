#!/bin/bash
# Double-click to run JARVIS-X with full internet in your browser.
cd "$(dirname "$0")"
URL_PORT=8765
if command -v node >/dev/null 2>&1; then
  exec node launcher/serve.mjs
elif command -v python3 >/dev/null 2>&1 && python3 -c 'import http.server' 2>/dev/null; then
  (sleep 1; open "http://localhost:$URL_PORT/") &
  echo "JARVIS-X is running at http://localhost:$URL_PORT/ — keep this window open."
  exec python3 -m http.server $URL_PORT --bind 127.0.0.1
elif command -v ruby >/dev/null 2>&1; then
  (sleep 2; open "http://localhost:$URL_PORT/") &
  echo "JARVIS-X is running at http://localhost:$URL_PORT/ — keep this window open."
  exec ruby -run -e httpd . -p $URL_PORT -b 127.0.0.1
else
  osascript -e 'display dialog "JARVIS-X needs Node.js to run on this Mac. Install it from nodejs.org (LTS), then double-click Start JARVIS-X again." buttons {"Open nodejs.org", "OK"} default button 1' -e 'if button returned of result is "Open nodejs.org" then open location "https://nodejs.org/"' >/dev/null 2>&1
fi
