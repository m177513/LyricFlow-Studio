@echo off
chcp 65001 >nul
setlocal
cd /d "%~dp0"
echo Installing vocal separation and Whisper into .venv-audio...
if not exist .venv-audio\Scripts\python.exe (
  python -m venv .venv-audio
  if errorlevel 1 goto failed
)
.venv-audio\Scripts\python.exe --version
if errorlevel 1 goto failed
.venv-audio\Scripts\python.exe -m pip install -r requirements-audio.txt
if errorlevel 1 goto failed
if not exist .lyricflow-studio mkdir .lyricflow-studio
.venv-audio\Scripts\python.exe -m pip freeze > .lyricflow-studio\audio-lock.windows.txt
.venv-audio\Scripts\python.exe worker\align.py --diagnose
if errorlevel 1 goto failed
echo Ready. Model files download on first analysis. CPU separation works without CUDA.
if /i not "%~1"=="--no-pause" pause
exit /b 0
:failed
echo Installation failed. Python 3.11 or 3.12 and FFmpeg are required.
echo The previous .venv and original music files were preserved.
if /i not "%~1"=="--no-pause" pause
exit /b 1
