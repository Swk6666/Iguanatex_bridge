(function () {
    'use strict';
    var $ = function (id) { return document.getElementById(id); };
    var mode = new URLSearchParams(location.search).get('mode') || 'help', token = null, settings = null;
    var reviewId = null, progressTimer = null;
    var storageKey = 'iguanatex-bridge.openaiConversation';
    function status(text, failed) { $('status').textContent = text; $('status').className = failed ? 'error' : ''; }
    async function api(path, data, retry) {
        if (!token) token = (await (await fetch('/api/session', {cache:'no-store'})).json()).token;
        var response = await fetch('/api/' + path, {method:'POST', headers:{'Content-Type':'application/json','X-Bridge-Token':token}, body:JSON.stringify(data || {})});
        if (response.status === 403 && !retry) { token = null; return api(path, data, true); }
        var result = await response.json();
        if (!response.ok) throw new Error(result.error || '本地服务不可用。');
        return result;
    }
    async function run(button, operation) {
        if (button) button.disabled = true;
        try { await operation(); } catch (e) { status(e.message || String(e), true); }
        finally { if (button) button.disabled = false; }
    }
    function conversationId() { try { return window.localStorage.getItem(storageKey); } catch (ignored) { return null; } }
    async function showProgress(cancel) {
        var batch = await api(cancel ? 'office/batch/cancel' : 'office/batch/status');
        if (batch.status !== 'idle') {
            var count = batch.succeeded + batch.failed + batch.skipped, remaining = batch.total - count;
            $('progressText').textContent = batch.stage + '\n已处理 ' + count + ' / ' + batch.total + '；成功 ' + batch.succeeded + '，失败 ' + batch.failed + '，跳过 ' + batch.skipped + (batch.status !== 'running' && remaining ? '，未处理 ' + remaining : '') + '。';
            $('progressErrors').textContent = (batch.errors || []).slice(0, 20).join('\n');
            if (cancel) status(batch.status === 'running' ? '已请求停止；当前操作结束后停止。' : '当前没有正在进行的批量转换。');
            if (batch.review_id && batch.review_id !== reviewId) {
                var review = await api('wps/review-get', {id:batch.review_id}); reviewId = batch.review_id;
                $('reviewOriginal').src = 'data:image/png;base64,' + review.image;
                $('reviewPreview').src = 'data:image/png;base64,' + review.preview; $('review').hidden = false;
            } else if (!batch.review_id) { $('review').hidden = true; reviewId = null; }
            if (batch.status === 'running' && !progressTimer) progressTimer = setInterval(function () { showProgress(false).catch(function (e) { status(e.message, true); }); }, 1500);
            if (batch.status !== 'running' && progressTimer) { clearInterval(progressTimer); progressTimer = null; }
            return;
        }
        var id = conversationId(), history = await api('chat/history', {conversation_id:id});
        var active = history.active_job, last = history.turns.length ? history.turns[history.turns.length - 1] : null;
        if (cancel && active) { await api('chat/cancel', {id:active}); status('已请求停止；已经发送的请求可能产生用量。'); }
        else if (cancel) status('当前没有正在进行的 AI 请求。');
        if (active) {
            var job = await api('chat/status', {id:active});
            $('progressText').textContent = (job.message || job.status) + (cancel ? '（正在停止）' : '');
        } else $('progressText').textContent = last ? '最近一次请求：' + (last.status || '已结束') + (last.error ? ' · ' + last.error : '') : '尚无转换请求。';
    }
    $('refresh').onclick = function () { return run($('refresh'), function () { return showProgress(false); }); };
    $('cancel').onclick = function () { return run($('cancel'), function () { return showProgress(true); }); };
    async function decide(value) { if (reviewId) { await api('wps/review-decide', {id:reviewId, decision:value}); $('review').hidden = true; } }
    $('accept').onclick = function () { return run($('accept'), function () { return decide('accept'); }); };
    $('skip').onclick = function () { return run($('skip'), function () { return decide('skip'); }); };
    $('stopReview').onclick = function () { return run($('stopReview'), function () { return decide('cancel'); }); };
    $('save').onclick = function () { return run($('save'), async function () {
        settings = await api('wps/settings', {point_size:Number($('size').value), color:$('color').value,
            align:$('align').value, review:Boolean($('reviewSetting').checked)});
        status('设置已保存，将用于下一次图片转换。');
    }); };
    $('doctor').onclick = function () { return run($('doctor'), async function () {
        $('diagnostics').textContent = JSON.stringify(await api('doctor'), null, 2);
    }); };
    $('sync').onclick = function () { return run($('sync'), async function () {
        status('正在检查当前演示文稿…'); $('syncResult').textContent = '';
        var scan = await IguanaOffice.scanFormulas(), count = 0, failures = [];
        for (var i = 0; i < scan.items.length; i++) {
            var item = scan.items[i];
            try {
                var meta = await api('metadata', {tags:item.original.tags, alt:item.original.alt || item.original.tags.IGUANABRIDGEMETA || ''});
                if (!meta.found) throw new Error('没有可读取的源码。');
                await IguanaOffice.syncFormula(item, meta); count++;
            } catch (e) { failures.push('第 ' + item.page + ' 页：' + (e.message || String(e))); }
        }
        $('syncResult').textContent = '发现 ' + scan.items.length + ' 个公式，同步 ' + count + ' 个。' +
            (scan.skippedGroups ? '\n跳过 ' + scan.skippedGroups + ' 个组合：此版本不支持读取组合。' : '') +
            (!scan.hasAlt ? '\n此版本仅同步标签备份，不能读取或写入替代文字。' : '') +
            (failures.length ? '\n' + failures.slice(0, 20).join('\n') : '');
        status(failures.length ? '部分公式未同步，请查看详情。' : '检查完成，请保存 PPTX。', failures.length > 0);
    }); };
    Office.onReady(function (info) {
        if (info.host !== Office.HostType.PowerPoint) { status('请在 PowerPoint 中打开此加载项。', true); return; }
        run(null, async function () {
            if (mode === 'settings') {
                $('settings').hidden = false; settings = await api('wps/settings');
                $('size').value = settings.point_size; $('color').value = settings.color; $('align').value = settings.align; $('reviewSetting').checked = settings.review;
            } else if (mode === 'status' || mode === 'cancel') {
                $('progress').hidden = false; await showProgress(mode === 'cancel');
            } else if (mode === 'protect') {
                $('protect').hidden = false; status('准备检查当前演示文稿。');
            } else {
                $('help').hidden = false;
                var supported = Office.context.requirements.isSetSupported('PowerPointApi', '1.10');
                $('capabilities').textContent = supported ? '当前版本支持直接读取选中图片和同步替代文字。' : '当前版本不支持直接读取选中图片；可在 AI 助手中粘贴截图。';
                $('diagnostics').textContent = JSON.stringify(await api('doctor'), null, 2);
            }
        });
    });
}());
