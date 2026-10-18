@echo off
chcp 65001 >nul
setlocal
cd /d "%~dp0"
call npm test
if errorlevel 1 goto failed
if exist .venv-audio\Scripts\python.exe (
 .venv-audio\Scripts\python.exe -m unittest discover -s tests -p test_*.py -v
) else if exist .venv\Scripts\python.exe (
 .venv\Scripts\python.exe -m unittest discover -s tests -p test_*.py -v
) else (
 py -3.11 -m unittest discover -s tests -p test_*.py -v
)
if errorlevel 1 goto failed
call npm run typecheck
if errorlevel 1 goto failed
echo Checks passed. Real-song alignment and MP4 output still require the acceptance test.
pause
exit /b 0
:failed
echo A check failed. Preserve the error output for Codex.
pause
exit /b 1
