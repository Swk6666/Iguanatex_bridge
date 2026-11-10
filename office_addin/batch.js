/* The shared runtime owns the worker so a progress window can be closed
   without stopping conversion. The same worker also supports the legacy pane. */
(function (root) {
    'use strict';
    function createWorker(options) {
    options = options || {};
    var silentNodes = {};
    var $ = function (id) { return options.background ? (silentNodes[id] || (silentNodes[id] = {})) : document.getElementById(id); };
    var token = null, items = [], batch = null, settings = null, stopped = false, timer = null, reviewShown = null, ownsBatch = false, ending = false;
    var starting = false;
    async function api(path, data, retried) {
        if (!token) token = (await (await fetch('/api/session', {cache:'no-store'})).json()).token;
        var response = await fetch('/api/' + path, {method:'POST', headers:{'Content-Type':'application/json','X-Bridge-Token':token}, body:JSON.stringify(data || {})});
        if (response.status === 403 && !retried) { token = null; return api(path, data, true); }
        var result = await response.json(); if (!response.ok) throw new Error(result.error || '本地服务不可用。'); return result;
    }
    function identity(target) { return {presentation:String(target.draftPresentation || target.presentationId), slide_id:target.slideId, shape_id:target.original.id}; }
    function signature(target) { return JSON.stringify([target.structure, target.imageDigest]); }
    function friendly(e) {
        var text = e && e.message ? e.message : String(e);
        if (/额度|余额|insufficient_quota/.test(text)) return 'OpenAI 额度不足，请检查 API 账单和额度。';
        if (/请求受限|速率|rate limit/i.test(text)) return 'OpenAI 请求过于频繁，请稍后重试。';
        if (/API Key|密钥/.test(text)) return 'OpenAI 密钥不可用，请在 AI 助手的 API 设置中更新。';
        if (/网络|连接|超时|fetch|network/i.test(text)) return '网络连接失败，请检查网络和本地服务。';
        if (/LaTeX 编译失败|LaTeX 字体缺字/.test(text)) return 'LaTeX 编译失败，可选中原图后点击“编辑失败草稿”。';
        return text.split('\n')[0].slice(0, 240);
    }
    function cancelled() { var e = new Error('已取消'); e.cancelled = true; return e; }
    async function pulse(extra) {
        if (!batch) throw new Error('批量任务未启动。');
        var state = await api('office/batch/update', Object.assign({id:batch.id}, extra || {}));
        if (!ending) { batch = state; draw(state); }
        if (state.cancel_requested || stopped) throw cancelled();
        return state;
    }
    function draw(state) {
        var count = state.succeeded + state.failed + state.skipped, remaining = state.total - count;
        $('progressText').textContent = state.stage + '\n已处理 ' + count + ' / ' + state.total + '；成功 ' + state.succeeded + '，失败 ' + state.failed + '，跳过 ' + state.skipped + (state.status !== 'running' && remaining ? '，未处理 ' + remaining : '') + '。';
        $('errors').textContent = (state.errors || []).slice(0, 20).join('\n');
        $('cancel').disabled = state.status !== 'running';
        if (state.review_id && reviewShown !== state.review_id) {
            if (options.background) { reviewShown = state.review_id; if (options.onReview) options.onReview(); }
            else showReview(state.review_id).catch(showError);
        }
        if (!state.review_id) { $('review').hidden = true; reviewShown = null; }
    }
    function showError(e) { $('message').textContent = friendly(e); if (options.onError) options.onError(friendly(e)); }
    async function showReview(id) {
        reviewShown = id; var review = await api('wps/review-get', {id:id});
        if (!batch || batch.review_id !== id) return;
        $('reviewOriginal').src = 'data:image/png;base64,' + review.image;
        $('reviewPreview').src = 'data:image/png;base64,' + review.preview;
        $('review').hidden = false;
    }
    async function decide(decision) {
        if (!batch || !batch.review_id) return;
        try { await api('wps/review-decide', {id:batch.review_id, decision:decision}); $('review').hidden = true; }
        catch (e) { showError(e); }
    }
    $('accept').onclick = function () { return decide('accept'); };
    $('skip').onclick = function () { return decide('skip'); };
    $('stopReview').onclick = function () { return decide('cancel'); };
    $('cancel').onclick = async function () { try { draw(await api('office/batch/cancel')); } catch (e) { showError(e); } };
    function correctionMessage(source, error) {
        var lines = String(error).split(/\r?\n/), first = lines.findIndex(function (line) { return /^! /.test(line); });
        var excerpt = (first >= 0 ? lines.slice(Math.max(0, first - 3), first + 20) : lines.slice(-30)).join('\n').slice(0, 2000);
        var message = 'XeLaTeX 编译失败。请根据错误日志修复下面的完整 LaTeX 文档，保留原公式含义及必要宏包，只输出一个完整的 latex 代码块。不能可靠修复时不要输出代码块。\n\n错误日志：\n```text\n' + excerpt + '\n```\n\n完整源码：\n```latex\n' + source + '\n```';
        if (message.length > 8000) throw new Error('源码过长，无法自动纠错；请手动检查。');
        return message;
    }
    function wait(ms) { return new Promise(function (resolve) { setTimeout(resolve, ms); }); }
    async function ask(request) {
        await pulse(); var job = await api('chat/start', request), active = false;
        try {
            try { await pulse({active_job:job.id}); active = true; }
            catch (e) { try { await api('chat/cancel', {id:job.id}); } catch (ignored) {} throw e; }
            while (true) {
                await pulse(); var result = await api('chat/status', {id:job.id}); await pulse();
                if (['succeeded','failed','cancelled'].includes(result.status)) {
                    if (result.status !== 'succeeded') throw new Error(result.message || 'OpenAI 请求未完成。');
                    var history = await api('chat/history', {conversation_id:job.conversation_id}); await pulse();
                    var turn = history.turns.find(function (item) { return item.id === job.id; });
                    if (!turn || !turn.latex_blocks || turn.latex_blocks.length !== 1) throw new Error('未得到可确认的公式源码。');
                    return {source:turn.latex_blocks[0], conversationId:job.conversation_id, revision:history.revision};
                }
                await wait(650);
            }
        } finally {
            if (active && batch) try { batch = await api('office/batch/update', {id:batch.id, active_job:null}); } catch (ignored) {}
        }
    }
    async function review(image, rendered) {
        await pulse(); var item = await api('wps/review-create', {image:image, preview:rendered.png});
        try {
            await pulse({review_id:item.id, stage:'等待校对：请核对当前图片。'});
            var deadline = Date.now() + 600000;
            while (Date.now() < deadline) {
                await pulse(); var state = await api('wps/review-status', {id:item.id});
                if (state.decision === 'accept') return true;
                if (state.decision === 'skip') return false;
                if (state.decision === 'cancel') { await api('office/batch/cancel'); throw cancelled(); }
                await wait(650);
            }
            throw new Error('校对等待超时，原图已保留。');
        } finally {
            try { await api('wps/review-discard', {id:item.id}); } catch (ignored) {}
            if (batch) try { batch = await api('office/batch/update', {id:batch.id, review_id:null}); draw(batch); } catch (ignored) {}
        }
    }
    async function convert(target, number, total, scratch) {
        async function stage(name) { await pulse({current:number, stage:'第 ' + number + ' / ' + total + ' 张：' + name}); }
        target.align = settings.align; await stage('读取图片');
        var image = await IguanaOffice.readPicture(target); await stage('识别中');
        var result = await ask({data:image, message:'请准确识别图片中的数学公式，输出一个可直接用 XeLaTeX 编译的完整 LaTeX 文档，放在唯一的 latex 代码块中。只转写看得清的内容；如果公式无法可靠辨认，不要输出代码块，请说明原因。不要输出页码。'});
        var source = result.source, rendered, corrections = 0; scratch.source = source;
        while (true) {
            await stage('本机编译中');
            try {
                rendered = await api('render', {source:source, engine:'xelatex', point_size:settings.point_size, color:settings.color, output:'svg', alt:target.original.alt || ''});
                scratch.error = ''; await pulse(); break;
            } catch (e) {
                if (e.cancelled) throw e;
                scratch.error = e.message || String(e);
                if (!/^(LaTeX 编译失败：|LaTeX 字体缺字：)/.test(scratch.error) || corrections >= 2) throw e;
                await stage('自动纠错中');
                result = await ask({message:correctionMessage(source, scratch.error), conversation_id:result.conversationId, revision:result.revision});
                source = result.source; scratch.source = source; corrections++;
            }
        }
        if (settings.review && !await review(image, rendered)) return 'skipped';
        await stage('写入原幻灯片');
        await IguanaOffice.applyBatch(target, rendered);
        try { await api('wps/draft-delete', {identity:identity(target)}); } catch (ignored) {}
        return 'succeeded';
    }
    async function run() {
        var counts = {succeeded:0, failed:0, skipped:0}, errors = [];
        try {
            if (!ownsBatch) { settings = await api('wps/settings'); batch = await api('office/batch/start', {total:items.length}); ownsBatch = true; }
            $('cancel').disabled = false; draw(batch);
            timer = setInterval(function () { if (batch && batch.status === 'running') pulse().catch(function (e) { if (e.cancelled) stopped = true; else showError(e); }); }, 5000);
            for (var i = 0; i < items.length; i++) {
                var item = items[i], scratch = {source:'', error:''};
                try {
                    await pulse(); if (item.error) throw new Error(item.error);
                    var outcome = await convert(item.target, i + 1, items.length, scratch); counts[outcome]++;
                } catch (e) {
                    if (e.cancelled || stopped) break;
                    counts.failed++; var issue = friendly(e);
                    if (item.target && scratch.source) {
                        try { await api('wps/draft-save', {identity:identity(item.target), signature:signature(item.target), source:scratch.source,
                            error:scratch.error || (e.message || String(e)), settings:settings}); issue += ' 已保存草稿。'; }
                        catch (err) { issue += ' 草稿保存失败：' + friendly(err); }
                    }
                    errors.push('第 ' + (i + 1) + ' 张：' + issue);
                }
                try { await pulse(Object.assign({errors:errors}, counts)); } catch (e) { if (e.cancelled) break; throw e; }
            }
            if (timer) { clearInterval(timer); timer = null; } ending = true;
            if (batch) { batch = await api('office/batch/finish', Object.assign({id:batch.id, errors:errors}, counts)); draw(batch); }
        } catch (e) { showError(e); if (batch && batch.status === 'running') {
            try { batch = await api('office/batch/abort', {id:batch.id}); draw(batch); } catch (ignored) {}
        } } finally { if (timer) clearInterval(timer); timer = null; $('cancel').disabled = true; ownsBatch = false; }
    }
    async function startBackground() {
        if (starting || ownsBatch) throw new Error('已有批量转换正在进行，请通过“转换状态”查看。');
        starting = true;
        try {
            var active = await api('office/batch/status');
            if (active.status === 'running') throw new Error('已有批量转换正在进行，请通过“转换状态”查看。');
            items = await IguanaOffice.capturePictures();
            if (!items.some(function (item) { return item.target; })) throw new Error('请先选中至少一张可转换的图片。');
            settings = await api('wps/settings'); batch = await api('office/batch/start', {total:items.length});
            stopped = false; ending = false; reviewShown = null; ownsBatch = true;
            run();
            return {total:items.length, invalid:items.filter(function (item) { return item.error; }).length};
        } finally { starting = false; }
    }
    if (options.background) {
        window.addEventListener('pagehide', function () {
            if (ownsBatch && batch && batch.status === 'running' && token) fetch('/api/office/batch/abort', {method:'POST', keepalive:true,
                headers:{'Content-Type':'application/json','X-Bridge-Token':token}, body:JSON.stringify({id:batch.id})}).catch(function () {});
        });
        return {start:startBackground};
    }
    $('start').onclick = function () { $('start').disabled = true; $('message').textContent = ''; run(); };
    window.addEventListener('pagehide', function () {
        if (ownsBatch && batch && batch.status === 'running' && token) fetch('/api/office/batch/abort', {method:'POST', keepalive:true,
            headers:{'Content-Type':'application/json','X-Bridge-Token':token}, body:JSON.stringify({id:batch.id})}).catch(function () {});
    });
    Office.onReady(function (info) {
        if (info.host !== Office.HostType.PowerPoint) { $('selection').textContent = '请在 PowerPoint 中打开此加载项。'; return; }
        (async function () {
            try {
                var active = await api('office/batch/status');
                if (active.status === 'running') { batch = active; draw(active); $('selection').textContent = '已有批量转换正在进行，请通过“转换状态”查看。'; return; }
                items = await IguanaOffice.capturePictures();
                var invalid = items.filter(function (item) { return item.error; }).length;
                $('selection').textContent = '已读取 ' + items.length + ' 个选中对象。' + (invalid ? '其中 ' + invalid + ' 个不是可转换的图片，将安全跳过。' : '');
                $('start').disabled = !items.some(function (item) { return item.target; });
            } catch (e) { $('selection').textContent = friendly(e); }
        }());
    });
    return {};
    }
    root.IguanaBatchWorker = {create:createWorker};
    if (document.getElementById('selection')) createWorker();
}(window));
