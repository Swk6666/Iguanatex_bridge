/* Background WPS picture conversion with progress, cancellation and optional review. */
(function (root) {
    'use strict';
    var token = null, running = false, cancelled = false, currentJob = null;
    var progress = {label:'转换：就绪', detail:'尚未开始转换。'};
    function show(label, detail) {
        progress = {label:label, detail:detail || label};
        try { if (root.UpdateRecognitionUI) root.UpdateRecognitionUI(); } catch (ignored) {}
    }
    async function api(path, data, retried) {
        if (!token) {
            var session = await fetch('/api/session?now=' + Date.now(), {cache:'no-store'});
            token = (await session.json()).token;
        }
        var response = await fetch('/api/' + path, {method:'POST', headers:{'Content-Type':'application/json','X-Bridge-Token':token}, body:JSON.stringify(data || {})});
        if (response.status === 403 && !retried) { token = null; return api(path, data, true); }
        var result = await response.json();
        if (!response.ok) throw new Error(result.error || '本地服务不可用。');
        return result;
    }
    function notify(text) { if (root.ShowBridgeMessage) root.ShowBridgeMessage(text); else alert(text); }
    function checkCancelled() { if (cancelled) { var e = new Error('已取消'); e.cancelled = true; throw e; } }
    function friendly(e) {
        var text = e && e.message ? e.message : String(e);
        if (/额度|余额|insufficient_quota/.test(text)) return 'OpenAI 额度不足：请检查 API 账单和额度。';
        if (/请求受限|速率|rate limit/i.test(text)) return 'OpenAI 请求过于频繁：请稍后重试。';
        if (/API Key|密钥/.test(text)) return 'OpenAI 密钥无效：请在 AI 助手的 API 设置中更新密钥。';
        if (/网络|连接|超时|fetch|network/i.test(text)) return '网络连接失败：请检查网络和本地服务后重试。';
        if (/导出|另存图片/.test(text)) return 'WPS 无法导出图片：请确认选中的是图片，并检查 WPS 版本。';
        if (/LaTeX 编译失败|LaTeX 字体缺字/.test(text)) return 'LaTeX 编译失败：可选择原图后点击“编辑失败草稿”查看源码和日志。';
        return text.split('\n')[0].slice(0, 240);
    }
    function correctionMessage(source, error) {
        var header = 'XeLaTeX 编译失败。请根据错误日志修复下面的完整 LaTeX 文档，保留图片中公式的含义及必要宏包，只输出一个完整的 latex 代码块。不能可靠修复时不要输出代码块。';
        var lines = String(error).split(/\r?\n/), first = -1;
        for (var i = 0; i < lines.length; i++) if (/^! /.test(lines[i])) { first = i; break; }
        var excerpt = (first >= 0 ? lines.slice(Math.max(0, first - 3), first + 20) : lines.slice(-30)).join('\n').slice(0, 2000);
        var message = header + '\n\n错误日志：\n```text\n' + excerpt + '\n```\n\n完整源码：\n```latex\n' + source + '\n```';
        if (message.length > 8000) throw new Error('源码过长，无法自动纠错；请手动检查后重试。');
        return message;
    }
    async function ask(request) {
        checkCancelled();
        var job = await api('chat/start', request), current;
        currentJob = job.id;
        try {
            if (cancelled) { try { await api('chat/cancel', {id:job.id}); } catch (ignored) {} checkCancelled(); }
            while (true) {
                checkCancelled();
                current = await api('chat/status', {id:job.id});
                checkCancelled();
                if (['succeeded','failed','cancelled'].indexOf(current.status) !== -1) break;
                await new Promise(function (resolve) { setTimeout(resolve, 650); });
            }
            if (current.status !== 'succeeded') throw new Error(current.message || 'OpenAI 请求未完成。');
            var history = await api('chat/history', {conversation_id:job.conversation_id});
            checkCancelled();
            var turn = history.turns.filter(function (item) { return item.id === job.id; })[0];
            if (!turn || !turn.latex_blocks || turn.latex_blocks.length !== 1) throw new Error('未得到可确认的公式源码。');
            return {source:turn.latex_blocks[0], conversationId:job.conversation_id, revision:history.revision};
        } finally { currentJob = null; }
    }
    async function review(image, rendered) {
        checkCancelled();
        var item = await api('wps/review-create', {image:image.data, preview:rendered.png});
        try {
            checkCancelled();
            var base = root.location.href.split('?')[0].replace(/[^/]*$/, '');
            root.wps.ShowDialog(base + 'workflow.html?mode=review&id=' + item.id, '图片与公式对照', 960, 680, false);
            var deadline = Date.now() + 10 * 60 * 1000;
            while (Date.now() < deadline) {
                checkCancelled();
                var state = await api('wps/review-status', {id:item.id});
                checkCancelled();
                if (state.decision === 'accept') return true;
                if (state.decision === 'skip') return false;
                if (state.decision === 'cancel') { cancelled = true; checkCancelled(); }
                await new Promise(function (resolve) { setTimeout(resolve, 650); });
            }
            throw new Error('校对等待超时，原图已保留。');
        } finally { try { await api('wps/review-discard', {id:item.id}); } catch (ignored) {} }
    }
    async function convert(ctx, settings, number, total, scratch) {
        function stage(name) { show('转换 ' + number + '/' + total + '：' + name, '第 ' + number + ' / ' + total + ' 张：' + name); }
        checkCancelled(); stage('导出图片');
        var target = await api('wps/image-target'), image;
        try {
            checkCancelled(); root.IguanaWps.exportImage(ctx, target.path);
            image = await api('wps/image-read', {token:target.token});
        } finally { try { await api('wps/image-discard', {token:target.token}); } catch (ignored) {} }
        checkCancelled(); stage('识别中');
        var result = await ask({data:image.data, message:'请准确识别图片中的数学公式，输出一个可直接用 XeLaTeX 编译的完整 LaTeX 文档，放在唯一的 latex 代码块中。只转写看得清的内容；如果公式无法可靠辨认，不要输出代码块，请说明原因。不要输出页码。'});
        var source = result.source, rendered, corrections = 0;
        scratch.source = source;
        while (true) {
            checkCancelled(); root.IguanaWps.validate(ctx); stage('编译中');
            try {
                rendered = await api('wps/render', {source:source, engine:'xelatex', point_size:settings.point_size,
                    color:settings.color, output:'svg', alt:ctx.original ? ctx.original.alt : ''});
                scratch.error = ''; checkCancelled(); break;
            } catch (e) {
                if (e.cancelled) throw e;
                scratch.error = e.message || String(e);
                if (!/^(LaTeX 编译失败：|LaTeX 字体缺字：)/.test(scratch.error) || corrections >= 2) throw e;
                stage('自动纠错中');
                var message = correctionMessage(source, scratch.error);
                result = await ask({message:message, conversation_id:result.conversationId, revision:result.revision});
                source = result.source; scratch.source = source; corrections++;
            }
        }
        checkCancelled(); root.IguanaWps.validate(ctx);
        if (settings.review) {
            stage('等待校对');
            if (!await review(image, rendered)) return 'skipped';
        }
        checkCancelled(); root.IguanaWps.validate(ctx);
        ctx.sizeMode = 'font'; ctx.align = settings.align;
        root.IguanaWps.replace(ctx, rendered);
        try { await api('wps/draft-delete', {identity:ctx.identity}); } catch (ignored) {}
        return 'succeeded';
    }
    async function batch(items) {
        var total = items.length, succeeded = 0, failed = 0, skipped = 0, errors = [];
        var settings = await api('wps/settings');
        for (var i = 0; i < total && !cancelled; i++) {
            var item = items[i], scratch = {source:'',error:''};
            try {
                if (item.error) throw new Error(item.error);
                var result = await convert(item.ctx, settings, i + 1, total, scratch);
                if (result === 'skipped') skipped++; else succeeded++;
            } catch (e) {
                if (e.cancelled || cancelled) break;
                failed++;
                var issue = friendly(e);
                if (item.ctx && scratch.source) {
                    try {
                        await api('wps/draft-save', {identity:item.ctx.identity, signature:item.ctx.signature,
                            source:scratch.source, error:scratch.error || (e.message || String(e)), settings:settings});
                        issue += ' 已保存草稿。';
                    } catch (draftError) { issue += ' 草稿保存失败：' + friendly(draftError); }
                }
                errors.push('第 ' + (i + 1) + ' 张：' + issue);
            }
        }
        var remaining = total - succeeded - failed - skipped;
        var label = cancelled ? '转换已取消' : '转换完成';
        var detail = label + '：成功 ' + succeeded + '，失败 ' + failed + '，跳过 ' + skipped + (remaining ? '，未处理 ' + remaining : '') + '。';
        if (errors.length) detail += '\n' + errors.slice(0, 20).join('\n');
        show(label + ' ' + succeeded + '/' + total, detail);
        if (total > 1 || failed) notify(detail);
    }
    function start() {
        if (running) { notify('图片转公式正在进行，请等待完成或点击“取消转换”。'); return; }
        var items;
        try { items = root.IguanaWps.imageContexts(); }
        catch (e) { show('转换未开始', friendly(e)); notify(friendly(e)); return; }
        running = true; cancelled = false;
        show('准备转换 0/' + items.length, '正在准备所选图片。');
        batch(items).catch(function (e) {
            var detail = '转换未完成，原图已保留。' + friendly(e);
            show('转换失败', detail); notify(detail);
        }).finally(function () { running = false; currentJob = null; });
    }
    function cancel() {
        if (!running) return;
        cancelled = true; show('转换：取消中', '正在取消；当前编译或网络请求结束后停止，尚未替换的图片会保留。');
        if (currentJob) api('chat/cancel', {id:currentJob}).catch(function () {});
    }
    root.IguanaRecognize = {start:start, cancel:cancel, status:function () { return progress; }};
}(window));
