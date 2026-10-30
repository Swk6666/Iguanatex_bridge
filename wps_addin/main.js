/* WPS callback functions must be globally visible. No runtime dependencies. */
var bridgeRibbon = null;
function OnAddinLoad(ribbon) { bridgeRibbon = ribbon; return true; }
function UpdateRecognitionUI() {
    try { if (bridgeRibbon) bridgeRibbon.InvalidateControl('IguanaStatus'); } catch (ignored) {}
}
function GetConversionStatus() { return window.IguanaRecognize ? window.IguanaRecognize.status().label : '转换：就绪'; }
function OnConversionStatus() { setTimeout(function () { alert(window.IguanaRecognize.status().detail); }, 10); return true; }
function OnCancelConversion() { setTimeout(function () { window.IguanaRecognize.cancel(); }, 10); return true; }
function OnConversionSettings() { return bridgeDialog('settings'); }
function OnEditDraft() { return bridgeDialog('draft'); }
function bridgeDialog(mode) {
    // Finish the native ribbon callback before starting another JS API request.
    // Nested synchronous callbacks can deadlock the Linux WPS web dialog loader.
    setTimeout(function () {
        try {
            var base = window.location.href.split('?')[0].replace(/[^/]*$/, '');
            var page = mode === 'settings' ? 'workflow.html?mode=settings' : 'editor.html?mode=' + mode;
            wps.ShowDialog(base + page + '&session=' + Date.now(), mode === 'settings' ? '转换设置' : 'IguanaTex · LaTeX 公式', 920, 760, false);
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
