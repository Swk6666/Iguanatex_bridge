import io
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

from PIL import Image

from bridge import Deck, EMU_PT, NS, PNG_KEY, decode_meta, xml
from desktop_support import (LocalService, NoRedirect, atomic_write, formula_pptx,
                             load_image, read_source, render_formula)


class DesktopExportTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.result = render_formula(r'\begin{aligned}E&=mc^2\\A&=\frac{1}{3}\end{aligned}', 'xelatex', 32)

    def test_svg_and_png_reopen_source_and_physical_size(self):
        with tempfile.TemporaryDirectory() as directory:
            for suffix in ('svg', 'png'):
                path = Path(directory, '公式.' + suffix)
                atomic_write(path, self.result[suffix])
                recovered = read_source(path)
                self.assertEqual(recovered['source'], self.result['source'])
                self.assertEqual(recovered['point_size'], 32)
            svg = xml(self.result['svg'])
            self.assertAlmostEqual(float(svg.get('width')[:-2]), self.result['width'])
            with Image.open(io.BytesIO(self.result['png'])) as image:
                self.assertAlmostEqual(image.width * 72 / image.info['dpi'][0], self.result['width'], places=1)
                self.assertEqual(decode_meta(image.info[PNG_KEY])['tags']['OUTPUTTYPE'], 'PNG')

    def test_exported_pptx_reopens_with_matching_size_and_source(self):
        data = formula_pptx(self.result)
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory, 'formula.pptx'); path.write_bytes(data)
            recovered = read_source(path)
            self.assertEqual(recovered['source'], self.result['source'])
            self.assertEqual(recovered['point_size'], 32)
        record = Deck(data).records()[0]
        ext = record['shape'].find('p:spPr/a:xfrm/a:ext', NS)
        self.assertAlmostEqual(int(ext.get('cx')) / EMU_PT, self.result['width'], places=3)
        self.assertAlmostEqual(int(ext.get('cy')) / EMU_PT, self.result['height'], places=3)

    def test_plain_image_is_not_mistaken_for_embedded_source(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory, 'screen.png')
            Image.new('RGB', (30, 20), 'white').save(path)
            self.assertTrue(load_image(path).startswith(b'\x89PNG'))
            with self.assertRaisesRegex(ValueError, '没有内嵌'):
                read_source(path)

    def test_failed_atomic_save_preserves_previous_file(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory, 'formula.tex'); path.write_bytes(b'original')
            with patch('desktop_support.os.replace', side_effect=OSError('disk full')):
                with self.assertRaises(OSError):
                    atomic_write(path, b'replacement')
            self.assertEqual(path.read_bytes(), b'original')
            self.assertEqual(list(Path(directory).iterdir()), [path])


class DesktopServiceTests(unittest.TestCase):
    def test_reuses_service_and_refreshes_expired_token_without_stopping_owner(self):
        with tempfile.TemporaryDirectory() as directory, patch('desktop_support.state_dir', return_value=Path(directory)):
            owner = LocalService(0)
            self.addCleanup(owner.close)
            guest = LocalService(int(owner.base.rsplit(':', 1)[1]))
            guest.token = 'stale-token'
            self.assertIn('xelatex', guest.call('doctor'))
            self.assertEqual(guest.servers, [])
            guest.close()
            self.assertIn('xelatex', owner.call('doctor'))

    def test_service_errors_remain_readable(self):
        with tempfile.TemporaryDirectory() as directory, patch('desktop_support.state_dir', return_value=Path(directory)):
            service = LocalService(0)
            self.addCleanup(service.close)
            with self.assertRaisesRegex(ValueError, '图片'):
                service.call('ocr/start', {'data': 'not-image'})

    def test_local_service_never_follows_redirects(self):
        with self.assertRaisesRegex(ValueError, '重定向'):
            NoRedirect().redirect_request(None, None, 302, '', {}, 'https://example.com/')
