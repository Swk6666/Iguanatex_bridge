#!/usr/bin/env python3
"""Install this user-level WPS add-in without replacing other add-ins."""
import argparse
import datetime
import json
import os
from pathlib import Path
import plistlib
import shutil
import subprocess
import sys
import time
import urllib.request
import xml.etree.ElementTree as ET

ROOT = Path(__file__).resolve().parent
NAME = 'IguanaTexBridge'
PORT = 17863
SERVICE = 'iguanatex-bridge.service'


def addon_dir():
    if sys.platform == 'win32':
        return Path(os.environ['APPDATA']) / 'kingsoft/wps/jsaddons'
    if sys.platform == 'darwin':
        return Path.home() / 'Library/Containers/com.kingsoft.wpsoffice.mac/Data/.kingsoft/wps/jsaddons'
    return Path.home() / '.local/share/Kingsoft/wps/jsaddons'


def register(directory, port=PORT, remove=False):
    directory.mkdir(parents=True, exist_ok=True)
    target = directory / 'publish.xml'
    if target.exists():
        tree = ET.parse(target)  # A malformed existing file is never overwritten.
        if tree.getroot().tag != 'jsplugins':
            raise ValueError('publish.xml 的根节点不是 jsplugins，未修改现有配置。')
        backup = target.with_name('publish.xml.iguanatex-backup-' + datetime.datetime.now().strftime('%Y%m%d-%H%M%S-%f'))
        shutil.copy2(target, backup)
    else:
        tree = ET.ElementTree(ET.Element('jsplugins'))
    for node in list(tree.getroot()):
        if node.get('name') == NAME:
            tree.getroot().remove(node)
    if not remove:
        ET.SubElement(tree.getroot(), 'jspluginonline', name=NAME, type='wpp',
                      url=f'http://127.0.0.1:{port}/wps/', enable='enable_dev', install='null', debug='')
    temporary = target.with_suffix('.tmp')
    tree.write(temporary, encoding='utf-8', xml_declaration=True)
    temporary.replace(target)
    return target


def healthy(port):
    try:
        with urllib.request.urlopen(f'http://127.0.0.1:{port}/health', timeout=2) as response:
            return json.load(response).get('app') == NAME
    except (OSError, ValueError):
        return False


def state_dir():
    if sys.platform == 'win32':
        return Path(os.environ['LOCALAPPDATA']) / NAME
    return Path.home() / '.local/state/iguanatex-bridge'


def launch(port):
    if healthy(port):
        return
    directory = state_dir()
    directory.mkdir(parents=True, exist_ok=True)
    options = {'start_new_session': True} if os.name != 'nt' else {'creationflags': subprocess.CREATE_NO_WINDOW}
    with (directory / 'service.log').open('ab') as log:
        subprocess.Popen([sys.executable, str(ROOT / 'app.py'), '--no-browser', '--port', str(port)],
                         cwd=ROOT, stdout=log, stderr=log, stdin=subprocess.DEVNULL, **options)
    for _ in range(30):
        if healthy(port):
            return
        time.sleep(.2)
    raise RuntimeError(f'本地服务未能启动。请检查端口 {port} 和日志 {directory / "service.log"}')


def autostart(port=PORT, remove=False):
    arguments = [sys.executable, str(ROOT / 'app.py'), '--no-browser', '--port', str(port)]
    if sys.platform == 'darwin':
        target = Path.home() / 'Library/LaunchAgents/org.iguanatex.bridge.plist'
        domain = f'gui/{os.getuid()}'
        if target.exists():
            subprocess.run(['launchctl', 'bootout', domain, str(target)], capture_output=True)
        if remove:
            target.unlink(missing_ok=True)
            return
        target.parent.mkdir(parents=True, exist_ok=True)
        log = state_dir() / 'service.log'
        log.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(plistlib.dumps(dict(Label='org.iguanatex.bridge', ProgramArguments=arguments,
            RunAtLoad=True, KeepAlive=True, WorkingDirectory=str(ROOT),
            StandardOutPath=str(log), StandardErrorPath=str(log))))
        subprocess.run(['launchctl', 'bootstrap', domain, str(target)], check=True)
    elif sys.platform == 'win32':
        target = Path(os.environ['APPDATA']) / 'Microsoft/Windows/Start Menu/Programs/Startup/IguanaTexBridge.vbs'
        if remove:
            target.unlink(missing_ok=True)
            return
        pythonw = Path(sys.executable).with_name('pythonw.exe')
        arguments[0] = str(pythonw if pythonw.exists() else sys.executable)
        command = subprocess.list2cmdline(arguments).replace('"', '""')
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text('CreateObject("WScript.Shell").Run "' + command + '", 0, False\r\n', encoding='utf-16')
    else:
        target = Path.home() / '.config/systemd/user' / SERVICE
        fallback = Path.home() / '.config/autostart/iguanatex-bridge.desktop'
        if remove:
            if target.exists():
                subprocess.run(['systemctl', '--user', 'disable', '--now', SERVICE], capture_output=True)
                target.unlink()
                subprocess.run(['systemctl', '--user', 'daemon-reload'], capture_output=True)
            fallback.unlink(missing_ok=True)
            return
        target.parent.mkdir(parents=True, exist_ok=True)
        def systemd_quote(value):
            return '"' + value.replace('\\', '\\\\').replace('"', '\\"').replace('%', '%%') + '"'
        command = ' '.join(systemd_quote(a) for a in arguments)
        target.write_text('[Unit]\nDescription=IguanaTex WPS local formula renderer\n\n[Service]\n'
            f'ExecStart={command}\nRestart=on-failure\nRestartSec=3\n\n[Install]\nWantedBy=default.target\n')
        try:
            subprocess.run(['systemctl', '--user', 'daemon-reload'], check=True, capture_output=True)
            subprocess.run(['systemctl', '--user', 'enable', SERVICE], check=True, capture_output=True)
            subprocess.run(['systemctl', '--user', 'restart', SERVICE], check=True, capture_output=True)
            fallback.unlink(missing_ok=True)
        except (OSError, subprocess.CalledProcessError):
            target.unlink(missing_ok=True)
            fallback.parent.mkdir(parents=True, exist_ok=True)
            fallback.write_text('[Desktop Entry]\nType=Application\nName=IguanaTex Bridge\n'
                                f'Exec={command}\nTerminal=false\nX-GNOME-Autostart-enabled=true\n')


def main():
    parser = argparse.ArgumentParser(description='安装 / 卸载 WPS IguanaTex 功能区')
    parser.add_argument('--uninstall', action='store_true')
    parser.add_argument('--no-autostart', action='store_true')
    parser.add_argument('--port', type=int, default=PORT)
    parser.add_argument('--addons-dir', type=Path, default=None)
    args = parser.parse_args()
    directory = args.addons_dir or addon_dir()
    if args.uninstall:
        register(directory, remove=True)
        autostart(remove=True)
        print('已移除本插件的 WPS 注册和自动启动配置。其他加载项保持不变。')
        return
    if not args.no_autostart:
        autostart(args.port)
    launch(args.port)
    config = register(directory, args.port)
    print(f'已安装 IguanaTex Bridge 0.4.2。配置：{config}')
    print('保存工作并重新启动 WPS 演示后，顶部将出现 IguanaTex 功能区。')
    print(f'本地服务：http://127.0.0.1:{args.port}/health')
    print('安装目录请保留；移动目录后重新运行安装脚本。')


if __name__ == '__main__':
    main()
