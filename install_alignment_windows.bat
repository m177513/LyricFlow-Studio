@echo off
chcp 65001 >nul
setlocal
cd /d "%~dp0"
set "AUDIO_PYTHON=.venv-audio\Scripts\python.exe"
if not exist "%AUDIO_PYTHON%" set "AUDIO_PYTHON=.venv\Scripts\python.exe"
if not exist "%AUDIO_PYTHON%" (
 echo Run install_windows.bat first.
 pause
 exit /b 1
)
echo Installing optional stable-ts refinement in the private environment.
echo This may install PyTorch. GPU runtime selection is NOT automated.
echo stable-ts upstream is archived; see docs\LIMITATIONS.md.
"%AUDIO_PYTHON%" -m pip install -r requirements-alignment.txt
if errorlevel 1 (
 echo Optional installation failed. Basic Whisper alignment remains available.
 pause
 exit /b 1
)
"%AUDIO_PYTHON%" -m pip freeze > .lyricflow-studio\python-lock.windows.txt
node scripts\doctor.mjs
echo In the UI select the source-text refinement alignment mode.
pause
