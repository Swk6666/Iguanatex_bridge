"""Desktop operations independent of Qt; a local service is shared with add-ins."""
from __future__ import annotations

import base64
import errno
import io
import json
import os
from pathlib import Path
import tempfile
import threading
from urllib.error import HTTPError, URLError
from urllib.request import (HTTPRedirectHandler, ProxyHandler, Request,
                            build_opener)

from PIL import Image, PngImagePlugin

from bridge import (Deck, EMU_PT, NS, PNG_KEY, Rendered, decode_meta, dump,
                    encode_meta, xml)
from ocr import MAX_IMAGE_BYTES, prepare_image
from paths import state_dir
from wps_support import WpsBridge


class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        raise ValueError('本地服务不能重定向到其他地址。')


class LocalService:
    """Reuse the running Bridge, or own one until this desktop window closes."""
    def __init__(self, port=17863, channel='chrome', selectors_file=None):
        self.servers = []
        self.opener = build_opener(ProxyHandler({}), NoRedirect())
        self.base = f'http://127.0.0.1:{port}'
        self.token = None
        try:
            health = self._request('/health', timeout=1)
            if health.get('app') != 'IguanaTexBridge' or health.get('version') != '0.5.0':
                raise ValueError('端口被其他服务或旧版本占用。')
        except (OSError, URLError, ValueError):
            from app import create_server
            shared = {}
            options = {'channel': channel, 'selectors_file': selectors_file}
            try:
                server = create_server(port, shared=shared, ocr_options=options)
            except OSError as error:
                if error.errno not in (errno.EADDRINUSE, 10048):
                    raise
                shared = {}
                server = create_server(0, shared=shared, ocr_options=options)
            self.base = f'http://127.0.0.1:{server.server_port}'
            self.servers.append(server)
            threading.Thread(target=server.serve_forever, daemon=True).start()
            # Reuse already prepared certificates; never change OS trust here.
            office = state_dir() / 'office'
            cert, key = office / 'localhost.pem', office / 'localhost-key.pem'
            if cert.is_file() and key.is_file():
                try:
                    secure = create_server(17864, tls=(cert, key), shared=shared)
                except (OSError, ValueError):
                    pass  # Standalone GUI works without the optional Office host.
                else:
                    self.servers.append(secure)
                    threading.Thread(target=secure.serve_forever, daemon=True).start()

    def _request(self, path, payload=None, timeout=65):
        data = json.dumps(payload).encode() if payload is not None else None
        headers = {'Content-Type': 'application/json'}
        if self.token:
            headers['X-Bridge-Token'] = self.token
        with self.opener.open(Request(self.base + path, data=data, headers=headers), timeout=timeout) as response:
            return json.load(response)

    def call(self, action, payload=None):
        if self.token is None:
            self.token = self._request('/api/session')['token']
        for attempt in range(2):
            try:
                return self._request('/api/' + action, payload or {})
            except HTTPError as error:
                if error.code == 403 and attempt == 0:
                    error.close()
                    self.token = self._request('/api/session')['token']
                    continue
                try:
                    message = json.load(error).get('error', str(error))
                except (ValueError, AttributeError):
                    message = str(error)
                finally:
                    error.close()
                raise ValueError(message) from error
            except URLError as error:
                raise ValueError('本地服务已关闭，请重新打开桌面程序。') from error

    def close(self):
        for server in reversed(self.servers):
            server.shutdown()
            server.server_close()
        self.servers.clear()


def load_image(path):
    path = Path(path)
    if path.stat().st_size > MAX_IMAGE_BYTES:
        raise ValueError('图片不得超过 10 MB，请裁剪公式区域。')
    return prepare_image(base64.b64encode(path.read_bytes()).decode())


def render_formula(source, engine, point_size):
    result = WpsBridge().render(dict(source=source, engine=engine,
                                    point_size=point_size, output='svg'))
    # Set the exported asset's physical size, not only the on-screen preview.
    svg = xml(result['svg'].encode())
    svg.set('width', f"{result['width']}pt")
    svg.set('height', f"{result['height']}pt")
    result['svg'] = dump(svg)
    with Image.open(io.BytesIO(base64.b64decode(result['png']))) as image:
        tags = dict(result['tags'], OUTPUTTYPE='PNG', OUTPUTDPI='300',
                    ORIGINALWIDTH=str(image.width * .75), ORIGINALHEIGHT=str(image.height * .75))
        meta = dict(version=1, uid=tags['IGUANABRIDGEID'],
                    source=result['source'], engine=engine, tags=tags)
        info = PngImagePlugin.PngInfo()
        info.add_itxt(PNG_KEY, encode_meta(meta))
        png = io.BytesIO()
        dpi = image.width * 72 / result['width']
        image.save(png, format='PNG', pnginfo=info, dpi=(dpi, dpi))
        result['png'] = png.getvalue()
    result['point_size'] = point_size
    return result


def formula_pptx(result):
    """A fresh one-formula deck; never alter the user's open presentation."""
    size = result['point_size']
    rendered = Rendered(result['source'], result['engine'], result['png'],
                        result['width'] * 10 / size, result['height'] * 10 / size, 300)
    deck = Deck.blank()
    deck.add_or_update(rendered, scale=size / 10)
    record = deck.records()[0]
    # Standalone export keeps the chosen size, including large formulas.
    ext = record['shape'].find('p:spPr/a:xfrm/a:ext', NS)
    ext.set('cx', str(round(result['width'] * EMU_PT)))
    ext.set('cy', str(round(result['height'] * EMU_PT)))
    deck.stamp(record['part'], record['shape'], result['source'], result['engine'],
               {'IGUANATEXSIZE': str(size)})
    return deck.bytes()


def read_source(path):
    """Reopen exported source, images with embedded metadata, or one-formula PPTX."""
    path = Path(path)
    if path.suffix.lower() == '.tex':
        if path.stat().st_size > 800_000:
            raise ValueError('TeX 文件过大。')
        return {'source': path.read_text(encoding='utf-8-sig')}
    if path.suffix.lower() == '.pptx':
        if path.stat().st_size > 50_000_000:
            raise ValueError('请选择小于 50 MB 的公式 PPTX。')
        records = Deck(path.read_bytes()).records()
        if len(records) != 1:
            raise ValueError('桌面入口仅读取恰好一条公式的 PPTX；多公式文稿请使用 PowerPoint/WPS 加载项。')
        tags = records[0]['tags']
        from bridge import ID_ENGINES
        return {'source': tags['LATEXADDIN'], 'engine': ID_ENGINES.get(tags.get('LATEXENGINEID'), 'xelatex'),
                'point_size': float(tags.get('IGUANATEXSIZE', 24))}
    if path.stat().st_size > MAX_IMAGE_BYTES:
        raise ValueError('文件不得超过 10 MB。')
    if path.suffix.lower() == '.png':
        with Image.open(path) as im:
            meta = decode_meta(im.info.get(PNG_KEY, ''))
    else:
        root = xml(path.read_bytes())
        meta = next((value for element in root.iter('{http://www.w3.org/2000/svg}metadata')
                     if (value := decode_meta(element.text or ''))), None)
    if not meta:
        raise ValueError('这张图片没有内嵌 TeX 源码，请放入截图区进行识别。')
    return dict(source=meta['source'], engine=meta.get('engine', 'xelatex'),
                point_size=float(meta.get('tags', {}).get('IGUANATEXSIZE', 24)))


def atomic_write(path, data):
    path = Path(path)
    temporary = None
    try:
        with tempfile.NamedTemporaryFile(dir=path.parent, prefix='.' + path.name,
                                         suffix='.tmp', delete=False) as output:
            temporary = Path(output.name)
            output.write(data)
        os.replace(temporary, path)
    finally:
        if temporary:
            temporary.unlink(missing_ok=True)
