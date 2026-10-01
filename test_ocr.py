import base64
import io
import json
from pathlib import Path
import tempfile
import threading
import time
import unittest
from unittest.mock import patch

from PIL import Image, PngImagePlugin

from ocr import (Cancelled, DeepSeekBrowser, OcrJobs, TERMINAL, browser_environment, extract_tex,
                 prepare_image, MAX_IMAGE_BYTES)


def image64():
    output = io.BytesIO()
    info = PngImagePlugin.PngInfo(); info.add_text('private', 'should not leave the machine')
    Image.new('RGBA', (40, 20), (0, 0, 0, 0)).save(output, format='PNG', pnginfo=info)
    return base64.b64encode(output.getvalue()).decode()


class OcrInputTests(unittest.TestCase):
    def test_linux_background_service_refreshes_only_graphical_environment(self):
        from types import SimpleNamespace
        with patch('ocr.sys.platform', 'linux'), patch.dict('ocr.os.environ', {'PATH': '/bin'}, clear=True), \
                patch('ocr.subprocess.run', return_value=SimpleNamespace(returncode=0, stdout='DISPLAY=:1\nXAUTHORITY=/run/auth\nUNRELATED_SECRET=not-copied\n')):
            env = browser_environment()
        self.assertEqual(env['DISPLAY'], ':1')
        self.assertEqual(env['XAUTHORITY'], '/run/auth')
        self.assertNotIn('UNRELATED_SECRET', env)

    def test_validates_pixels_and_removes_metadata(self):
        with Image.open(io.BytesIO(prepare_image(image64()))) as im:
            self.assertNotIn('private', im.info)
            self.assertEqual(im.mode, 'RGB')
            self.assertEqual(im.getpixel((0, 0)), (255, 255, 255))

    def test_rejects_non_images_and_excess_size(self):
        for data in (None, '', 'not base64', base64.b64encode(b'<svg/>').decode(), 'a' * (MAX_IMAGE_BYTES * 2)):
            with self.assertRaises(ValueError): prepare_image(data)
        with patch('ocr.MAX_PIXELS', 100):
            with self.assertRaisesRegex(ValueError, '像素'): prepare_image(image64())

    def test_extracts_complete_tex_preserving_case_and_newlines(self):
        text = '说明\nBEGIN_test\n```latex\n\\[A x=\\tau\\\\ B=y\\]\n```\nEND_test\n'
        self.assertEqual(extract_tex(text, 'test'), r'A x=\tau\\ B=y')
        self.assertEqual(extract_tex('```tex\nx=y\n```'), 'x=y')
        self.assertEqual(extract_tex('BEGIN_test\n$$x=y$$\nEND_test', 'test'), 'x=y')

    def test_rejects_partial_or_missing_answer_and_unreadable(self):
        for text in ('BEGIN_test\nx=y', 'The formula is x=y', 'BEGIN_other\nx=y\nEND_other',
                     'BEGIN_test\nUNREADABLE\nEND_test', 'BEGIN_test\n\nEND_test'):
            with self.assertRaises(ValueError): extract_tex(text, 'test')
        with self.assertRaises(ValueError): extract_tex('```tex\nx\n```\n```tex\ny\n```')

    def test_markers_inside_code_block_preserve_matrix_row_breaks(self):
        source = '\\begin{aligned}\nE &= mc^2, \\\\\n\\mathbf{A} &= \\begin{bmatrix}1 & 2 \\\\ 3 & 4\\end{bmatrix}\n\\end{aligned}'
        # DeepSeek adds a code block toolbar outside the verbatim source.
        text = 'latex\n复制\nBEGIN_test\n' + source + '\nEND_test'
        self.assertEqual(extract_tex(text, 'test'), source)

    def test_rejects_unknown_selector_config(self):
        with tempfile.TemporaryDirectory() as td:
            path = Path(td, 'selectors.json'); path.write_text(json.dumps({'url': 'http://invalid'}))
            with self.assertRaises(ValueError): OcrJobs(selectors_file=path)


class FakeBackend:
    def __init__(self):
        self.entered, self.release = threading.Event(), threading.Event()
        self.threads, self.calls = [], []
        self.fail = False

    def open(self):
        self.threads.append(threading.get_ident()); self.calls.append('open')

    def recognize(self, data, update, cancelled):
        self.open(); self.calls.append('recognize')
        update('recognizing', 'Working')
        self.entered.set()
        while not self.release.wait(.01):
            if cancelled.is_set(): raise Cancelled()
        if self.fail: raise ValueError('Login expired')
        return {'source': r'\frac{A}{b}', 'provider': 'deepseek-web'}

    def close(self):
        self.threads.append(threading.get_ident()); self.calls.append('close')


class OcrJobTests(unittest.TestCase):
    def setUp(self):
        self.backend = FakeBackend(); self.jobs = OcrJobs(backend=self.backend)
        self.addCleanup(self.jobs.close)

    def finished(self, jid):
        deadline = time.monotonic() + 3
        while time.monotonic() < deadline:
            result = self.jobs.get(jid)
            if result['status'] in TERMINAL: return result
            time.sleep(.01)
        self.fail('Job did not finish')

    def test_serializes_browser_work_and_returns_source(self):
        login = self.jobs.start({}, login=True)
        self.assertEqual(self.finished(login['id'])['status'], 'succeeded')
        job = self.jobs.start({'data': image64()})
        self.assertTrue(self.backend.entered.wait(1))
        with self.assertRaisesRegex(ValueError, '已有'): self.jobs.start({}, login=True)
        self.backend.release.set()
        result = self.finished(job['id'])
        self.assertEqual(result['source'], r'\frac{A}{b}')
        self.assertEqual(len(set(self.backend.threads)), 1)
        self.assertNotEqual(self.backend.threads[0], threading.get_ident())

    def test_cancels_inflight_job_and_can_start_next(self):
        job = self.jobs.start({'data': image64()})
        self.assertTrue(self.backend.entered.wait(1))
        self.jobs.cancel(job['id'])
        self.assertEqual(self.finished(job['id'])['status'], 'cancelled')
        self.backend.release.set()
        second = self.jobs.start({'data': image64()})
        self.assertEqual(self.finished(second['id'])['status'], 'succeeded')

    def test_failure_is_reported_and_invalid_input_never_opens_browser(self):
        with self.assertRaises(ValueError): self.jobs.start({'data': 'bad'})
        self.assertEqual(self.backend.calls, [])
        self.backend.fail = True; self.backend.release.set()
        result = self.finished(self.jobs.start({'data': image64()})['id'])
        self.assertEqual(result['status'], 'failed')
        self.assertEqual(result['message'], 'Login expired')


class Locator:
    def __init__(self, page, kind): self.page, self.kind = page, kind
    @property
    def first(self): return self
    def count(self):
        return 0 if self.kind in ('busy', 'error', 'stop') or self.kind == 'file' and not self.page.has_file else 1
    def is_visible(self): return self.count() > 0
    def evaluate_all(self, script): return self.count() > 0
    def is_editable(self): return True
    def set_input_files(self, data): self.page.upload = data
    def fill(self, text): self.page.prompt = text
    def press(self, key): self.page.sent = True
    def all_inner_texts(self):
        marker = self.page.prompt.split('BEGIN_')[1].split('\n')[0]
        # Include the user prompt too, to verify it is never accepted as output.
        return [self.page.prompt, 'BEGIN_' + marker + '\n\\frac{A}{b}\nEND_' + marker]


class FakePage:
    has_file = True
    sent = False
    def locator(self, selector): return Locator(self, selector)
    def get_by_text(self, *a, **kw): return Locator(self, 'attachment')
    def get_by_role(self, *a, **kw): return Locator(self, 'attachment')
    def goto(self, *a, **kw): pass
    def is_closed(self): return False
    def wait_for_timeout(self, *a): pass


class BrowserFlowTests(unittest.TestCase):
    def test_cleanup_after_user_closes_browser_is_recoverable(self):
        from unittest.mock import Mock
        browser = DeepSeekBrowser('/unused')
        browser.context = Mock(); browser.context.close.side_effect = RuntimeError('Already closed')
        browser.playwright = Mock(); driver = browser.playwright
        browser.close()
        driver.stop.assert_called_once()
        self.assertIsNone(browser.context)
        self.assertIsNone(browser.page)

    def browser(self, page):
        browser = DeepSeekBrowser('/unused', selectors=dict(composer='composer', file_input='file',
             upload_busy='busy', upload_error='error', response='response', stop_button='stop'))
        browser.open = lambda: page
        return browser

    def test_upload_and_complete_response_contract(self):
        page = FakePage(); steps = []
        with patch('ocr.time.monotonic', side_effect=iter(range(1000))):
            result = self.browser(page).recognize(b'validated image', lambda *x: steps.append(x), threading.Event())
        self.assertTrue(page.sent)
        self.assertIn('```latex\nBEGIN_', page.prompt)
        self.assertEqual(page.upload['buffer'], b'validated image')
        self.assertEqual(result['source'], r'\frac{A}{b}')
        self.assertEqual([x[0] for x in steps], ['waiting_user', 'uploading', 'recognizing'])

    def test_missing_upload_control_never_sends_prompt(self):
        page = FakePage(); page.has_file = False
        with self.assertRaisesRegex(ValueError, '上传入口'):
            self.browser(page).recognize(b'image', lambda *x: None, threading.Event())
        self.assertFalse(page.sent)

    def test_image_alt_attachment_and_transparent_spinner_are_accepted(self):
        class ImageOnlyLocator(Locator):
            def count(self): return 0 if self.kind == 'text_attachment' else super().count()
            def is_visible(self):
                if self.kind == 'busy': return True  # Playwright ignores opacity.
                return super().is_visible()
            def evaluate_all(self, script):
                if self.kind == 'busy':
                    self.page.checked_opacity = 'style.opacity' in script
                    return False  # Spinner's ancestor has opacity: 0.
                return super().evaluate_all(script)
        class ImageOnlyPage(FakePage):
            def locator(self, selector): return ImageOnlyLocator(self, selector)
            def get_by_text(self, *a, **kw): return ImageOnlyLocator(self, 'text_attachment')
            def get_by_role(self, role, **kw):
                self.image_alt = kw['name']
                return ImageOnlyLocator(self, 'image_attachment')
        page = ImageOnlyPage()
        with patch('ocr.time.monotonic', side_effect=iter(range(1000))):
            result = self.browser(page).recognize(b'image', lambda *x: None, threading.Event())
        self.assertEqual(result['source'], r'\frac{A}{b}')
        self.assertEqual(page.image_alt, page.upload['name'])
        self.assertTrue(page.checked_opacity)

    def test_cancel_before_upload(self):
        page = FakePage(); event = threading.Event(); event.set()
        with self.assertRaises(Cancelled): self.browser(page).recognize(b'image', lambda *x: None, event)
        self.assertFalse(page.sent)


if __name__ == '__main__': unittest.main()
