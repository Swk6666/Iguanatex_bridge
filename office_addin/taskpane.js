(function () {
    'use strict';
    var $ = function (id) { return document.getElementById(id); };
    var target = null, insertTarget = null, imageId = null, pictureSettings = null, pictureSourceReady = false, draftError = '', token = null, preview = null, previewKey = '', busy = false, appliedSize = 18, ready = false, widthDirty = false;
    var mode = new URLSearchParams(location.search).get('mode') || 'new';
    var sizePreferenceKey = 'iguanatex-bridge.pointSize';
    var templates = {sum: '\\sum_{k=1}^{n} k = \\frac{n(n+1)}{2}',
        matrix: '\\mathbf{A}=\\begin{bmatrix}a&b\\\\c&d\\end{bmatrix}',
        aligned: '\\begin{aligned}\nM(q)\\ddot q+C(q,\\dot q)\\dot q+g(q)&=\\tau,\\\\\nA x&=b.\n\\end{aligned}',
        chinese: '\\underbrace{M(q)\\ddot q}_{\\text{惯性项}}+g(q)=\\tau'};
    function validSize(value) { var n = Number(value); return isFinite(n) && n >= 4 && n <= 200; }
    function preferredSize() {
        try { var saved = window.localStorage.getItem(sizePreferenceKey); if (validSize(saved)) return Number(saved); } catch (ignored) {}
        return 18;
    }
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
        $('errorDetails').hidden = true;
        try { await fn(); } catch (e) {
            status(e.message.split('\n')[0], true);
            $('errorDetails').hidden = false; $('errorText').textContent = e.compile ? e.message : e.stack || String(e);
        }
        finally {
            busy = false;
            lock(false);
            $('apply').disabled = !ready || ((mode === 'edit' || mode === 'picture') && !target) || (mode === 'picture' && !pictureSourceReady);
        }
    }
    function reset() {
        target = null; insertTarget = null; imageId = null; pictureSettings = null; pictureSourceReady = false; draftError = ''; preview = null; $('sizeModeLabel').hidden = true; $('sizeMode').value = 'font';
        clearPreview('点击预览，查看当前源码的编译结果。');
        $('apply').textContent = '插入当前幻灯片';
    }
    function key() { return JSON.stringify([$('source').value, $('engine').value, $('output').value, $('pointSize').value, $('lineWidth').value]); }
    function clearPreview(message) {
        preview = null; previewKey = '';
        $('formulaImage').hidden = true; $('formulaImage').src = '';
        $('previewSize').hidden = true; $('previewSize').textContent = '';
        $('previewHint').hidden = false; $('previewHint').textContent = message;
    }
    // Server-side LaTeX failures can be handed to the AI assistant with one click.
    var compileError = null;
    function compileApi(path, data) { return api(path, data).catch(function (e) { e.compile = true; throw e; }); }
    function setCompileError(info) { compileError = info; $('aiFix').hidden = !info; }
    function previewChanged() { setCompileError(null); clearPreview('内容或设置已修改，请重新预览。'); }
    function syncLineWidth() {
        var ratio = IguanaLatex.lineWidth($('source').value);
        $('lineWidth').value = ratio === null ? '' : String(ratio);
        $('lineWidth').placeholder = ratio === null ? '自定义' : '1'; widthDirty = false;
    }
    function sourceChanged() {
        if (mode === 'picture') { pictureSourceReady = true; $('apply').disabled = !ready || !target; }
        if (draftError) { draftError = ''; $('errorDetails').hidden = true; }
        if (!widthDirty) syncLineWidth(); previewChanged();
    }
    $('source').oninput = sourceChanged;
    $('lineWidth').oninput = function () { widthDirty = true; previewChanged(); };
    $('engine').onchange = previewChanged;
    $('output').onchange = previewChanged;
    // 100% by default so different font sizes look different; "fit" is opt-in.
    var fitKey = 'iguanatex-bridge.previewFit', fitPreview = false;
    try { fitPreview = window.localStorage.getItem(fitKey) === '1'; } catch (ignored) {}
    function showZoom() { $('previewZoom').textContent = fitPreview ? '适应窗口' : '100%'; }
    function showPreview() {
        var box = target && target.original ? IguanaOffice.layout(target, preview, $('sizeMode').value) : {width: preview.width, height: preview.height};
        var width = box.width * 96 / 72, height = box.height * 96 / 72, fit = 1;
        if (fitPreview && width > 0 && height > 0) {
            fit = Math.min(1, Math.max(1, $('preview').clientWidth - 24) / width, Math.max(1, $('preview').clientHeight - 24) / height);
        }
        $('formulaImage').src = 'data:image/png;base64,' + preview.png;
        if (width > 0 && height > 0) {
            $('formulaImage').style.width = width * fit + 'px'; $('formulaImage').style.height = height * fit + 'px';
        }
        $('formulaImage').hidden = false; $('previewHint').hidden = true;
        $('previewSize').hidden = false;
        $('previewSize').textContent = '写入尺寸：' + (box.width * 2.54 / 72).toFixed(2) + ' × ' +
            (box.height * 2.54 / 72).toFixed(2) + ' cm' + (fit < .99 ? ' · 预览缩小至 ' + Math.round(fit * 100) + '%' : '');
        var ratio = (box.width / box.height) / (preview.width / preview.height);
        if (target && $('sizeMode').value === 'frame' && Math.abs(Math.log(ratio)) > Math.log(1.05)) {
            $('previewSize').textContent += ' · 固定原宽高会拉伸文字。';
        }
    }
    showZoom();
    $('previewZoom').onclick = function () {
        fitPreview = !fitPreview; showZoom();
        try { window.localStorage.setItem(fitKey, fitPreview ? '1' : '0'); } catch (ignored) {}
        if (preview && previewKey === key()) showPreview();
    };
    window.addEventListener('resize', function () { if (preview && previewKey === key()) showPreview(); });
    function sizeHint() {
        var current = target && target.original ? $('sizeMode').value : 'font';
        $('sizeHint').textContent = current === 'font' ? '按字号重设尺寸，保持自然宽高比例。' :
            (current === 'height' ? '保留原高度，宽度随内容调整。' : '固定原宽高时内容比例变化会拉伸文字。') +
            ' 修改字号会切换到“按字号重设尺寸”。';
    }
    async function renderFormula() {
        try {
            if (mode === 'picture' && !pictureSourceReady) throw new Error('请先采用识别结果或输入公式，再预览。');
            setCompileError(null);
            await IguanaLatex.prepare($('source'), compileApi);
            if (widthDirty) {
                var updatedSource = IguanaLatex.withLineWidth($('source').value, $('lineWidth').value);
                widthDirty = false;
                if (updatedSource !== $('source').value) {
                    $('source').value = updatedSource;
                    $('source').dispatchEvent(new Event('input', {bubbles: true}));
                }
                syncLineWidth();
            }
            var requestKey = key(), size = Number($('pointSize').value);
            if (!(size >= 4 && size <= 200)) throw new Error('字号须在 4–200 pt 之间。');
            if (!preview || previewKey !== requestKey) {
                clearPreview('正在编译当前源码…');
                status('正在本机编译公式…');
                var request = {source: $('source').value, engine: $('engine').value, output: $('output').value, point_size: size,
                    alt: target && target.original ? target.original.alt || '' : ''};
                if (pictureSettings) request.color = pictureSettings.color;
                var result = await compileApi('render', request);
                if (key() !== requestKey) throw new Error('源码已变更，请重新预览。');
                preview = result;
                previewKey = requestKey;
            }
            draftError = '';
            showPreview();
            status('预览已生成，请核对公式后写入。');
            return preview;
        } catch (e) {
            clearPreview('编译未完成，请修正源码或设置后重新预览。');
            if (e.compile) {
                setCompileError({source: $('source').value, engine: $('engine').value, message: e.message});
                if (mode === 'picture' && target && pictureSettings && $('source').value.trim()) {
                    draftError = e.message;
                    try { await api('wps/draft-save', {identity: pictureIdentity(target), signature: pictureSignature(target),
                        source: $('source').value, error: e.message, settings: pictureSettings}); } catch (ignored) {}
                }
            }
            throw e;
        }
    }
    var chat = IguanaChat.mount($('chatPanel'), {api: api, source: $('source'), canStart: function () { return !busy; },
        collapsed: false, docked: true,
        prepareSource: function (source, current) { return IguanaLatex.merge(source, current, api); }, onSource: sourceChanged});
    async function newFormula() {
        mode = 'new'; reset(); $('pointSize').value = preferredSize(); await IguanaLatex.load($('source'), 'E=mc^{2}', api); syncLineWidth(); sizeHint();
        IguanaLatex.selectBody($('source'));
        status('新建公式：编辑完整 LaTeX 文档，预览后插入当前幻灯片。');
    }
    async function loadSelection() {
        mode = 'edit'; reset(); $('apply').textContent = '更新选中公式';
        var selected = await IguanaOffice.capture(true);
        var tags = selected.sourceTags || selected.original.tags;
        var meta = await api('metadata', {tags: tags, alt: selected.sourceAlt || selected.original.alt || tags.IGUANABRIDGEMETA || ''});
        if (!meta.found) throw new Error('选中对象没有公式源码。请选中 IguanaTeX / Bridge 公式，或点击“新建公式”后识别截图。');
        if (!['xelatex', 'pdflatex', 'lualatex'].includes(meta.engine)) throw new Error('此公式使用不支持的编译引擎。');
        await IguanaLatex.load($('source'), meta.source, api);
        target = selected; preview = null; $('engine').value = meta.engine;
        var format = String(meta.tags.OUTPUTTYPE || '').toUpperCase();
        $('output').value = ['SVG', 'PDF', 'EMF'].includes(format) || selected.original.type === 'Group' || meta.tags.BITMAPVECTOR === '1' ? 'svg' : 'png';
        appliedSize = Number(meta.tags.IGUANATEXSIZE) || preferredSize(); $('pointSize').value = appliedSize; syncLineWidth();
        $('sizeModeLabel').hidden = false; $('sizeMode').value = 'font'; $('apply').textContent = '更新已读取的公式';
        sizeHint();
        status(selected.original.type === 'Group' ? '已读取 IguanaTeX Shape 组合的完整源码。更新后保存为 SVG / PNG，仍可用原 IguanaTeX 继续编辑。' : '已读取公式源码和字号。修改后更新，也可用原 IguanaTeX 继续编辑。');
    }
    function pictureIdentity(item) {
        return {presentation: String(item.draftPresentation || item.presentationId), slide_id: item.slideId, shape_id: item.original.id};
    }
    function pictureSignature(item) { return JSON.stringify([item.structure, item.imageDigest]); }
    async function preparePicture(draft) {
        await newFormula(); mode = 'picture';
        var picture = await IguanaOffice.capturePicture(); target = picture.target;
        pictureSettings = await api('wps/settings'); target.align = pictureSettings.align;
        $('pointSize').value = pictureSettings.point_size; appliedSize = Number(pictureSettings.point_size);
        $('sizeModeLabel').hidden = false; $('apply').textContent = '替换原图片';
        if (draft) {
            var saved = await api('wps/draft-get', {identity: pictureIdentity(target)});
            if (!saved.found) throw new Error('当前图片没有保存的失败草稿。');
            if (saved.signature !== pictureSignature(target)) throw new Error('图片已变化，无法安全恢复草稿。');
            pictureSettings = saved.settings; target.align = pictureSettings.align;
            $('pointSize').value = pictureSettings.point_size; appliedSize = Number(pictureSettings.point_size);
            await IguanaLatex.load($('source'), saved.source, api); syncLineWidth();
            pictureSourceReady = true;
            draftError = saved.error || '';
            if (draftError) { $('errorDetails').hidden = false; $('errorText').textContent = draftError;
                setCompileError({source: $('source').value, engine: $('engine').value, message: draftError}); }
            status('已恢复失败草稿。请预览核对后替换原图片。');
        } else {
            var cached = await api('wps/review-create', {image: picture.image, preview: picture.image});
            imageId = cached.id;
            status('已读取选中图片；在 AI 助手中点击发送，然后采用、预览并替换。');
        }
        sizeHint();
    }
    $('new').onclick = function () { return run(async function () { await newFormula(); await openEditor(); }); };
    $('load').onclick = function () { return run(async function () { await loadSelection(); await openEditor(); }); };
    $('pointSize').oninput = function () {
        $('sizeMode').value = 'font';
        if (validSize($('pointSize').value)) { try { window.localStorage.setItem(sizePreferenceKey, String(Number($('pointSize').value))); } catch (ignored) {} }
        previewChanged(); sizeHint();
    };
    $('sizeMode').onchange = function () {
        if ($('sizeMode').value !== 'font') $('pointSize').value = appliedSize;
        sizeHint();
        if (preview && previewKey === key()) showPreview(); else previewChanged();
    };
    $('previewButton').onclick = function () { return run(renderFormula); };
    $('aiFix').onclick = function () {
        if (!compileError) return;
        if ($('assistantDock').hidden) $('assistantToggle').click();
        return chat.ask(IguanaChat.compileReport(compileError));
    };
    $('apply').onclick = function () { return run(async function () {
        if (!ready) throw new Error('尚未连接 PowerPoint。');
        if ((mode === 'edit' || mode === 'picture') && !target) throw new Error('请先选中并读取要修改的对象。');
        if (mode === 'picture' && (!pictureSourceReady || !preview || previewKey !== key())) throw new Error('请先预览并核对公式，再替换原图片。');
        var captured = target || insertTarget || await IguanaOffice.capture(false);
        var data = await renderFormula();
        try {
            target = await IguanaOffice.apply(captured, data, target ? $('sizeMode').value : 'font');
        } catch (e) {
            // The local server may have expired or evicted the cached image.
            // Allow the next preview to compile a fresh, insertable result.
            if (e.message.indexOf('预览已过期') !== -1) clearPreview('预览已过期，请重新预览。');
            throw e;
        }
        if (mode === 'picture') { try { await api('wps/draft-delete', {identity: pictureIdentity(captured)}); } catch (ignored) {} pictureSettings = null; }
        appliedSize = Number(data.tags.IGUANATEXSIZE); preview = null;
        $('sizeModeLabel').hidden = false; $('apply').textContent = '更新此公式';
        status('公式与源码已写入，请在 PowerPoint 中保存 PPTX。');
        if (window.IguanaDialogClient) { mode = 'edit'; window.IguanaDialogClient.close(editorState()); }
    }); };
    $('doctor').onclick = function () { run(async function () { $('diagnostics').textContent = JSON.stringify(await api('doctor'), null, 2); }); };
    document.addEventListener('keydown', function (e) {
        if (!e.isComposing && (e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); run(renderFormula); }
    });
    document.querySelectorAll('[data-template]').forEach(function (button) { button.onclick = function () {
        var field = $('source'), snippet = templates[button.dataset.template];
        field.setRangeText(snippet, field.selectionStart, field.selectionEnd, 'end'); field.focus(); sourceChanged();
    }; });
    function editorState() {
        return {mode: mode, source: $('source').value, engine: $('engine').value, output: $('output').value,
            pointSize: $('pointSize').value, sizeMode: $('sizeMode').value, appliedSize: appliedSize, target: target, insertTarget: insertTarget,
            imageId: imageId, pictureSettings: pictureSettings, pictureSourceReady: pictureSourceReady, draftError: draftError,
            lineWidth: $('lineWidth').value, widthDirty: widthDirty, status: $('status').textContent};
    }
    function restoreState(state) {
        if (!state) return;
        mode = state.mode; target = state.target || null; insertTarget = state.insertTarget || null; imageId = state.imageId || null;
        pictureSettings = state.pictureSettings || null; pictureSourceReady = Boolean(state.pictureSourceReady); draftError = state.draftError || '';
        appliedSize = Number(state.appliedSize) || preferredSize();
        $('source').value = state.source; $('engine').value = state.engine; $('output').value = state.output;
        $('pointSize').value = state.pointSize; $('sizeMode').value = state.sizeMode || 'font'; syncLineWidth(); sizeHint();
        if (state.widthDirty) { $('lineWidth').value = state.lineWidth; widthDirty = true; }
        $('sizeModeLabel').hidden = !target; $('apply').textContent = mode === 'picture' ? '替换原图片' : target ? '更新此公式' : '插入当前幻灯片';
        $('apply').disabled = !ready || ((mode === 'edit' || mode === 'picture') && !target) || (mode === 'picture' && !pictureSourceReady);
        clearPreview('点击预览，查看当前源码的编译结果。');
        $('errorDetails').hidden = true; $('errorText').textContent = '';
        setCompileError(null);
        if (draftError) { $('errorDetails').hidden = false; $('errorText').textContent = draftError;
            setCompileError({source: $('source').value, engine: $('engine').value, message: draftError}); }
        status(state.status || '编辑完整 LaTeX 文档，预览后写入幻灯片。');
    }
    async function openEditor() {
        if (!window.IguanaDialogHost) return;
        var state = editorState();
        // Keep the original slide as the insertion target even if the user
        // changes the presentation while the separate editor is open.
        if (!state.target) state.insertTarget = await IguanaOffice.capture(false);
        await window.IguanaDialogHost.open(state, {
            capture: function (edit) { return IguanaOffice.capture(edit); },
            apply: async function (captured, renderId, sizeMode) {
                var result = await api('render/result', {id: renderId});
                return IguanaOffice.apply(captured, result, sizeMode);
            },
            closed: restoreState
        });
    }
    $('openEditor').onclick = function () { return run(openEditor); };
    $('closeEditor').onclick = function () { if (window.IguanaDialogClient) window.IguanaDialogClient.close(editorState()); };
    if (!window.Office) { status('Office.js 加载失败，请检查网络或从 PowerPoint 加载项打开。', true); return; }
    Office.onReady(function (info) {
        if (info.host !== Office.HostType.PowerPoint) { status('请在 PowerPoint 中打开此加载项。', true); return; }
        // The dialog webview does not expose the presentation requirement set
        // reliably; its parent already checks it before opening this window.
        if (!window.IguanaDialogClient && !Office.context.requirements.isSetSupported('PowerPointApi', '1.5')) {
            status('此 PowerPoint 版本不支持所需 API。请更新 Office，或打开独立 PPTX 编辑器。', true); return;
        }
        ready = true;
        if (window.IguanaDialogClient) {
            run(async function () {
                restoreState(await window.IguanaDialogClient.ready);
                if (imageId) {
                    var id = imageId; imageId = null;
                    try { var cached = await api('wps/review-get', {id: id}); await chat.attachPng(cached.image, '选中图片.png'); }
                    finally { try { await api('wps/review-discard', {id: id}); } catch (ignored) {} }
                }
            });
        } else {
            run(async function () {
                var requestedMode = mode;
                if (requestedMode === 'edit') await loadSelection();
                else if (requestedMode === 'picture' || requestedMode === 'draft') await preparePicture(requestedMode === 'draft');
                else { await newFormula(); if (requestedMode === 'ocr') mode = 'ocr'; }
                await openEditor();
            });
        }
    });
}());
