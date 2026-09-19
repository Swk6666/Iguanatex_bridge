"""IguanaTex Bridge 0.3: conservative PPTX package editing, no Office automation.

Original implementation, MIT license. IguanaTex is a separate upstream project.
"""
from __future__ import annotations

import base64
import copy
import hashlib
import io
import json
import os
from pathlib import Path
import posixpath
import re
import shutil
import subprocess
import tempfile
import uuid
import zipfile
import zlib
from dataclasses import dataclass

from lxml import etree as ET
from PIL import Image, PngImagePlugin
import pymupdf as fitz

P = 'http://schemas.openxmlformats.org/presentationml/2006/main'
A = 'http://schemas.openxmlformats.org/drawingml/2006/main'
R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'
REL = 'http://schemas.openxmlformats.org/package/2006/relationships'
CT = 'http://schemas.openxmlformats.org/package/2006/content-types'
NS = {'p': P, 'a': A, 'r': R}
PREFIX = 'IGUANABRIDGE1:'
PNG_KEY = 'IguanaTexBridge'
ENGINE_IDS = {'pdflatex': 1, 'xelatex': 2, 'lualatex': 3}
ID_ENGINES = {'0': 'pdflatex', '1': 'pdflatex', '2': 'xelatex', '3': 'lualatex',
              '4': 'platex', '5': 'tectonic'}
EMU_PT = 12700
MAX_SOURCE = 200_000


def xml(data):
    return ET.fromstring(data, ET.XMLParser(resolve_entities=False, no_network=True))


def dump(node):
    return ET.tostring(node, xml_declaration=True, encoding='UTF-8', standalone=True)


def child(node, tag, **attrs):
    prefix, local = tag.split(':')
    return ET.SubElement(node, '{%s}%s' % (NS[prefix], local), **{k: str(v) for k, v in attrs.items()})


def relpath(part):
    return posixpath.join(posixpath.dirname(part), '_rels', posixpath.basename(part) + '.rels')


def target(part, dest):
    return dest.lstrip('/') if dest.startswith('/') else posixpath.normpath(posixpath.join(posixpath.dirname(part), dest))


def complete_source(source):
    if len(source) > MAX_SOURCE or not source.strip():
        raise ValueError('源码为空或超过 200,000 个字符。')
    if '\\documentclass' in source:
        return source
    # The default 10 pt class agrees with IguanaTex's size scaling convention.
    cjk = '\\usepackage[fontset=fandol]{ctex}\n' if re.search('[\u3400-\u9fff]', source) else ''
    return ('\\documentclass{article}\n\\usepackage{amsmath,amssymb,bm}\n' + cjk
            + '\\pagestyle{empty}\n\\begin{document}\n\\[\n' + source
            + '\n\\]\n\\end{document}\n')


def encode_meta(meta):
    return PREFIX + base64.b64encode(zlib.compress(json.dumps(meta, ensure_ascii=False).encode())).decode()


def decode_meta(text):
    if not text or PREFIX not in text:
        return None
    try:
        value = text.split(PREFIX, 1)[1].split()[0]
        dec = zlib.decompressobj()
        raw = dec.decompress(base64.b64decode(value, validate=True), MAX_SOURCE * 8)
        if dec.unconsumed_tail:
            return None
        obj = json.loads(raw)
        if isinstance(obj.get('source'), str) and len(obj['source']) <= MAX_SOURCE:
            return obj
    except (ValueError, KeyError, TypeError, zlib.error):
        pass
    return None


def human_alt(value):
    return value.split(PREFIX, 1)[0].rstrip()


def executable(name):
    found = shutil.which(name)
    if not found and os.name != 'nt':
        for folder in ['/Library/TeX/texbin', '/usr/texbin']:
            p = Path(folder, name)
            if p.is_file():
                return str(p)
    return found


@dataclass
class Rendered:
    source: str
    engine: str
    png: bytes
    width_pt: float
    height_pt: float
    dpi: int
    svg: bytes = b''


def render(source, engine='xelatex', dpi=300):
    if engine not in ENGINE_IDS:
        raise ValueError('支持 xelatex、pdflatex、lualatex。')
    exe = executable(engine)
    if not exe:
        raise ValueError(f'未找到 {engine}。请安装 TeX Live / MacTeX / MiKTeX，并加入 PATH。')
    source = complete_source(source)
    with tempfile.TemporaryDirectory(prefix='iguanabridge-') as temp:
        work = Path(temp)
        (work / 'formula.tex').write_text(source, encoding='utf-8')
        env = dict(os.environ, openin_any='p', openout_any='p')
        try:
            result = subprocess.run([exe, '-no-shell-escape', '-halt-on-error',
                                     '-interaction=nonstopmode', 'formula.tex'],
                                    cwd=work, env=env, capture_output=True, timeout=50)
        except subprocess.TimeoutExpired as e:
            raise ValueError('LaTeX 编译超过 50 秒；请检查源码。') from e
        if result.returncode or not (work / 'formula.pdf').exists():
            output = result.stdout.decode('utf-8', 'replace')[-10000:]
            raise ValueError('LaTeX 编译失败：\n' + output)
        with fitz.open(work / 'formula.pdf') as doc:
            if len(doc) != 1:
                raise ValueError('每个公式必须只生成一页 PDF。请使用空页眉页脚并缩短内容。')
            page = doc[0]
            if page.rect.width * page.rect.height * (dpi/72)**2 > 50_000_000:
                raise ValueError('LaTeX 页面过大，请使用常规单页文档。')
            pix = page.get_pixmap(matrix=fitz.Matrix(dpi/72, dpi/72), alpha=True)
            im = Image.frombytes('RGBA', (pix.width, pix.height), pix.samples)
            box = im.getchannel('A').getbbox()
            if not box:
                raise ValueError('公式没有可见内容。')
            pad = 3
            box = (max(0, box[0]-pad), max(0, box[1]-pad),
                   min(im.width, box[2]+pad), min(im.height, box[3]+pad))
            im = im.crop(box)
            stream = io.BytesIO()
            # 96 DPI import baseline matches IguanaTex PNG scaling.
            im.save(stream, format='PNG', dpi=(96, 96))
            # Export glyph outlines, so Office does not need the TeX fonts.
            # Use the same crop for the vector asset and the raster preview.
            crop = fitz.Rect(*(v * 72/dpi for v in box)) & page.rect
            page.set_cropbox(crop)
            svg = page.get_svg_image(text_as_path=True).encode('utf-8')
            return Rendered(source, engine, stream.getvalue(), im.width * 72/dpi,
                            im.height * 72/dpi, dpi, svg)


class Deck:
    def __init__(self, data):
        self.raw = data
        with zipfile.ZipFile(io.BytesIO(data)) as z:
            infos = z.infolist()
            if len(infos) > 15000 or sum(i.file_size for i in infos) > 600_000_000:
                raise ValueError('PPTX 过大；本版本限制解压后 600 MB、15,000 项。')
            if len({i.filename for i in infos}) != len(infos):
                raise ValueError('PPTX 中有重复 ZIP 项。')
            self.parts = {i.filename: z.read(i) for i in infos}
            self.infos = {i.filename: i for i in infos}
        if 'ppt/presentation.xml' not in self.parts:
            raise ValueError('请使用 .pptx 文件。')
        if any(x.startswith('_xmlsignatures/') or 'vbaProject' in x for x in self.parts):
            raise ValueError('本版本只处理未签名、无宏的 .pptx；请另存副本后再使用。')
        self.docs = {}
        self.ct = self.doc('[Content_Types].xml')
        root = self.doc('ppt/presentation.xml')
        if root.tag != '{%s}presentation' % P:
            raise ValueError('本版本支持常见 Transitional PPTX，请用 Office 另存普通 PPTX。')
        rels = self.rels('ppt/presentation.xml')
        refs = {i.get('Id'): i.get('Target') for i in rels}
        self.slides = [target('ppt/presentation.xml', refs[i.get('{%s}id' % R)])
                       for i in root.findall('p:sldIdLst/p:sldId', NS)]
        self.size = root.find('p:sldSz', NS)

    @classmethod
    def blank(cls):
        return cls(Path(__file__).with_name('assets').joinpath('blank.pptx').read_bytes())

    def doc(self, part):
        if part not in self.docs:
            self.docs[part] = xml(self.parts[part])
        return self.docs[part]

    def rels(self, part):
        rp = relpath(part)
        if rp not in self.parts and rp not in self.docs:
            self.docs[rp] = ET.Element('{%s}Relationships' % REL, nsmap={None: REL})
        return self.doc(rp) if rp in self.parts else self.docs[rp]

    def resolve(self, part, rid):
        for rel in self.rels(part):
            if rel.get('Id') == rid and rel.get('TargetMode') != 'External':
                return target(part, rel.get('Target'))
        return None

    def add_rel(self, part, dest, kind):
        rels = self.rels(part)
        ids = {i.get('Id') for i in rels}
        n = 1
        while 'rId' + str(n) in ids:
            n += 1
        rid = 'rId' + str(n)
        ET.SubElement(rels, '{%s}Relationship' % REL, Id=rid, Type=R + '/' + kind,
                      Target=posixpath.relpath(dest, posixpath.dirname(part)))
        return rid

    def content_type(self, part, kind):
        name = '/' + part
        if not any(e.get('PartName') == name for e in self.ct):
            ET.SubElement(self.ct, '{%s}Override' % CT, PartName=name, ContentType=kind)

    def unique(self, directory, stem, suffix):
        n = 1
        while f'{directory}/{stem}{n}.{suffix}' in self.parts or f'{directory}/{stem}{n}.{suffix}' in self.docs:
            n += 1
        return f'{directory}/{stem}{n}.{suffix}'

    @staticmethod
    def nv(shape):
        for e in shape:
            if ET.QName(e).localname.startswith('nv'):
                return e
        return None

    def properties(self, shape):
        nv = self.nv(shape)
        return nv.find('p:cNvPr', NS) if nv is not None else None

    def tags(self, part, shape):
        nv = self.nv(shape)
        if nv is None:
            return {}
        link = nv.find('p:nvPr/p:custDataLst/p:tags', NS)
        if link is None:
            return {}
        ref = self.resolve(part, link.get('{%s}id' % R))
        if not ref or ref not in self.parts and ref not in self.docs:
            return {}
        return {t.get('name', '').upper(): t.get('val', '') for t in self.doc(ref)}

    def image_part(self, part, shape):
        blip = shape.find('p:blipFill/a:blip', NS)
        return self.resolve(part, blip.get('{%s}embed' % R)) if blip is not None else None

    def metadata(self, part, shape):
        props = self.properties(shape)
        if props is None:
            return None
        fallback = decode_meta(props.get('descr', ''))
        tags = self.tags(part, shape)
        if tags.get('LATEXADDIN'):
            # Native tags are authoritative after PowerPoint/IguanaTex edits.
            return dict(source=tags['LATEXADDIN'], engine=ID_ENGINES.get(tags.get('LATEXENGINEID', '2'), 'unsupported'),
                        origin='IguanaTex Tags', uid=tags.get('IGUANABRIDGEID', (fallback or {}).get('uid', '')),
                        tags=tags)
        if fallback:
            return dict(fallback, origin='替代文字备份', tags={})
        ip = self.image_part(part, shape)
        if ip and ip in self.parts and ip.endswith('.png'):
            try:
                with Image.open(io.BytesIO(self.parts[ip])) as im:
                    meta = decode_meta(im.info.get(PNG_KEY, ''))
                    if meta:
                        return dict(meta, origin='PNG 源码备份', tags={})
            except (OSError, ValueError):
                pass
        return None

    def records(self):
        out = []
        def walk(part, node, index):
            for shape in node:
                if ET.QName(shape).localname not in ('pic', 'sp', 'grpSp', 'graphicFrame', 'cxnSp'):
                    continue
                meta = self.metadata(part, shape)
                if meta:
                    props = self.properties(shape)
                    out.append(dict(meta, slide=index, part=part, shape_id=props.get('id'),
                                    name=props.get('name'), shape=shape))
                    # A tagged vector group is one formula, not hundreds of leaves.
                elif shape.tag == '{%s}grpSp' % P:
                    walk(part, shape, index)
        for i, part in enumerate(self.slides, 1):
            walk(part, self.doc(part).find('p:cSld/p:spTree', NS), i)
        return out

    def set_tags(self, part, shape, tags):
        nv = self.nv(shape)
        nvpr = nv.find('p:nvPr', NS)
        if nvpr is None:
            nvpr = child(nv, 'p:nvPr')
        lst = nvpr.find('p:custDataLst', NS)
        if lst is None:
            lst = ET.Element('{%s}custDataLst' % P)
            ext = nvpr.find('p:extLst', NS)
            nvpr.insert(list(nvpr).index(ext) if ext is not None else len(nvpr), lst)
        for old in list(lst):
            if old.tag == '{%s}tags' % P:
                lst.remove(old)
        dest = self.unique('ppt/tags', 'iguanabridge', 'xml')
        root = ET.Element('{%s}tagLst' % P, nsmap={'p': P})
        for key, value in tags.items():
            child(root, 'p:tag', name=key.upper(), val=str(value))
        self.docs[dest] = root
        self.content_type(dest, 'application/vnd.openxmlformats-officedocument.presentationml.tags+xml')
        rid = self.add_rel(part, dest, 'tags')
        child(lst, 'p:tags', **{'{%s}id' % R: rid})

    def stamp(self, part, shape, source, engine, extra=None):
        old = self.tags(part, shape)
        props = self.properties(shape)
        prior = decode_meta(props.get('descr', '')) or {}
        uid = old.get('IGUANABRIDGEID') or prior.get('uid') or str(uuid.uuid4())
        engine_id = str(ENGINE_IDS.get(engine, old.get('LATEXENGINEID', '2')))
        if extra is None and old.get('LATEXENGINEID'):
            engine_id = old['LATEXENGINEID']
        tags = dict(old, LATEXADDIN=source, LATEXENGINEID=engine_id,
                    IGUANABRIDGEID=uid)
        if extra:
            tags.update(extra)
        meta = dict(version=1, uid=uid, source=source, engine=engine)
        props.set('descr', (human_alt(props.get('descr', '')) + '\n' + encode_meta(meta)).strip())
        self.set_tags(part, shape, tags)
        return meta

    def add_or_update(self, rendered, slide=1, shape_id=None, scale=2.4):
        if not 1 <= slide <= len(self.slides):
            raise ValueError('幻灯片页码无效。')
        part = self.slides[slide-1]
        tree = self.doc(part).find('p:cSld/p:spTree', NS)
        existing = None
        if shape_id is not None:
            matches = [r for r in self.records() if r['slide'] == slide and r['shape_id'] == str(shape_id)]
            if len(matches) != 1:
                raise ValueError('目标公式不存在或不唯一，请重新载入文件。')
            existing = matches[0]['shape']
            if existing.tag == '{%s}grpSp' % P:
                raise ValueError('独立编辑器可读取并保护 Shape 组合的源码；请从 WPS 工具栏直接编辑 Shape 组合。')
            if existing.tag != '{%s}pic' % P:
                raise ValueError('本版只原位更新 Picture 公式；可复制源码后新建公式。')
        pic = copy.deepcopy(existing) if existing is not None else ET.Element('{%s}pic' % P)
        if existing is None:
            shape_id = max([int(e.get('id')) for e in tree.findall('.//p:cNvPr', NS)] + [1]) + 1
            nv = child(pic, 'p:nvPicPr')
            child(nv, 'p:cNvPr', id=shape_id, name=f'IguanaTex {shape_id}')
            child(child(nv, 'p:cNvPicPr'), 'a:picLocks', noChangeAspect='1')
            child(nv, 'p:nvPr')
            bf = child(pic, 'p:blipFill')
            child(bf, 'a:blip')
            child(child(bf, 'a:stretch'), 'a:fillRect')
            sp = child(pic, 'p:spPr')
            xf = child(sp, 'a:xfrm')
            child(xf, 'a:off', x=914400, y=1828800)
            width = rendered.width_pt * scale * EMU_PT
            height = rendered.height_pt * scale * EMU_PT
            maxw, maxh = int(self.size.get('cx'))*.8, int(self.size.get('cy'))*.65
            reduction = min(1, maxw / width, maxh / height)
            child(xf, 'a:ext', cx=round(width*reduction), cy=round(height*reduction))
            child(child(sp, 'a:prstGeom', prst='rect'), 'a:avLst')
        else:
            # Keep height and top-left position; new width follows the formula aspect ratio.
            xf = pic.find('p:spPr/a:xfrm', NS)
            if xf is None:
                raise ValueError('公式缺少显式变换，请在 Office 中移动一次后保存。')
            ext = xf.find('a:ext', NS)
            ext.set('cx', str(round(int(ext.get('cy')) * rendered.width_pt/rendered.height_pt)))
            bf = pic.find('p:blipFill', NS)
            for sub in list(bf):
                bf.remove(sub)
            child(bf, 'a:blip')
            child(child(bf, 'a:stretch'), 'a:fillRect')
        with Image.open(io.BytesIO(rendered.png)) as im:
            # ORIGINAL dimensions are unscaled PNG pixels imported at 96 DPI.
            extra = {'BITMAPVECTOR': '0', 'OUTPUTTYPE': 'PNG', 'OUTPUTDPI': str(rendered.dpi),
                     'ORIGINALWIDTH': str(im.width * .75), 'ORIGINALHEIGHT': str(im.height * .75),
                     'TRANSPARENCY': 'True', 'CHOOSECOLOR': 'False', 'COLORHEX': '000000',
                     'IGUANATEXSIZE': '24', 'IGUANATEXCURSOR': '0'}
            meta = self.stamp(part, pic, rendered.source, rendered.engine, extra)
            info = PngImagePlugin.PngInfo()
            info.add_itxt(PNG_KEY, encode_meta(meta))
            buf = io.BytesIO()
            im.save(buf, format='PNG', pnginfo=info, dpi=(96, 96))
        ip = self.unique('ppt/media', 'iguanabridge', 'png')
        self.parts[ip] = buf.getvalue()
        self.content_type(ip, 'image/png')
        rid = self.add_rel(part, ip, 'image')
        pic.find('p:blipFill/a:blip', NS).set('{%s}embed' % R, rid)
        if existing is None:
            ext = tree.find('p:extLst', NS)
            tree.insert(list(tree).index(ext) if ext is not None else len(tree), pic)
        else:
            existing.getparent().replace(existing, pic)
        return str(shape_id)

    def protect(self):
        records = self.records()
        for rec in records:
            meta = self.stamp(rec['part'], rec['shape'], rec['source'], rec['engine'])
            ip = self.image_part(rec['part'], rec['shape'])
            if ip and ip.endswith('.png') and ip in self.parts:
                with Image.open(io.BytesIO(self.parts[ip])) as im:
                    if decode_meta(im.info.get(PNG_KEY, '')) == meta:
                        continue
                    info = PngImagePlugin.PngInfo()
                    for key, value in im.info.items():
                        if isinstance(value, str) and key != PNG_KEY:
                            info.add_itxt(key, value)
                    info.add_itxt(PNG_KEY, encode_meta(meta))
                    buf = io.BytesIO()
                    options = {'pnginfo': info, 'dpi': im.info.get('dpi', (96, 96))}
                    if im.info.get('icc_profile'):
                        options['icc_profile'] = im.info['icc_profile']
                    im.save(buf, format='PNG', **options)
                # A copied picture may share its media; isolate each source association.
                dest = self.unique('ppt/media', 'iguanabridge', 'png')
                self.parts[dest] = buf.getvalue()
                self.content_type(dest, 'image/png')
                rid = self.add_rel(rec['part'], dest, 'image')
                rec['shape'].find('p:blipFill/a:blip', NS).set('{%s}embed' % R, rid)
        return len(records)

    def inventory(self):
        return [{k: v for k, v in r.items() if k not in ('shape', 'tags')} for r in self.records()]

    def bytes(self):
        stream = io.BytesIO()
        with zipfile.ZipFile(stream, 'w', zipfile.ZIP_DEFLATED) as z:
            for name in dict.fromkeys([*self.parts, *self.docs]):
                payload = dump(self.docs[name]) if name in self.docs else self.parts[name]
                # No recomposition of untouched charts, media, animations or notes.
                info = self.infos.get(name, name)
                z.writestr(info, payload)
        return stream.getvalue()


def public_records(deck):
    return {'slides': len(deck.slides), 'equations': deck.inventory()}


def doctor():
    return {name: executable(name) or '未安装' for name in ENGINE_IDS}
