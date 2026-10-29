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
        for asset in ['ribbon.xml', 'main.js', 'adapter.js', 'editor.js', 'style.css']:
            with urllib.request.urlopen(self.base + '/wps/' + asset) as response:
                self.assertEqual(response.status, 200)
                self.assertNotIn(self.token.encode(), response.read())
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
