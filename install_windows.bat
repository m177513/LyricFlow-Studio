@echo off
chcp 65001 >nul
setlocal
cd /d "%~dp0"
echo [1/5] Checking Node.js 22+ and Python 3.11...
where node >nul 2>nul || goto missing_node
node -e "if(Number(process.versions.node.split('.')[0])<22) process.exit(1)" || goto missing_node
py -3.11 --version >nul 2>nul || goto missing_python
where ffmpeg >nul 2>nul || goto missing_ffmpeg
where ffprobe >nul 2>nul || goto missing_ffmpeg
echo [2/5] Installing the pinned Remotion and browser UI packages...
if exist package-lock.json (call npm ci) else (call npm install)
if errorlevel 1 goto failed
echo [3/5] Building the Remotion Player...
call npm run build
if errorlevel 1 goto failed
echo [4/5] Creating a private Python environment and installing local ASR...
if not exist .venv\Scripts\python.exe py -3.11 -m venv .venv
if errorlevel 1 goto failed
.venv\Scripts\python.exe -m pip install -r requirements-asr.txt
if errorlevel 1 goto failed
if not exist .lyricflow-studio mkdir .lyricflow-studio
.venv\Scripts\python.exe -m pip freeze > .lyricflow-studio\python-lock.windows.txt
echo [5/5] Checking the installation...
call install_audio_windows.bat --no-pause
if errorlevel 1 goto failed
node scripts\doctor.mjs
call npm run typecheck
if errorlevel 1 goto failed
echo.
echo Basic installation finished. Run run_windows.bat.
echo Optional source-text refinement: install_alignment_windows.bat.
echo Models and the render browser may download on first use. No paid API key is required.
pause
exit /b 0
:missing_node
echo Node.js 22 or newer is required. Install it, reopen this folder, and retry.
goto failed
:missing_python
echo Python 3.11 with the Windows Python launcher is required.
echo Install Python 3.11, then reopen this folder and retry.
goto failed
:missing_ffmpeg
echo FFmpeg and ffprobe must be available in PATH.
echo One installation option: winget install --id Gyan.FFmpeg -e
echo Reopen the terminal after installation.
goto failed
:failed
echo.
echo Installation stopped. The original audio and image files were not changed.
echo Hand this terminal error to Codex. Dependency-free review UI: node server\main.mjs
pause
exit /b 1
