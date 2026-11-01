/* Each Office dialog has its own webview. The hidden shared runtime owns
   presentation access and forwards only the requested operations. */
(function (root) {
    'use strict';
    var isDialog = new URLSearchParams(root.location.search).get('dialog') === '1';
    var Office = root.Office;
    if (!Office) return;

    function trusted(event) { return !event.origin || event.origin === root.location.origin; }
    function parse(event) {
        if (!trusted(event)) return null;
        try { return JSON.parse(event.message); } catch (ignored) { return null; }
    }

    if (!isDialog) {
        var active = null, opening = false;
        var pages = {editor: 'taskpane.html', batch: 'batch.html', utility: 'utility.html'};
        var methods = {capture: ['edit'], apply: ['target', 'renderId', 'sizeMode'],
            capturePictures: [], readPicture: ['target'], applyBatch: ['target', 'renderId'],
            scanFormulas: [], syncFormula: ['item', 'metadata']};
        root.IguanaDialogHost = {
            isOpen: function () { return Boolean(active || opening); },
            notify: function (message) {
                if (active) try { active.messageChild(JSON.stringify({type: 'notice', message: message})); } catch (ignored) {}
            },
            open: function (snapshot, operations) {
                return new Promise(function (resolve, reject) {
                    if (active || opening) { reject(new Error('请先关闭当前窗口。')); return; }
                    if (!Office.context.ui || !Office.context.ui.displayDialogAsync ||
                        !Office.context.requirements.isSetSupported('DialogApi', '1.2')) {
                        reject(new Error('此 PowerPoint 不支持完整编辑窗口。')); return;
                    }
                    var page = snapshot.page || 'editor';
                    if (!Object.prototype.hasOwnProperty.call(pages, page)) { reject(new Error('未知窗口。')); return; }
                    var url = root.location.origin + '/office/' + pages[page] + '?dialog=1&mode=' + encodeURIComponent(snapshot.mode || '');
                    var dimensions = page === 'editor' ? {height: 85, width: 75} :
                        snapshot.mode === 'message' ? {height: 30, width: 45} : {height: 65, width: 60};
                    opening = true;
                    Office.context.ui.displayDialogAsync(url, dimensions, function (result) {
                        opening = false;
                        if (result.status !== Office.AsyncResultStatus.Succeeded) {
                            reject(new Error((result.error && result.error.message) || '无法打开窗口。')); return;
                        }
                        var dialog = result.value;
                        active = dialog;
                        function send(value) { if (active === dialog) dialog.messageChild(JSON.stringify(value)); }
                        dialog.addEventHandler(Office.EventType.DialogMessageReceived, function (event) {
                            var message = parse(event);
                            if (!message || typeof message.type !== 'string') return;
                            if (message.type === 'ready') { send({type: 'ready', snapshot: snapshot}); return; }
                            if (message.type === 'close') {
                                active = null;
                                if (operations.closed) operations.closed(message.state);
                                dialog.close(); return;
                            }
                            if (message.type !== 'call' || !Number.isInteger(message.id) ||
                                !Object.prototype.hasOwnProperty.call(methods, message.operation) ||
                                typeof operations[message.operation] !== 'function') return;
                            Promise.resolve().then(function () {
                                return operations[message.operation].apply(null, methods[message.operation].map(function (key) { return message[key]; }));
                            }).then(function (value) { send({type: 'reply', id: message.id, ok: true, value: value}); },
                                function (error) { send({type: 'reply', id: message.id, ok: false, error: error.message || String(error)}); });
                        });
                        dialog.addEventHandler(Office.EventType.DialogEventReceived, function () {
                            if (active === dialog) { active = null; if (operations.closed) operations.closed(); }
                        });
                        resolve();
                    });
                });
            }
        };
        return;
    }

    document.body.classList.add('office-dialog');
    var closeButton = document.getElementById('closeEditor');
    if (closeButton) closeButton.hidden = false;
    var pending = {}, nextId = 0, initialized = false, resolveReady, rejectReady;
    var ready = new Promise(function (resolve, reject) { resolveReady = resolve; rejectReady = reject; });
    function send(message) { Office.context.ui.messageParent(JSON.stringify(message)); }
    Office.onReady(function () {
        Office.context.ui.addHandlerAsync(Office.EventType.DialogParentMessageReceived, function (event) {
            var message = parse(event);
            if (!message) return;
            if (message.type === 'ready' && !initialized) {
                initialized = true; resolveReady(message.snapshot); return;
            }
            if (message.type === 'notice') {
                var notice = document.getElementById('iguanaNotice');
                if (!notice) {
                    notice = document.createElement('div'); notice.id = 'iguanaNotice';
                    notice.setAttribute('role', 'status');
                    notice.style.cssText = 'position:fixed;top:12px;left:50%;transform:translateX(-50%);z-index:99999;background:#243c36;color:white;padding:12px 18px;border-radius:8px;box-shadow:0 3px 14px #0006';
                    document.body.appendChild(notice);
                }
                notice.textContent = message.message; notice.hidden = false;
                root.setTimeout(function () { notice.hidden = true; }, 5000); return;
            }
            var waiting = message.type === 'reply' && pending[message.id];
            if (!waiting) return;
            delete pending[message.id]; root.clearTimeout(waiting.timer);
            if (message.ok) waiting.resolve(message.value);
            else waiting.reject(new Error(message.error || 'PowerPoint 操作失败。'));
        }, function (result) {
            if (result.status !== Office.AsyncResultStatus.Succeeded) {
                rejectReady(new Error('无法连接 PowerPoint 编辑器。')); return;
            }
            var attempts = 0;
            function hello() {
                if (initialized) return;
                if (++attempts > 50) { rejectReady(new Error('连接 PowerPoint 超时，请关闭窗口后重试。')); return; }
                try { send({type: 'ready'}); } catch (ignored) {}
                root.setTimeout(hello, 400);
            }
            hello();
        });
    });
    function call(operation, args) {
        return ready.then(function () { return new Promise(function (resolve, reject) {
            var id = ++nextId;
            var timer = root.setTimeout(function () {
                delete pending[id]; reject(new Error('PowerPoint 操作超时，请检查幻灯片后重试。'));
            }, 120000);
            pending[id] = {resolve: resolve, reject: reject, timer: timer};
            try { send(Object.assign({type: 'call', id: id, operation: operation}, args)); }
            catch (error) { root.clearTimeout(timer); delete pending[id]; reject(error); }
        }); });
    }
    async function localApi(path, data) {
        var session = await fetch('/api/session', {cache: 'no-store'});
        if (!session.ok) throw new Error('本地服务不可用。');
        var token = (await session.json()).token;
        var response = await fetch('/api/' + path, {method: 'POST', headers: {'Content-Type': 'application/json', 'X-Bridge-Token': token}, body: JSON.stringify(data)});
        var result = await response.json();
        if (!response.ok) throw new Error(result.error || '本地服务不可用。');
        return result;
    }
    root.IguanaDialogClient = {ready: ready, close: function (state) { send({type: 'close', state: state}); }};
    root.IguanaOffice = {
        capture: function (edit) { return call('capture', {edit: edit}); },
        apply: function (target, data, sizeMode) {
            if (!data.render_id) return Promise.reject(new Error('预览未保存，请重新预览后重试。'));
            return call('apply', {target: target, renderId: data.render_id, sizeMode: sizeMode});
        },
        capturePictures: function () { return call('capturePictures', {}); },
        readPicture: async function (target) {
            var cached = await call('readPicture', {target: target});
            try { return (await localApi('wps/review-get', {id: cached.id})).image; }
            finally { try { await localApi('wps/review-discard', {id: cached.id}); } catch (ignored) {} }
        },
        applyBatch: function (target, data) {
            if (!data.render_id) return Promise.reject(new Error('预览未保存，请重新预览后重试。'));
            return call('applyBatch', {target: target, renderId: data.render_id});
        },
        scanFormulas: function () { return call('scanFormulas', {}); },
        syncFormula: function (item, metadata) { return call('syncFormula', {item: item, metadata: metadata}); },
        layout: function (target, data, mode) {
            var old = target && target.original, height = old && mode !== 'font' ? old.height : data.height;
            var width = old && mode !== 'font' ? (mode === 'frame' ? old.width : height * data.width / data.height) : data.width;
            if (![width, height].every(function (n) { return Number.isFinite(n) && n > 0; })) throw new Error('公式尺寸无效。');
            var left = old ? old.left : 36;
            if (old && target.align === 'center') left += (old.width - width) / 2;
            if (old && target.align === 'right') left += old.width - width;
            return {width: width, height: height, left: left, top: old ? old.top : 36};
        }
    };
}(window));
