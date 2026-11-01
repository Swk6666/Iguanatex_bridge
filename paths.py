"""Per-user state, kept outside the checkout and release archives."""
import os
from pathlib import Path
import sys

# The single source of the release number; scripts/build_release.py reads the same file.
VERSION = (Path(__file__).resolve().parent / 'VERSION').read_text(encoding='utf-8').strip()


def state_dir():
    if sys.platform == 'win32':
        return Path(os.environ.get('LOCALAPPDATA', Path.home() / 'AppData/Local')) / 'IguanaTexBridge'
    if sys.platform == 'darwin':
        return Path.home() / 'Library/Application Support/IguanaTexBridge'
    return Path(os.environ.get('XDG_STATE_HOME', Path.home() / '.local/state')) / 'iguanatex-bridge'
