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

    def test_batch_progress_and_cancel_are_shared_across_requests(self):
        self.assertEqual(self.request('/api/office/batch/status', {})['status'], 'idle')
        task = self.request('/api/office/batch/start', {'total': 3})
        self.request('/api/office/batch/update', {'id': task['id'], 'current': 2, 'succeeded': 1})
        self.assertTrue(self.request('/api/office/batch/cancel', {})['cancel_requested'])
        final = self.request('/api/office/batch/finish', {'id': task['id'], 'succeeded': 1})
        self.assertEqual((final['status'], final['succeeded'], final['total']), ('cancelled', 1, 3))
        self.assertEqual(self.request('/api/office/batch/status', {}), final)

    def test_native_routes_require_session_origin_and_cached_render(self):
        native = self.shared['office_native']
        with patch.object(native, 'capture', return_value={'nativeSession': 'opaque'}) as capture:
            for headers in ({'X-Bridge-Token': ''}, {'Origin': 'https://evil.invalid'}, {'Host': 'evil.invalid'}):
                with self.assertRaises(urllib.error.HTTPError) as cm:
                    self.request('/api/office/native/capture', {}, headers=headers)
                self.assertEqual(cm.exception.code, 403); cm.exception.close()
            capture.assert_not_called()
            self.assertEqual(self.request('/api/office/native/capture', {'binding': {'slideId': '712'}}), {'nativeSession': 'opaque'})
            capture.assert_called_once_with({'binding': {'slideId': '712'}})
        with patch.object(native, 'apply', return_value={'ok': True}) as apply:
            with self.assertRaises(urllib.error.HTTPError) as cm:
                self.request('/api/office/native/apply', {'renderId': '../untrusted.svg', 'path': 'C:/untrusted.svg'})
            self.assertEqual(cm.exception.code, 400); cm.exception.close(); apply.assert_not_called()
            with patch.object(self.shared['renderer'], 'render_result', return_value={'path': 'server-cached.svg'}) as cached:
                self.assertEqual(self.request('/api/office/native/apply', {'renderId': 'valid-id', 'path': 'untrusted.svg'}), {'ok': True})
                cached.assert_called_once_with({'id': 'valid-id'})
                self.assertEqual(apply.call_args.args[1], {'path': 'server-cached.svg'})

    def test_assets_and_render_supply_office_image_data(self):
        for path in ('/office/taskpane.html', '/office/adapter.js', '/office/taskpane.js', '/office/batch.html', '/office/batch.js', '/office/utility.html', '/office/utility.js',
                     '/office/utility.css', '/office/icons/recognize-32.png', '/office/icon.png', '/shared/ocr.js', '/shared/ocr.css'):
            with urllib.request.urlopen(self.base + path) as response:
                self.assertEqual(response.status, 200)
                if path.startswith('/office/'):
                    self.assertIsNone(response.headers.get('X-Frame-Options'))
        result = self.request('/api/render', {'source': 'A=b', 'output': 'svg'})
        cached = self.request('/api/render/result', {'id': result['render_id']})
        self.assertEqual(cached, result)
        with self.assertRaises(urllib.error.HTTPError) as invalid:
            self.request('/api/render/result', {'id': '../invalid'})
        self.assertEqual(invalid.exception.code, 400); invalid.exception.close()
        renderer = self.shared['renderer']
        with renderer._renders_lock:
            created, stored, size = renderer._renders[result['render_id']]
            renderer._renders[result['render_id']] = (created - 1801, stored, size)
        with self.assertRaises(urllib.error.HTTPError) as expired:
            self.request('/api/render/result', {'id': result['render_id']})
        self.assertEqual(expired.exception.code, 400); expired.exception.close()
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

    def test_manifest_matches_wps_ribbon_and_has_distinct_served_icons(self):
        ns = {'o':'http://schemas.microsoft.com/office/taskpaneappversionoverrides',
              'bt':'http://schemas.microsoft.com/office/officeappbasictypes/1.0'}
        root = ET.parse('office_addin/manifest.xml').getroot()
        groups = root.findall('.//o:CustomTab/o:Group', ns)
        controls = [[node.get('id') for node in group.findall('o:Control', ns)] for group in groups]
        self.assertEqual(controls, [['IgBridge.New','IgBridge.Picture','IgBridge.Edit'],
            ['IgBridge.Status','IgBridge.Cancel','IgBridge.Settings','IgBridge.Api','IgBridge.Draft'],
            ['IgBridge.Protect','IgBridge.Help']])
        actions = root.findall('.//o:CustomTab/o:Group/o:Control/o:Action', ns)
        action_type = '{http://www.w3.org/2001/XMLSchema-instance}type'
        self.assertEqual([action.get(action_type) for action in actions], ['ExecuteFunction'] * 10)
        self.assertEqual([action.find('o:FunctionName', ns).text for action in actions],
            ['igBridgeNew','igBridgePicture','igBridgeEdit','igBridgeStatus','igBridgeCancel',
             'igBridgeSettings','igBridgeApi','igBridgeDraft','igBridgeProtect','igBridgeHelp'])
        runtime = root.find('.//o:Host/o:Runtimes/o:Runtime', ns)
        function_file = root.find('.//o:Host/o:DesktopFormFactor/o:FunctionFile', ns)
        self.assertEqual((runtime.get('lifetime'), runtime.get('resid')), ('long', function_file.get('resid')))
        resources = {item.get('id'):item.get('DefaultValue') for item in root.findall('.//bt:Images/bt:Image', ns)}
        for group in groups:
            for control in group.findall('o:Control', ns):
                images = control.findall('o:Icon/bt:Image', ns)
                self.assertEqual([image.get('size') for image in images], ['16','32','80'])
                for image in images:
                    self.assertIn('/office/icons/', resources[image.get('resid')])


if __name__ == '__main__': unittest.main()
