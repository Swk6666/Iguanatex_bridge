/* Shared DeepSeek chat. Only an explicit Send uploads text/images. */
(function (root) {
    'use strict';
    function icon(paths) {
        return '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true">' + paths + '</svg>';
    }
    function mount(container, options) {
        container.classList.add('chat-panel');
        var wrapper = options.docked ? 'div' : 'details';
        container.innerHTML = '<' + wrapper + ' class="chat-main"' + (options.docked || options.collapsed ? '' : ' open') + '>' +
            (options.docked ? '' : '<summary>AI 对话 · DeepSeek API</summary>') + '<div class="chat-body">' +
            '<div class="chat-toolbar"><button type="button" data-action="new" title="开始不携带旧内容的对话">' + icon('<path d="M12 5v14M5 12h14"/>') + '新对话</button><button type="button" data-action="refresh" title="从本机服务重新读取对话">' + icon('<path d="M20 11a8 8 0 1 0-2.3 5.7M20 4v7h-7"/>') + '刷新</button>' +
            '<details class="chat-settings"><summary>' + icon('<circle cx="8" cy="15" r="4"/><path d="M11 12l9-9M17 6l3 3M15 8l2 2"/>') + 'API 设置</summary><div class="chat-settings-body"><p class="chat-config-status">正在读取…</p>' +
            '<label>DeepSeek API Key<input class="chat-key" type="password" autocomplete="new-password" spellcheck="false" placeholder="已保存时留空即可"></label>' +
            '<label>模型<input class="chat-model" type="text" spellcheck="false" value="deepseek-flash" maxlength="128"></label>' +
            '<p class="chat-note">密钥仅保存在本机，不写入 PPTX 或 Git。<a href="https://platform.deepseek.com/api_keys" target="_blank" rel="noopener noreferrer">获取 API Key</a></p>' +
            '<div class="chat-actions"><button type="button" data-action="save">保存设置</button><button type="button" data-action="clear-key">删除本机密钥</button></div></div></details></div>' +
            '<div class="chat-history" role="region" aria-label="DeepSeek 对话记录"></div>' +
            '<div class="chat-composer"><div class="chat-box"><label class="chat-prompt-label"><span class="chat-sr">发送给 DeepSeek</span><textarea class="chat-prompt" rows="3" maxlength="8000" spellcheck="false" placeholder="描述公式，或附图让 AI 识别…"></textarea></label>' +
            '<div class="chat-image" tabindex="0" aria-label="图片拖放区"><span>拖入或粘贴图片 · ≤10 MB</span><img alt="待发送的图片" hidden></div>' +
            '<div class="chat-actions"><label class="chat-file" title="选择 PNG、JPEG 或 WebP 图片">' + icon('<rect x="3.5" y="4.5" width="17" height="15" rx="2.5"/><circle cx="9" cy="10" r="1.6"/><path d="M20.5 16l-5-5-8.5 8.5"/>') + '图片<input type="file" accept="image/png,image/jpeg,image/webp" aria-label="选择图片"></label><button type="button" data-action="remove" hidden>移除图片</button>' +
            '<span class="chat-hint">Ctrl ↵</span><button class="chat-send" type="button" data-action="send" title="Ctrl / ⌘ + Enter 发送">发送</button><button type="button" data-action="cancel" hidden>停止等待</button></div></div>' +
            '<p class="chat-note chat-disclosure">文字与图片发送至 DeepSeek，按 API 用量计费。</p>' +
            '<p class="chat-status" role="status" aria-live="polite"></p></div></div></' + wrapper + '>';
        var q = function (s) { return container.querySelector(s); };
        var action = function (s) { return q('[data-action="' + s + '"]'); };
        var prompt = q('.chat-prompt'), history = q('.chat-history'), zone = q('.chat-image'), image = q('img');
        var fileInput = q('input[type=file]'), keyInput = q('.chat-key'), model = q('.chat-model');
        var active = false, loading = true, configured = false, chosen = null, blobUrl = null, jobId = null;
        var conversation = {conversation_id: null, revision: 0, turns: [], active_job: null};
        var storageKey = 'iguanatex-bridge.deepseekConversation';
        var lastHistory = '', rows = {};
        function status(text) { q('.chat-status').textContent = text; }
        function mayStart() { return !active && !loading && (!options.canStart || options.canStart()); }
        function saveConversation(id) {
            try { if (id) root.localStorage.setItem(storageKey, id); else root.localStorage.removeItem(storageKey); } catch (ignored) {}
        }
        function setBusy(value) {
            active = value;
            // The prompt stays editable: disabling it mid-composition breaks Chinese IMEs on Linux Chromium.
            container.querySelectorAll('button,input').forEach(function (e) { e.disabled = value || loading; });
            action('cancel').hidden = !jobId; action('cancel').disabled = !jobId;
        }
        function showConfig(config) {
            configured = config.configured; model.value = config.model;
            q('.chat-config-status').textContent = config.configured ? '已配置（' + config.key_source + '）' : '尚未配置';
            if (!config.configured) q('.chat-settings').open = true;
        }
        function removeImage() {
            chosen = null; image.hidden = true; image.removeAttribute('src');
            zone.querySelector('span').hidden = false; action('remove').hidden = true;
            if (blobUrl) URL.revokeObjectURL(blobUrl); blobUrl = null;
        }
        function select(file) {
            if (!mayStart() || !file) return;
            if (!/^image\/(png|jpeg|webp)$/.test(file.type)) { status('请选择 PNG、JPEG 或 WebP 图片。'); return; }
            if (file.size > 10 * 1024 * 1024) { status('图片不得超过 10 MB，请先裁剪。'); return; }
            removeImage(); chosen = file; blobUrl = URL.createObjectURL(file); image.src = blobUrl; image.hidden = false;
            zone.querySelector('span').hidden = true; action('remove').hidden = false; q('.chat-main').open = true;
            status('已选择 ' + (file.name || '剪贴板图片') + '。可补充文字，点击发送后上传。');
        }
        function readFile(file) {
            return new Promise(function (resolve, reject) {
                var reader = new FileReader();
                reader.onload = function () { resolve(reader.result.split(',')[1]); };
                reader.onerror = function () { reject(new Error('图片读取失败。')); };
                reader.readAsDataURL(file);
            });
        }
        function node(tag, className, text) {
            var el = document.createElement(tag); el.className = className;
            if (text !== undefined) el.textContent = text;
            return el;
        }
        async function copy(answer) {
            try {
                if (root.navigator.clipboard && root.navigator.clipboard.writeText) {
                    try { await root.navigator.clipboard.writeText(answer); status('已复制完整回答。'); return; } catch (ignored) {}
                }
                var field = node('textarea', 'chat-copy-buffer'); field.value = answer; container.appendChild(field);
                field.focus(); field.select();
                var ok = document.execCommand('copy'); field.remove();
                if (!ok) throw new Error('复制失败，请直接选择回答文字复制。');
                status('已复制完整回答。');
            } catch (e) { status(e.message); }
        }
        async function adopt(source) {
            if (!mayStart()) return;
            setBusy(true);
            var original = options.source.value;
            try {
                var prepared = options.prepareSource ? await options.prepareSource(source, original) : source;
                if (options.source.value !== original) throw new Error('编辑区已变化，请核对后重新采用。');
                options.source.value = prepared; options.source.dispatchEvent(new Event('input', {bubbles: true}));
                if (options.onSource) options.onSource(prepared);
                status('LaTeX 已填入编辑区，请预览核对后写入。');
            } catch (e) { status(e.message); }
            finally { setBusy(false); }
        }
        function renderHistory(data) {
            conversation = data; saveConversation(data.conversation_id);
            var signature = JSON.stringify(data.turns);
            if (signature === lastHistory) return;
            lastHistory = signature;
            var follow = history.scrollTop + history.clientHeight >= history.scrollHeight - 40;
            if (!data.turns.length) {
                history.replaceChildren(node('p', 'chat-empty', '识别截图、修改公式或解释符号\n回答中的 LaTeX 可一键采用\n\n对话在本次服务运行期间保留'));
                rows = {}; return;
            }
            if (!Object.keys(rows).length) history.replaceChildren();
            data.turns.forEach(function (turn) {
                var row = rows[turn.id];
                if (!row) {
                    var article = node('article', 'chat-turn');
                    article.appendChild(node('div', 'chat-who', '你' + (turn.has_image ? ' · 附带图片' : '')));
                    article.appendChild(node('div', 'chat-user', turn.message));
                    article.appendChild(node('div', 'chat-who', 'DeepSeek · ' + turn.model));
                    row = {answer: node('pre', 'chat-answer'), error: node('p', 'chat-turn-error'), actions: node('div', 'chat-actions')};
                    article.appendChild(row.answer); article.appendChild(row.error); article.appendChild(row.actions);
                    history.appendChild(article); rows[turn.id] = row;
                }
                row.answer.textContent = turn.answer || '正在等待回答…';
                row.error.textContent = turn.error || ''; row.error.hidden = !turn.error;
                if (row.terminal || ['succeeded', 'failed', 'cancelled'].indexOf(turn.status) < 0) return;
                row.terminal = true;
                if (turn.answer) {
                    var copyButton = node('button', 'chat-copy', '复制完整回答'); copyButton.type = 'button';
                    copyButton.onclick = function () { return copy(turn.answer); }; row.actions.appendChild(copyButton);
                } else { row.answer.textContent = '尚未收到回答。'; }
                if (turn.status === 'succeeded') (turn.latex_blocks || []).forEach(function (source, i) {
                    var use = node('button', 'chat-adopt', '采用 LaTeX' + (turn.latex_blocks.length > 1 ? ' ' + (i + 1) : ''));
                    use.type = 'button'; use.onclick = function () { return adopt(source); }; row.actions.appendChild(use);
                });
            });
            if (follow) history.scrollTop = history.scrollHeight;
        }
        async function poll(id) {
            jobId = id; setBusy(true);
            try {
                while (true) {
                    var job = await options.api('chat/status', {id: id});
                    var data = await options.api('chat/history', {conversation_id: job.conversation_id});
                    renderHistory(data); status(job.message);
                    if (['succeeded', 'failed', 'cancelled'].indexOf(job.status) !== -1) return job.status;
                    await new Promise(function (resolve) { setTimeout(resolve, 650); });
                }
            } finally { jobId = null; setBusy(false); }
        }
        async function refresh() {
            if (!mayStart()) return;
            setBusy(true);
            try {
                var data = await options.api('chat/history', {conversation_id: conversation.conversation_id});
                renderHistory(data);
                if (data.active_job) await poll(data.active_job);
                else status('对话已刷新。');
            } catch (e) { status(e.message); }
            finally { setBusy(false); }
        }
        async function send() {
            if (!mayStart()) {
                status(active || loading ? '请等待当前操作完成后再发送，草稿已保留。' : '编辑器正在编译或写入，请稍后再发送。');
                return;
            }
            if (!configured) { q('.chat-settings').open = true; status('请先填写并保存 DeepSeek API Key。'); return; }
            if (!prompt.value.trim() && !chosen) { status('请输入文字或选择一张图片。'); return; }
            setBusy(true); status('正在发送到 DeepSeek…');
            var sent = prompt.value;
            try {
                var job = await options.api('chat/start', {message: prompt.value, data: chosen ? await readFile(chosen) : null,
                    conversation_id: conversation.conversation_id, revision: conversation.revision});
                conversation.conversation_id = job.conversation_id; saveConversation(job.conversation_id);
                if (await poll(job.id) === 'succeeded') { if (prompt.value === sent) prompt.value = ''; removeImage(); }
            } catch (e) { status(e.message + ' 可点击“刷新对话”恢复状态。'); }
            finally { setBusy(false); }
        }
        async function settings(clear) {
            if (!mayStart()) return;
            setBusy(true);
            try {
                showConfig(await options.api('chat/config', {api_key: keyInput.value, model: model.value.trim(), clear_key: clear}));
                keyInput.value = ''; if (configured) q('.chat-settings').open = false; status(clear ? '已删除本机保存的密钥。' : '设置已保存在本机。点击发送即可开始对话。');
            } catch (e) { status(e.message); }
            finally { setBusy(false); }
        }
        action('save').onclick = function () { return settings(false); };
        action('clear-key').onclick = function () { return settings(true); };
        action('send').onclick = send; action('refresh').onclick = refresh;
        action('remove').onclick = function () { if (mayStart()) removeImage(); };
        action('new').onclick = function () {
            if (!mayStart()) return;
            rows = {}; lastHistory = ''; renderHistory({conversation_id: null, revision: 0, turns: [], active_job: null});
            status('已开始新对话，下一次发送不携带之前的内容。');
        };
        action('cancel').onclick = async function () {
            if (!jobId) return;
            action('cancel').disabled = true;
            try { await options.api('chat/cancel', {id: jobId}); status('正在停止等待…已发送的请求可能已产生用量。'); }
            catch (e) { status(e.message); action('cancel').disabled = false; }
        };
        fileInput.onchange = function () { select(fileInput.files[0]); fileInput.value = ''; };
        zone.ondragover = function (e) { e.preventDefault(); };
        zone.ondrop = function (e) { e.preventDefault(); select(e.dataTransfer.files[0]); };
        container.addEventListener('paste', function (e) {
            var files = e.clipboardData && e.clipboardData.files;
            if (files && files.length && mayStart()) { e.preventDefault(); select(files[0]); }
        });
        container.addEventListener('keydown', function (e) {
            if (e.isComposing || e.keyCode === 229) return;
            if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
                e.preventDefault(); e.stopPropagation();
                if (e.target === prompt) send();
            }
        });
        setBusy(false);
        var ready = (async function () {
            try {
                showConfig(await options.api('chat/config', {}));
                var saved = null; try { saved = root.localStorage.getItem(storageKey); } catch (ignored) {}
                var data;
                try { data = await options.api('chat/history', {conversation_id: saved}); }
                catch (e) { saveConversation(null); data = {conversation_id: null, revision: 0, turns: [], active_job: null}; status(e.message); }
                renderHistory(data); loading = false;
                if (data.active_job) await poll(data.active_job);
            } catch (e) { status(e.message); }
            finally { loading = false; setBusy(false); }
        }());
        async function ask(text) {
            if (!mayStart()) { status('请等待当前操作完成后再发送。'); return; }
            prompt.value = text;
            return send();
        }
        return {isBusy: function () { return active; }, ready: ready, ask: ask};
    }
    function clip(text, limit) {
        if (text.length <= limit) return text;
        var head = Math.floor(limit * 0.6);
        return text.slice(0, head) + '\n…（中间省略 ' + (text.length - limit) + ' 字符）…\n' + text.slice(text.length - (limit - head));
    }
    // The part of a TeX log a reader needs: the first "!" error with its context, else the tail.
    function excerpt(log) {
        var lines = String(log || '').replace(/^LaTeX 编译失败：\n?/, '').split(/\r?\n/);
        var first = -1;
        for (var i = 0; i < lines.length; i++) if (/^! /.test(lines[i])) { first = i; break; }
        var picked = first >= 0 ? lines.slice(Math.max(0, first - 3), first + 20) : lines.slice(-40);
        return clip(picked.join('\n').trim(), 2500);
    }
    var ENGINES = {xelatex: 'XeLaTeX', pdflatex: 'pdfLaTeX', lualatex: 'LuaLaTeX'};
    function compileReport(info) {
        var header = '预览编译失败（引擎：' + (ENGINES[info.engine] || info.engine) + '）。请根据错误日志说明原因，并给出修正后的完整 LaTeX 文档。';
        var log = excerpt(info.message);
        var room = 7600 - header.length - log.length;
        return header + '\n\n错误日志：\n```text\n' + log + '\n```\n\n当前源码：\n```latex\n' + clip(String(info.source || '').trim(), Math.max(800, room)) + '\n```';
    }
    root.IguanaChat = {mount: mount, compileReport: compileReport};
}(typeof window !== 'undefined' ? window : globalThis));
