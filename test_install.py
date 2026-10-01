"""Exercise installer failure boundaries without sudo, network, or WPS changes."""
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import unittest


ROOT = Path(__file__).resolve().parent


@unittest.skipIf(os.geteuid() == 0 if hasattr(os, 'geteuid') else True,
                 'Installer integration tests require a non-root POSIX user')
class InstallEntryTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.base = Path(self.temp.name).resolve()  # macOS /var -> /private/var
        self.project = self.base / '中文 checkout with spaces'
        self.project.mkdir()
        self.bin = self.base / 'bin'
        self.bin.mkdir()
        for name in ('install.sh', 'install_wps_linux_mac.sh'):
            shutil.copyfile(ROOT / name, self.project / name)
        (self.project / 'install_wps.py').write_text('# never executed by real Python\n')
        (self.project / 'requirements.txt').write_text('example\n')
        self.log = self.base / 'calls.jsonl'
        # Every potentially mutating external command is replaced by this stub.
        # The real shell still parses and runs install.sh, including error handling.
        stub = f'#!{sys.executable}\n' + r'''
import json, os, pathlib, shutil, subprocess, sys
name = pathlib.Path(sys.argv[0]).name
args = sys.argv[1:]
with open(os.environ['BRIDGE_TEST_LOG'], 'a') as log:
    log.write(json.dumps([name, args, os.getcwd()]) + '\n')
if name == 'uname':
    print(os.environ.get('BRIDGE_TEST_PLATFORM', 'Linux'))
elif name == 'dpkg-query':
    missing = os.environ.get('BRIDGE_TEST_MISSING', '').split(',')
    print('unknown ok not-installed' if args[-1] in missing else 'install ok installed', end='')
elif name == 'sudo':
    sys.exit(subprocess.call(args))
elif name == 'apt-get':
    sys.exit(int(os.environ.get('BRIDGE_TEST_APT_EXIT', '0')))
elif name == 'kpsewhich':
    sys.exit(int(os.environ.get('BRIDGE_TEST_TEX_EXIT', '0')))
elif name in ('python', 'python3'):
    if args[0] == '-c':
        if 'ensurepip' in args[1] and not pathlib.Path('.venv/bin/python').exists():
            sys.exit(int(os.environ.get('BRIDGE_TEST_VENV_MISSING', '0')))
    elif args[:2] == ['-m', 'venv']:
        target = pathlib.Path(args[2]) / 'bin/python'
        target.parent.mkdir(parents=True)
        shutil.copyfile(sys.argv[0], target)
        target.chmod(0o755)
    elif args[:3] == ['-m', 'pip', 'install']:
        sys.exit(int(os.environ.get('BRIDGE_TEST_PIP_EXIT', '0')))
'''
        for name in ('uname', 'dpkg-query', 'sudo', 'apt-get', 'python3', 'xelatex', 'kpsewhich'):
            path = self.bin / name
            path.write_text(stub)
            path.chmod(0o755)
        self.env = dict(os.environ, PATH=str(self.bin) + os.pathsep + os.environ['PATH'],
                        BRIDGE_TEST_LOG=str(self.log))

    def run_install(self, *args, legacy=False, **env):
        name = 'install_wps_linux_mac.sh' if legacy else 'install.sh'
        return subprocess.run(['bash', str(self.project / name), *args], cwd=self.base,
                              env=dict(self.env, **env), text=True, capture_output=True)

    def calls(self):
        if not self.log.exists():
            return []
        return [json.loads(line) for line in self.log.read_text().splitlines()]

    def test_fresh_install_then_rerun_reuses_venv_without_sudo(self):
        for _ in range(2):
            result = self.run_install()
            self.assertEqual(result.returncode, 0, result.stderr)
        calls = self.calls()
        self.assertFalse(any(name == 'sudo' for name, _, _ in calls))
        self.assertEqual(sum(args[:2] == ['-m', 'venv'] for _, args, _ in calls), 1)
        registered = [call for call in calls if call[1][0] == 'install_wps.py']
        self.assertEqual(len(registered), 2)
        self.assertTrue(all(call[2] == str(self.project) for call in registered))

    def test_missing_packages_are_installed_before_venv(self):
        result = self.run_install(BRIDGE_TEST_MISSING='python3-venv,texlive-lang-chinese',
                                  BRIDGE_TEST_VENV_MISSING='1')
        self.assertEqual(result.returncode, 0, result.stderr)
        calls = self.calls()
        apt = [args for name, args, _ in calls if name == 'apt-get']
        self.assertEqual(apt, [['update'], ['install', '-y', 'texlive-lang-chinese', 'python3-venv']])
        self.assertLess(next(i for i, c in enumerate(calls) if c[1][:2] == ['install', '-y']),
                        next(i for i, c in enumerate(calls) if c[1][:2] == ['-m', 'venv']))

    def test_apt_failure_stops_before_venv_or_registration(self):
        result = self.run_install(BRIDGE_TEST_MISSING='texlive-xetex', BRIDGE_TEST_APT_EXIT='42')
        self.assertNotEqual(result.returncode, 0)
        self.assertFalse((self.project / '.venv').exists())
        self.assertFalse(any(c[1][0] == 'install_wps.py' for c in self.calls()))

    def test_pip_failure_does_not_register_plugin(self):
        result = self.run_install(BRIDGE_TEST_PIP_EXIT='23')
        self.assertNotEqual(result.returncode, 0)
        self.assertFalse(any(c[1][0] == 'install_wps.py' for c in self.calls()))

    def test_missing_tex_stops_before_registration(self):
        result = self.run_install('--skip-system-deps', BRIDGE_TEST_TEX_EXIT='1')
        self.assertNotEqual(result.returncode, 0)
        self.assertFalse(any(c[1][0] == 'install_wps.py' for c in self.calls()))

    def test_custom_options_and_legacy_entry(self):
        addons = str(self.base / '自定义 addons')
        result = self.run_install('--skip-system-deps', '--port', '17864', '--addons-dir', addons,
                                  '--no-autostart', legacy=True)
        self.assertEqual(result.returncode, 0, result.stderr)
        calls = self.calls()
        self.assertFalse(any(c[0] in ('sudo', 'dpkg-query') for c in calls))
        self.assertEqual(calls[-1][1], ['install_wps.py', '--port', '17864',
                                      '--addons-dir', addons, '--no-autostart'])

    def test_optional_ocr_installs_before_registration(self):
        result = self.run_install('--with-ocr')
        self.assertEqual(result.returncode, 0, result.stderr)
        calls = self.calls()
        ocr = next(i for i, c in enumerate(calls) if c[1] == ['-m', 'pip', 'install', '-r', 'requirements-ocr.txt'])
        register = next(i for i, c in enumerate(calls) if c[1][0] == 'install_wps.py')
        self.assertLess(ocr, register)

    def test_uninstall_skips_apt_pip_and_tex(self):
        result = self.run_install('--uninstall', BRIDGE_TEST_TEX_EXIT='1', BRIDGE_TEST_PIP_EXIT='23')
        self.assertEqual(result.returncode, 0, result.stderr)
        calls = self.calls()
        self.assertEqual(len(calls), 2)  # Python version check, then stdlib installer.
        self.assertEqual(calls[-1][1], ['install_wps.py', '--uninstall'])

    def test_help_and_invalid_options_have_no_external_effects(self):
        self.assertEqual(self.run_install('--help').returncode, 0)
        for args in (('--port',), ('--port', '65536'), ('--port', '-1'),
                     ('--addons-dir',), ('--unknown',)):
            self.assertNotEqual(self.run_install(*args).returncode, 0)
        self.assertEqual(self.calls(), [])


if __name__ == '__main__':
    unittest.main()
