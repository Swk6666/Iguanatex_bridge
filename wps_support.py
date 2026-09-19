"""Local render and metadata API shared by the WPS JavaScript add-in."""
import base64
import os
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

    def render(self, req):
        output = req.get('output', 'png').lower()
        if output not in ('png', 'svg'):
            raise ValueError('输出格式须为 SVG 或 PNG。')
        size = float(req.get('point_size', 24))
        if not 4 <= size <= 200:
            raise ValueError('字号须在 4–200 之间。')
        rendered = render(req['source'], req.get('engine', 'xelatex'))
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
                    width=rendered.width_pt * size / 10, height=rendered.height_pt * size / 10)

    @staticmethod
    def metadata(req):
        tags = {str(k).upper(): str(v) for k, v in req.get('tags', {}).items()}
        alt = str(req.get('alt', ''))
        backup = decode_meta(alt)
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
