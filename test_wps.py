import json
from pathlib import Path
import tempfile
import threading
import unittest
import urllib.error
import urllib.request
import xml.etree.ElementTree as ET

from app import create_server
from bridge import decode_meta, complete_source, Deck
from install_wps import register
from wps_support import WpsBridge


class WpsIntegrationTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.temp = tempfile.TemporaryDirectory()
        cls.server = create_server(cache_dir=cls.temp.name)
        cls.thread = threading.Thread(target=cls.server.serve_forever, daemon=True)
        cls.thread.start()
        cls.base = 'http://127.0.0.1:' + str(cls.server.server_port)
        with urllib.request.urlopen(cls.base + '/api/session') as response:
            cls.token = json.load(response)['token']

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown()
        cls.server.server_close()
        cls.thread.join()
        cls.temp.cleanup()

    def request(self, path, data, headers=None):
        h = {'Content-Type': 'application/json', 'X-Bridge-Token': self.token}
        h.update(headers or {})
        req = urllib.request.Request(self.base + path, json.dumps(data).encode(), headers=h)
        with urllib.request.urlopen(req) as response:
            return json.load(response)

    def test_render_has_native_tags_and_embedded_png_source(self):
        output = self.request('/api/wps/render', {'source': r'M(q)\ddot q=\tau', 'point_size': 28})
        self.assertEqual(output['tags']['LATEXADDIN'], complete_source(r'M(q)\ddot q=\tau'))
        self.assertEqual(output['tags']['LATEXENGINEID'], '2')
        self.assertEqual(output['tags']['IGUANATEXSIZE'], '28.0')
        self.assertEqual(decode_meta(output['alt'])['source'], output['source'])
        from PIL import Image
        with Image.open(output['path']) as im:
            self.assertEqual(decode_meta(im.info['IguanaTexBridge'])['source'], output['source'])
            self.assertAlmostEqual(output['width'], im.width * 72 / 300 * 2.8)
        restored = self.request('/api/wps/metadata', {'tags': {}, 'alt': output['alt']})
        self.assertEqual(restored['tags'], output['tags'])
        edited = dict(output['tags'], LATEXADDIN=complete_source('X=y % 中文\n'))
        newer = self.request('/api/wps/metadata', {'tags': edited, 'alt': output['alt']})
        self.assertEqual(decode_meta(newer['alt'])['source'], edited['LATEXADDIN'])
        with_backup = dict(newer['tags'], IGUANABRIDGEMETA=newer['alt'])
        resynced = self.request('/api/wps/metadata', {'tags': with_backup, 'alt': newer['alt']})
        self.assertEqual(resynced['alt'], newer['alt'])
        self.assertNotIn('IGUANABRIDGEMETA', decode_meta(resynced['alt'])['tags'])

    def test_reject_cross_origin_and_missing_token(self):
        for headers in [{'Origin': 'https://evil.invalid'}, {'X-Bridge-Token': ''}, {'Host': 'evil.invalid'}]:
            with self.assertRaises(urllib.error.HTTPError) as cm:
                self.request('/api/doctor', {}, headers)
            self.assertEqual(cm.exception.code, 403)
            cm.exception.close()

    def test_svg_is_outlined_cropped_and_has_matching_source(self):
        result = self.request('/api/wps/render', {'source': r'\frac{a^2}{b}+\text{矢量}', 'output': 'svg'})
        svg = ET.parse(result['path']).getroot()
        ns = {'s': 'http://www.w3.org/2000/svg'}
        self.assertTrue(svg.findall('.//s:path', ns))
        self.assertFalse(svg.findall('.//s:text', ns))
        self.assertFalse(svg.findall('.//s:image', ns))
        self.assertEqual(decode_meta(svg.find('s:metadata', ns).text)['source'], result['source'])
        self.assertEqual(result['tags']['BITMAPVECTOR'], '0')
        self.assertEqual(result['tags']['OUTPUTTYPE'], 'SVG')
        self.assertNotIn('OUTPUTDPI', result['tags'])
        self.assertAlmostEqual(float(svg.get('width')[:-2]), float(result['tags']['ORIGINALWIDTH']))
        import pymupdf as fitz
        with fitz.open(result['path']) as doc:
            pix = doc[0].get_pixmap(alpha=True)
            self.assertLess(pix.height, 100)
            self.assertLess(pix.width, 150)
            self.assertGreater(max(pix.samples[3::4]), 0)
            self.assertEqual(min(pix.samples[3::4]), 0)

    def test_recognition_image_export_and_cleanup(self):
        from PIL import Image
        target = self.request('/api/wps/image-target', {})
        path = Path(target['path'])
        Image.new('RGB', (12, 8), 'white').save(path)
        result = self.request('/api/wps/image-read', {'token': target['token']})
        import base64, io
        with Image.open(io.BytesIO(base64.b64decode(result['data']))) as image:
            self.assertEqual(image.size, (12, 8))
        self.assertFalse(path.exists())
        self.request('/api/wps/image-discard', {'token': target['token']})
        for token in ('../bad', 'a' * 32 + '/x'):
            with self.assertRaises(urllib.error.HTTPError) as caught:
                self.request('/api/wps/image-read', {'token': token})
            caught.exception.close()

    def test_workflow_settings_draft_and_review(self):
        import base64
        defaults = self.request('/api/wps/settings', {})
        self.assertEqual(defaults['point_size'], 18)
        settings = {'point_size': 26, 'color': '#DD2244', 'align': 'right', 'review': True}
        self.assertEqual(self.request('/api/wps/settings', settings), settings)
        self.assertEqual(self.request('/api/wps/settings', {}), settings)
        identity = {'presentation': '/tmp/deck.pptx', 'slide_id': 42, 'shape_id': 7}
        self.assertFalse(self.request('/api/wps/draft-get', {'identity': identity})['found'])
        self.request('/api/wps/draft-save', {'identity': identity, 'signature': 'original', 'source': r'\bad', 'error': 'error log'})
        draft = self.request('/api/wps/draft-get', {'identity': identity})
        self.assertEqual((draft['source'], draft['error'], draft['signature']), (r'\bad', 'error log', 'original'))
        self.assertEqual(self.request('/api/wps/draft-get', {'identity': dict(identity, shape_id=8)}), {'found': False})
        self.request('/api/wps/draft-delete', {'identity': identity})
        self.assertFalse(self.request('/api/wps/draft-get', {'identity': identity})['found'])
        office_identity = {'presentation': 'deck-guid', 'slide_id': 'slide-guid', 'shape_id': 'shape-guid'}
        self.request('/api/wps/draft-save', {'identity': office_identity, 'signature': 'image-hash', 'source': 'x', 'error': 'error'})
        self.assertEqual(self.request('/api/wps/draft-get', {'identity': office_identity})['source'], 'x')
        image = base64.b64encode(b'example').decode()
        rid = self.request('/api/wps/review-create', {'image': image, 'preview': image})['id']
        self.assertIsNone(self.request('/api/wps/review-status', {'id':rid})['decision'])
        self.assertEqual(self.request('/api/wps/review-get', {'id':rid})['image'], image)
        self.request('/api/wps/review-decide', {'id':rid, 'decision':'accept'})
        self.assertEqual(self.request('/api/wps/review-status', {'id':rid})['decision'], 'accept')
        self.request('/api/wps/review-discard', {'id':rid})
        with self.assertRaises(urllib.error.HTTPError) as caught:
            self.request('/api/wps/review-status', {'id':rid})
        caught.exception.close()

    def test_formula_color_is_rendered_and_editable(self):
        import base64, io
        from PIL import Image
        result = self.request('/api/wps/render', {'source': 'E=mc^2', 'point_size': 24, 'color': '#D02030', 'output': 'png'})
        self.assertIn(r'\color[HTML]{D02030}', result['source'])
        self.assertEqual(result['tags']['LATEXADDIN'], result['source'])
        with Image.open(io.BytesIO(base64.b64decode(result['png']))) as im:
            pixels = [p for p in im.convert('RGBA').getdata() if p[3] > 128]
        self.assertGreater(len(pixels), 0)
        self.assertGreater(sum(1 for r,g,b,a in pixels if r>g*2 and r>b*2), len(pixels)*.9)
        with self.assertRaises(urllib.error.HTTPError) as caught:
            self.request('/api/wps/render', {'source':'x', 'color':'bad'})
        caught.exception.close()

    def test_unknown_output_is_rejected(self):
        with self.assertRaises(urllib.error.HTTPError) as cm:
            self.request('/api/wps/render', {'source': 'x', 'output': 'emf'})
        self.assertEqual(cm.exception.code, 400)
        cm.exception.close()

    def test_font_size_scales_both_formats_and_survives_metadata_restore(self):
        for output in ('svg', 'png'):
            small = self.request('/api/wps/render', {'source': 'E=mc^2', 'point_size': 22.5, 'output': output})
            large = self.request('/api/wps/render', {'source': 'E=mc^2', 'point_size': 45, 'output': output})
            self.assertAlmostEqual(large['width'], small['width'] * 2)
            self.assertAlmostEqual(large['height'], small['height'] * 2)
            self.assertEqual(large['source'], small['source'])
            restored = self.request('/api/wps/metadata', {'tags': {}, 'alt': small['alt']})
            self.assertEqual(restored['tags']['IGUANATEXSIZE'], '22.5')

    def test_invalid_font_size_does_not_compile(self):
        from unittest.mock import patch
        with patch('wps_support.render') as compile_formula:
            for size in (0, 3.5, 201, float('nan'), float('inf')):
                with self.assertRaises(ValueError):
                    WpsBridge(self.temp.name).render({'source': 'x', 'point_size': size})
            compile_formula.assert_not_called()

    def test_assets_and_path_traversal(self):
        for asset in ('latex.js', 'workspace.js', 'workspace.css'):
            with urllib.request.urlopen(self.base + '/shared/' + asset) as response:
                self.assertEqual(response.status, 200)
        for asset in ['ribbon.xml', 'main.js', 'adapter.js', 'recognize.js', 'editor.js', 'style.css']:
            with urllib.request.urlopen(self.base + '/wps/' + asset) as response:
                self.assertEqual(response.status, 200)
                self.assertNotIn(self.token.encode(), response.read())
        # The version comes from the VERSION file only.
        version = Path('VERSION').read_text(encoding='utf-8').strip()
        with urllib.request.urlopen(self.base + '/health') as response:
            self.assertEqual(json.load(response)['version'], version)
        with urllib.request.urlopen(self.base + '/wps/editor.js') as response:
            script = response.read().decode()
        self.assertNotIn('__VERSION__', script)
        self.assertIn('IguanaTex Bridge ' + version, script)
        # Every ribbon button uses one of our icons; WPS shows "?" for unknown imageMso names.
        import re
        ribbon = Path('wps_addin/ribbon.xml').read_text(encoding='utf-8')
        self.assertNotIn('imageMso', ribbon)
        buttons = re.findall(r'<button [^>]*>', ribbon)
        self.assertTrue(buttons)
        for button in buttons:
            self.assertIn('getImage="GetImage"', button)
        for name in ('new', 'recognize', 'edit', 'status', 'cancel', 'settings', 'draft', 'protect', 'help'):
            with urllib.request.urlopen(self.base + '/wps/images/' + name + '.svg') as response:
                self.assertEqual(response.headers['Content-Type'], 'image/svg+xml')
                self.assertTrue(response.read().startswith(b'<svg'))
        with self.assertRaises(urllib.error.HTTPError) as cm:
            urllib.request.urlopen(self.base + '/wps/../app.py')
        self.assertEqual(cm.exception.code, 404)
        cm.exception.close()

    def test_existing_offline_flow_is_preserved(self):
        self.request('/api/new', {})
        self.request('/api/apply', {'source': 'a=B', 'slide': 1})
        result = self.request('/api/save', {})
        import base64
        deck = Deck(base64.b64decode(result['data']))
        self.assertEqual(deck.records()[0]['source'], complete_source('a=B'))

    def test_source_less_picture_is_not_mistaken_for_formula(self):
        self.assertFalse(WpsBridge.metadata({'tags': {'OTHER': 'value'}, 'alt': 'a plain picture'})['found'])

    def test_installer_is_idempotent_and_preserves_other_plugins(self):
        with tempfile.TemporaryDirectory() as td:
            d = Path(td)
            (d / 'publish.xml').write_text('<jsplugins><jspluginonline name="Other" type="wps" url="http://other/" /></jsplugins>')
            register(d); register(d)
            root = ET.parse(d / 'publish.xml').getroot()
            self.assertEqual(len(root), 2)
            self.assertEqual(root[0].get('url'), 'http://other/')
            register(d, remove=True)
            root = ET.parse(d / 'publish.xml').getroot()
            self.assertEqual(len(root), 1)
            self.assertEqual(root[0].get('name'), 'Other')
            self.assertTrue(list(d.glob('publish.xml.iguanatex-backup-*')))

    def test_installer_does_not_overwrite_malformed_config(self):
        with tempfile.TemporaryDirectory() as td:
            p = Path(td) / 'publish.xml'
            p.write_text('<unfinished')
            with self.assertRaises(ET.ParseError):
                register(Path(td))
            self.assertEqual(p.read_text(), '<unfinished')

    def test_full_source_api_matches_compilation_and_preserves_ocr_preamble(self):
        full = self.request('/api/latex/source', {'source': r'\frac{a}{b}'})['source']
        rendered = self.request('/api/wps/render', {'source': full})
        self.assertEqual(rendered['source'], full)
        self.assertEqual(rendered['tags']['LATEXADDIN'], full)
        custom = full.replace('\\pagestyle{empty}', '\\newcommand{\\R}{\\mathbb{R}}\n\\pagestyle{empty}')
        adopted = self.request('/api/latex/source', {'source': r'\R', 'base': custom})['source']
        self.assertIn(r'\newcommand{\R}', adopted)
        self.assertNotIn(r'\frac{a}{b}', adopted)
        self.assertEqual(self.request('/api/latex/source', {'source': custom})['source'], custom)


if __name__ == '__main__':
    unittest.main()
