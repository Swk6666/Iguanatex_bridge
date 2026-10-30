"""Local render and metadata API shared by WPS and Office JavaScript add-ins."""
import base64
import os
import re
from pathlib import Path
import tempfile
import time
import uuid

from bridge import (Deck, render, decode_meta, encode_meta, human_alt,
                    ID_ENGINES, ENGINE_IDS, MAX_SOURCE, xml, dump)


class WpsBridge:
    def __init__(self, cache_dir=None):
        self.cache = Path(cache_dir or Path(tempfile.gettempdir()) / ('iguanatex-bridge-' + str(os.getuid() if hasattr(os, 'getuid') else 'user')))
        self.cache.mkdir(parents=True, exist_ok=True, mode=0o700)

    def image_target(self):
        # Only opaque server-generated names are accepted by image_read.
        token = uuid.uuid4().hex
        for old in self.cache.glob('recognize-*.png'):
            if time.time() - old.stat().st_mtime > 3600:
                old.unlink(missing_ok=True)
        return {'token': token, 'path': str((self.cache / ('recognize-' + token + '.png')).resolve())}

    def image_path(self, req):
        token = req.get('token', '')
        if not isinstance(token, str) or not re.fullmatch(r'[0-9a-f]{32}', token):
            raise ValueError('图片导出标识无效。')
        return self.cache / ('recognize-' + token + '.png')

    def image_discard(self, req):
        self.image_path(req).unlink(missing_ok=True)
        return {'ok': True}

    def image_read(self, req):
        path = self.image_path(req)
        try:
            if path.is_symlink() or not path.is_file():
                raise ValueError('WPS 未能导出图片，请检查当前版本是否支持此功能。')
            if path.stat().st_size > 10 * 1024 * 1024:
                raise ValueError('选中的图片超过 10 MB。')
            from ocr import prepare_image
            encoded = base64.b64encode(path.read_bytes()).decode('ascii')
            return {'data': base64.b64encode(prepare_image(encoded)).decode('ascii')}
        finally:
            path.unlink(missing_ok=True)

    def render(self, req):
        output = req.get('output', 'png').lower()
        if output not in ('png', 'svg'):
            raise ValueError('输出格式须为 SVG 或 PNG。')
        size = float(req.get('point_size', 24))
        if not 4 <= size <= 200:
            raise ValueError('字号须在 4–200 之间。')
        source = req['source']
        if req.get('color') is not None:
            source = self.color_source(source, req['color'])
        rendered = render(source, req.get('engine', 'xelatex'))
        # Reuse the same IguanaTex serialization as offline PPTX editing.
        deck = Deck.blank()
        deck.add_or_update(rendered)
        rec = deck.records()[0]
        tags = rec['tags']
        tags['IGUANATEXSIZE'] = str(size)
        if output == 'svg':
            # SVG is an Office Graphic / Picture, not an ungrouped Shape display.
            # IguanaTex distinguishes Picture/Shape via BITMAPVECTOR, not the
            # raster/vector nature of the asset. SVG's import dimensions are pt.
            tags.update(OUTPUTTYPE='SVG', BITMAPVECTOR='0',
                        ORIGINALWIDTH=str(rendered.width_pt), ORIGINALHEIGHT=str(rendered.height_pt))
            tags.pop('OUTPUTDPI', None)
        meta = dict(version=1, uid=tags['IGUANABRIDGEID'], source=rendered.source,
                    engine=rendered.engine, tags=tags)
        alt = (human_alt(str(req.get('alt', ''))) + '\n' + encode_meta(meta)).strip()
        png = deck.parts[deck.image_part(rec['part'], rec['shape'])]
        path = self.cache / (uuid.uuid4().hex + '.' + output)
        if output == 'svg':
            from lxml import etree as ET
            svg = xml(rendered.svg)
            svg.set('width', f'{rendered.width_pt}pt')
            svg.set('height', f'{rendered.height_pt}pt')
            ET.SubElement(svg, '{http://www.w3.org/2000/svg}metadata').text = encode_meta(meta)
            path.write_bytes(dump(svg))
        else:
            path.write_bytes(png)
        # Embedded images do not depend on this file after insertion.
        for old in self.cache.iterdir():
            if old.suffix in ('.png', '.svg') and time.time() - old.stat().st_mtime > 7 * 86400:
                old.unlink(missing_ok=True)
        return dict(source=rendered.source, engine=rendered.engine, tags=tags, alt=alt,
                    path=str(path.resolve()), output=output, png=base64.b64encode(png).decode(),
                    svg=path.read_text(encoding='utf-8') if output == 'svg' else None,
                    width=rendered.width_pt * size / 10, height=rendered.height_pt * size / 10)

    @staticmethod
    def color_source(source, color):
        from latex_source import active_tex, complete_source
        if not isinstance(color, str) or not re.fullmatch(r'#[0-9A-Fa-f]{6}', color):
            raise ValueError('颜色须为六位十六进制颜色。')
        source = complete_source(source)
        active = active_tex(source)
        begin = re.search(r'\\begin\s*\{document\}', active)
        if not begin:
            raise ValueError('完整 LaTeX 文档缺少 document 环境。')
        preamble = active[:begin.start()]
        package = re.search(r'\\(?:usepackage|RequirePackage)(?:\s*\[[^]]*\])?\s*\{[^}]*\bxcolor\b[^}]*\}', preamble)
        if not package:
            source = source[:begin.start()] + '\\usepackage{xcolor}\n' + source[begin.start():]
            active = active_tex(source)
            begin = re.search(r'\\begin\s*\{document\}', active)
        return source[:begin.end()] + '\n\\color[HTML]{' + color[1:].upper() + '}\n' + source[begin.end():]

    @staticmethod
    def metadata(req):
        tags = {str(k).upper(): str(v) for k, v in req.get('tags', {}).items()}
        alt = str(req.get('alt', ''))
        backup = decode_meta(alt) or decode_meta(tags.get('IGUANABRIDGEMETA', ''))
        if tags.get('LATEXADDIN'):
            source = tags['LATEXADDIN']
            engine = ID_ENGINES.get(tags.get('LATEXENGINEID', '2'), 'unsupported')
            origin = 'IguanaTex Tags'
        elif backup:
            source, engine = backup['source'], backup.get('engine', 'xelatex')
            tags = dict(backup.get('tags', {}), **tags)
            tags.update(LATEXADDIN=source, LATEXENGINEID=str(ENGINE_IDS.get(engine, 2)))
            origin = '替代文字备份'
        else:
            return {'found': False}
        if len(source) > MAX_SOURCE:
            raise ValueError('公式源码过长。')
        uid = tags.get('IGUANABRIDGEID') or (backup or {}).get('uid') or str(uuid.uuid4())
        tags['IGUANABRIDGEID'] = uid
        meta = dict(version=1, uid=uid, source=source, engine=engine, tags=tags)
        return dict(found=True, source=source, engine=engine, tags=tags, origin=origin,
                    alt=(human_alt(alt) + '\n' + encode_meta(meta)).strip())


class WpsWorkflow:
    """Private settings, recoverable drafts, and transient review decisions."""
    DEFAULTS = {'point_size': 18, 'color': '#000000', 'align': 'left', 'review': False}

    def __init__(self, directory=None):
        from paths import state_dir
        self.directory = Path(directory or state_dir()) / 'wps-workflow'
        self.reviews = {}

    def _write(self, path, data):
        import json
        self.directory.mkdir(parents=True, exist_ok=True, mode=0o700)
        fd, name = tempfile.mkstemp(prefix='.workflow-', dir=self.directory)
        try:
            with os.fdopen(fd, 'w', encoding='utf-8') as f:
                json.dump(data, f, ensure_ascii=False)
            os.chmod(name, 0o600)
            os.replace(name, path)
        finally:
            if os.path.exists(name):
                os.unlink(name)

    def settings(self, req):
        import json
        path = self.directory / 'settings.json'
        if not req:
            try:
                return dict(self.DEFAULTS, **json.loads(path.read_text(encoding='utf-8')))
            except FileNotFoundError:
                return dict(self.DEFAULTS)
        result = self.valid_settings(req)
        self._write(path, result)
        return result

    @staticmethod
    def valid_settings(req):
        if not isinstance(req, dict):
            raise ValueError('转换设置无效。')
        size, color, align, review = req.get('point_size'), req.get('color'), req.get('align'), req.get('review')
        if isinstance(size, bool) or not isinstance(size, (int, float)) or not 4 <= size <= 200:
            raise ValueError('字号须在 4–200 pt 之间。')
        if not isinstance(color, str) or not re.fullmatch(r'#[0-9a-fA-F]{6}', color):
            raise ValueError('颜色须为六位十六进制颜色。')
        if align not in ('left', 'center', 'right') or not isinstance(review, bool):
            raise ValueError('对齐方式或校对选项无效。')
        return {'point_size': size, 'color': color.upper(), 'align': align, 'review': review}

    def draft_path(self, identity):
        import hashlib
        if not isinstance(identity, dict) or set(identity) != {'presentation', 'slide_id', 'shape_id'}:
            raise ValueError('图片标识无效。')
        name, slide, shape = identity['presentation'], identity['slide_id'], identity['shape_id']
        if not isinstance(name, str) or not name or len(name) > 4096 or not isinstance(slide, int) or isinstance(slide, bool) or not isinstance(shape, int) or isinstance(shape, bool):
            raise ValueError('图片标识无效。')
        raw = (name + '\0' + str(slide) + '\0' + str(shape)).encode('utf-8')
        return self.directory / ('draft-' + hashlib.sha256(raw).hexdigest() + '.json')

    def draft_save(self, req):
        identity, source, error = req.get('identity'), req.get('source'), req.get('error', '')
        path = self.draft_path(identity)
        if not isinstance(source, str) or not source.strip() or len(source) > MAX_SOURCE or not isinstance(error, str):
            raise ValueError('草稿源码或日志无效。')
        signature = req.get('signature', '')
        if not isinstance(signature, str) or len(signature) > 50000:
            raise ValueError('图片状态无效。')
        settings = self.valid_settings(req.get('settings', self.DEFAULTS))
        draft = {'identity': identity, 'signature': signature, 'source': source, 'error': error[:20000], 'settings': settings, 'updated': time.time()}
        self._write(path, draft)
        return {'saved': True}

    def draft_get(self, req):
        import json
        path = self.draft_path(req.get('identity'))
        try:
            draft = json.loads(path.read_text(encoding='utf-8'))
        except FileNotFoundError:
            return {'found': False}
        if draft.get('identity') != req['identity']:
            raise ValueError('草稿与选中的图片不匹配。')
        return dict(draft, found=True)

    def draft_delete(self, req):
        self.draft_path(req.get('identity')).unlink(missing_ok=True)
        return {'ok': True}

    def review_create(self, req):
        image, preview = req.get('image'), req.get('preview')
        for value in (image, preview):
            if not isinstance(value, str) or len(value) > 14_000_000 or not value:
                raise ValueError('校对图片无效。')
            try:
                base64.b64decode(value, validate=True)
            except ValueError:
                raise ValueError('校对图片无效。') from None
        now = time.time()
        self.reviews = {k: v for k, v in self.reviews.items() if now - v['created'] < 3600}
        token = uuid.uuid4().hex
        self.reviews[token] = {'image': image, 'preview': preview, 'decision': None, 'created': now}
        return {'id': token}

    def review_get(self, req):
        token = req.get('id')
        review = self.reviews.get(token) if isinstance(token, str) else None
        if review is None:
            raise ValueError('校对已结束或过期。')
        return review

    def review_decide(self, req):
        decision = req.get('decision')
        if decision not in ('accept', 'skip', 'cancel'):
            raise ValueError('校对操作无效。')
        review = self.review_get(req)
        if review['decision'] is not None:
            raise ValueError('此图片已处理。')
        review['decision'] = decision
        return {'ok': True}

    def review_discard(self, req):
        self.reviews.pop(req.get('id'), None)
        return {'ok': True}
