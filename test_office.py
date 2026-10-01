import base64
import json
from pathlib import Path
import ssl
import tempfile
import threading
import unittest
from unittest.mock import patch
import io
from contextlib import redirect_stdout
import urllib.error
import urllib.request
import xml.etree.ElementTree as ET

from app import create_server
from bridge import decode_meta
from setup_office import prepare, install_manifest_or_instruct
from test_ocr import FakeBackend, image64


class OfficeServiceTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(); self.addCleanup(self.temp.cleanup)
        self.shared = {}; self.backend = FakeBackend(); self.backend.release.set()
        self.http = create_server(cache_dir=self.temp.name, shared=self.shared, ocr_options={'backend': self.backend})
        self.addCleanup(self.http.server_close)
        self.start(self.http)
        self.base = f'http://127.0.0.1:{self.http.server_port}'

    def start(self, server):
        thread = threading.Thread(target=server.serve_forever, daemon=True); thread.start()
        self.addCleanup(thread.join); self.addCleanup(server.shutdown)

    def request(self, path, data, base=None, **kwargs):
        headers = {'Content-Type': 'application/json', 'X-Bridge-Token': self.shared['token']}
        headers.update(kwargs.pop('headers', {}))
        req = urllib.request.Request((base or self.base) + path, json.dumps(data).encode(), headers=headers)
        with urllib.request.urlopen(req, **kwargs) as response: return json.load(response)

    def test_assets_and_render_supply_office_image_data(self):
        for path in ('/office/taskpane.html', '/office/adapter.js', '/office/taskpane.js', '/office/icon.png', '/shared/ocr.js', '/shared/ocr.css'):
            with urllib.request.urlopen(self.base + path) as response:
                self.assertEqual(response.status, 200)
                if path.startswith('/office/'):
                    self.assertIsNone(response.headers.get('X-Frame-Options'))
        result = self.request('/api/render', {'source': 'A=b', 'output': 'svg'})
        root = ET.fromstring(result['svg'])
        self.assertEqual(decode_meta(root.find('{http://www.w3.org/2000/svg}metadata').text)['source'], result['source'])
        self.assertTrue(base64.b64decode(result['png']).startswith(b'\x89PNG'))
        restored = self.request('/api/metadata', {'tags': {'IGUANABRIDGEMETA': result['alt']}})
        self.assertEqual(restored['source'], result['source'])

    def test_image_jobs_require_session_and_status_is_nonblocking(self):
        for path in ('/api/ocr/start', '/api/ocr/login', '/api/ocr/status', '/api/ocr/cancel'):
            with self.assertRaises(urllib.error.HTTPError) as cm:
                self.request(path, {'data': image64()}, headers={'X-Bridge-Token': ''})
            self.assertEqual(cm.exception.code, 403); cm.exception.close()
        job = self.request('/api/ocr/start', {'data': image64()})
        result = self.request('/api/ocr/status', {'id': job['id']})
        self.assertIn(result['status'], ['queued', 'running', 'recognizing', 'succeeded'])
        with urllib.request.urlopen(self.base + '/health', timeout=2) as response:
            self.assertEqual(json.load(response)['app'], 'IguanaTexBridge')

    def test_https_trust_hosts_shared_session_and_origin_checks(self):
        try:
            cert, key, manifest = prepare(Path(self.temp.name) / 'certs')
        except ImportError:
            self.skipTest('Install requirements-office.txt for HTTPS tests')
        https = create_server(tls=(cert, key), shared=self.shared)
        self.addCleanup(https.server_close); self.start(https)
        base = f'https://localhost:{https.server_port}'
        trust = ssl.create_default_context(cafile=str(cert))
        self.assertEqual(self.request('/api/ocr/login', {}, base=base, context=trust)['status'], 'queued')
        for headers in ({'Origin': self.base}, {'Host': 'evil.invalid'}, {'Origin': 'https://evil.invalid'}):
            with self.assertRaises(urllib.error.HTTPError) as cm:
                self.request('/api/ocr/login', {}, base=base, context=trust, headers=headers)
            self.assertEqual(cm.exception.code, 403); cm.exception.close()
        with urllib.request.urlopen(base + '/api/session', context=trust) as response:
            self.assertEqual(json.load(response)['token'], self.shared['token'])
        self.assertEqual(prepare(Path(self.temp.name) / 'certs')[0].read_bytes(), cert.read_bytes())
        manifest_root = ET.parse(manifest).getroot()
        ns = {'o': 'http://schemas.microsoft.com/office/appforoffice/1.1'}
        self.assertEqual(manifest_root.find('o:Hosts/o:Host', ns).get('Name'), 'Presentation')

    def test_mac_container_permission_error_provides_finder_install_steps(self):
        output = io.StringIO()
        with patch('setup_office.install_manifest', side_effect=PermissionError('Operation not permitted')), redirect_stdout(output):
            self.assertFalse(install_manifest_or_instruct(Path('/example/office/IguanaTexBridge.xml')))
        self.assertIn('Command+Shift+G', output.getvalue())
        self.assertIn('wef', output.getvalue())
        self.assertIn('不要复制 localhost-key.pem', output.getvalue())


if __name__ == '__main__': unittest.main()
