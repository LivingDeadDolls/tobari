@echo off
setlocal
title Tobari DEV - STARTING
echo Starting Tobari DEV. Keep this window open.
echo Server changes restart automatically. Web changes reload the browser.
echo Default: http://localhost:3000/
echo For LAN access: start-dev.bat --host YOUR_LAN_IP
title Tobari DEV - WATCHING
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\start.ps1" -Mode dev -Repository "%~dp0." %*
set "TOBARI_EXIT_CODE=%ERRORLEVEL%"
title Tobari DEV - STOPPED
echo.
echo Tobari DEV stopped. Exit code: %TOBARI_EXIT_CODE%
echo Review the log above. Press any key to close this window.
pause >nul
exit /b %TOBARI_EXIT_CODE%
