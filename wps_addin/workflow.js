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
    function error(e) { $('status').textContent = e.message || String(e); }
    async function decide(value) {
        try {
            await api('review-decide', {id:reviewId, decision:value}); decided = true; window.close();
        } catch (e) { error(e); }
    }
    $('settingsClose').onclick = function () { window.close(); };
    $('save').onclick = async function () {
        try {
            await api('settings', {point_size:Number($('size').value), color:$('color').value, align:$('align').value, review:$('review').checked});
            $('status').textContent = '设置已保存，将用于下一次转换。';
        } catch (e) { error(e); }
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
                $('settings').hidden = false;
            } else if (mode === 'review' && reviewId) {
                var review = await api('review-get', {id:reviewId});
                $('original').src = 'data:image/png;base64,' + review.image;
                $('result').src = 'data:image/png;base64,' + review.preview;
                $('reviewPanel').hidden = false;
            } else throw new Error('无法打开此窗口。');
        } catch (e) { error(e); }
    }());
}());
