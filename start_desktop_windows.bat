@echo off
cd /d "%~dp0"
if not exist .venv\Scripts\python.exe py -3 -m venv .venv
if errorlevel 1 goto failed
.venv\Scripts\python.exe -c "import PySide6.QtWidgets, playwright, PIL, lxml, pymupdf" >nul 2>&1
if not errorlevel 1 goto launch
.venv\Scripts\python.exe -m pip install -r requirements-desktop.txt
if errorlevel 1 goto failed
:launch
.venv\Scripts\python.exe desktop.py %*
if not errorlevel 1 exit /b 0
:failed
pause
exit /b 1
