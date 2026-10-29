"""Visible, editable LaTeX documents shared by every editor and renderer."""
import re

MAX_SOURCE = 200_000
DEFAULT_FORMULA = 'E = mc^{2}'
PREAMBLE = r'''\documentclass[10pt]{article}
\usepackage{amsmath,amssymb,bm}
\usepackage{iftex}
\ifPDFTeX
  \usepackage[T1]{fontenc}
\else
  \usepackage[fontset=fandol]{ctex}
\fi
\pagestyle{empty}
\begin{document}
'''


def checked(source):
    if not isinstance(source, str) or not source.strip() or len(source) > MAX_SOURCE:
        raise ValueError('源码为空或超过 200,000 个字符。')
    return source


def active_tex(source):
    """Mask comments without changing character offsets (including escaped %)."""
    return re.sub(r'(\\[\s\S])|(%[^\r\n]*)',
                  lambda m: m[1] if m[1] else ' ' * len(m[0]), source)


def is_document(source):
    return re.search(r'\\documentclass\b', active_tex(source)) is not None


def math_body(source):
    body = source.strip()
    # OCR commonly returns display delimiters or a self-contained math environment.
    if ((body.startswith(r'\[') and body.endswith(r'\]'))
            or (body.startswith(r'\(') and body.endswith(r'\)'))
            or (body.startswith('$') and body.endswith('$'))
            or re.match(r'\\begin\s*\{(?:equation\*?|align\*?|gather\*?|multline\*?|displaymath|math)\}', body)):
        return body
    return '\\[\n' + source + '\n\\]'


def complete_source(source):
    checked(source)
    if is_document(source):
        # Never rewrite a user's packages, macros, comments, whitespace or body.
        return source
    if re.search(r'\\(?:usepackage|RequirePackage)\b|\\(?:begin|end)\s*\{document\}', active_tex(source)):
        raise ValueError('这段代码包含导言区或 document 环境，请补上 \\documentclass，使用完整 LaTeX 文档。')
    return checked(PREAMBLE + math_body(source) + '\n\\end{document}\n')


def replace_formula(current, incoming):
    """Adopt an OCR formula while preserving an existing document's preamble."""
    checked(incoming)
    if is_document(incoming) or not current.strip() or not is_document(current):
        return complete_source(incoming)
    checked(current)
    active = active_tex(current)
    begin = re.search(r'\\begin\s*\{document\}', active)
    end = re.search(r'\\end\s*\{document\}', active)
    if not begin or not end or end.start() < begin.end():
        raise ValueError('现有文档的 document 环境不完整，已保留原文；请修正后再采用识别结果。')
    # Validate a fragment before placing it inside an existing document.
    complete_source(incoming)
    return checked(current[:begin.end()] + '\n' + math_body(incoming)
                   + '\n' + current[end.start():])
