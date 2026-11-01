'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const sandbox = {};
vm.runInNewContext(fs.readFileSync('shared/latex.js', 'utf8'), sandbox);
const latex = sandbox.IguanaLatex;
(async () => {
    const full = '\\documentclass{article}\n\\usepackage{amsmath}\n\\begin{document}\n\\[\nx\n\\]\n\\end{document}\n';
    const field = {value: 'x', setSelectionRange(a, b) { this.selection = [a, b]; }};
    await latex.prepare(field, async (path, data) => {
        assert.equal(path, 'latex/source'); assert.equal(data.source, 'x'); return {source: full};
    });
    assert.equal(field.value, full);
    latex.selectBody(field);
    assert.equal(field.value.slice(...field.selection), 'x');
    await latex.prepare(field, async (_, data) => ({source: data.source}));
    assert.equal(field.value, full, 'custom complete source is not rewritten by the UI');
    let finish;
    const pending = latex.prepare(field, () => new Promise(resolve => { finish = resolve; }));
    field.value = 'a newer user edit'; finish({source: 'stale result'});
    await assert.rejects(pending, /源码已变更/);
    assert.equal(field.value, 'a newer user edit');
    assert.equal(await latex.merge('y', full, async (_, data) => {
        assert.equal(data.base, full); assert.equal(data.source, 'y'); return {source: 'merged document'};
    }), 'merged document');
    field.value = 'keep my code';
    await assert.rejects(latex.prepare(field, async () => { throw Error('service unavailable'); }), /unavailable/);
    assert.equal(field.value, 'keep my code');
    for (const original of [full, '% \\begin{document} is a comment\n' + full,
            full.replace(/\n/g, '\r\n'), full.replace('\\begin{document}\n', '\\begin{document}% a comment\n')]) {
        assert.equal(latex.lineWidth(original), 1);
        assert.equal(latex.withLineWidth(original, 1), original);
        const reduced = latex.withLineWidth(original, '0.6');
        assert.equal(latex.lineWidth(reduced), 0.6);
        assert.match(reduced, /\\setlength\{\\textwidth\}\{0\.6\\textwidth\}/);
        assert.equal(latex.withLineWidth(reduced, 0.6), reduced, 'repeated previews must not scale twice');
        const modified = latex.withLineWidth(reduced, 0.75);
        assert.equal(latex.lineWidth(modified), 0.75);
        assert.equal(latex.withLineWidth(modified, 1), original, 'restoring width must preserve the original document');
    }
    for (const value of ['', '0', '0.09', '1.1', 'NaN', 'Infinity']) {
        assert.throws(() => latex.withLineWidth(full, value), /0\.1–1/);
    }
    const custom = latex.withLineWidth(full, 0.6).replace('\\setlength{\\hsize}{\\textwidth}', '% user modified settings');
    assert.equal(latex.lineWidth(custom), null);
    assert.throws(() => latex.withLineWidth(custom, 0.7), /已被修改/);
    assert.throws(() => latex.withLineWidth('no document', 0.6), /document/);
    console.log('full-document and line-width UI tests passed');
})().catch(e => { console.error(e); process.exitCode = 1; });
