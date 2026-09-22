#!/usr/bin/env python3
"""Local-only browser UI. Run: python app.py"""
import argparse
import base64
import json
from pathlib import Path
import secrets
import threading
import webbrowser
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlsplit

from bridge import Deck, render, public_records, doctor
from wps_support import WpsBridge


def create_server(port=0, cache_dir=None):
    state = {'deck': None, 'name': 'formulas.pptx'}
    lock = threading.Lock()
    token = secrets.token_urlsafe(32)
    wps_bridge = WpsBridge(cache_dir)

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
            return self.headers.get('Host') == f'127.0.0.1:{self.server.server_port}'

        def do_GET(self):
            if not self.allowed():
                self.reply({'error': 'Invalid Host'}, 403)
                return
            path = urlsplit(self.path).path
            if path == '/api/session':
                origin = self.headers.get('Origin')
                if origin and origin != f'http://127.0.0.1:{self.server.server_port}':
                    self.reply({'error': 'Invalid Origin'}, 403)
                    return
                self.reply({'token': token})
                return
            if path == '/health':
                self.reply({'app': 'IguanaTexBridge', 'version': '0.3.3'})
                return
            assets = {'/': ('ui.html', 'text/html; charset=utf-8'),
                      '/wps/': ('wps_addin/index.html', 'text/html; charset=utf-8'),
                      '/wps/index.html': ('wps_addin/index.html', 'text/html; charset=utf-8'),
                      '/wps/editor.html': ('wps_addin/editor.html', 'text/html; charset=utf-8'),
                      '/wps/main.js': ('wps_addin/main.js', 'application/javascript'),
                      '/wps/adapter.js': ('wps_addin/adapter.js', 'application/javascript'),
                      '/wps/editor.js': ('wps_addin/editor.js', 'application/javascript'),
                      '/wps/style.css': ('wps_addin/style.css', 'text/css'),
                      '/wps/ribbon.xml': ('wps_addin/ribbon.xml', 'application/xml')}
            if path not in assets:
                self.reply({'error': 'Not found'}, 404)
                return
            filename, content_type = assets[path]
            data = Path(__file__).parent.joinpath(filename).read_text(encoding='utf-8').replace('__TOKEN__', token).encode()
            self.send_response(200)
            self.send_header('Content-Type', content_type)
            self.send_header('Content-Length', str(len(data)))
            self.send_header('Cache-Control', 'no-store')
            if not path.startswith('/wps/'):
                self.send_header('X-Frame-Options', 'DENY')
            self.send_header('X-Content-Type-Options', 'nosniff')
            self.end_headers()
            self.wfile.write(data)

        def do_POST(self):
            if not self.allowed() or self.headers.get('X-Bridge-Token') != token:
                self.reply({'error': 'Invalid local session'}, 403)
                return
            origin = self.headers.get('Origin')
            if origin and origin != f'http://127.0.0.1:{self.server.server_port}':
                self.reply({'error': 'Invalid Origin'}, 403)
                return
            try:
                size = int(self.headers.get('Content-Length', '0'))
                if not 0 < size <= 80_000_000:
                    raise ValueError('文件过大；请使用小于 50 MB 的 PPTX。')
                req = json.loads(self.rfile.read(size))
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
            elif op == '/api/wps/render':
                return wps_bridge.render(req)
            elif op == '/api/wps/metadata':
                return wps_bridge.metadata(req)
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

    server = ThreadingHTTPServer(('127.0.0.1', port), Handler)
    server.daemon_threads = True
    return server


def main():
    parser = argparse.ArgumentParser(description='IguanaTex Bridge 本地公式编辑器 / WPS 加载项服务')
    parser.add_argument('--port', type=int, default=0)
    parser.add_argument('--no-browser', action='store_true')
    parser.add_argument('--doctor', action='store_true')
    args = parser.parse_args()
    if args.doctor:
        print(json.dumps(doctor(), ensure_ascii=False, indent=2))
        return
    server = create_server(args.port)
    url = f'http://127.0.0.1:{server.server_port}/'
    print('IguanaTex Bridge 0.3.3，按 Ctrl+C 退出。', flush=True)
    print('本地界面：' + url, flush=True)
    if not args.no_browser:
        webbrowser.open(url)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == '__main__':
    main()
