import unittest

from bridge import render
from latex_source import complete_source, replace_formula
from wps_support import WpsBridge


class FullLatexTests(unittest.TestCase):
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
