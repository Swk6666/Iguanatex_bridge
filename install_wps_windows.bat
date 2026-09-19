@echo off
chcp 65001 >nul
cd /d "%~dp0"
if not exist .venv\Scripts\python.exe py -3 -m venv .venv
if errorlevel 1 goto failed
.venv\Scripts\python.exe -m pip install -r requirements.txt
if errorlevel 1 goto failed
.venv\Scripts\python.exe install_wps.py %*
if errorlevel 1 goto failed
pause
exit /b 0
:failed
echo 安装失败，请检查以上错误。
pause
exit /b 1
