/* WPS callback functions must be globally visible. No runtime dependencies. */
var bridgeRibbon = null;
function OnAddinLoad(ribbon) { bridgeRibbon = ribbon; return true; }
// Own SVG icons: WPS shows a "?" placeholder for imageMso names it does not know.
var bridgeIcons = {IguanaNew: 'new', IguanaRecognize: 'recognize', IguanaEdit: 'edit', IguanaStatus: 'status',
    IguanaCancel: 'cancel', IguanaSettings: 'settings', IguanaDraft: 'draft', IguanaProtect: 'protect', IguanaHelp: 'help'};
function GetImage(control) { return 'images/' + (bridgeIcons[control && control.Id] || 'new') + '.svg'; }
function UpdateRecognitionUI() {
    try { if (bridgeRibbon) bridgeRibbon.InvalidateControl('IguanaStatus'); } catch (ignored) {}
}
function GetConversionStatus() { return window.IguanaRecognize ? window.IguanaRecognize.status().label : '转换：就绪'; }
function OnConversionStatus() { ShowBridgeMessage(window.IguanaRecognize.status().detail); return true; }
function OnCancelConversion() { setTimeout(function () { window.IguanaRecognize.cancel(); }, 10); return true; }
function OnConversionSettings() { return bridgeDialog('settings'); }
function OnEditDraft() { return bridgeDialog('draft'); }
function bridgeBase() { return window.location.href.split('?')[0].replace(/[^/]*$/, ''); }
// Conversion results open in a non-modal window: alert() would block WPS until dismissed.
function ShowBridgeMessage(text) {
    setTimeout(function () {
        try {
            wps.ShowDialog(bridgeBase() + 'workflow.html?mode=message&session=' + Date.now() + '#' +
                encodeURIComponent(String(text).slice(0, 4000)), 'IguanaTex · 图片转公式', 560, 420, false);
        } catch (e) { alert(text); }
    }, 10);
    return true;
}
function bridgeDialog(mode) {
    // Finish the native ribbon callback before starting another JS API request.
    // Nested synchronous callbacks can deadlock the Linux WPS web dialog loader.
    setTimeout(function () {
        try {
            var base = bridgeBase(), settings = mode === 'settings';
            var page = settings ? 'workflow.html?mode=settings' : 'editor.html?mode=' + mode;
            // The four conversion settings fit a compact window; the editor needs the full workbench.
            wps.ShowDialog(base + page + '&session=' + Date.now(), settings ? '转换设置' : 'IguanaTex · LaTeX 公式',
                settings ? 600 : 920, settings ? 540 : 760, false);
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
