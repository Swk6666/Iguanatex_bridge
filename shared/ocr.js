/* Shared, explicit image-upload flow for WPS, PowerPoint and the offline UI. */
(function (root) {
    'use strict';
    function mount(container, options) {
        container.classList.add('ocr-panel');
        container.innerHTML = '<details' + (options.collapsed ? '' : ' open') + '><summary>图片 → LaTeX · DeepSeek 网页版</summary>' +
            '<p class="ocr-note">选择、拖入或粘贴公式截图。点击识别会将这张图片发送到 DeepSeek；首次使用需在独立浏览器中登录。</p>' +
            '<div class="ocr-actions"><label class="ocr-file">选择图片<input type="file" accept="image/png,image/jpeg,image/webp"></label>' +
            '<button type="button" data-action="login">打开 / 登录 DeepSeek</button></div>' +
            '<div class="ocr-image" tabindex="0" aria-label="公式截图拖放区"><span>拖入或粘贴公式截图 · PNG / JPEG / WebP · ≤10 MB</span><img alt="待识别的公式截图" hidden></div>' +
            '<div class="ocr-actions"><button type="button" data-action="start">发送到 DeepSeek 识别</button><button type="button" data-action="cancel" hidden>取消等待</button></div>' +
            '<p class="ocr-status" role="status" aria-live="polite"></p>' +
            '<div class="ocr-result" hidden><label>识别结果（编辑区已变化，请手动采用）<textarea spellcheck="false" aria-label="待采用的识别结果"></textarea></label><button type="button" data-action="use">采用此结果</button></div></details>';
        var input = container.querySelector('input'), image = container.querySelector('img'), zone = container.querySelector('.ocr-image');
        var message = container.querySelector('.ocr-status'), resultBox = container.querySelector('.ocr-result');
        var start = container.querySelector('[data-action=start]'), login = container.querySelector('[data-action=login]');
        var cancel = container.querySelector('[data-action=cancel]'), use = container.querySelector('[data-action=use]');
        var chosen = null, jobId = null, active = false, blobUrl = null;
        function status(text) { message.textContent = text; }
        function select(file) {
            if (active || !file) return;
            if (!/^image\/(png|jpeg|webp)$/.test(file.type)) { status('请选择 PNG、JPEG 或 WebP 图片。'); return; }
            if (file.size > 10 * 1024 * 1024) { status('图片不得超过 10 MB，请裁剪公式区域。'); return; }
            chosen = file;
            if (blobUrl) URL.revokeObjectURL(blobUrl);
            blobUrl = URL.createObjectURL(file); image.src = blobUrl; image.hidden = false;
            zone.querySelector('span').hidden = true;
            status('已选择 ' + (file.name || '剪贴板截图') + '。点击识别后上传到 DeepSeek。');
        }
        function setBusy(value) {
            active = value; start.disabled = value; login.disabled = value; input.disabled = value; use.disabled = value;
            cancel.hidden = !value; cancel.disabled = value && !jobId;
        }
        async function applySource(source) {
            var original = options.source.value;
            try {
                var prepared = options.prepareSource ? await options.prepareSource(source, original) : source;
                if (options.source.value !== original) throw new Error('编辑区已变化，请核对后重新采用识别结果。');
                options.source.value = prepared;
            } catch (e) {
                resultBox.querySelector('textarea').value = source; resultBox.hidden = false;
                throw e;
            }
            options.source.dispatchEvent(new Event('input', {bubbles: true}));
            if (options.onSource) options.onSource(options.source.value);
        }
        function readFile(file) {
            return new Promise(function (resolve, reject) {
                var reader = new FileReader();
                reader.onload = function () { resolve(reader.result.split(',')[1]); };
                reader.onerror = function () { reject(new Error('图片读取失败。')); };
                reader.readAsDataURL(file);
            });
        }
        async function run(isLogin) {
            if (active || options.canStart && !options.canStart()) return;
            if (!isLogin && !chosen) { status('请先选择、拖入或粘贴公式截图。'); return; }
            var original = options.source.value;
            setBusy(true); status('正在启动 DeepSeek…');
            try {
                var payload = isLogin ? {} : {data: await readFile(chosen)};
                var job = await options.api(isLogin ? 'ocr/login' : 'ocr/start', payload);
                jobId = job.id; cancel.disabled = false;
                while (true) {
                    status(job.message);
                    if (['succeeded', 'failed', 'cancelled'].indexOf(job.status) !== -1) break;
                    await new Promise(function (resolve) { setTimeout(resolve, 1000); });
                    job = await options.api('ocr/status', {id: jobId});
                }
                if (job.status === 'succeeded' && typeof job.source === 'string') {
                    if (options.source.value === original) {
                        await applySource(job.source); resultBox.hidden = true;
                        status('识别结果已填入编辑区，请核对后预览、写入。');
                    } else {
                        resultBox.querySelector('textarea').value = job.source; resultBox.hidden = false;
                        status('识别已完成。编辑区有新修改，结果保留在下方。');
                    }
                }
            } catch (e) { status(e.message); }
            finally { jobId = null; setBusy(false); }
        }
        input.onchange = function () { select(input.files[0]); input.value = ''; };
        zone.ondragover = function (e) { e.preventDefault(); };
        zone.ondrop = function (e) { e.preventDefault(); select(e.dataTransfer.files[0]); };
        document.addEventListener('paste', function (e) {
            var files = e.clipboardData && e.clipboardData.files;
            if (files && files.length && !active) { e.preventDefault(); select(files[0]); }
        });
        start.onclick = function () { return run(false); };
        login.onclick = function () { return run(true); };
        cancel.onclick = async function () {
            if (!jobId) return;
            cancel.disabled = true;
            try { await options.api('ocr/cancel', {id: jobId}); status('正在取消本地等待…'); }
            catch (e) { status(e.message); cancel.disabled = false; }
        };
        use.onclick = async function () {
            if (active || options.canStart && !options.canStart()) return;
            setBusy(true);
            try { await applySource(resultBox.querySelector('textarea').value); resultBox.hidden = true; status('已采用识别结果，请预览核对。'); }
            catch (e) { status(e.message); }
            finally { setBusy(false); }
        };
        return {isBusy: function () { return active; }};
    }
    root.IguanaOcr = {mount: mount};
}(typeof window !== 'undefined' ? window : globalThis));
