@echo off
rem 打开五官校准页。拖圆点对位置，右侧滑块调大小，点保存写回 face.json。
cd /d "%~dp0"

curl -s -o nul -m 2 http://127.0.0.1:8777/index.html
if %errorlevel%==0 goto open

start "puppet-server" /min cmd /c "python tools\serve.py 8777"
timeout /t 2 /nobreak >nul

:open
start "" "http://127.0.0.1:8777/calibrate.html"
exit
