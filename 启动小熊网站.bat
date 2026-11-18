@echo off
rem Bear-site launcher: start local server (if not running) and open the page.
rem This file must stay in the project folder - it uses its own location via %~dp0.
cd /d "%~dp0"

rem If port 8777 already answers, skip starting a new server.
curl -s -o nul -m 2 http://127.0.0.1:8777/index.html
if %errorlevel%==0 goto open

start "bear-server" /min cmd /c "python tools\serve.py 8777"
timeout /t 2 /nobreak >nul

:open
start "" "http://127.0.0.1:8777/index.html"
exit
