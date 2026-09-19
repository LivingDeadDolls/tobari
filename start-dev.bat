@echo off
setlocal
title Tobari DEV - STARTING
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 goto missing_node
node -e "const [a,b]=process.versions.node.split('.').map(Number);process.exit(a>22||(a===22&&b>=13)?0:1)"
if errorlevel 1 goto missing_node
echo Starting Tobari DEV. Keep this window open.
echo Server changes restart automatically. Web changes reload the browser.
echo Default: http://localhost:3000/
echo For LAN access: start-dev.bat --host YOUR_LAN_IP
title Tobari DEV - WATCHING
node --watch --watch-preserve-output --disable-warning=ExperimentalWarning src/server.mjs --dev %*
set "TOBARI_EXIT_CODE=%ERRORLEVEL%"
title Tobari DEV - STOPPED
echo.
echo Tobari DEV stopped. Exit code: %TOBARI_EXIT_CODE%
echo Review the log above. Press any key to close this window.
pause >nul
exit /b %TOBARI_EXIT_CODE%
:missing_node
title Tobari DEV - ERROR
echo Node.js 22.13 or newer is required. Install Node.js and run this file again.
pause
exit /b 1
