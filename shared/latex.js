/* One server-owned document template; the text displayed is the text compiled. */
(function (root) {
    'use strict';
    async function prepare(field, api) {
        var original = field.value;
        var result = await api('latex/source', {source: original});
        if (field.value !== original) throw new Error('源码已变更，请重新预览。');
        field.value = result.source;
        return result.source;
    }
    async function load(field, source, api) {
        field.value = source;
        return prepare(field, api);
    }
    async function merge(source, current, api) {
        return (await api('latex/source', {source: source, base: current})).source;
    }
    function selectBody(field) {
        var start = field.value.indexOf('\\[\n'), end = field.value.lastIndexOf('\n\\]');
        if (start >= 0 && end > start && field.setSelectionRange) field.setSelectionRange(start + 3, end);
    }
    var widthStart = '%<IguanaTexBridge:line-width>', widthEnd = '%</IguanaTexBridge:line-width>';
    function activeTex(source) {
        // Keep offsets intact while ignoring comments and escaped percent signs.
        return source.replace(/(\\[\s\S])|(%[^\r\n]*)/g, function (match, escaped) {
            return escaped || ' '.repeat(match.length);
        });
    }
    function documentBegin(source) {
        var match = /\\begin\s*\{document\}/.exec(activeTex(source));
        return match ? match.index + match[0].length : -1;
    }
    function widthBlock(source) {
        var start = source.indexOf(widthStart), end = source.indexOf(widthEnd);
        if (start < 0 && end < 0) return {ratio: 1, exists: false};
        if (start < 0 || end < start || source.indexOf(widthStart, start + widthStart.length) >= 0 ||
                source.indexOf(widthEnd, end + widthEnd.length) >= 0) return null;
        var before = source.slice(start - 2, start) === '\r\n' ? 2 : source.charAt(start - 1) === '\n' ? 1 : 0;
        var afterPos = end + widthEnd.length;
        var after = source.slice(afterPos, afterPos + 2) === '\r\n' ? 2 : source.charAt(afterPos) === '\n' ? 1 : 0;
        var lines = source.slice(start, afterPos).split(/\r?\n/);
        var match = lines.length === 6 && /^\\setlength\{\\textwidth\}\{((?:\d+(?:\.\d*)?|\.\d+))\\textwidth\}$/.exec(lines[1]);
        if (!before || !after || documentBegin(source) !== start - before || !match ||
                lines[0] !== widthStart || lines[2] !== '\\setlength{\\columnwidth}{\\textwidth}' ||
                lines[3] !== '\\setlength{\\linewidth}{\\textwidth}' ||
                lines[4] !== '\\setlength{\\hsize}{\\textwidth}' || lines[5] !== widthEnd ||
                !(Number(match[1]) >= 0.1 && Number(match[1]) <= 1)) return null;
        return {ratio: Number(match[1]), exists: true, start: start - before, end: afterPos + after};
    }
    function lineWidth(source) {
        var block = widthBlock(source);
        return block ? block.ratio : null;
    }
    function withLineWidth(source, value) {
        var ratio = Number(value);
        if (!String(value).trim() || !isFinite(ratio) || ratio < 0.1 || ratio > 1) {
            throw new Error('行宽比例须在 0.1–1 之间。');
        }
        var block = widthBlock(source);
        if (!block) throw new Error('源码中的行宽设置已被修改，请先检查或移除行宽标记，再调整比例。');
        if (block.ratio === ratio) return source;
        var base = block.exists ? source.slice(0, block.start) + source.slice(block.end) : source;
        if (ratio === 1) return base;
        var position = documentBegin(base);
        if (position < 0) throw new Error('找不到 document 环境，请先补全 LaTeX 源码。');
        var newline = base.slice(position, position + 2) === '\r\n' ? '\r\n' : '\n';
        var insert = [widthStart, '\\setlength{\\textwidth}{' + ratio + '\\textwidth}',
            '\\setlength{\\columnwidth}{\\textwidth}', '\\setlength{\\linewidth}{\\textwidth}',
            '\\setlength{\\hsize}{\\textwidth}', widthEnd].join(newline);
        return base.slice(0, position) + newline + insert + newline + base.slice(position);
    }
    root.IguanaLatex = {prepare: prepare, load: load, merge: merge, selectBody: selectBody,
        lineWidth: lineWidth, withLineWidth: withLineWidth};
}(typeof window !== 'undefined' ? window : globalThis));
