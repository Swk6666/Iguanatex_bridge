/* WPS callback functions must be globally visible. No runtime dependencies. */
function OnAddinLoad(ribbon) { return true; }
function bridgeDialog(mode) {
    // Finish the native ribbon callback before starting another JS API request.
    // Nested synchronous callbacks can deadlock the Linux WPS web dialog loader.
    setTimeout(function () {
        try {
            var base = window.location.href.split('?')[0].replace(/[^/]*$/, '');
            wps.ShowDialog(base + 'editor.html?mode=' + mode + '&session=' + Date.now(), 'IguanaTex · LaTeX 公式', 920, 760, false);
        } catch (e) { alert('无法打开公式编辑器：' + e.message); }
    }, 10);
    return true;
}
function OnNewFormula() { return bridgeDialog('new'); }
function OnRecognizeImage() {
    // Keep WPS API calls out of the native ribbon callback.
    setTimeout(function () { window.IguanaRecognize.start(); }, 10);
    return true;
}
function OnEditFormula() { return bridgeDialog('edit'); }
function OnProtectFormulas() { return bridgeDialog('protect'); }
function OnBridgeHelp() { return bridgeDialog('help'); }
