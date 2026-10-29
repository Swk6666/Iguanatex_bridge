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
        if (new URLSearchParams(location.search).get('mode') === 'ocr') showAssistant(true);
    }
    document.addEventListener('click', function (e) {
        document.querySelectorAll('.popover[open]').forEach(function (menu) {
            if (!menu.contains(e.target) || e.target.closest('[data-template]')) menu.open = false;
        });
    });
    document.addEventListener('keydown', function (e) {
        if (e.key !== 'Escape') return;
        var menus = document.querySelectorAll('.popover[open], .chat-settings[open]');
        if (menus.length) {
            menus.forEach(function (menu) { menu.open = false; menu.querySelector('summary').focus(); });
        } else if (dock && !dock.hidden) showAssistant(false);
    });
}());
