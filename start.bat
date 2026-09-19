@echo off
setlocal
title Tobari - STARTING
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 goto missing_node
node -e "const [a,b]=process.versions.node.split('.').map(Number);process.exit(a>22||(a===22&&b>=13)?0:1)"
if errorlevel 1 goto missing_node
echo Starting Tobari. Keep this window open while using the dashboard.
echo Default: http://localhost:3000/
echo For LAN access: start.bat --host YOUR_LAN_IP
title Tobari - RUNNING
node --disable-warning=ExperimentalWarning src/server.mjs %*
set "TOBARI_EXIT_CODE=%ERRORLEVEL%"
title Tobari - STOPPED
echo.
echo Tobari stopped. Exit code: %TOBARI_EXIT_CODE%
echo Review the log above. Press any key to close this window.
pause >nul
exit /b %TOBARI_EXIT_CODE%
:missing_node
title Tobari - ERROR
echo Node.js 22.13 or newer is required. Install Node.js and run this file again.
pause
exit /b 1
