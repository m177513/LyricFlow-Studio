@echo off
chcp 65001 >nul
setlocal
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
 echo Node.js 22+ is required.
 pause
 exit /b 1
)
node -e "if(Number(process.versions.node.split('.')[0])<22) process.exit(1)"
if errorlevel 1 (
 echo Node.js 22+ is required. See README.md.
 pause
 exit /b 1
)
if not exist web\dist\player.js (
 echo Run install_windows.bat first. The Player has not been built.
 pause
 exit /b 1
)
node scripts\launch.mjs
if errorlevel 1 pause
