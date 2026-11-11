@echo off
setlocal
if exist "%~dp0release\0.8.0\win-unpacked\StudioWav.exe" (
  start "" "%~dp0release\0.8.0\win-unpacked\StudioWav.exe"
  exit /b 0
)
if exist "%~dp0release\0.8.0\StudioWav-0.8.0-portable.exe" (
  start "" "%~dp0release\0.8.0\StudioWav-0.8.0-portable.exe"
  exit /b 0
)
echo Genera la aplicacion con: npm.cmd run dist
pause
exit /b 1
