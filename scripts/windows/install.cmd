@echo off
REM Installs DataLad Desktop for the current user. No administrator rights needed.
REM
REM Download install.cmd and install.ps1 from the same release page into one folder, then double-click this
REM file or run it from any shell. Arguments are passed on to install.ps1.
REM
REM This is a .cmd on purpose: batch files are not blocked by PowerShell's execution policy.
REM Kept free of parenthesised blocks and goto so it survives being saved with Unix line endings.
setlocal
cd /d "%~dp0"

echo Removing the "downloaded from the internet" mark from the install script...
powershell -NoProfile -Command "Unblock-File -Path '.\install.cmd','.\install.ps1' -ErrorAction SilentlyContinue"

powershell -NoProfile -ExecutionPolicy Bypass -File ".\install.ps1" %*
if errorlevel 1 echo.
if errorlevel 1 echo Setup failed - see the messages above and "DataLad Desktop install.log" next to the install folder.
if errorlevel 1 pause
if errorlevel 1 exit /b 1

echo.
pause
