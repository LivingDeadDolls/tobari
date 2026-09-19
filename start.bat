@echo off
setlocal
title Tobari - STARTING
echo Starting Tobari. Keep this window open while using the dashboard.
echo Default: http://localhost:3000/
echo For LAN access: start.bat --host YOUR_LAN_IP
title Tobari - RUNNING
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\start.ps1" -Mode normal -Repository "%~dp0." %*
set "TOBARI_EXIT_CODE=%ERRORLEVEL%"
title Tobari - STOPPED
echo.
echo Tobari stopped. Exit code: %TOBARI_EXIT_CODE%
echo Review the log above. Press any key to close this window.
pause >nul
exit /b %TOBARI_EXIT_CODE%
