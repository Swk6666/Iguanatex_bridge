@echo off
cd /d "%~dp0"
if not exist .venv\Scripts\python.exe py -3 -m venv .venv
if errorlevel 1 goto end
.venv\Scripts\python.exe -m pip install -r requirements-office.txt
if errorlevel 1 goto end
.venv\Scripts\python.exe setup_office.py --serve %*
:end
pause
