@echo off
chcp 65001 >nul
title Sigarsjefen
cd /d "%~dp0"

echo.
echo   ==============================
echo     SIGARSJEFEN
echo   ==============================
echo.

where node >nul 2>nul
if errorlevel 1 goto installnode

if exist node_modules goto envfile
echo Installerer pakker. Forste gang tar dette 1-2 minutter...
call npm install
if errorlevel 1 goto npmfail

:envfile
if not exist .env copy .env.example .env >nul

echo.
echo Starter boten. Dashboardet apnes i nettleseren om noen sekunder.
echo LA DETTE VINDUET STA APENT. Lukker du det, stopper boten.
echo.
start "" cmd /c "timeout /t 8 >nul & start http://localhost:3000"
call npm start
echo.
echo Boten har stoppet.
pause
exit /b 0

:installnode
echo Node.js er ikke installert. Installerer det na...
echo Trykk JA hvis Windows spor om tillatelse.
echo.
winget install -e --id OpenJS.NodeJS.LTS --accept-source-agreements --accept-package-agreements
if errorlevel 1 goto nodefail
echo.
echo Node.js er installert.
echo Lukk dette vinduet og dobbeltklikk "Start Sigarsjefen" en gang til.
pause
exit /b 0

:nodefail
echo.
echo Klarte ikke a installere Node.js automatisk.
echo Nettsiden nodejs.org apnes na. Last ned LTS-versjonen, installer den,
echo og dobbeltklikk "Start Sigarsjefen" igjen.
start https://nodejs.org
pause
exit /b 1

:npmfail
echo.
echo Noe gikk galt under installasjonen. Ta et skjermbilde av dette vinduet og send det til Claude.
pause
exit /b 1
