@echo off
title RedBeryl Landslide API
cd /d D:\SIH\landslide_api
echo Starting RedBeryl backend...
echo Open http://localhost:8000/docs to test
echo.
python -m uvicorn main:app --reload --port 8000
pause
