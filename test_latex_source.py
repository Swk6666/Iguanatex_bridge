import unittest

from bridge import render, xml
from latex_source import complete_source, replace_formula
from wps_support import WpsBridge


class FullLatexTests(unittest.TestCase):
    chinese_source = r'''\documentclass{article}
\usepackage{setspace}
\usepackage{amsmath}
\begin{document}
\begin{spacing}{1.2}
$\tau_m$ 为实测的 Franka 关节力矩\\
$W_c$ 为作用在 link0 底部法兰处的六维约束力\\
$\delta$ 为广义力误差，包括模型参数偏差、状态与力矩测量误差\par
\end{spacing}
\end{document}
'''

    def test_missing_chinese_font_rejected_before_svg_or_png_export(self):
        # XeLaTeX exits 0 but drops the Chinese; MuPDF then emits &#xffff;.
        for output in ('svg', 'png'):
            with self.subTest(output=output), self.assertRaisesRegex(ValueError, '字体缺字') as error:
                WpsBridge().render({'source': self.chinese_source, 'engine': 'xelatex', 'output': output})
            self.assertIn(r'\usepackage[fontset=fandol]{ctex}', str(error.exception))
            self.assertIn('Missing character:', str(error.exception))
            self.assertNotIn('xmlParseCharRef', str(error.exception))

    def test_corrected_chinese_document_exports_valid_svg_and_tight_crop(self):
        source = self.chinese_source.replace(r'\begin{document}',
            '\\usepackage[fontset=fandol]{ctex}\n\\pagestyle{empty}\n\\begin{document}')
        result = render(source)
        self.assertEqual(result.source, source)
        root = xml(result.svg)
        # Glyph outlines retain the Chinese labels and occupy just three lines.
        self.assertIn('为', ''.join(root.xpath('//@data-text')))
        self.assertIn('差', ''.join(root.xpath('//@data-text')))
        self.assertLess(result.height_pt, 65)
        self.assertGreater(result.height_pt, 20)

    def test_default_document_compiles_with_chinese_and_common_math_packages(self):
        source = complete_source(r'\bm{x}+\mathbb{R}+\text{惯性项}')
        self.assertIn(r'\documentclass[10pt]{article}', source)
        self.assertIn(r'\usepackage{amsmath,amssymb,bm}', source)
        result = render(source)
        self.assertEqual(result.source, source)
        self.assertGreater(result.width_pt, 0)

    def test_default_document_also_compiles_with_pdflatex(self):
        source = complete_source(r'\frac{a}{b}')
        self.assertEqual(render(source, 'pdflatex').source, source)

    def test_line_width_reflows_chinese_and_is_embedded_as_native_source(self):
        source = r'''\documentclass[10pt]{article}
\usepackage[a4paper,margin=1.5cm]{geometry}
\usepackage[fontset=fandol]{ctex}
\usepackage{amsmath}
\pagestyle{empty}
\begin{document}
这是一段中文和数学符号混合的较长说明，用于检查正文能否按新的行宽自动换行。我们希望保留字号和所有内容，也希望 $\tau_m$ 等行内数学符号保持清楚，并确保完整源码可以跨平台保存。
\[
\boxed{u_{k}=u_{k-1}+g_F(q_k)-\tau_{m,k}}
\]
这里还有一段说明，模拟幻灯片中的公式文字。限制行宽后，文字应该自然换行，同时数学公式仍然保持清晰。
\end{document}
'''
        block = r'''%<IguanaTexBridge:line-width>
\setlength{\textwidth}{0.6\textwidth}
\setlength{\columnwidth}{\textwidth}
\setlength{\linewidth}{\textwidth}
\setlength{\hsize}{\textwidth}
%</IguanaTexBridge:line-width>
'''
        narrow_source = source.replace('\\begin{document}\n', '\\begin{document}\n' + block, 1)
        bridge = WpsBridge()
        full = bridge.render({'source': source, 'engine': 'xelatex', 'point_size': 18, 'output': 'png'})
        narrow = bridge.render({'source': narrow_source, 'engine': 'xelatex', 'point_size': 18, 'output': 'svg'})
        self.assertLess(narrow['width'], full['width'] * 0.7)
        self.assertGreater(narrow['height'], full['height'])
        self.assertEqual(narrow['source'], narrow_source)
        self.assertEqual(narrow['tags']['LATEXADDIN'], narrow_source)
        self.assertEqual(narrow['tags']['IGUANATEXSIZE'], '18.0')
        self.assertEqual(bridge.metadata({'tags': narrow['tags']})['source'], narrow_source)
        self.assertIn('中', ''.join(xml(narrow['svg'].encode()).xpath('//@data-text')))

    def test_custom_packages_and_commands_are_compiled_and_stored_verbatim(self):
        source = ('% Custom document\r\n\\documentclass[10pt]{article}\r\n'
                  '\\usepackage{amsmath,xcolor}\r\n'
                  '\\newcommand{\\myforce}{\\color{red} F}\r\n'
                  '\\pagestyle{empty}\r\n\\begin{document}\r\n'
                  '\\[\\myforce=ma\\]\r\n\\end{document}\r\n')
        self.assertEqual(complete_source(source), source)
        result = WpsBridge().render({'source': source, 'output': 'svg'})
        self.assertEqual(result['source'], source)
        self.assertEqual(result['tags']['LATEXADDIN'], source)

    def test_delimited_ocr_and_equation_environment_are_not_nested(self):
        for fragment in (r'\[x=1\]', r'$$x=1$$', r'\begin{align}a&=b\\c&=d\end{align}'):
            source = complete_source(fragment)
            self.assertEqual(source.count(fragment), 1)
            self.assertNotIn('\\[\n' + fragment, source)
            self.assertEqual(render(source).source, source)

    def test_comment_does_not_hide_a_fragment_and_partial_preamble_is_rejected(self):
        self.assertIn(r'\documentclass[10pt]{article}', complete_source('% \\documentclass is a comment\nx'))
        with self.assertRaisesRegex(ValueError, 'documentclass'):
            complete_source(r'\usepackage{amsmath}' + '\nx')
        for invalid in ('', None, 1, 'x' * 200_001):
            with self.assertRaises(ValueError):
                complete_source(invalid)

    def test_ocr_replaces_body_but_keeps_custom_preamble_and_suffix(self):
        original = complete_source('x').replace(r'\pagestyle{empty}', r'\newcommand{\R}{\mathbb{R}}' + '\n\\pagestyle{empty}')
        original += '% keep this suffix\n'
        source = replace_formula(original, r'\R = \{x\}')
        self.assertEqual(source.split(r'\begin{document}')[0], original.split(r'\begin{document}')[0])
        self.assertTrue(source.endswith('% keep this suffix\n'))
        self.assertEqual(source.count(r'\documentclass'), 1)
        self.assertIn(r'\R = \{x\}', source)
        self.assertEqual(render(source).source, source)

    def test_ocr_full_document_is_unchanged_and_incomplete_base_is_not_destroyed(self):
        document = complete_source('z')
        self.assertEqual(replace_formula(complete_source('x'), document), document)
        with self.assertRaisesRegex(ValueError, '保留原文'):
            replace_formula(r'\documentclass{article}', 'z')


if __name__ == '__main__':
    unittest.main()
