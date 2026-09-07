@echo off
title RedBeryl — Xaodhang Full Stack
cd /d D:\SIH\landslide_api

echo ================================
echo  Xaodhang — RedBeryl / SIH26001
echo ================================
echo.

echo [1/2] Starting backend (FastAPI on port 8000)...
start "RedBeryl API" cmd /k "python -m uvicorn main:app --reload --port 8000"

timeout /t 4 /nobreak > nul

echo [2/2] Starting Cloudflare Tunnel...

REM Uses full explicit path — no PATH dependency
if exist "D:\SIH\landslide_api\cloudflared.exe" (
    start "RedBeryl Tunnel" cmd /k "D:\SIH\landslide_api\cloudflared.exe tunnel --url http://localhost:8000"
    echo.
    echo Tunnel window is opening. Copy the .trycloudflare.com URL from it.
) else (
    echo.
    echo [ERROR] cloudflared.exe not found at D:\SIH\landslide_api\
    echo.
    echo 1. Download: https://github.com/cloudflare/cloudflared/releases/latest
    echo    File: cloudflared-windows-amd64.exe
    echo 2. Rename to: cloudflared.exe
    echo 3. Move to:   D:\SIH\landslide_api\
    echo 4. Run this bat again.
    echo.
)

echo ================================
echo  Local:    http://localhost:8000
echo  Docs:     http://localhost:8000/docs
echo ================================
pause
