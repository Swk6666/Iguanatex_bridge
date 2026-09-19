#!/usr/bin/env bash
set -euo pipefail
cd -- "$(dirname -- "$0")"
if [ ! -x .venv/bin/python ]; then
    python3 -m venv .venv || { echo '请安装 Python venv（Ubuntu: sudo apt install python3-venv），然后重试。'; exit 1; }
fi
.venv/bin/python -m pip install -r requirements.txt
.venv/bin/python install_wps.py "$@"
