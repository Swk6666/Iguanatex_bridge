(function () {
    'use strict';
    var $ = function (id) { return document.getElementById(id); };
    var token = null;
    var mode = new URLSearchParams(location.search).get('mode') || 'new';
    var ctx = null, preview = null, previewKey = '', busy = false, appliedPointSize = 18;
    var sizePreferenceKey = 'iguanatex-bridge.pointSize';
    function validSize(value) { var n = Number(value); return isFinite(n) && n >= 4 && n <= 200; }
    function preferredSize() {
        try {
            var saved = window.localStorage.getItem(sizePreferenceKey);
            if (validSize(saved)) return Number(saved);
        } catch (ignored) {} // Storage may be unavailable in some WPS builds.
        return 18;
    }
    $('closeButton').onclick = function () { window.close(); };
    var templates = {sum: '\\sum_{k=1}^{n} k = \\frac{n(n+1)}{2}',
        matrix: '\\mathbf{A}=\\begin{bmatrix}a&b\\\\c&d\\end{bmatrix}',
        aligned: '\\begin{aligned}\nM(q)\\ddot q+C(q,\\dot q)\\dot q+g(q)&=\\tau,\\\\\nA x&=b.\n\\end{aligned}',
        chinese: '\\underbrace{M(q)\\ddot q}_{\\text{惯性项}}+g(q)=\\tau'};
    function status(message, error) { $('status').textContent = message; $('status').className = error ? 'error' : ''; }
    function failure(e) { status(e.message.split('\n')[0], true); $('errorDetails').hidden = false; $('errorText').textContent = e.stack || String(e); }
    async function api(path, data, retried) {
        if (!token) {
            var session = await fetch('/api/session?now=' + Date.now(), {cache: 'no-store'});
            token = (await session.json()).token;
        }
        var response = await fetch('/api/' + path, {method: 'POST', headers: {'Content-Type': 'application/json', 'X-Bridge-Token': token}, body: JSON.stringify(data || {})});
        if (response.status === 403 && !retried) { token = null; return api(path, data, true); }
        var result = await response.json();
        if (!response.ok) throw new Error(result.error || '本地服务不可用，请运行启动脚本。');
        return result;
    }
    function key() { return JSON.stringify([$('source').value, $('engine').value, $('pointSize').value, $('output').value]); }
    function sizeMode() { return ctx && ctx.shape ? $('sizeMode').value : 'font'; }
    function sizeHint() {
        var current = sizeMode();
        $('sizeHint').textContent = current === 'font' ?
            '按字号重设尺寸：使用 IguanaTex 的 10 pt 模板缩放规则，恢复自然宽高比例。' :
            (current === 'height' ? '保留原高度，宽度随内容调整，保持自然比例。' :
                '固定原宽高：内容比例变化时会拉伸文字。') +
            '字号显示上次记录值；修改字号会切换到“按字号重设尺寸”。';
    }
    function showPreview(result) {
        ctx.sizeMode = sizeMode();
        var box = IguanaWps.layout(ctx, result), desiredWidth = box.width * 96 / 72;
        var fit = Math.min(1, Math.max(1, $('preview').clientWidth - 24) / desiredWidth,
            Math.max(1, $('preview').clientHeight - 24) / (box.height * 96 / 72));
        $('formulaImage').src = 'data:image/png;base64,' + result.png;
        $('formulaImage').style.width = desiredWidth * fit + 'px';
        $('formulaImage').style.height = box.height * 96 / 72 * fit + 'px';
        $('formulaImage').hidden = false; $('previewHint').hidden = true;
        $('previewSize').hidden = false;
        $('previewSize').textContent = '写入尺寸：' + (box.width * 2.54 / 72).toFixed(2) + ' × ' +
            (box.height * 2.54 / 72).toFixed(2) + ' cm' + (fit < .99 ? ' · 预览已缩小显示' : '');
        if (box.width > ctx.presentation.PageSetup.SlideWidth || box.height > ctx.presentation.PageSetup.SlideHeight) {
            $('previewSize').textContent += ' · 公式尺寸超过幻灯片，请考虑减小字号。';
        }
        var ratio = (box.width / box.height) / (result.width / result.height);
        if (sizeMode() === 'frame' && Math.abs(Math.log(ratio)) > Math.log(1.05)) {
            $('previewSize').textContent += ' · 固定原宽高会拉伸文字；请选择“保留高度”或“按字号重设尺寸”。';
        }
    }
    $('pointSize').oninput = function () {
        if (ctx && ctx.shape) $('sizeMode').value = 'font';
        if (validSize($('pointSize').value)) {
            try { window.localStorage.setItem(sizePreferenceKey, String(Number($('pointSize').value))); } catch (ignored) {}
        }
        $('previewSize').hidden = true; sizeHint();
    };
    $('sizeMode').onchange = function () {
        if (sizeMode() !== 'font') $('pointSize').value = appliedPointSize;
        sizeHint();
        if (preview && previewKey === key()) showPreview(preview);
        else $('previewSize').hidden = true;
    };
    window.addEventListener('resize', function () { if (preview && previewKey === key()) showPreview(preview); });
    async function renderFormula() {
        var pointSize = Number($('pointSize').value);
        if (!isFinite(pointSize) || pointSize < 4 || pointSize > 200) throw new Error('字号须在 4–200 pt 之间。');
        await IguanaLatex.prepare($('source'), api);
        var requestKey = key();
        if (preview && previewKey === requestKey) { showPreview(preview); return preview; }
        status('正在使用本机 LaTeX 编译…');
        var result = await api('wps/render', {source: $('source').value, engine: $('engine').value,
            point_size: pointSize, output: $('output').value, alt: ctx && ctx.original ? ctx.original.alt : ''});
        if (key() !== requestKey) throw new Error('源码已变更，请重新预览。');
        preview = result; previewKey = requestKey;
        showPreview(result);
        status('预览已生成，可以写入幻灯片。');
        return result;
    }
    async function run(action) {
        if (busy || chat && chat.isBusy()) return;
        busy = true; $('errorDetails').hidden = true;
        document.querySelectorAll('button, textarea, select, input').forEach(function (e) { e.disabled = true; });
        try { await action(); } catch (e) { failure(e); }
        finally { busy = false; document.querySelectorAll('button, textarea, select, input').forEach(function (e) { e.disabled = false; }); }
    }
    var chat = window.IguanaChat ? window.IguanaChat.mount($('chatPanel'), {api: api, source: $('source'),
        collapsed: false, docked: true,
        prepareSource: function (source, current) { return IguanaLatex.merge(source, current, api); },
        canStart: function () { return !busy; }, onSource: function () { preview = null; $('previewSize').hidden = true; }}) : null;
    $('previewButton').onclick = function () { return run(renderFormula); };
    $('applyButton').onclick = function () { return run(async function () {
        if (!ctx) throw new Error('未连接 WPS，请从 IguanaTex 功能区重新打开。');
        IguanaWps.validate(ctx);
        var rendered = await renderFormula();
        ctx.sizeMode = sizeMode();
        IguanaWps.replace(ctx, rendered);
        appliedPointSize = Number(rendered.tags.IGUANATEXSIZE);
        $('sizeMode').value = ctx.sizeMode;
        preview = null; $('applyButton').textContent = '更新此公式'; $('sizeModeRow').hidden = false; sizeHint();
        status('公式已写入第 ' + ctx.slide.SlideIndex + ' 页。请在 WPS 中保存 PPTX。');
        window.close();
    }); };
    document.addEventListener('keydown', function (e) { if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); run(renderFormula); } });
    document.querySelectorAll('[data-template]').forEach(function (button) { button.onclick = function () {
        var field = $('source'), snippet = templates[button.dataset.template];
        field.setRangeText(snippet, field.selectionStart, field.selectionEnd, 'end'); field.focus();
    }; });
    $('protectButton').onclick = function () { run(async function () {
        var items = IguanaWps.formulas(), restored = 0, failed = [];
        for (var i = 0; i < items.length; i++) {
            var item = items[i];
            try {
                var data = await api('wps/metadata', item.data);
                if (!data.found) throw new Error('备份损坏，无法读取源码');
                IguanaWps.stamp(item.shape, data); restored++;
            } catch (e) { failed.push('第 ' + item.page + ' 页：' + e.message); }
        }
        $('protectResult').textContent = '发现 ' + items.length + ' 个公式，已同步 ' + restored + ' 个。\n' + failed.join('\n');
        status(failed.length ? '部分公式未能同步，请查看详情。' : '源码检查完成，请保存 PPTX。', failed.length > 0);
    }); };
    async function init() {
        if (mode === 'help') {
            $('help').hidden = false; status('IguanaTex Bridge 0.6.0 · 本地 WPS 加载项');
            var info = await api('doctor'); $('doctor').textContent = JSON.stringify(info, null, 2); return;
        }
        if (mode === 'protect') { $('protect').hidden = false; status('准备检查当前演示文稿中的公式源码。'); return; }
        document.body.classList.add('editing');
        $('pointSize').value = preferredSize();
        ctx = IguanaWps.context(mode === 'edit');
        $('editor').hidden = false;
        $('target').textContent = '第 ' + ctx.slide.SlideIndex + ' 页';
        if (ctx.shape) {
            var meta = await api('wps/metadata', ctx.sourceData);
            if (!meta.found) throw new Error('选中的对象没有可读的 IguanaTex 源码。若仅剩 PNG 备份，请使用独立 PPTX 编辑器恢复。');
            if (!['xelatex','pdflatex','lualatex'].includes(meta.engine)) throw new Error('原公式使用暂不支持的编译引擎；请通过独立编辑器转换。');
            await IguanaLatex.load($('source'), meta.source, api); $('engine').value = meta.engine;
            $('pointSize').value = validSize(meta.tags.IGUANATEXSIZE) ? Number(meta.tags.IGUANATEXSIZE) : preferredSize();
            appliedPointSize = Number($('pointSize').value);
            $('output').value = ctx.shape.Type === 13 && meta.tags.OUTPUTTYPE !== 'SVG' ? 'png' : 'svg';
            $('sizeModeRow').hidden = false; $('sizeMode').value = 'font';
            $('applyButton').textContent = '更新此公式';
            $('editNote').textContent = '更新保留位置、旋转、翻转和层叠顺序，宽高按上方选项处理。Shape 组合将整体替换为所选格式；SVG 保留矢量清晰度及 LaTeX 源码，不保留逐字 Shape 结构。动画、手动字形配色、特效与交互动作需重新设置。';
            status('已读取选中公式 · ' + meta.origin);
        } else {
            await IguanaLatex.load($('source'), 'E = mc^{2}', api);
            IguanaLatex.selectBody($('source'));
            status('编辑完整 LaTeX 文档：可修改宏包和正文，预览后插入当前幻灯片。');
        }
        sizeHint();
    }
    init().catch(function (e) {
        $('editor').hidden = true;
        $('formulaActions').hidden = true;
        $('assistantToggle').hidden = true;
        failure(e);
    });
}());
