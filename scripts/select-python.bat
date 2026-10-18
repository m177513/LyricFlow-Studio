@echo off
rem Called from the application root. Export only a validated command.
set "LYRICFLOW_INSTALL_PYTHON="
py -3.11 -c "import sys; sys.exit(0 if sys.version_info[:2] == (3,11) else 1)" >nul 2>nul
if not errorlevel 1 (
 set "LYRICFLOW_INSTALL_PYTHON=py -3.11"
 exit /b 0
)
py -3.12 -c "import sys; sys.exit(0 if sys.version_info[:2] == (3,12) else 1)" >nul 2>nul
if not errorlevel 1 (
 set "LYRICFLOW_INSTALL_PYTHON=py -3.12"
 exit /b 0
)
python -c "import sys; sys.exit(0 if sys.version_info[:2] in ((3,11),(3,12)) else 1)" >nul 2>nul
if not errorlevel 1 (
 set "LYRICFLOW_INSTALL_PYTHON=python"
 exit /b 0
)
echo Python 3.11 or 3.12 is required. See the README download links.
exit /b 1
