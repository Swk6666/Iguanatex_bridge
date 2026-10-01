#!/usr/bin/env python3
"""Package only explicitly approved project files; never scan the workspace."""
import hashlib
from pathlib import Path, PurePosixPath
import re
import zipfile

ROOT = Path(__file__).resolve().parents[1]
FORBIDDEN = {'.git', '.venv', '.work', '__pycache__', 'dist'}


def main():
    version = (ROOT / 'VERSION').read_text(encoding='utf-8').strip()
    if not re.fullmatch(r'\d+\.\d+\.\d+', version):
        raise ValueError('VERSION must contain a semantic version such as 0.3.2')
    expected = {
        'app.py': "'version': '" + version + "'",
        'install_wps.py': 'Bridge ' + version + '。',
        'wps_addin/editor.js': 'Bridge ' + version + ' ·',
    }
    for name, marker in expected.items():
        if marker not in (ROOT / name).read_text(encoding='utf-8'):
            raise ValueError('Version mismatch: ' + name)
    entries = []
    for line in (ROOT / 'RELEASE_FILES.txt').read_text(encoding='utf-8').splitlines():
        name = line.strip()
        if not name or name.startswith('#'):
            continue
        path = PurePosixPath(name)
        if (path.is_absolute() or '..' in path.parts or set(path.parts) & FORBIDDEN
                or path.name.startswith(('.env', 'HKEY_CURRENT_USER'))
                or path.suffix in ('.log', '.pyc')):
            raise ValueError('Forbidden release path: ' + name)
        source = ROOT / path
        if not source.is_file() or source.is_symlink() or not source.resolve().is_relative_to(ROOT):
            raise ValueError('Missing or external release file: ' + name)
        if name in entries:
            raise ValueError('Duplicate release file: ' + name)
        entries.append(name)
    if not entries:
        raise ValueError('Empty release manifest')
    destination = ROOT / 'dist'
    destination.mkdir(exist_ok=True)
    archive = destination / f'IguanaTex_Bridge_WPS_v{version}.zip'
    with zipfile.ZipFile(archive, 'w', compression=zipfile.ZIP_DEFLATED, compresslevel=9) as output:
        for name in sorted(entries):
            # Fixed timestamps and permissions make unchanged inputs reproducible.
            info = zipfile.ZipInfo('iguanatex_bridge/' + name, date_time=(2026, 1, 1, 0, 0, 0))
            info.create_system = 3
            info.external_attr = (0o100755 if name.endswith(('.sh', '.command')) else 0o100644) << 16
            info.compress_type = zipfile.ZIP_DEFLATED
            output.writestr(info, (ROOT / name).read_bytes())
    with zipfile.ZipFile(archive) as output:
        if output.testzip() is not None:
            raise ValueError('ZIP integrity check failed')
    digest = hashlib.sha256(archive.read_bytes()).hexdigest()
    checksum = archive.with_suffix(archive.suffix + '.sha256')
    checksum.write_text(f'{digest}  {archive.name}\n', encoding='utf-8')
    print(f'{archive.name}: {len(entries)} files, {archive.stat().st_size} bytes')
    print(f'SHA-256: {digest}')
    print(f'Output: {destination}')


if __name__ == '__main__':
    main()
