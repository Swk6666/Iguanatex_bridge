(function () {
    'use strict';
    var $ = function (id) { return document.getElementById(id); }, token = null;
    var params = new URLSearchParams(location.search), mode = params.get('mode'), reviewId = params.get('id'), decided = false;
    async function api(path, data, retried) {
        if (!token) token = (await (await fetch('/api/session', {cache:'no-store'})).json()).token;
        var response = await fetch('/api/wps/' + path, {method:'POST', headers:{'Content-Type':'application/json','X-Bridge-Token':token}, body:JSON.stringify(data || {})});
        if (response.status === 403 && !retried) { token = null; return api(path, data, true); }
        var result = await response.json();
        if (!response.ok) throw new Error(result.error || '本地服务不可用。');
        return result;
    }
    function status(text, failed) { $('status').textContent = text; $('status').className = failed ? 'error' : ''; }
    function error(e) { status(e.message || String(e), true); }
    function busy(ids, value) { ids.forEach(function (id) { $(id).disabled = value; }); }
    function showColor() { $('colorValue').textContent = String($('color').value).toUpperCase(); }
    async function decide(value) {
        busy(['accept', 'skip', 'cancel'], true);
        try {
            await api('review-decide', {id:reviewId, decision:value}); decided = true; window.close();
        } catch (e) { error(e); busy(['accept', 'skip', 'cancel'], false); }
    }
    $('settingsClose').onclick = $('messageClose').onclick = function () { window.close(); };
    $('color').oninput = showColor;
    $('save').onclick = async function () {
        busy(['save'], true);
        try {
            await api('settings', {point_size:Number($('size').value), color:$('color').value, align:$('align').value, review:$('review').checked});
            status('设置已保存，将用于下一次转换。');
        } catch (e) { error(e); } finally { busy(['save'], false); }
    };
    $('accept').onclick = function () { decide('accept'); };
    $('skip').onclick = function () { decide('skip'); };
    $('cancel').onclick = function () { decide('cancel'); };
    window.addEventListener('pagehide', function () {
        if (mode === 'review' && reviewId && token && !decided) {
            fetch('/api/wps/review-decide', {method:'POST', keepalive:true, headers:{'Content-Type':'application/json','X-Bridge-Token':token}, body:JSON.stringify({id:reviewId,decision:'skip'})}).catch(function () {});
        }
    });
    (async function () {
        try {
            if (mode === 'settings') {
                var settings = await api('settings');
                $('size').value = settings.point_size; $('color').value = settings.color; $('align').value = settings.align; $('review').checked = settings.review;
                showColor(); $('context').textContent = '转换设置';
                $('settings').hidden = $('settingsActions').hidden = false; status('');
            } else if (mode === 'message') {
                $('messageText').textContent = decodeURIComponent(String(location.hash || '').slice(1));
                $('context').textContent = '转换结果';
                $('message').hidden = $('messageActions').hidden = false; status('');
            } else if (mode === 'review' && reviewId) {
                var review = await api('review-get', {id:reviewId});
                $('original').src = 'data:image/png;base64,' + review.image;
                $('result').src = 'data:image/png;base64,' + review.preview;
                $('context').textContent = '对照校对';
                $('reviewPanel').hidden = $('reviewActions').hidden = false; status('');
            } else throw new Error('无法打开此窗口。');
        } catch (e) { error(e); }
    }());
}());
