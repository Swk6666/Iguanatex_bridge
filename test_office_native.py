"""Safety contract tests for the Windows adapter, runnable without Windows/Office."""
from copy import deepcopy
from pathlib import Path
from types import SimpleNamespace
import tempfile
import unittest

from bridge import encode_meta
from office_native import NativePowerPoint, document_path, slide_id, structure


class Tags:
    def __init__(self, values=None):
        self.values = dict(values or {})
        self.truncate = False

    @property
    def Count(self): return len(self.values)
    def Name(self, i): return list(self.values)[i - 1]
    def Value(self, i): return list(self.values.values())[i - 1]
    def Add(self, key, value):
        self.values[key] = 'TRUNCATED' if self.truncate and key == 'LATEXADDIN' else value


class Collection:
    def __init__(self, items=()): self.items = list(items)
    @property
    def Count(self): return len(self.items)
    def __iter__(self): return iter(self.items)
    def __call__(self, i): return self.items[i - 1]


class Shape:
    def __init__(self, id, kind=28, tags=None, children=()):
        self.Id, self.Type, self.Name = id, kind, 'Equation ' + str(id)
        self.Left, self.Top, self.Width, self.Height = 25., 30., 50., 20.
        self.Rotation, self.HorizontalFlip, self.VerticalFlip, self.Visible = 0., 0, 0, -1
        self.Tags, self.AlternativeText, self.GroupItems = Tags(tags), '', Collection(children)
        self.pixels, self.collection, self.fail_delete = 'original pixels', None, False

    @property
    def ZOrderPosition(self): return self.collection.items.index(self) + 1 if self.collection else 1
    def Delete(self):
        self.collection.items.remove(self)
        if self.fail_delete: raise RuntimeError('Commit response lost')
    def ZOrder(self, op):
        old = self.collection.items.index(self)
        self.collection.items.remove(self)
        self.collection.items.insert(0 if op == 1 else old + 1, self)


class Shapes(Collection):
    def __init__(self, items):
        super().__init__(items)
        for shape in self.items: shape.collection = self
        self.next_id, self.truncate, self.concurrent_edit = 100, False, None
    def AddPicture(self, path, link, embed, left, top, width, height):
        assert not link and embed
        self.next_id += 1
        shape = Shape(self.next_id)
        shape.Left, shape.Top, shape.Width, shape.Height = left, top, width, height
        shape.collection, shape.Tags.truncate = self, self.truncate
        self.items.append(shape)
        if self.concurrent_edit: self.concurrent_edit()
        return shape


class FakeNative(NativePowerPoint):
    def __init__(self, app):
        super().__init__()
        self.app = app
    def _active(self): return self.app
    def _visual(self, shape):
        return structure({'pixels': shape.pixels, 'children': [self._visual(c) for c in shape.GroupItems]})


class NativeTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(); self.addCleanup(self.temp.cleanup)
        self.asset = Path(self.temp.name) / 'preview.svg'; self.asset.write_text('<svg/>')
        self.glyph = Shape(12, 5, {'EMFCHILD': 'True', 'LATEXADDIN': r'CaseSensitive \alpha'})
        self.group = Shape(11, 6, {'LATEXADDIN': r'CaseSensitive \alpha'}, [self.glyph])
        self.other = Shape(22)
        self.shapes = Shapes([self.other, self.group, Shape(30)])
        self.slide = SimpleNamespace(SlideID=712, Shapes=self.shapes)
        self.presentation = SimpleNamespace(Path=r'C:\slides', FullName=r'C:\slides\test.pptx',
            Slides=SimpleNamespace(FindBySlideID=lambda sid: self.slide if sid == 712 else None))
        self.window = SimpleNamespace(Presentation=self.presentation, View=SimpleNamespace(Slide=self.slide),
            Selection=SimpleNamespace(Type=2, HasChildShapeRange=False, ShapeRange=Collection([self.group])))
        self.app = SimpleNamespace(ActiveWindow=self.window, StartNewUndoEntry=lambda: None)
        self.native = FakeNative(self.app); self.addCleanup(self.native.close)
        self.binding = dict(documentUrl='file:///C:/slides/test.pptx', presentationId='Presentation', slideId='712#1977420541', selectedId='11')
        self.render = dict(path=str(self.asset), output='svg', width=100., height=40.,
                           tags={'LATEXADDIN': r'Updated \Beta', 'LATEXENGINEID': '2'},
                           alt=encode_meta({'source': r'Updated \Beta', 'engine': 'xelatex'}))

    def capture(self): return self.native._capture({'binding': self.binding})
    def apply(self, target, **kw):
        return self.native._apply(dict(binding=self.binding, nativeSession=target['nativeSession'], mode='height', **kw), self.render)

    def test_capture_group_and_glyph_without_writes(self):
        before = deepcopy(self.group.Tags.values)
        target = self.capture()
        self.assertEqual(target['sourceTags']['LATEXADDIN'], r'CaseSensitive \alpha')
        self.assertEqual(before, self.group.Tags.values)
        self.window.Selection.HasChildShapeRange = True
        self.window.Selection.ChildShapeRange = Collection([self.glyph])
        self.binding['selectedId'] = '12'
        self.assertEqual(self.capture()['original']['id'], target['original']['id'])

    def test_svg_update_and_repeat_preserve_box_z_and_metadata(self):
        original = self.capture()
        target = self.apply(original)
        self.assertEqual([s.Id for s in self.shapes], [22, 101, 30])
        self.assertEqual((target['original']['left'], target['original']['top'], target['original']['height']), (25, 30, 20))
        self.assertEqual(target['sourceTags']['LATEXADDIN'], self.render['tags']['LATEXADDIN'])
        self.assertEqual(target['sourceAlt'], self.render['alt'])
        again = self.apply(target)
        self.assertEqual([s.Id for s in self.shapes], [22, 102, 30])
        self.assertEqual(again['nativeSession'], original['nativeSession'])

    def test_missing_or_changed_selection_does_not_capture(self):
        self.window.Selection.ShapeRange = Collection([self.other])
        with self.assertRaisesRegex(ValueError, '选中对象已变化'): self.capture()
        self.assertFalse(self.native._sessions)

    def test_rejects_mixed_outer_group(self):
        self.group.GroupItems.items.append(Shape(99))
        with self.assertRaisesRegex(ValueError, '外层排版组合'): self.capture()

    def test_rejects_conflicting_formula_and_backup_only_child(self):
        self.glyph.Tags.values['LATEXADDIN'] = 'different'
        with self.assertRaisesRegex(ValueError, '多个不同公式'): self.capture()
        self.glyph.Tags.values.pop('LATEXADDIN')
        self.glyph.Tags.values['IGUANABRIDGEMETA'] = encode_meta({'source': 'different'})
        with self.assertRaisesRegex(ValueError, '多个不同公式'): self.capture()

    def test_source_on_first_glyph_only(self):
        self.group.Tags.values.clear()
        self.assertEqual(self.capture()['sourceTags']['LATEXADDIN'], r'CaseSensitive \alpha')

    def test_changed_glyph_geometry_or_pixels_refuses_write(self):
        target = self.capture()
        self.glyph.Left += 1
        with self.assertRaisesRegex(ValueError, '变化'): self.apply(target)
        self.glyph.Left -= 1
        self.glyph.pixels = 'recolored glyph'
        with self.assertRaisesRegex(ValueError, '变化'): self.apply(target)
        self.assertEqual(self.shapes.Count, 3)

    def test_wrong_document_slide_and_reopened_window_refuse_write(self):
        target = self.capture()
        self.presentation.FullName = r'C:\slides\different.pptx'
        with self.assertRaisesRegex(ValueError, '切换'): self.apply(target)
        self.presentation.FullName = r'C:\slides\test.pptx'
        self.window.View.Slide = SimpleNamespace(SlideID=713)
        with self.assertRaisesRegex(ValueError, '切换'): self.apply(target)
        self.window.View.Slide = self.slide
        self.app.ActiveWindow = SimpleNamespace(**vars(self.window), changed=True)
        with self.assertRaisesRegex(ValueError, '窗口已变化'): self.apply(target)
        self.assertEqual(self.shapes.Count, 3)

    def test_truncated_source_rolls_back_new_only(self):
        target = self.capture(); self.shapes.truncate = True
        with self.assertRaisesRegex(ValueError, '未完整保存'): self.apply(target)
        self.assertEqual([s.Id for s in self.shapes], [22, 11, 30])

    def test_concurrent_edit_during_insertion_rolls_back_new(self):
        target = self.capture()
        self.shapes.concurrent_edit = lambda: setattr(self.glyph, 'Left', 999)
        with self.assertRaisesRegex(ValueError, '变化'): self.apply(target)
        self.assertEqual([s.Id for s in self.shapes], [22, 11, 30])

    def test_uncertain_delete_keeps_new_and_invalidates_session(self):
        target = self.capture(); self.group.fail_delete = True
        with self.assertRaisesRegex(ValueError, '新公式已保留'): self.apply(target)
        self.assertEqual([s.Id for s in self.shapes], [22, 101, 30])
        with self.assertRaisesRegex(ValueError, '过期'): self.apply(target)

    def test_invalid_size_expired_session_and_missing_render_cannot_write(self):
        target = self.capture(); self.render['width'] = float('nan')
        with self.assertRaisesRegex(ValueError, '尺寸无效'): self.apply(target)
        self.render['width'] = 100; self.asset.unlink()
        with self.assertRaisesRegex(ValueError, '失效'): self.apply(target)
        self.native._sessions[target['nativeSession']]['touched'] -= 1801
        with self.assertRaisesRegex(ValueError, '过期'): self.apply(target)
        self.assertEqual(self.shapes.Count, 3)

    def test_path_normalization_and_unsaved_remote_rejection(self):
        self.assertEqual(document_path('file:///C:/%E5%85%AC%E5%BC%8F/test.pptx'), document_path('C:\\公式\\test.pptx'))
        for value in ('', 'relative.pptx', 'https://example.com/test.pptx'):
            with self.assertRaises(ValueError): document_path(value)
        self.assertEqual(slide_id('712#1977420541'), 712)
        self.assertEqual(slide_id('712'), 712)
        for value in ('712#bad', '712#1#2', '712abc'):
            with self.assertRaises(ValueError): slide_id(value)

    def test_same_numeric_slide_with_changed_office_identity_refuses_write(self):
        target = self.capture()
        self.binding['slideId'] = '712#999'
        with self.assertRaisesRegex(ValueError, '切换'): self.apply(target)
        self.assertEqual(self.shapes.Count, 3)


if __name__ == '__main__': unittest.main()
