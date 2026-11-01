"""Windows PowerPoint document adapter for hosts without ShapeGroup in Office.js.

All COM objects stay on one STA thread. A capture binds a live presentation and
shape to an opaque, expiring handle; callers never supply a file to open or delete.
Writes accept only a render already produced by this server. No macros, UI
commands, registry changes, document saving, or new PowerPoint instances.
"""
from __future__ import annotations

from collections import OrderedDict
from concurrent.futures import ThreadPoolExecutor
import hashlib
import json
import math
import ntpath
from pathlib import Path
import re
import sys
import tempfile
import time
from urllib.parse import unquote, urlsplit
import uuid


def document_path(value):
    if not isinstance(value, str) or not value:
        raise ValueError('首次使用 Shape 兼容编辑前，请将演示文稿保存到本地。')
    if value.lower().startswith('file:'):
        parsed = urlsplit(value)
        value = ('//' + parsed.netloc if parsed.netloc else '') + unquote(parsed.path)
        if re.match(r'^/[A-Za-z]:', value):
            value = value[1:]
    if not ntpath.isabs(value) or '://' in value or '\x00' in value:
        raise ValueError('Shape 兼容编辑需要本地保存的演示文稿。')
    return ntpath.normcase(ntpath.normpath(value))


def object_id(value):
    value = str(value)
    if not re.fullmatch(r'[1-9][0-9]{0,9}', value):
        raise ValueError('PowerPoint 对象标识无效，请重新选择公式。')
    return int(value)


def slide_id(value):
    # Windows Office.js returns e.g. "712#1977420541"; COM uses SlideID=712.
    # Keep the complete Office.js ID in the session/response and compare it on
    # every write. The document path plus live COM references bind its scope.
    value = str(value)
    if not re.fullmatch(r'[1-9][0-9]{0,9}(?:#[0-9]{1,20})?', value):
        raise ValueError('PowerPoint 幻灯片标识无效，请重新选择公式。')
    return int(value.split('#')[0])


def has_source(data):
    tags = data['tags']
    return bool(tags.get('LATEXADDIN') or tags.get('IGUANABRIDGEMETA') or
                'IGUANABRIDGE1:' in data.get('alt', ''))


def source_owner(node):
    """Same conservative rule as Office.js: never replace an outer layout group."""
    data = node['data']
    if data['type'] != 'Group':
        if not has_source(data):
            raise ValueError('选中对象没有公式源码。')
        return data
    owners, glyphs_only = [], True

    def walk(child, inherited=False):
        nonlocal glyphs_only
        item = child['data']
        if has_source(item):
            owners.append(item)
        glyph = inherited or str(item['tags'].get('EMFCHILD', '')).lower() in ('true', '-1')
        if item['type'] == 'Group':
            for nested in child['children']:
                walk(nested, glyph)
        elif not glyph:
            glyphs_only = False

    for child in node['children']:
        walk(child)
    own = has_source(data)
    reference = data if own else owners[0] if owners else None
    if reference is None:
        raise ValueError('选中组合没有公式源码。')
    from wps_support import WpsBridge
    reference_meta = WpsBridge.metadata({'tags': reference['tags'], 'alt': reference.get('alt', '')})
    if not reference_meta.get('found'):
        raise ValueError('公式源码无法读取，请用原 IguanaTeX 检查此公式。')
    for owner in owners:
        meta = WpsBridge.metadata({'tags': owner['tags'], 'alt': owner.get('alt', '')})
        if not meta.get('found') or meta['source'] != reference_meta['source']:
            raise ValueError('这个组合包含多个不同公式，请先取消外层排版组合。')
    if (not glyphs_only or not node['children'] or
            (not own and any(owner['type'] == 'Group' for owner in owners))):
        raise ValueError('这是外层排版组合，请先取消外层组合，再选择公式本身的 Shape 组合。')
    return reference


def contains(node, selected):
    return node['data']['id'] == str(selected) or any(contains(n, selected) for n in node['children'])


def structure(node):
    return hashlib.sha256(json.dumps(node, sort_keys=True, ensure_ascii=False,
                                    separators=(',', ':')).encode()).hexdigest()


def layout(original, data, mode, align=None):
    if mode not in ('font', 'height', 'frame') or align not in (None, 'left', 'center', 'right'):
        raise ValueError('公式尺寸或对齐方式无效。')
    width, height = float(data['width']), float(data['height'])
    if mode != 'font':
        height = original['height']
        width = original['width'] if mode == 'frame' else height * float(data['width']) / float(data['height'])
    left = original['left']
    if align in ('center', 'right'):
        left += (original['width'] - width) / (2 if align == 'center' else 1)
    box = dict(left=left, top=original['top'], width=width, height=height)
    if not all(math.isfinite(v) for v in box.values()) or not (0 < width <= 10000 and 0 < height <= 10000):
        raise ValueError('公式尺寸无效。')
    return box


class NativePowerPoint:
    def __init__(self):
        self._executor = ThreadPoolExecutor(max_workers=1, thread_name_prefix='PowerPoint-STA')
        self._sessions = OrderedDict()
        self._initialized = False

    def _dispatch(self, operation, *args):
        if sys.platform != 'win32':
            raise ValueError('Shape 原生兼容接口仅支持 Windows；此平台需要 PowerPointApi 1.8。')
        try:
            import pythoncom
            import win32com.client
        except ImportError as exc:
            raise ValueError('缺少 Windows Shape 兼容组件，请重新安装 requirements-office.txt 后重启本地服务。') from exc
        if not self._initialized:
            pythoncom.CoInitialize()
            self._initialized = True
        try:
            return getattr(self, '_' + operation)(*args)
        except pythoncom.com_error as exc:
            raise ValueError('PowerPoint 原生接口暂不可用，请关闭原版公式编辑或文件对话框，回到原幻灯片后重试。') from exc

    def capture(self, request):
        return self._executor.submit(self._dispatch, 'capture', request).result()

    def apply(self, request, rendered):
        return self._executor.submit(self._dispatch, 'apply', request, rendered).result()

    def close(self):
        def release():
            self._sessions.clear()
            if self._initialized:
                import pythoncom
                pythoncom.CoUninitialize()
                self._initialized = False
        self._executor.submit(release).result()
        self._executor.shutdown(wait=True)

    def _prune(self):
        now = time.monotonic()
        for key, session in list(self._sessions.items()):
            if now - session['touched'] > 1800:
                del self._sessions[key]
        while len(self._sessions) > 16:
            self._sessions.popitem(last=False)

    @staticmethod
    def _active():
        import win32com.client
        # GetActiveObject never starts PowerPoint or opens a document.
        return win32com.client.GetActiveObject('PowerPoint.Application')

    @staticmethod
    def _tags(shape):
        tags = shape.Tags
        if tags.Count > 1024:
            raise ValueError('公式标签过多，请先选择单个公式。')
        return {str(tags.Name(i)).upper(): str(tags.Value(i)) for i in range(1, tags.Count + 1)}

    def _tree(self, shape, budget=None, depth=0):
        budget = budget if budget is not None else [0, 0]
        budget[0] += 1
        if budget[0] > 5000 or depth > 20:
            raise ValueError('组合结构过大，请先选择单个公式组合。')
        kind = int(shape.Type)
        data = dict(id=str(shape.Id), name=str(shape.Name),
                    type={6: 'Group', 13: 'Image', 28: 'Graphic'}.get(kind, 'Shape'),
                    nativeType=kind, left=float(shape.Left), top=float(shape.Top),
                    width=float(shape.Width), height=float(shape.Height),
                    rotation=float(shape.Rotation), flipH=int(shape.HorizontalFlip),
                    flipV=int(shape.VerticalFlip), visible=int(shape.Visible),
                    z=int(shape.ZOrderPosition) - 1, tags=self._tags(shape), alt=str(shape.AlternativeText))
        budget[1] += len(json.dumps(data, ensure_ascii=False))
        if budget[1] > 16 * 1024 * 1024:
            raise ValueError('公式元数据过大，请先选择单个公式组合。')
        children = [self._tree(shape.GroupItems(i), budget, depth + 1)
                    for i in range(1, shape.GroupItems.Count + 1)] if kind == 6 else []
        return dict(data=data, children=children)

    @staticmethod
    def _visual(shape):
        # Geometry/tags alone miss glyph edits. Export only this shape locally;
        # hash decoded pixels so PNG metadata cannot cause false mismatches.
        from PIL import Image
        with tempfile.TemporaryDirectory(prefix='igb-shape-check-') as folder:
            path = Path(folder) / 'shape.png'
            shape.Export(str(path), 2, 4096, 4096)
            with Image.open(path) as image:
                if image.width * image.height > 20_000_000:
                    raise ValueError('公式图形过大。')
                image = image.convert('RGBA')
                return hashlib.sha256(str(image.size).encode() + image.tobytes()).hexdigest()

    @staticmethod
    def _binding(app, binding):
        if not isinstance(binding, dict):
            raise ValueError('缺少 PowerPoint 文稿标识。')
        expected = document_path(binding.get('documentUrl'))
        sid = slide_id(binding.get('slideId'))
        window = app.ActiveWindow
        presentation = window.Presentation
        if not presentation.Path or document_path(str(presentation.FullName)) != expected:
            raise ValueError('目标演示文稿已切换，请回到原文稿后重试。')
        if int(window.View.Slide.SlideID) != sid:
            raise ValueError('目标幻灯片已切换，请回到原页后重试。')
        return window, presentation, presentation.Slides.FindBySlideID(sid)

    @staticmethod
    def _target(key, session):
        tree = session['tree']
        owner = source_owner(tree)
        return dict(presentationId=session['binding']['presentationId'],
                    slideId=session['binding']['slideId'], original=tree['data'],
                    sourceTags=owner['tags'], sourceAlt=owner.get('alt', ''),
                    nativeSession=key)

    def _capture(self, request):
        binding = request.get('binding')
        app = self._active()
        window, presentation, slide = self._binding(app, binding)
        selected_id = object_id(binding.get('selectedId'))
        selection = window.Selection
        if selection.Type != 2:
            raise ValueError('请只选中一个公式或公式内的一个字符。')
        selected = selection.ChildShapeRange if selection.HasChildShapeRange else selection.ShapeRange
        if selected.Count != 1 or int(selected(1).Id) != selected_id:
            raise ValueError('选中对象已变化，请重新选择公式。')
        root, tree = None, None
        # Resolve selected glyphs to their top-level group, retaining the same
        # rejection of mixed layout groups used by the modern Office.js path.
        for candidate in slide.Shapes:
            if int(candidate.Id) == selected_id:
                root, tree = candidate, self._tree(candidate)
                break
        if root is None:
            budget = [0, 0]
            for candidate in slide.Shapes:
                if candidate.Type != 6:
                    continue
                possible = self._tree(candidate, budget)
                if contains(possible, selected_id):
                    root, tree = candidate, possible
                    break
        if root is None or tree['data']['type'] != 'Group':
            raise ValueError('未找到选中字符所属的公式组合，请选择整条公式。')
        source_owner(tree)
        self._prune()
        key = uuid.uuid4().hex
        session = dict(binding=dict(binding), presentation=presentation, slide=slide,
                       root=root, window=window, tree=tree,
                       visual=self._visual(root), touched=time.monotonic())
        # No presentation/shape tags are added just to establish identity.
        self._sessions[key] = session
        self._prune()
        return self._target(key, session)

    def _inspect(self, session, binding):
        for name in ('presentationId', 'slideId'):
            if str(binding.get(name)) != str(session['binding'].get(name)):
                raise ValueError('目标文稿或幻灯片已切换，请重新读取公式。')
        if document_path(binding.get('documentUrl')) != document_path(session['binding']['documentUrl']):
            raise ValueError('目标文稿已切换，请重新读取公式。')
        app = self._active()
        window, presentation, slide = self._binding(app, binding)
        if window != session['window'] or presentation != session['presentation']:
            raise ValueError('目标文稿窗口已变化，请重新读取公式。')
        # Live COM identity also rejects close/reopen of a file with identical IDs.
        if session['slide'] != slide:
            raise ValueError('目标幻灯片已变化，请重新读取公式。')
        matches = [s for s in slide.Shapes if str(s.Id) == session['tree']['data']['id']]
        if len(matches) != 1 or matches[0] != session['root']:
            raise ValueError('原公式已删除或替换，请重新读取公式。')
        old = matches[0]
        if structure(self._tree(old)) != structure(session['tree']) or self._visual(old) != session['visual']:
            raise ValueError('公式或排版已在编辑期间变化，未覆盖。请重新读取公式。')
        return app, slide, old

    def _apply(self, request, rendered):
        self._prune()
        key = request.get('nativeSession')
        session = self._sessions.get(key) if isinstance(key, str) else None
        if session is None:
            raise ValueError('原生编辑会话已过期，请重新读取公式。')
        binding = request.get('binding')
        if not isinstance(binding, dict):
            raise ValueError('缺少 PowerPoint 文稿标识。')
        box = layout(session['tree']['data'], rendered, request.get('mode', 'font'), request.get('align'))
        app, slide, old = self._inspect(session, binding)
        path = Path(rendered['path'])
        if rendered.get('output') not in ('svg', 'png') or not path.is_file():
            raise ValueError('预览文件已失效，请重新预览。')
        added, deletion_started = None, False
        try:
            app.StartNewUndoEntry()
            added = slide.Shapes.AddPicture(str(path), False, True, box['left'], box['top'], box['width'], box['height'])
            expected = dict(rendered['tags'], IGUANABRIDGEMETA=rendered['alt'])
            for name, value in expected.items():
                added.Tags.Add(name, str(value))
            added.AlternativeText = rendered['alt']
            added.Name = session['tree']['data']['name']
            saved = self._tree(added)
            if (any(saved['data']['tags'].get(k) != str(v) for k, v in expected.items()) or
                    saved['data']['alt'] != rendered['alt']):
                raise ValueError('PowerPoint 未完整保存公式源码，已取消替换。')
            # Stage fully validated image and source before touching the original.
            self._inspect(session, binding)
            added.ZOrder(1)  # msoSendToBack
            for _ in range(session['tree']['data']['z'] + 1):
                added.ZOrder(2)  # msoBringForward: immediately above old
            saved = self._tree(added)
            saved['data']['z'] = session['tree']['data']['z']
            visual = self._visual(added)
            self._inspect(session, binding)
            deletion_started = True
            old.Delete()
            session.update(root=added, tree=saved, visual=visual, touched=time.monotonic())
            self._sessions.move_to_end(key)
            # Metadata is already validated; do not delete the new image if a
            # subsequent COM read or response delivery is lost after this point.
            return self._target(key, session)
        except Exception as exc:
            if added is not None and not deletion_started:
                try:
                    added.Delete()
                except Exception:
                    raise ValueError('替换已停止，原公式已保留；新增对象未能清理，请检查本页。') from exc
            if deletion_started:
                self._sessions.pop(key, None)
                raise ValueError('写入结果未能确认，新公式已保留。请检查幻灯片并重新读取公式。') from exc
            raise
