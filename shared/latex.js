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
    root.IguanaLatex = {prepare: prepare, load: load, merge: merge, selectBody: selectBody};
}(typeof window !== 'undefined' ? window : globalThis));
