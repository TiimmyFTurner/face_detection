@echo off
title FaceTrack Server
cd /d "%~dp0"

echo ========================================================
echo         FaceTrack - Real-Time Face Detection Server     
echo ========================================================

REM Check if venv exists
if not exist "venv\Scripts\python.exe" (
    echo [ERROR] Virtual environment 'venv' was not found in: %cd%
    echo.
    echo Please set up the environment first by running:
    echo   python -m venv venv
    echo   venv\Scripts\python.exe -m pip install --upgrade pip
    echo   venv\Scripts\pip.exe install -r requirements.txt
    echo   venv\Scripts\pip.exe install greenlet onnxruntime
    echo.
    pause
    exit /b 1
)

REM Activate virtual environment
call venv\Scripts\activate.bat

REM Ensure greenlet is installed (required by SQLAlchemy AsyncIO)
python -c "import greenlet" 2>nul
if %errorlevel% neq 0 (
    echo [INFO] Installing missing required dependency: greenlet...
    python -m pip install greenlet
)

REM Default HOST and PORT
set HOST=0.0.0.0
set PORT=8000

REM Read PORT and HOST from .env if present
if exist ".env" (
    for /f "usebackq tokens=1,2 delims==" %%A in (".env") do (
        set "KEY=%%A"
        set "VAL=%%B"
        if /i "%%A"=="PORT" set "PORT=%%B"
        if /i "%%A"=="HOST" set "HOST=%%B"
    )
)

echo Starting FaceTrack Backend and Web Dashboard...
echo Local Address:    http://localhost:%PORT%
echo Network Address:  http://0.0.0.0:%PORT%
echo.

python -m uvicorn backend.main:app --host %HOST% --port %PORT%

if %errorlevel% neq 0 (
    echo.
    echo [ERROR] Server terminated with error code %errorlevel%.
    pause
)
