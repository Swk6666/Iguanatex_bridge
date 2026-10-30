/* Convert a selected WPS picture in the background without opening an editor. */
(function (root) {
    'use strict';
    var running = false, token = null;
    async function api(path, data, retried) {
        if (!token) {
            var session = await fetch('/api/session?now=' + Date.now(), {cache: 'no-store'});
            token = (await session.json()).token;
        }
        var response = await fetch('/api/' + path, {method: 'POST', headers: {
            'Content-Type': 'application/json', 'X-Bridge-Token': token
        }, body: JSON.stringify(data || {})});
        if (response.status === 403 && !retried) { token = null; return api(path, data, true); }
        var result = await response.json();
        if (!response.ok) throw new Error(result.error || '本地服务不可用。');
        return result;
    }
    function preferredSize() {
        try {
            var size = Number(root.localStorage.getItem('iguanatex-bridge.pointSize'));
            if (isFinite(size) && size >= 4 && size <= 200) return size;
        } catch (ignored) {}
        return 18;
    }
    // Preserve the complete source; never send a truncated document as if it were complete.
    function correctionMessage(source, error) {
        var header = 'XeLaTeX 编译失败。请根据错误日志修复下面的完整 LaTeX 文档，保留图片中公式的含义及必要宏包，只输出一个完整的 latex 代码块。不能可靠修复时不要输出代码块。';
        var lines = String(error).split(/\r?\n/), first = -1;
        for (var i = 0; i < lines.length; i++) if (/^! /.test(lines[i])) { first = i; break; }
        var excerpt = (first >= 0 ? lines.slice(Math.max(0, first - 3), first + 20) : lines.slice(-30)).join('\n');
        excerpt = excerpt.slice(0, 2000);
        var message = header + '\n\n错误日志：\n```text\n' + excerpt + '\n```\n\n完整源码：\n```latex\n' + source + '\n```';
        if (message.length > 8000) throw new Error('源码过长，无法自动纠错；请手动检查后重试。');
        return message;
    }
    async function ask(request) {
        var job = await api('chat/start', request), current;
        while (true) {
            current = await api('chat/status', {id: job.id});
            if (['succeeded', 'failed', 'cancelled'].indexOf(current.status) !== -1) break;
            await new Promise(function (resolve) { setTimeout(resolve, 650); });
        }
        if (current.status !== 'succeeded') throw new Error(current.message || 'OpenAI 请求未完成。');
        var history = await api('chat/history', {conversation_id: job.conversation_id});
        var turn = history.turns.filter(function (item) { return item.id === job.id; })[0];
        if (!turn || !turn.latex_blocks || turn.latex_blocks.length !== 1) throw new Error('未得到可确认的公式源码。');
        return {source: turn.latex_blocks[0], conversationId: job.conversation_id, revision: history.revision};
    }
    async function convert() {
        var ctx = root.IguanaWps.imageContext();
        var target = await api('wps/image-target'), image;
        try {
            root.IguanaWps.exportImage(ctx, target.path);
            image = await api('wps/image-read', {token: target.token});
        } finally {
            try { await api('wps/image-discard', {token: target.token}); } catch (ignored) {}
        }
        var result = await ask({data: image.data, message:
            '请准确识别图片中的数学公式，输出一个可直接用 XeLaTeX 编译的完整 LaTeX 文档，放在唯一的 latex 代码块中。只转写看得清的内容；如果公式无法可靠辨认，不要输出代码块，请说明原因。不要输出页码。'});
        var source = result.source, rendered, correctionCount = 0;
        while (true) {
            root.IguanaWps.validate(ctx);
            try {
                rendered = await api('wps/render', {source: source, engine: 'xelatex',
                    point_size: preferredSize(), output: 'svg', alt: ctx.original ? ctx.original.alt : ''});
                break;
            } catch (e) {
                if (!/^(LaTeX 编译失败：|LaTeX 字体缺字：)/.test(e.message) || correctionCount >= 2) throw e;
                var message = correctionMessage(source, e.message);
                result = await ask({message: message, conversation_id: result.conversationId, revision: result.revision});
                source = result.source;
                correctionCount++;
            }
        }
        root.IguanaWps.validate(ctx);
        ctx.sizeMode = 'height';
        root.IguanaWps.replace(ctx, rendered);
    }
    function start() {
        if (running) { alert('图片转公式正在进行，请等待完成。'); return; }
        running = true;
        convert().catch(function (e) {
            alert('图片转公式失败，原图已保留。\n' + (e && e.message ? e.message : '请检查服务后重试。'));
        }).finally(function () { running = false; });
    }
    root.IguanaRecognize = {start: start};
}(window));
