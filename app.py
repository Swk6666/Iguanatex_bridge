#!/usr/bin/env python3
"""Local-only browser UI. Run: python app.py"""
import argparse
import base64
import json
from pathlib import Path
import secrets
import ssl
import threading
import webbrowser
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlsplit

from bridge import Deck, render, public_records, doctor
from wps_support import WpsBridge
from ocr import OcrJobs
from ai_chat import ChatJobs
from latex_source import complete_source, replace_formula, DEFAULT_FORMULA


def create_server(port=0, cache_dir=None, tls=None, shared=None, ocr_options=None, chat_options=None):
    shared = shared if shared is not None else {}
    owner = not shared
    if owner:
        shared.update(state={'deck': None, 'name': 'formulas.pptx'}, lock=threading.Lock(),
                      token=secrets.token_urlsafe(32), renderer=WpsBridge(cache_dir),
                      ocr=OcrJobs(**(ocr_options or {})), chat=ChatJobs(**(chat_options or {})))
    state, lock, token = shared['state'], shared['lock'], shared['token']
    wps_bridge, ocr = shared['renderer'], shared['ocr']
    chat = shared['chat']

    class Handler(BaseHTTPRequestHandler):
        def reply(self, obj, code=200):
            data = json.dumps(obj, ensure_ascii=False).encode()
            self.send_response(code)
            self.send_header('Content-Type', 'application/json; charset=utf-8')
            self.send_header('Content-Length', str(len(data)))
            self.send_header('Cache-Control', 'no-store')
            self.send_header('X-Content-Type-Options', 'nosniff')
            self.end_headers()
            self.wfile.write(data)

        def allowed(self):
            hosts = ['127.0.0.1', 'localhost'] if tls else ['127.0.0.1']
            return self.headers.get('Host') in [f'{h}:{self.server.server_port}' for h in hosts]

        def valid_origin(self):
            origin = self.headers.get('Origin')
            scheme = 'https' if tls else 'http'
            return not origin or origin == f'{scheme}://{self.headers.get("Host")}'

        def do_GET(self):
            if not self.allowed():
                self.reply({'error': 'Invalid Host'}, 403)
                return
            path = urlsplit(self.path).path
            if path == '/api/session':
                if not self.valid_origin():
                    self.reply({'error': 'Invalid Origin'}, 403)
                    return
                self.reply({'token': token})
                return
            if path == '/health':
                self.reply({'app': 'IguanaTexBridge', 'version': '0.6.1'})
                return
            assets = {'/': ('ui.html', 'text/html; charset=utf-8'),
                      '/wps/': ('wps_addin/index.html', 'text/html; charset=utf-8'),
                      '/wps/index.html': ('wps_addin/index.html', 'text/html; charset=utf-8'),
                      '/wps/editor.html': ('wps_addin/editor.html', 'text/html; charset=utf-8'),
                      '/wps/main.js': ('wps_addin/main.js', 'application/javascript'),
                      '/wps/adapter.js': ('wps_addin/adapter.js', 'application/javascript'),
                      '/wps/editor.js': ('wps_addin/editor.js', 'application/javascript'),
                      '/wps/style.css': ('wps_addin/style.css', 'text/css'),
                      '/wps/ribbon.xml': ('wps_addin/ribbon.xml', 'application/xml'),
                      '/shared/ocr.js': ('shared/ocr.js', 'application/javascript'),
                      '/shared/latex.js': ('shared/latex.js', 'application/javascript'),
                      '/shared/ocr.css': ('shared/ocr.css', 'text/css'),
                      '/shared/chat.js': ('shared/chat.js', 'application/javascript'),
                      '/shared/chat.css': ('shared/chat.css', 'text/css'),
                      '/shared/workspace.css': ('shared/workspace.css', 'text/css'),
                      '/shared/workspace.js': ('shared/workspace.js', 'application/javascript'),
                      '/office/': ('office_addin/taskpane.html', 'text/html; charset=utf-8'),
                      '/office/taskpane.html': ('office_addin/taskpane.html', 'text/html; charset=utf-8'),
                      '/office/adapter.js': ('office_addin/adapter.js', 'application/javascript'),
                      '/office/taskpane.js': ('office_addin/taskpane.js', 'application/javascript'),
                      '/office/style.css': ('office_addin/style.css', 'text/css'),
                      '/office/icon.png': ('office_addin/icon.png', 'image/png')}
            if path not in assets:
                self.reply({'error': 'Not found'}, 404)
                return
            filename, content_type = assets[path]
            asset = Path(__file__).parent.joinpath(filename)
            data = asset.read_bytes() if content_type == 'image/png' else asset.read_text(encoding='utf-8').replace('__TOKEN__', token).encode()
            self.send_response(200)
            self.send_header('Content-Type', content_type)
            self.send_header('Content-Length', str(len(data)))
            self.send_header('Cache-Control', 'no-store')
            if not path.startswith(('/wps/', '/office/')):
                self.send_header('X-Frame-Options', 'DENY')
            self.send_header('X-Content-Type-Options', 'nosniff')
            self.end_headers()
            self.wfile.write(data)

        def do_POST(self):
            if not self.allowed() or self.headers.get('X-Bridge-Token') != token:
                self.reply({'error': 'Invalid local session'}, 403)
                return
            if not self.valid_origin():
                self.reply({'error': 'Invalid Origin'}, 403)
                return
            try:
                size = int(self.headers.get('Content-Length', '0'))
                if not 0 < size <= 80_000_000:
                    raise ValueError('文件过大；请使用小于 50 MB 的 PPTX。')
                req = json.loads(self.rfile.read(size))
                if not isinstance(req, dict):
                    raise ValueError('请求必须为 JSON 对象。')
                with lock:
                    result = self.action(req)
                self.reply(result)
            except Exception as e:
                self.reply({'error': str(e)}, 400)

        def action(self, req):
            op = self.path
            if op == '/api/new':
                state.update(deck=Deck.blank(), name='formulas.pptx')
            elif op == '/api/load':
                name = Path(req.get('name', 'formulas.pptx')).name
                if not name.lower().endswith('.pptx'):
                    raise ValueError('请选择 .pptx 文件。')
                deck = Deck(base64.b64decode(req['data'], validate=True))
                state.update(deck=deck, name=name)
            elif op == '/api/doctor':
                return doctor()
            elif op == '/api/latex/source':
                source = req.get('source', DEFAULT_FORMULA)
                base = req.get('base')
                if base is not None and not isinstance(base, str):
                    raise ValueError('原文必须是字符串。')
                return {'source': complete_source(source) if base is None else replace_formula(base, source)}
            elif op in ('/api/wps/render', '/api/render'):
                return wps_bridge.render(req)
            elif op in ('/api/wps/metadata', '/api/metadata'):
                return wps_bridge.metadata(req)
            elif op == '/api/ocr/login':
                return ocr.start(req, login=True)
            elif op == '/api/ocr/start':
                return ocr.start(req)
            elif op == '/api/ocr/status':
                return ocr.get(req.get('id'))
            elif op == '/api/ocr/cancel':
                return ocr.cancel(req.get('id'))
            elif op == '/api/chat/config':
                return chat.configure(req)
            elif op == '/api/chat/start':
                return chat.start(req)
            elif op == '/api/chat/history':
                return chat.history(req.get('conversation_id'))
            elif op == '/api/chat/status':
                return chat.get(req.get('id'))
            elif op == '/api/chat/cancel':
                return chat.cancel(req.get('id'))
            elif op == '/api/preview':
                result = render(req['source'], req.get('engine', 'xelatex'))
                return {'png': base64.b64encode(result.png).decode(), 'source': result.source}
            elif state['deck'] is None:
                raise ValueError('请先打开 PPTX 或新建空白 PPTX。')
            elif op == '/api/apply':
                result = render(req['source'], req.get('engine', 'xelatex'))
                # Commit only after the entire edit succeeds.
                edited = Deck(state['deck'].bytes())
                sid = edited.add_or_update(result, int(req['slide']), req.get('shape_id'))
                state['deck'] = edited
                return dict(public_records(edited), selected=sid, name=state['name'])
            elif op in ('/api/save', '/api/protect'):
                edited = Deck(state['deck'].bytes())
                count = edited.protect()
                state['deck'] = edited
                if op == '/api/save':
                    return {'name': Path(state['name']).stem + '_bridge.pptx',
                            'data': base64.b64encode(edited.bytes()).decode(), 'count': count}
            elif op == '/api/sources':
                return {'name': Path(state['name']).stem + '_sources.json',
                        'version': 1, 'equations': state['deck'].inventory()}
            else:
                raise ValueError('Unknown operation')
            return dict(public_records(state['deck']), name=state['name'])

        def log_message(self, fmt, *values):
            # Log only HTTP method/path/status, never formula source or session tokens.
            print(fmt % values, flush=True)

    class Server(ThreadingHTTPServer):
        def server_close(self):
            super().server_close()
            if owner:
                ocr.close()
                chat.close()

    server = Server(('127.0.0.1', port), Handler)
    server.daemon_threads = True
    if tls:
        try:
            context = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
            context.minimum_version = ssl.TLSVersion.TLSv1_2
            context.load_cert_chain(*tls)
            server.socket = context.wrap_socket(server.socket, server_side=True)
        except Exception:
            server.server_close()
            raise
    return server


def main():
    parser = argparse.ArgumentParser(description='IguanaTex Bridge 本地公式编辑器 / WPS 加载项服务')
    parser.add_argument('--port', type=int, default=0)
    parser.add_argument('--no-browser', action='store_true')
    parser.add_argument('--doctor', action='store_true')
    parser.add_argument('--tls-cert', help='PowerPoint HTTPS 证书')
    parser.add_argument('--tls-key', help='PowerPoint HTTPS 私钥')
    parser.add_argument('--https-port', type=int, default=17864)
    parser.add_argument('--ocr-browser', choices=['chrome', 'msedge', 'chromium'], default='chrome')
    parser.add_argument('--ocr-selectors', help='DeepSeek 网页选择器 JSON 文件')
    args = parser.parse_args()
    if args.doctor:
        print(json.dumps(doctor(), ensure_ascii=False, indent=2))
        return
    if bool(args.tls_cert) != bool(args.tls_key):
        parser.error('--tls-cert 与 --tls-key 必须同时提供')
    shared = {}
    server = create_server(args.port, shared=shared,
                           ocr_options={'channel': args.ocr_browser, 'selectors_file': args.ocr_selectors})
    secure = None
    if args.tls_cert:
        try:
            secure = create_server(args.https_port, tls=(args.tls_cert, args.tls_key), shared=shared)
        except Exception:
            server.server_close()
            raise
        threading.Thread(target=secure.serve_forever, daemon=True).start()
        print(f'PowerPoint 加载项：https://localhost:{secure.server_port}/office/', flush=True)
    url = f'http://127.0.0.1:{server.server_port}/'
    print('IguanaTex Bridge 0.6.1，按 Ctrl+C 退出。', flush=True)
    print('本地界面：' + url, flush=True)
    if not args.no_browser:
        webbrowser.open(url)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        if secure:
            secure.shutdown()
            secure.server_close()
        server.server_close()


if __name__ == '__main__':
    main()
