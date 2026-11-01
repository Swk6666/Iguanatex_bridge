/* The Office dialog has its own webview. Document operations remain in its
   parent task pane and are forwarded over Office's same-origin dialog API. */
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
        var active = null;
        root.IguanaDialogHost = {
            open: function (snapshot, operations) {
                return new Promise(function (resolve, reject) {
                    if (active) { reject(new Error('完整编辑器已经打开。')); return; }
                    if (!Office.context.ui || !Office.context.ui.displayDialogAsync ||
                        !Office.context.requirements.isSetSupported('DialogApi', '1.2')) {
                        reject(new Error('此 PowerPoint 不支持完整编辑窗口，请使用侧栏编辑。')); return;
                    }
                    var url = root.location.origin + '/office/taskpane.html?dialog=1&mode=' + encodeURIComponent(snapshot.mode);
                    Office.context.ui.displayDialogAsync(url, {height: 85, width: 75}, function (result) {
                        if (result.status !== Office.AsyncResultStatus.Succeeded) {
                            reject(new Error((result.error && result.error.message) || '无法打开完整编辑器。')); return;
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
                                !['capture', 'apply'].includes(message.operation)) return;
                            Promise.resolve().then(function () {
                                return message.operation === 'capture' ? operations.capture(Boolean(message.edit)) :
                                    operations.apply(message.target, message.renderId, message.sizeMode);
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
    document.getElementById('closeEditor').hidden = false;
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
    root.IguanaDialogClient = {ready: ready, close: function (state) { send({type: 'close', state: state}); }};
    root.IguanaOffice = {
        capture: function (edit) { return call('capture', {edit: edit}); },
        apply: function (target, data, sizeMode) {
            if (!data.render_id) return Promise.reject(new Error('预览未保存，请重新预览后重试。'));
            return call('apply', {target: target, renderId: data.render_id, sizeMode: sizeMode});
        },
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
