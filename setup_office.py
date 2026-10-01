#!/usr/bin/env python3
"""Generate local Office assets; OS certificate trust is an explicit install step."""
import argparse
from datetime import datetime, timedelta, timezone
import ipaddress
from pathlib import Path
import shutil
import subprocess
import sys

from paths import state_dir

ROOT = Path(__file__).resolve().parent


def prepare(directory=None, port=17864):
    if not 1 <= port <= 65535:
        raise ValueError('HTTPS 端口必须在 1–65535 之间。')
    from cryptography import x509
    from cryptography.hazmat.primitives import hashes, serialization
    from cryptography.hazmat.primitives.asymmetric import rsa
    from cryptography.x509.oid import ExtendedKeyUsageOID, NameOID
    directory = Path(directory or state_dir() / 'office')
    directory.mkdir(parents=True, exist_ok=True, mode=0o700)
    certificate, key = directory / 'localhost.pem', directory / 'localhost-key.pem'
    # Do not silently rotate a trusted certificate or overwrite a partial installation.
    if certificate.exists() != key.exists():
        raise ValueError('证书或私钥缺失，请备份并移走 office 状态目录后重新生成与信任证书。')
    if certificate.exists():
        cert = x509.load_pem_x509_certificate(certificate.read_bytes())
        if cert.not_valid_after_utc <= datetime.now(timezone.utc):
            raise ValueError('本地证书已过期，请按 docs/INSTALL_OFFICE.md 的证书更新步骤处理。')
        private = serialization.load_pem_private_key(key.read_bytes(), password=None)
        if private.public_key().public_numbers() != cert.public_key().public_numbers():
            raise ValueError('本地证书与私钥不匹配，请重新生成。')
    else:
        private = rsa.generate_private_key(public_exponent=65537, key_size=2048)
        name = x509.Name([x509.NameAttribute(NameOID.COMMON_NAME, 'IguanaTex Bridge localhost')])
        now = datetime.now(timezone.utc)
        cert = (x509.CertificateBuilder().subject_name(name).issuer_name(name)
                .public_key(private.public_key()).serial_number(x509.random_serial_number())
                .not_valid_before(now - timedelta(minutes=5)).not_valid_after(now + timedelta(days=365))
                .add_extension(x509.SubjectAlternativeName([x509.DNSName('localhost'),
                               x509.IPAddress(ipaddress.ip_address('127.0.0.1'))]), critical=False)
                .add_extension(x509.BasicConstraints(ca=False, path_length=None), critical=True)
                .add_extension(x509.ExtendedKeyUsage([ExtendedKeyUsageOID.SERVER_AUTH]), critical=False)
                .sign(private, hashes.SHA256()))
        key.write_bytes(private.private_bytes(serialization.Encoding.PEM,
                       serialization.PrivateFormat.PKCS8, serialization.NoEncryption()))
        key.chmod(0o600)
        certificate.write_bytes(cert.public_bytes(serialization.Encoding.PEM))
    manifest = directory / 'IguanaTexBridge.xml'
    template = (ROOT / 'office_addin/manifest.xml').read_text(encoding='utf-8')
    manifest.write_text(template.replace('https://localhost:17864', f'https://localhost:{port}'), encoding='utf-8')
    return certificate, key, manifest


def trust_certificate(certificate):
    """Trust only the generated localhost leaf certificate in this user's store."""
    if sys.platform == 'darwin':
        subprocess.run(['security', 'add-trusted-cert', '-r', 'trustRoot', '-p', 'ssl',
                        '-k', str(Path.home() / 'Library/Keychains/login.keychain-db'), str(certificate)], check=True)
    elif sys.platform == 'win32':
        # certutil accepts PEM certificates. No machine-wide administrator store.
        subprocess.run(['certutil', '-user', '-addstore', 'Root', str(certificate)], check=True)
    else:
        raise ValueError('Office 桌面加载项证书安装适用于 macOS 和 Windows。Ubuntu WPS 不需要此证书。')


def install_manifest(manifest):
    if sys.platform != 'darwin':
        return None  # Windows uses the official network-shared catalog procedure.
    destination = Path.home() / 'Library/Containers/com.microsoft.Powerpoint/Data/Documents/wef/IguanaTexBridge.xml'
    destination.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(manifest, destination)
    return destination


def install_manifest_or_instruct(manifest):
    try:
        destination = install_manifest(manifest)
    except PermissionError:
        # macOS may deny terminal access to another app's container. Finder is
        # the supported manual path; do not request Full Disk Access or sudo.
        print('macOS 阻止脚本写入 PowerPoint 目录，请通过 Finder 完成安装：')
        print('1. Finder 按 Command+Shift+G，前往：' + str(manifest.parent))
        print('2. 只复制 IguanaTexBridge.xml（不要复制 localhost-key.pem）。')
        print('3. 再前往：~/Library/Containers/com.microsoft.Powerpoint/Data/Documents/')
        print('4. 新建 wef 文件夹（若不存在），打开后粘贴清单。')
        return False
    print('已复制到 PowerPoint：' + str(destination) if destination else 'Windows：将清单复制到单独的共享目录，按 docs/INSTALL_OFFICE.md 添加受信任加载项目录。不要共享证书目录。')
    return True


def main():
    parser = argparse.ArgumentParser(description='准备 PowerPoint 加载项的本地 HTTPS 证书和清单')
    parser.add_argument('--port', type=int, default=17864)
    parser.add_argument('--directory', type=Path)
    parser.add_argument('--trust-cert', action='store_true', help='把本项目的 localhost 证书加入当前用户证书信任库')
    parser.add_argument('--install-manifest', action='store_true', help='macOS：注册 PowerPoint 清单；Windows：输出目录位置')
    parser.add_argument('--serve', action='store_true', help='准备后启动 HTTP 17863 与 HTTPS 服务')
    parser.add_argument('--http-port', type=int, default=17863)
    parser.add_argument('--ocr-browser', choices=['chrome', 'msedge', 'chromium'], default='chrome')
    parser.add_argument('--ocr-selectors', type=Path)
    args = parser.parse_args()
    certificate, key, manifest = prepare(args.directory, args.port)
    print('证书：', certificate)
    print('加载项清单：', manifest)
    if args.trust_cert:
        trust_certificate(certificate)
    if args.install_manifest:
        install_manifest_or_instruct(manifest)
    print(f'加载项地址：https://localhost:{args.port}/office/taskpane.html')
    if args.serve:
        command = [sys.executable, str(ROOT / 'app.py'), '--no-browser', '--port', str(args.http_port),
                   '--https-port', str(args.port), '--tls-cert', str(certificate), '--tls-key', str(key),
                   '--ocr-browser', args.ocr_browser]
        if args.ocr_selectors:
            command.extend(['--ocr-selectors', str(args.ocr_selectors.resolve())])
        subprocess.run(command, check=True, cwd=ROOT)


if __name__ == '__main__':
    main()
