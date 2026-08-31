@echo off & setlocal & cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -Command "chcp 65001 | Out-Null; . .\toonflow-control.ps1"
if errorlevel 1 (echo. & echo [ERR] Failed to start script. Press any key to exit... & pause >nul)
endlocal
