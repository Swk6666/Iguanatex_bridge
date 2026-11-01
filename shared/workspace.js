/* Layout controls shared by WPS, Office and the standalone editor. */
(function () {
    'use strict';
    var dock = document.getElementById('assistantDock');
    var toggle = document.getElementById('assistantToggle');
    var deck = document.querySelector('.deck-panel');
    if (deck && window.innerWidth <= 760) deck.open = false;
    function showAssistant(open) {
        dock.hidden = !open;
        toggle.setAttribute('aria-expanded', String(open));
        // WPS previews fit the actual available canvas, including after docking.
        window.dispatchEvent(new Event('resize'));
        if (open) {
            var settings = dock.querySelector('.chat-settings');
            var field = dock.querySelector(settings && settings.open ? '.chat-key' : '.chat-prompt');
            if (field) field.focus();
        } else toggle.focus();
    }
    if (dock && toggle) {
        toggle.onclick = function () { showAssistant(dock.hidden); };
        document.getElementById('assistantClose').onclick = function () { showAssistant(false); };
        if (['ocr', 'picture'].includes(new URLSearchParams(location.search).get('mode'))) showAssistant(true);
    }
    // Line numbers: the source is also set programmatically, so poll cheaply as well as on input.
    var source = document.getElementById('source');
    var gutter = document.querySelector('.code-gutter');
    if (source && gutter) {
        var lines = 0;
        var syncGutter = function () {
            var count = source.value.split('\n').length;
            if (count !== lines) {
                lines = count;
                var text = '';
                for (var i = 1; i <= count; i++) text += i + '\n';
                gutter.textContent = text;
            }
            gutter.scrollTop = source.scrollTop;
        };
        source.addEventListener('input', syncGutter);
        source.addEventListener('scroll', syncGutter);
        setInterval(syncGutter, 300);
        syncGutter();
    }
    // Resizable preview; WPS recomputes its fitted preview on resize.
    var splitter = document.querySelector('.pane-splitter');
    var pane = document.querySelector('.formula-pane');
    var heightKey = 'iguanatex-bridge.previewHeight';
    function setPreviewHeight(value, save) {
        var max = Math.max(80, pane.clientHeight - 150);
        var height = Math.round(Math.min(max, Math.max(72, value)));
        pane.style.setProperty('--preview-h', height + 'px');
        splitter.setAttribute('aria-valuenow', String(height));
        if (save) { try { window.localStorage.setItem(heightKey, String(height)); } catch (ignored) {} }
        window.dispatchEvent(new Event('resize'));
    }
    if (splitter && pane) {
        var canvas = pane.querySelector('.preview-canvas');
        try {
            var saved = Number(window.localStorage.getItem(heightKey));
            if (saved > 0) setPreviewHeight(saved, false);
        } catch (ignored) {}
        splitter.addEventListener('pointerdown', function (e) {
            e.preventDefault();
            var startY = e.clientY, startH = canvas.offsetHeight;
            splitter.classList.add('dragging');
            splitter.setPointerCapture(e.pointerId);
            var move = function (ev) { setPreviewHeight(startH + startY - ev.clientY, false); };
            var up = function () {
                splitter.classList.remove('dragging');
                splitter.removeEventListener('pointermove', move);
                splitter.removeEventListener('pointerup', up);
                setPreviewHeight(canvas.offsetHeight, true);
            };
            splitter.addEventListener('pointermove', move);
            splitter.addEventListener('pointerup', up);
        });
        splitter.addEventListener('keydown', function (e) {
            if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
            e.preventDefault();
            setPreviewHeight(canvas.offsetHeight + (e.key === 'ArrowUp' ? 16 : -16), true);
        });
        splitter.addEventListener('dblclick', function () { setPreviewHeight(150, true); });
    }
    document.addEventListener('click', function (e) {
        document.querySelectorAll('.popover[open]').forEach(function (menu) {
            if (!menu.contains(e.target) || e.target.closest('[data-template]')) menu.open = false;
        });
    });
    document.addEventListener('keydown', function (e) {
        // Escape during IME composition cancels the candidate, not the panel.
        if (e.key !== 'Escape' || e.isComposing || e.keyCode === 229) return;
        var menus = document.querySelectorAll('.popover[open], .chat-settings[open], .chat-guide[open]');
        if (menus.length) {
            menus.forEach(function (menu) { menu.open = false; menu.querySelector('summary').focus(); });
        } else if (dock && !dock.hidden) showAssistant(false);
    });
}());
