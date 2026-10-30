import base64
import io
import json
import os
from pathlib import Path
import tempfile
import threading
import time
import unittest
from unittest.mock import patch
import urllib.error
import urllib.request

from ai_chat import (ApiSettings, ChatJobs, OpenAIClient, ENDPOINT, DEFAULT_MODEL, INSTRUCTIONS, INSTRUCTIONS_FILE,
                     MAX_INSTRUCTIONS, NoRedirect, ProjectInstructions, latex_blocks)
from app import create_server
from ocr import Cancelled, TERMINAL
from test_ocr import image64

ANSWER = '说明文字。\n```latex\n\\documentclass{article}\n\\begin{document}\n$x$\n\\end{document}\n```\n可以继续追问。'


def stream(*events):
    return b''.join(b'data: ' + (e if isinstance(e, bytes) else json.dumps(e).encode()) + b'\n\n' for e in events)


def delta(text='', finish=None, **extra):
    return {'choices': [{'delta': {'content': text, **extra}, 'finish_reason': finish}]}


class Opener:
    def __init__(self, data=None, error=None):
        self.data, self.error, self.calls = data, error, []

    def open(self, request, timeout):
        self.calls.append((request, timeout))
        if self.error:
            raise self.error
        return io.BytesIO(self.data)


class ApiSettingsTests(unittest.TestCase):
    def setUp(self):
        td = tempfile.TemporaryDirectory(); self.addCleanup(td.cleanup)
        self.settings = ApiSettings(td.name)
        env = patch.dict(os.environ, {}, clear=True); env.start(); self.addCleanup(env.stop)

    def test_saved_key_is_private_and_never_returned(self):
        public = self.settings.save({'api_key': 'secret-example'})
        self.assertTrue(public['configured'])
        self.assertNotIn('secret-example', json.dumps(public))
        self.assertEqual(self.settings.credentials(), ('secret-example', DEFAULT_MODEL))
        if os.name != 'nt': self.assertEqual(self.settings.path.stat().st_mode & 0o777, 0o600)
        self.settings.save({'api_key': '', 'model': 'another-model'})
        self.assertEqual(self.settings.credentials(), ('secret-example', 'another-model'))
        self.assertFalse(self.settings.save({'clear_key': True})['configured'])
        with self.assertRaisesRegex(ValueError, 'API Key'): self.settings.credentials()

    def test_deepseek_settings_and_environment_are_not_used_for_openai(self):
        (self.settings.directory / 'deepseek-api.json').write_text(json.dumps({'api_key': 'old-deepseek-key', 'model': 'deepseek-flash'}))
        with patch.dict(os.environ, {'DEEPSEEK_API_KEY': 'old-env-key'}):
            self.assertFalse(self.settings.public()['configured'])
            with self.assertRaisesRegex(ValueError, 'API Key'):
                self.settings.credentials()
        self.assertEqual(self.settings.public()['model'], 'gpt-6-astra')

    def test_shared_key_and_precedence(self):
        self.settings.shared_key_path.write_text('repository-secret\n')
        self.assertEqual(self.settings.credentials()[0], 'repository-secret')
        self.assertEqual(self.settings.public()['key_source'], '仓库密钥')
        with patch.dict(os.environ, {'OPENAI_API_KEY': 'environment-secret'}):
            self.assertEqual(self.settings.credentials()[0], 'environment-secret')
            self.settings.save({'api_key': 'local-secret'})
            self.assertEqual(self.settings.credentials()[0], 'local-secret')

    def test_environment_key_and_validation(self):
        with patch.dict(os.environ, {'OPENAI_API_KEY': 'env-secret'}):
            self.assertEqual(self.settings.public()['key_source'], '环境变量')
            self.assertEqual(self.settings.credentials()[0], 'env-secret')
            self.settings.save({'api_key': 'local'})
            self.assertEqual(self.settings.credentials()[0], 'local')
            self.settings.save({'clear_key': True})
            self.assertEqual(self.settings.credentials()[0], 'env-secret')
        for req in ({'api_key': 'bad\nkey'}, {'api_key': 123}, {'model': '../bad'}, {'model': ''}):
            with self.assertRaises(ValueError): self.settings.save(req)
        self.assertNotIn('env-secret', self.settings.path.read_text())

    def test_bad_environment_key_is_rejected_without_echoing_secret(self):
        with patch.dict(os.environ, {'OPENAI_API_KEY': 'private-secret\n'}):
            with self.assertRaisesRegex(ValueError, '格式') as caught:
                self.settings.credentials()
            self.assertNotIn('private-secret', str(caught.exception))


class TransportTests(unittest.TestCase):
    def test_text_image_payload_full_stream_and_usage(self):
        data = stream(delta('说明', reasoning_content='do not show'), delta(ANSWER[4:]),
                      dict(delta(finish='stop'), usage={'total_tokens': 123, 'private': 'not needed'}), b'[DONE]')
        opener = Opener(data); updates = []
        messages = [{'role': 'user', 'content': [{'type': 'text', 'text': '说明图片'},
                    {'type': 'image_url', 'image_url': {'url': 'data:image/png;base64,' + image64()}}]}]
        result = OpenAIClient(opener).answer('secret', DEFAULT_MODEL, messages, updates.append, threading.Event())
        request = opener.calls[0][0]; body = json.loads(request.data)
        self.assertEqual(request.full_url, ENDPOINT)
        self.assertEqual(request.headers['Authorization'], 'Bearer secret')
        self.assertEqual(body['messages'][1:], messages)
        self.assertEqual(body['messages'][0]['role'], 'system')
        self.assertNotIn('thinking', body)
        self.assertNotIn('max_tokens', body)
        self.assertEqual(body['max_completion_tokens'], 8192)
        self.assertEqual(request.full_url, 'https://api.openai.com/v1/chat/completions')
        self.assertEqual(body['model'], 'gpt-6-astra')
        self.assertTrue(body['stream'])
        # A leading project system message is merged into the single system prompt.
        opener = Opener(data)
        OpenAIClient(opener).answer('secret', DEFAULT_MODEL, [{'role': 'system', 'content': '项目指令'}] + messages,
                                      updates.append, threading.Event())
        body = json.loads(opener.calls[0][0].data)
        self.assertEqual([m['role'] for m in body['messages']], ['system', 'user'])
        self.assertTrue(body['messages'][0]['content'].startswith(INSTRUCTIONS))
        self.assertTrue(body['messages'][0]['content'].endswith('项目指令'))
        self.assertEqual(result['answer'], '说明' + ANSWER[4:])
        self.assertNotIn('do not show', result['answer'])
        self.assertEqual(result['usage'], {'total_tokens': 123})
        self.assertEqual(result['latex_blocks'], latex_blocks(ANSWER))
        self.assertEqual(updates[-1], result['answer'])

    def test_partial_disconnect_length_and_bad_json_never_look_complete(self):
        for tail in (b'', stream(delta(finish='length'), b'[DONE]'), b'data: invalid\n', stream(b'[DONE]')):
            updates = []
            with self.assertRaises(ValueError):
                OpenAIClient(Opener(stream(delta('partial')) + tail)).answer('secret', DEFAULT_MODEL, [], updates.append, threading.Event())
            self.assertEqual(updates[-1], 'partial')

    def test_http_errors_do_not_expose_server_body_or_key_and_do_not_retry(self):
        for code in (400, 401, 402, 403, 404, 422, 429, 500):
            opener = Opener(error=urllib.error.HTTPError(ENDPOINT, code, 'secret', {}, io.BytesIO(b'secret')))
            with self.assertRaises(ValueError) as caught:
                OpenAIClient(opener).answer('secret', DEFAULT_MODEL, [], lambda x: None, threading.Event())
            self.assertNotIn('secret', str(caught.exception))
            self.assertEqual(len(opener.calls), 1)

    def test_cancel_and_timeout_and_redirect(self):
        event = threading.Event(); event.set(); opener = Opener(b'')
        with self.assertRaises(Cancelled):
            OpenAIClient(opener).answer('key', DEFAULT_MODEL, [], lambda x: None, event)
        self.assertEqual(opener.calls, [])
        with self.assertRaisesRegex(ValueError, '超时'):
            OpenAIClient(Opener(error=TimeoutError())).answer('key', DEFAULT_MODEL, [], lambda x: None, threading.Event())
        with self.assertRaisesRegex(ValueError, '重定向'):
            NoRedirect().redirect_request(None, None, 307, '', {}, 'https://other.example')

    def test_extracts_all_unique_latex_without_losing_slashes(self):
        result = latex_blocks(ANSWER + '\n```tex\n\\frac{a}{b}\n```\n```js\nalert(1)\n```')
        self.assertEqual(len(result), 2)
        self.assertEqual(result[-1], r'\frac{a}{b}')
        self.assertEqual(latex_blocks('```latex\nx\n```\n```latex\nx\n```'), ['x'])


class FakeBackend:
    def __init__(self):
        self.entered, self.release = threading.Event(), threading.Event()
        self.calls = []; self.fail = False

    def answer(self, key, model, messages, update, cancelled):
        self.calls.append(messages); update('partial'); self.entered.set()
        while not self.release.wait(.01):
            if cancelled.is_set(): raise Cancelled()
        if self.fail: raise ValueError('test failure')
        return {'answer': ANSWER, 'latex_blocks': latex_blocks(ANSWER), 'usage': {}}


class ChatJobTests(unittest.TestCase):
    def setUp(self):
        td = tempfile.TemporaryDirectory(); self.addCleanup(td.cleanup)
        self.guide = Path(td.name) / 'AI_INSTRUCTIONS.md'
        self.backend = FakeBackend(); self.jobs = ChatJobs(td.name, self.backend, self.guide)
        self.addCleanup(self.jobs.close)
        self.jobs.configure({'api_key': 'test-key'})

    def finished(self, job):
        deadline = time.monotonic() + 3
        while time.monotonic() < deadline:
            result = self.jobs.get(job['id'])
            if result['status'] in TERMINAL: return result
            time.sleep(.01)
        self.fail('job did not finish')

    def test_project_instructions_are_read_for_every_request(self):
        self.backend.release.set()
        self.assertEqual(self.jobs.project_instructions({}), {'path': str(self.guide), 'text': '', 'active_chars': 0})
        job = self.jobs.start({'message': 'a'}); self.finished(job)
        self.assertEqual(self.backend.calls[0][0]['role'], 'user')  # missing file: built-in rules only
        saved = self.jobs.project_instructions({'text': '<!-- 只给自己看 -->\n矩阵用 bmatrix。'})
        self.assertEqual(saved['active_chars'], len('矩阵用 bmatrix。'))
        job = self.jobs.start({'message': '识别图片', 'data': image64()}); self.finished(job)
        system = self.backend.calls[1][0]
        self.assertEqual(system['role'], 'system')
        self.assertTrue(system['content'].endswith('矩阵用 bmatrix。'))
        self.assertNotIn('只给自己看', system['content'])
        self.guide.write_text('直接编辑文件也立即生效。', encoding='utf-8')  # no restart needed
        job = self.jobs.start({'message': 'b', 'conversation_id': job['conversation_id'], 'revision': 1}); self.finished(job)
        self.assertTrue(self.backend.calls[2][0]['content'].endswith('直接编辑文件也立即生效。'))
        self.assertEqual(sum(m['role'] == 'system' for m in self.backend.calls[2]), 1)
        with self.assertRaisesRegex(ValueError, '精简'):
            self.jobs.project_instructions({'text': 'x' * (MAX_INSTRUCTIONS + 1)})
        self.guide.write_text('x' * (MAX_INSTRUCTIONS + 1), encoding='utf-8')
        with self.assertRaisesRegex(ValueError, '精简'):
            self.jobs.start({'message': 'c'})
        self.guide.write_bytes(b'\xff\xfe bad')
        with self.assertRaisesRegex(ValueError, 'UTF-8'):
            self.jobs.start({'message': 'c'})

    def test_project_instructions_file_is_usable(self):
        # The user edits this file freely; it only has to stay readable and within the limit.
        self.assertTrue(INSTRUCTIONS_FILE.exists())
        ProjectInstructions().effective()

    def test_text_image_followup_and_public_history(self):
        self.backend.release.set()
        job = self.jobs.start({'message': '请解释图片', 'data': image64()})
        self.assertEqual(self.finished(job)['status'], 'succeeded')
        cid = job['conversation_id']; history = self.jobs.history(cid)
        self.assertEqual(history['turns'][0]['answer'], ANSWER)
        self.assertNotIn('_image', history['turns'][0]); self.assertNotIn('test-key', str(history))
        content = self.backend.calls[0][0]['content']
        self.assertEqual(content[0]['text'], '请解释图片')
        self.assertTrue(content[1]['image_url']['url'].startswith('data:image/png;base64,'))
        second = self.jobs.start({'conversation_id': cid, 'revision': 1, 'message': '把 x 改为 y'})
        self.assertEqual(self.finished(second)['status'], 'succeeded')
        self.assertEqual(len(self.backend.calls[1]), 3)
        self.assertEqual(self.backend.calls[1][0], self.backend.calls[0][0])
        self.assertEqual(self.backend.calls[1][1], {'role': 'assistant', 'content': ANSWER})
        with self.assertRaisesRegex(ValueError, '其他窗口'):
            self.jobs.start({'conversation_id': cid, 'revision': 1, 'message': 'stale'})

    def test_busy_cancel_preserves_partial_and_excludes_failed_context(self):
        job = self.jobs.start({'data': image64()})
        self.assertTrue(self.backend.entered.wait(1))
        with self.assertRaisesRegex(ValueError, '已有'): self.jobs.start({'message': 'second'})
        with self.assertRaisesRegex(ValueError, '等待'): self.jobs.configure({'api_key': 'changed'})
        self.assertEqual(self.jobs.history(job['conversation_id'])['active_job'], job['id'])
        self.jobs.cancel(job['id'])
        self.assertEqual(self.finished(job)['status'], 'cancelled')
        turn = self.jobs.history(job['conversation_id'])['turns'][0]
        self.assertEqual(turn['answer'], 'partial'); self.assertEqual(turn['latex_blocks'], [])
        self.assertIsNone(self.jobs.conversations[job['conversation_id']][0]['_image'])
        self.backend.release.set()
        second = self.jobs.start({'message': 'new', 'conversation_id': job['conversation_id'], 'revision': 1})
        self.assertEqual(self.finished(second)['status'], 'succeeded')
        self.assertEqual(len(self.backend.calls[1]), 1)

    def test_failure_and_validation_never_send_bad_inputs(self):
        for req in ({}, {'message': 123}, {'message': 'x' * 8001}, {'data': 'not an image'}, {'message': 'x', 'conversation_id': []}):
            with self.assertRaises(ValueError): self.jobs.start(req)
        self.assertEqual(self.backend.calls, [])
        self.backend.release.set(); self.backend.fail = True
        job = self.jobs.start({'message': 'test'})
        self.assertEqual(self.finished(job)['status'], 'failed')
        self.assertEqual(self.jobs.history(job['conversation_id'])['turns'][0]['error'], 'test failure')

    def test_missing_key_never_calls_backend_and_history_is_bounded(self):
        self.jobs.configure({'clear_key': True})
        with patch.dict(os.environ, {}, clear=True), self.assertRaisesRegex(ValueError, 'API Key'):
            self.jobs.start({'message': 'x'})
        self.assertEqual(self.backend.calls, [])
        self.jobs.configure({'api_key': 'new'}); self.backend.release.set()
        for i in range(6): self.finished(self.jobs.start({'message': str(i)}))
        self.assertEqual(len(self.jobs.conversations), 5)
        cid = next(iter(self.jobs.conversations)); turns = self.jobs.conversations[cid]
        turns.extend([dict(turns[0])] * 19)
        with self.assertRaisesRegex(ValueError, '20 轮'):
            self.jobs.start({'message': 'x', 'conversation_id': cid, 'revision': 20})


class ChatHttpTests(unittest.TestCase):
    def test_protected_routes_config_and_job_end_to_end(self):
        with tempfile.TemporaryDirectory() as td:
            backend = FakeBackend(); backend.release.set()
            server = create_server(cache_dir=td, chat_options={'directory': td, 'backend': backend})
            worker = threading.Thread(target=server.serve_forever); worker.start()
            try:
                base = 'http://127.0.0.1:' + str(server.server_port)
                with urllib.request.urlopen(base + '/api/session') as res: token = json.load(res)['token']
                def post(route, body, auth=token, origin=None):
                    headers = {'X-Bridge-Token': auth, 'Content-Type': 'application/json'}
                    if origin: headers['Origin'] = origin
                    with urllib.request.urlopen(urllib.request.Request(base + '/api/chat/' + route, data=json.dumps(body).encode(), headers=headers)) as res:
                        return json.load(res)
                for auth, origin in (('', None), (token, 'https://other.example')):
                    with self.assertRaises(urllib.error.HTTPError) as caught: post('config', {'api_key': 'secret'}, auth, origin)
                    self.assertEqual(caught.exception.code, 403)
                    caught.exception.close()
                config = post('config', {'api_key': 'secret'})
                self.assertNotIn('secret', str(config))
                job = post('start', {'message': 'text', 'data': image64()})
                for i in range(100):
                    result = post('status', {'id': job['id']})
                    if result['status'] in TERMINAL: break
                    time.sleep(.01)
                self.assertEqual(result['status'], 'succeeded')
                self.assertEqual(post('history', {'conversation_id': job['conversation_id']})['turns'][0]['answer'], ANSWER)
                for asset in ('/shared/chat.js', '/shared/chat.css'):
                    with urllib.request.urlopen(base + asset) as response: self.assertEqual(response.status, 200)
            finally:
                server.shutdown(); worker.join(); server.server_close()


if __name__ == '__main__':
    unittest.main()
