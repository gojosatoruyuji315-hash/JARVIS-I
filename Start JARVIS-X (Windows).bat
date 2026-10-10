@echo off
title JARVIS-X
cd /d "%~dp0"
where node >nul 2>nul
if %errorlevel%==0 (
  node "launcher\serve.mjs"
) else (
  powershell -NoProfile -ExecutionPolicy Bypass -File "launcher\serve.ps1"
)
pause
