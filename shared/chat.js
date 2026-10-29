/* Shared DeepSeek chat. Only an explicit Send uploads text/images. */
(function (root) {
    'use strict';
    function mount(container, options) {
        container.classList.add('chat-panel');
        container.innerHTML = '<details class="chat-main"' + (options.collapsed ? '' : ' open') + '><summary>AI 对话 · DeepSeek API</summary>' +
            '<p class="chat-note">输入文字，也可附一张图片；支持连续追问。发送时将本次内容与当前对话传给 DeepSeek，按 API 用量计费。</p>' +
            '<details class="chat-settings"><summary>API 设置 <span class="chat-config-status">正在读取…</span></summary>' +
            '<label>DeepSeek API Key<input class="chat-key" type="password" autocomplete="new-password" spellcheck="false" placeholder="填写密钥；已保存时留空即可"></label>' +
            '<label>模型<input class="chat-model" type="text" spellcheck="false" value="deepseek-flash" maxlength="128"></label>' +
            '<p class="chat-note">密钥仅保存在本机，不写入 PPTX 或 Git 仓库。接口：api.deepseek.com。<a href="https://platform.deepseek.com/api_keys" target="_blank" rel="noopener noreferrer">获取 DeepSeek API Key</a></p>' +
            '<div class="chat-actions"><button type="button" data-action="save">保存设置</button><button type="button" data-action="clear-key">删除本机密钥</button></div></details>' +
            '<div class="chat-actions"><button type="button" data-action="new">新对话</button><button type="button" data-action="refresh">刷新对话</button><span class="chat-note">对话在本次服务运行期间保留</span></div>' +
            '<div class="chat-history" role="region" aria-label="DeepSeek 对话记录"></div>' +
            '<label class="chat-prompt-label">发送给 DeepSeek<textarea class="chat-prompt" rows="3" maxlength="8000" spellcheck="false" placeholder="例如：请识别截图中的公式，并给出包含宏包的完整 LaTeX。也可以直接输入问题。"></textarea></label>' +
            '<div class="chat-image" tabindex="0" aria-label="图片拖放区"><span>可拖入或粘贴一张图片 · PNG / JPEG / WebP · ≤10 MB</span><img alt="待发送的图片" hidden></div>' +
            '<div class="chat-actions"><label class="chat-file">选择图片<input type="file" accept="image/png,image/jpeg,image/webp"></label><button type="button" data-action="remove" hidden>移除图片</button>' +
            '<button class="chat-send" type="button" data-action="send">发送到 DeepSeek</button><button type="button" data-action="cancel" hidden>停止等待</button></div>' +
            '<p class="chat-status" role="status" aria-live="polite"></p></details>';
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
            container.querySelectorAll('button,input,textarea').forEach(function (e) { e.disabled = value || loading; });
            action('cancel').hidden = !jobId; action('cancel').disabled = !jobId;
        }
        function showConfig(config) {
            configured = config.configured; model.value = config.model;
            q('.chat-config-status').textContent = config.configured ? '· 已配置（' + config.key_source + '）' : '· 尚未配置';
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
                history.replaceChildren(node('p', 'chat-empty', '可以询问公式、解释截图，或让 DeepSeek 修改 LaTeX。回答不会自动覆盖源码。'));
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
                    var copyButton = node('button', '', '复制完整回答'); copyButton.type = 'button';
                    copyButton.onclick = function () { return copy(turn.answer); }; row.actions.appendChild(copyButton);
                } else { row.answer.textContent = '尚未收到回答。'; }
                if (turn.status === 'succeeded') (turn.latex_blocks || []).forEach(function (source, i) {
                    var use = node('button', '', '采用 LaTeX' + (turn.latex_blocks.length > 1 ? ' ' + (i + 1) : ''));
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
            if (!mayStart()) return;
            if (!configured) { q('.chat-settings').open = true; status('请先填写并保存 DeepSeek API Key。'); return; }
            if (!prompt.value.trim() && !chosen) { status('请输入文字或选择一张图片。'); return; }
            setBusy(true); status('正在发送到 DeepSeek…');
            try {
                var job = await options.api('chat/start', {message: prompt.value, data: chosen ? await readFile(chosen) : null,
                    conversation_id: conversation.conversation_id, revision: conversation.revision});
                conversation.conversation_id = job.conversation_id; saveConversation(job.conversation_id);
                if (await poll(job.id) === 'succeeded') { prompt.value = ''; removeImage(); }
            } catch (e) { status(e.message + ' 可点击“刷新对话”恢复状态。'); }
            finally { setBusy(false); }
        }
        async function settings(clear) {
            if (!mayStart()) return;
            setBusy(true);
            try {
                showConfig(await options.api('chat/config', {api_key: keyInput.value, model: model.value.trim(), clear_key: clear}));
                keyInput.value = ''; status(clear ? '已删除本机保存的密钥。' : '设置已保存在本机。点击发送即可开始对话。');
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
        return {isBusy: function () { return active; }, ready: ready};
    }
    root.IguanaChat = {mount: mount};
}(typeof window !== 'undefined' ? window : globalThis));
