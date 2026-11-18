@echo off
rem 启动手势玩偶。必须走本地服务，直接双击 html 打不开摄像头。
cd /d "%~dp0"

curl -s -o nul -m 2 http://127.0.0.1:8777/index.html
if %errorlevel%==0 goto open

start "puppet-server" /min cmd /c "python tools\serve.py 8777"
timeout /t 2 /nobreak >nul

:open
start "" "http://127.0.0.1:8777/index.html"
exit
