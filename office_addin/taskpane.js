(function () {
    'use strict';
    var $ = function (id) { return document.getElementById(id); };
    var target = null, token = null, preview = null, previewKey = '', busy = false, appliedSize = 24, ready = false;
    var mode = new URLSearchParams(location.search).get('mode') || 'new';
    function status(text, error) { $('status').textContent = text; $('status').className = error ? 'error' : ''; }
    async function api(path, data, retry) {
        if (!token) {
            var session = await fetch('/api/session', {cache: 'no-store'});
            if (!session.ok) throw new Error('本地服务连接失败，请重启启动脚本。');
            token = (await session.json()).token;
        }
        var response = await fetch('/api/' + path, {method: 'POST', headers: {'Content-Type': 'application/json', 'X-Bridge-Token': token}, body: JSON.stringify(data || {})});
        if (response.status === 403 && !retry) { token = null; return api(path, data, true); }
        var result = await response.json();
        if (!response.ok) throw new Error(result.error || '本地服务不可用。');
        return result;
    }
    function lock(disabled) {
        // The AI panel manages its own controls; its prompt must stay typable while compiling.
        document.querySelectorAll('button,textarea,select,input').forEach(function (e) {
            if (!(e.closest && e.closest('.chat-panel'))) e.disabled = disabled;
        });
    }
    async function run(fn) {
        if (busy || chat.isBusy()) return;
        busy = true;
        lock(true);
        try { await fn(); } catch (e) { status(e.message, true); }
        finally {
            busy = false;
            lock(false);
            $('apply').disabled = !ready || (mode === 'edit' && !target);
        }
    }
    function reset() {
        target = null; preview = null; $('sizeModeLabel').hidden = true; $('sizeMode').value = 'font';
        clearPreview('点击预览，查看当前源码的编译结果。');
        $('apply').textContent = '插入当前幻灯片';
    }
    function key() { return JSON.stringify([$('source').value, $('engine').value, $('output').value, $('pointSize').value]); }
    function clearPreview(message) {
        preview = null; previewKey = '';
        $('formulaImage').hidden = true; $('formulaImage').src = '';
        $('previewHint').hidden = false; $('previewHint').textContent = message;
    }
    // Server-side LaTeX failures can be handed to the AI assistant with one click.
    var compileError = null;
    function compileApi(path, data) { return api(path, data).catch(function (e) { e.compile = true; throw e; }); }
    function setCompileError(info) { compileError = info; $('aiFix').hidden = !info; }
    function previewChanged() { setCompileError(null); clearPreview('内容或设置已修改，请重新预览。'); }
    $('source').oninput = previewChanged;
    $('engine').onchange = previewChanged;
    $('output').onchange = previewChanged;
    async function renderFormula() {
        try {
            setCompileError(null);
            await IguanaLatex.prepare($('source'), compileApi);
            var requestKey = key(), size = Number($('pointSize').value);
            if (!(size >= 4 && size <= 200)) throw new Error('字号须在 4–200 pt 之间。');
            if (!preview || previewKey !== requestKey) {
                clearPreview('正在编译当前源码…');
                status('正在本机编译公式…');
                var result = await compileApi('render', {source: $('source').value, engine: $('engine').value, output: $('output').value, point_size: size});
                if (key() !== requestKey) throw new Error('源码已变更，请重新预览。');
                preview = result;
                previewKey = requestKey;
            }
            $('formulaImage').src = 'data:image/png;base64,' + preview.png;
            $('formulaImage').hidden = false; $('previewHint').hidden = true;
            status('预览已生成，请核对公式后写入。');
            return preview;
        } catch (e) {
            clearPreview('编译未完成，请修正源码或设置后重新预览。');
            if (e.compile) setCompileError({source: $('source').value, engine: $('engine').value, message: e.message});
            throw e;
        }
    }
    var chat = IguanaChat.mount($('chatPanel'), {api: api, source: $('source'), canStart: function () { return !busy; },
        collapsed: false, docked: true,
        prepareSource: function (source, current) { return IguanaLatex.merge(source, current, api); }, onSource: previewChanged});
    async function newFormula() {
        mode = 'new'; reset(); await IguanaLatex.load($('source'), 'E=mc^{2}', api);
        IguanaLatex.selectBody($('source'));
        status('新建公式：编辑完整 LaTeX 文档，预览后插入当前幻灯片。');
    }
    async function loadSelection() {
        mode = 'edit'; reset(); $('apply').textContent = '更新选中公式';
        var selected = await IguanaOffice.capture(true);
        var tags = selected.sourceTags || selected.original.tags;
        var meta = await api('metadata', {tags: tags, alt: tags.IGUANABRIDGEMETA || ''});
        if (!meta.found) throw new Error('选中对象没有公式源码。请选中 IguanaTeX / Bridge 公式，或点击“新建公式”后识别截图。');
        if (!['xelatex', 'pdflatex', 'lualatex'].includes(meta.engine)) throw new Error('此公式使用不支持的编译引擎。');
        await IguanaLatex.load($('source'), meta.source, api);
        target = selected; preview = null; $('engine').value = meta.engine;
        var format = String(meta.tags.OUTPUTTYPE || '').toUpperCase();
        $('output').value = ['SVG', 'PDF', 'EMF'].includes(format) || selected.original.type === 'Group' || meta.tags.BITMAPVECTOR === '1' ? 'svg' : 'png';
        appliedSize = Number(meta.tags.IGUANATEXSIZE) || 24; $('pointSize').value = appliedSize;
        $('sizeModeLabel').hidden = false; $('sizeMode').value = 'font'; $('apply').textContent = '更新已读取的公式';
        status(selected.original.type === 'Group' ? '已读取 IguanaTeX Shape 组合的完整源码。更新后保存为 SVG / PNG，仍可用原 IguanaTeX 继续编辑。' : '已读取公式源码和字号。修改后更新，也可用原 IguanaTeX 继续编辑。');
    }
    $('new').onclick = function () { return run(newFormula); };
    $('load').onclick = function () { return run(loadSelection); };
    $('pointSize').oninput = function () { $('sizeMode').value = 'font'; previewChanged(); };
    $('sizeMode').onchange = function () {
        if ($('sizeMode').value !== 'font') $('pointSize').value = appliedSize;
        if (previewKey !== key()) previewChanged();
    };
    $('previewButton').onclick = function () { return run(renderFormula); };
    $('aiFix').onclick = function () {
        if (!compileError) return;
        if ($('assistantDock').hidden) $('assistantToggle').click();
        return chat.ask(IguanaChat.compileReport(compileError));
    };
    $('apply').onclick = function () { return run(async function () {
        if (!ready) throw new Error('尚未连接 PowerPoint。');
        if (mode === 'edit' && !target) throw new Error('请先选中并读取要修改的公式。');
        var captured = target || await IguanaOffice.capture(false);
        var data = await renderFormula();
        target = await IguanaOffice.apply(captured, data, target ? $('sizeMode').value : 'font');
        appliedSize = Number(data.tags.IGUANATEXSIZE); preview = null;
        $('sizeModeLabel').hidden = false; $('apply').textContent = '更新此公式';
        status('公式与源码已写入，请在 PowerPoint 中保存 PPTX。');
    }); };
    $('doctor').onclick = function () { run(async function () { $('diagnostics').textContent = JSON.stringify(await api('doctor'), null, 2); }); };
    if (!window.Office) { status('Office.js 加载失败，请检查网络或从 PowerPoint 加载项打开。', true); return; }
    Office.onReady(function (info) {
        if (info.host !== Office.HostType.PowerPoint) { status('请在 PowerPoint 中打开此加载项。', true); return; }
        if (!Office.context.requirements.isSetSupported('PowerPointApi', '1.5')) {
            status('此 PowerPoint 版本不支持所需 API。请更新 Office，或打开独立 PPTX 编辑器。', true); return;
        }
        ready = true;
        if (mode === 'edit') run(loadSelection);
        else if (mode === 'new') run(newFormula);
        else run(newFormula);
    });
}());
