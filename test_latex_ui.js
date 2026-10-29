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
    console.log('5 full-document UI tests passed');
})().catch(e => { console.error(e); process.exitCode = 1; });
