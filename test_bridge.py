"""Run with python -m unittest -v. No WPS/PowerPoint integration is claimed."""
import copy
import io
from pathlib import Path
import unittest
import zipfile

from PIL import Image
from bridge import *


class BridgeTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.rendered = render(r'\begin{aligned}M(q)\ddot q+C(q,\dot q)\dot q+g(q)&=\tau\\A x&=b\end{aligned}')

    def fresh(self):
        d = Deck.blank()
        d.add_or_update(self.rendered)
        return Deck(d.bytes())

    def strip_tags(self, d):
        for r in d.records():
            nvpr = d.nv(r['shape']).find('p:nvPr', NS)
            lst = nvpr.find('p:custDataLst', NS)
            if lst is not None:
                nvpr.remove(lst)

    def test_native_tags_xml_and_case_roundtrip(self):
        d = self.fresh()
        r = d.records()[0]
        text = self.rendered.source + '\n% 中文 CaseSensitive A!=a & < > " tabs\t\n'
        d.stamp(r['part'], r['shape'], text, 'xelatex')
        again = Deck(d.bytes()).records()[0]
        self.assertEqual(again['source'], text)
        self.assertEqual(again['origin'], 'IguanaTex Tags')
        self.assertEqual(again['tags']['LATEXENGINEID'], '2')
        self.assertEqual(again['tags']['BITMAPVECTOR'], '0')
        with zipfile.ZipFile(io.BytesIO(d.bytes())) as z:
            self.assertIsNone(z.testzip())
            for name in z.namelist():
                if name.endswith(('.xml', '.rels')):
                    xml(z.read(name))

    def test_transparent_real_latex_render(self):
        with Image.open(io.BytesIO(self.rendered.png)) as im:
            self.assertEqual(im.mode, 'RGBA')
            low, high = im.getchannel('A').getextrema()
            self.assertEqual(low, 0)
            self.assertGreater(high, 0)
            self.assertLess(im.height, 500)

    def test_recover_after_tag_loss(self):
        d = self.fresh()
        self.strip_tags(d)
        d = Deck(d.bytes())
        self.assertEqual(d.records()[0]['origin'], '替代文字备份')
        self.assertEqual(d.protect(), 1)
        self.assertEqual(Deck(d.bytes()).records()[0]['source'], self.rendered.source)
        self.assertEqual(Deck(d.bytes()).records()[0]['origin'], 'IguanaTex Tags')

    def test_recover_png_when_both_tags_and_alt_lost(self):
        d = self.fresh()
        self.strip_tags(d)
        for r in d.records():
            d.properties(r['shape']).set('descr', '')
        restored = Deck(d.bytes())
        self.assertEqual(restored.records()[0]['origin'], 'PNG 源码备份')
        restored.protect()
        self.assertEqual(Deck(restored.bytes()).records()[0]['source'], self.rendered.source)

    def test_no_source_is_not_invented(self):
        d = self.fresh()
        r = d.records()[0]
        ip = d.image_part(r['part'], r['shape'])
        d.parts[ip] = self.rendered.png  # Raw PNG without source metadata.
        self.strip_tags(d)
        d.properties(r['shape']).set('descr', '')
        self.assertEqual(Deck(d.bytes()).records(), [])

    def test_native_update_wins_over_stale_backup(self):
        d = self.fresh()
        r = d.records()[0]
        tags = dict(r['tags'], LATEXADDIN=complete_source('a=B'))
        d.set_tags(r['part'], r['shape'], tags)
        self.assertEqual(d.records()[0]['source'], complete_source('a=B'))
        d.protect()
        self.strip_tags(d)
        self.assertEqual(Deck(d.bytes()).records()[0]['source'], complete_source('a=B'))
        d.properties(r['shape']).set('descr', '')
        self.assertEqual(Deck(d.bytes()).records()[0]['source'], complete_source('a=B'))

    def test_replacement_isolated_from_shared_media(self):
        d = self.fresh()
        r = d.records()[0]
        first = r['shape']
        second = copy.deepcopy(first)
        d.properties(second).set('id', '99')
        d.properties(second).set('name', 'Copied formula')
        first.getparent().append(second)
        old_media = d.image_part(r['part'], second)
        old_png = d.parts[old_media]
        transform = first.find('p:spPr/a:xfrm', NS)
        transform.set('rot', '1200000')
        before_y = transform.find('a:off', NS).get('y')
        before_h = transform.find('a:ext', NS).get('cy')
        d.add_or_update(render('x+y=z'), shape_id=r['shape_id'])
        records = Deck(d.bytes()).records()
        self.assertEqual(len(records), 2)
        self.assertEqual(records[0]['source'], complete_source('x+y=z'))
        self.assertEqual(records[1]['source'], self.rendered.source)
        self.assertEqual(d.parts[old_media], old_png)
        xf = records[0]['shape'].find('p:spPr/a:xfrm', NS)
        self.assertEqual(xf.get('rot'), '1200000')
        self.assertEqual(xf.find('a:off', NS).get('y'), before_y)
        self.assertEqual(xf.find('a:ext', NS).get('cy'), before_h)

    def test_unrelated_parts_preserved_byte_for_byte(self):
        d = Deck.blank()
        d.parts['customXml/fixture.xml'] = b'<fixture>opaque content &amp; attributes</fixture>'
        original = dict(d.parts)
        d.add_or_update(self.rendered)
        out = Deck(d.bytes())
        changed = set(d.docs)
        for name, data in original.items():
            if name not in changed:
                self.assertEqual(out.parts[name], data, name)

    def test_invalid_latex_fails_without_deck_mutation(self):
        d = self.fresh()
        before = d.bytes()
        with self.assertRaisesRegex(ValueError, '编译失败'):
            render(r'\nonexistentcommandXYZ')
        self.assertEqual(d.bytes(), before)

    def test_tagged_group_source_can_be_read_and_protected(self):
        d = self.fresh()
        rec = d.records()[0]
        pic = rec['shape']
        group = ET.Element('{%s}grpSp' % P)
        nv = child(group, 'p:nvGrpSpPr')
        child(nv, 'p:cNvPr', id='100', name='IguanaTex group')
        child(nv, 'p:cNvGrpSpPr')
        child(nv, 'p:nvPr')
        child(group, 'p:grpSpPr')
        pic.getparent().replace(pic, group)
        group.append(pic)
        d.stamp(rec['part'], group, self.rendered.source, 'xelatex', {'BITMAPVECTOR': '1'})
        d = Deck(d.bytes())
        self.assertEqual(len(d.records()), 1)
        self.assertEqual(d.records()[0]['shape_id'], '100')
        self.assertEqual(d.protect(), 1)
        with self.assertRaisesRegex(ValueError, 'WPS 工具栏'):
            d.add_or_update(self.rendered, shape_id='100')


if __name__ == '__main__':
    unittest.main()
