#!/bin/sh
# Run JARVIS-X with full internet in your browser (Linux / any Unix).
cd "$(dirname "$0")"
PORT=${PORT:-8765}
if command -v node >/dev/null 2>&1; then
  exec node launcher/serve.mjs --port "$PORT"
elif command -v python3 >/dev/null 2>&1; then
  (sleep 1; xdg-open "http://localhost:$PORT/" >/dev/null 2>&1 || true) &
  echo "JARVIS-X is running at http://localhost:$PORT/ — press Ctrl+C to stop."
  exec python3 -m http.server "$PORT" --bind 127.0.0.1
else
  echo "Please install Node.js (nodejs.org) or Python 3, then run this again."; exit 1
fi
