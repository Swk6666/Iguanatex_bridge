#!/usr/bin/env python3
"""Standalone screenshot-to-TeX desktop application. No IguanaTeX installation."""
from __future__ import annotations

import argparse
import base64
import json
from pathlib import Path
import sys

from PySide6.QtCore import (QBuffer, QByteArray, QIODevice, QMimeData, QObject,
                            QRunnable, QThreadPool, QTimer, Qt, Signal, Slot)
from PySide6.QtGui import (QAction, QFontDatabase, QImage, QKeySequence, QPixmap,
                           QShortcut, QTextCursor)
from PySide6.QtWidgets import (QApplication, QCheckBox, QComboBox, QDoubleSpinBox,
                               QFileDialog, QFrame, QHBoxLayout, QLabel,
                               QMainWindow, QMessageBox, QPlainTextEdit,
                               QProgressBar, QPushButton, QScrollArea, QToolButton,
                               QVBoxLayout, QWidget)

from desktop_support import (LocalService, atomic_write, formula_pptx, load_image,
                             read_source, render_formula)
from ocr import MAX_PIXELS, TERMINAL, prepare_image
from paths import state_dir
from latex_source import complete_source, replace_formula, DEFAULT_FORMULA


class TaskSignals(QObject):
    success = Signal(object)
    failure = Signal(str)
    finished = Signal()


class Task(QRunnable):
    def __init__(self, fn):
        super().__init__()
        self.fn, self.signals = fn, TaskSignals()

    @Slot()
    def run(self):
        try:
            self.signals.success.emit(self.fn())
        except Exception as error:
            self.signals.failure.emit(str(error))
        finally:
            self.signals.finished.emit()


class ImageArea(QLabel):
    imageDropped = Signal(object)

    def __init__(self, text, drop=False):
        super().__init__(text)
        self.empty_text, self.original = text, QPixmap()
        self.setAlignment(Qt.AlignmentFlag.AlignCenter)
        self.setWordWrap(True)
        self.setMinimumSize(240, 180)
        self.setAcceptDrops(drop)
        self.setObjectName('imageArea')

    def show_image(self, data):
        self.original.loadFromData(data)
        self.fit_image()

    def clear_image(self, text):
        self.original = QPixmap()
        self.setPixmap(QPixmap())
        self.setText(text)

    def fit_image(self):
        if not self.original.isNull():
            self.setPixmap(self.original.scaled(self.size() * .88,
                                               Qt.AspectRatioMode.KeepAspectRatio,
                                               Qt.TransformationMode.SmoothTransformation))

    def resizeEvent(self, event):
        super().resizeEvent(event)
        self.fit_image()

    def dragEnterEvent(self, event):
        mime = event.mimeData()
        if mime.hasImage() or mime.hasUrls() and any(u.isLocalFile() for u in mime.urls()):
            event.acceptProposedAction()

    def dropEvent(self, event):
        self.imageDropped.emit(event.mimeData())
        event.acceptProposedAction()


class MainWindow(QMainWindow):
    def __init__(self, service, directory=None):
        super().__init__()
        self.service = service
        self.directory = Path(directory or state_dir())
        self.pool = QThreadPool(self)
        self.tasks = set()
        self.image_data = self.result = self.job_id = None
        self.ocr_active = self.polling = self.rendering = False
        self.pending_source, self.ocr_baseline = '', ''
        self.setWindowTitle('IguanaTex Bridge · 公式编辑器')
        self.resize(950, 920)
        self.setMinimumSize(800, 610)
        root = QWidget()
        self.setCentralWidget(root)
        layout = QVBoxLayout(root)
        layout.setContentsMargins(0, 0, 0, 0); layout.setSpacing(0)
        header = QFrame(); header.setObjectName('header')
        header_row = QHBoxLayout(header); header_row.setContentsMargins(28, 20, 28, 20)
        mark = QLabel('∑'); mark.setObjectName('mark'); mark.setFixedSize(46, 46)
        mark.setAlignment(Qt.AlignmentFlag.AlignCenter); header_row.addWidget(mark)
        title = QVBoxLayout()
        heading = QLabel('IguanaTex <span style="color:#698581; font-weight:400">Bridge</span>')
        heading.setObjectName('heading'); title.addWidget(heading)
        subtitle = QLabel('在独立窗口中编写，随 PPTX 跨平台编辑')
        subtitle.setObjectName('muted'); title.addWidget(subtitle)
        header_row.addLayout(title); header_row.addStretch()
        badge = QLabel('本机编译'); badge.setObjectName('badge'); header_row.addWidget(badge)
        self.button('关闭', self.close, header_row)
        layout.addWidget(header)
        scroll = QScrollArea(); scroll.setWidgetResizable(True)
        scroll.setFrameShape(QFrame.Shape.NoFrame)
        content = QWidget(); scroll.setWidget(content); layout.addWidget(scroll)
        b = QVBoxLayout(content); b.setContentsMargins(28, 18, 28, 22); b.setSpacing(10)
        self.status = QLabel('输入公式，预览后复制或导出到幻灯片。')
        self.status.setObjectName('status'); self.status.setWordWrap(True)
        self.status.setTextInteractionFlags(Qt.TextInteractionFlag.TextSelectableByMouse)
        b.addWidget(self.status)
        row = QHBoxLayout()
        row.addWidget(QLabel('编译引擎'))
        self.engine = QComboBox()
        for label, value in [('XeLaTeX · 支持中文', 'xelatex'), ('pdfLaTeX', 'pdflatex'), ('LuaLaTeX', 'lualatex')]:
            self.engine.addItem(label, value)
        row.addWidget(self.engine)
        row.addWidget(QLabel('输出'))
        self.output = QComboBox()
        self.output.addItem('SVG 矢量 · 放大清晰', 'svg'); self.output.addItem('PNG 透明图片', 'png')
        row.addWidget(self.output)
        row.addWidget(QLabel('字号'))
        self.size = QDoubleSpinBox(); self.size.setRange(4, 200); self.size.setValue(24)
        self.size.setSingleStep(.5); self.size.setDecimals(1); self.size.setFixedWidth(80)
        row.addWidget(self.size); row.addWidget(QLabel('pt')); row.addStretch()
        target = QLabel('独立桌面'); target.setObjectName('muted'); row.addWidget(target)
        b.addLayout(row)
        hint = QLabel('字号范围 4–200 pt；沿用原编辑器的 10 pt 模板缩放规则。')
        hint.setObjectName('muted'); b.addWidget(hint)
        self.ocr_toggle = QToolButton()
        self.ocr_toggle.setText('截图识别 · DeepSeek 网页版')
        self.ocr_toggle.setToolButtonStyle(Qt.ToolButtonStyle.ToolButtonTextBesideIcon)
        self.ocr_toggle.setArrowType(Qt.ArrowType.DownArrow)
        self.ocr_toggle.setCheckable(True); self.ocr_toggle.setChecked(False)
        b.addWidget(self.ocr_toggle)
        self.ocr_panel = QWidget(); a = QVBoxLayout(self.ocr_panel)
        a.setContentsMargins(0, 0, 0, 0); a.setSpacing(6)
        shot_row = QHBoxLayout()
        self.drop = ImageArea('拖入或粘贴公式截图\n⌘V / Ctrl+V', drop=True)
        self.drop.setMinimumSize(220, 90); self.drop.setFixedHeight(100); self.drop.setMaximumWidth(310)
        self.drop.setAccessibleName('公式截图拖放区')
        self.drop.imageDropped.connect(self.accept_mime)
        shot_row.addWidget(self.drop, 1)
        controls = QVBoxLayout()
        row = QHBoxLayout()
        self.choose = self.button('选择图片', self.choose_image, row)
        self.paste_button = self.button('粘贴截图', self.paste_image, row)
        self.login = self.button('打开 DeepSeek · Chrome', lambda: self.start_ocr(True), row)
        controls.addLayout(row)
        row = QHBoxLayout()
        self.auto = QCheckBox('放入截图后自动识别')
        self.auto.setChecked(True); row.addWidget(self.auto); row.addStretch()
        self.recognize = self.button('识别 / 重试', self.start_ocr, row)
        self.cancel = self.button('取消等待', self.cancel_ocr, row)
        self.cancel.hide()
        controls.addLayout(row)
        note = QLabel('图片发送到 DeepSeek；首次需在专用 Chrome 窗口登录。')
        note.setWordWrap(True); note.setObjectName('muted'); controls.addWidget(note)
        shot_row.addLayout(controls, 2); a.addLayout(shot_row)
        self.progress = QProgressBar()
        self.progress.setRange(0, 0); self.progress.setFixedHeight(4); self.progress.hide()
        a.addWidget(self.progress)
        self.ocr_message = QLabel('支持 PNG、JPEG、WebP，最大 10 MB。')
        self.ocr_message.setWordWrap(True)
        self.ocr_message.setTextInteractionFlags(Qt.TextInteractionFlag.TextSelectableByMouse)
        a.addWidget(self.ocr_message)
        self.pending = QPlainTextEdit()
        self.pending.setReadOnly(True)
        self.pending.setMaximumHeight(120)
        self.pending.hide()
        a.addWidget(self.pending)
        self.use_result = self.button('采用这次识别结果', self.use_pending, a)
        self.use_result.hide()
        b.addWidget(self.ocr_panel)
        self.ocr_toggle.toggled.connect(self.toggle_ocr)
        self.toggle_ocr(False)
        row = QHBoxLayout(); row.addWidget(QLabel('<b>完整 LaTeX 源码</b>')); row.addStretch()
        hint = QLabel('宏包、命令与正文均可编辑'); hint.setObjectName('muted'); row.addWidget(hint)
        b.addLayout(row)
        self.source = QPlainTextEdit()
        self.source.setAccessibleName('LaTeX 源码')
        self.source.setFont(QFontDatabase.systemFont(QFontDatabase.SystemFont.FixedFont))
        self.source.setMinimumHeight(260)
        self.source.setPlaceholderText('输入完整 LaTeX 文档；粘贴公式片段时，编译前会先补全并显示。')
        initial_source = complete_source(DEFAULT_FORMULA)
        self.source.setPlainText(initial_source)
        cursor = self.source.textCursor()
        cursor.setPosition(initial_source.index(DEFAULT_FORMULA))
        cursor.setPosition(initial_source.index(DEFAULT_FORMULA) + len(DEFAULT_FORMULA), QTextCursor.MoveMode.KeepAnchor)
        self.source.setTextCursor(cursor)
        b.addWidget(self.source, 3)
        row = QHBoxLayout()
        label = QLabel('插入示例'); label.setObjectName('muted'); row.addWidget(label)
        templates = [('求和', r'\sum_{k=1}^{n} k = \frac{n(n+1)}{2}'),
                     ('矩阵', r'\mathbf{A}=\begin{bmatrix}a&b\\c&d\end{bmatrix}'),
                     ('多行公式', '\\begin{aligned}\nM(q)\\ddot q+C(q,\\dot q)\\dot q+g(q)&=\\tau,\\\\\nA x&=b.\n\\end{aligned}'),
                     ('中文标注', r'\underbrace{M(q)\ddot q}_{\text{惯性项}}+g(q)=\tau')]
        for label, snippet in templates:
            button = self.button(label, lambda checked=False, value=snippet: self.insert_template(value), row)
            button.setObjectName('template')
        row.addStretch(); b.addLayout(row)
        self.preview_area = ImageArea('点击“预览”检查排版')
        self.preview_area.setMinimumHeight(100); self.preview_area.setMaximumHeight(150)
        b.addWidget(self.preview_area, 1)
        self.preview_size = QLabel(''); self.preview_size.setObjectName('muted')
        b.addWidget(self.preview_size)
        row = QHBoxLayout()
        self.copy_tex_button = self.button('复制 TeX', self.copy_tex, row)
        row.addStretch()
        self.preview_button = self.button('预览  Ctrl + Enter', self.preview, row)
        self.copy_image_button = self.button('复制图片', self.copy_image, row)
        self.export_button = self.button('导出公式…', self.export, row)
        self.export_button.setObjectName('primary')
        b.addLayout(row)
        hint = QLabel('复制图片后在幻灯片中粘贴。矢量图选择 SVG 导出；含源码的 PPTX 可再次打开编辑。')
        hint.setObjectName('muted'); hint.setWordWrap(True)
        b.addWidget(hint)
        self.detail = QPlainTextEdit(); self.detail.setReadOnly(True)
        self.detail.setMaximumHeight(110); self.detail.hide(); b.addWidget(self.detail)
        menu = self.menuBar().addMenu('文件')
        for title, shortcut, action in [('打开源码 / 公式…', QKeySequence.StandardKey.Open, self.open_source),
                                         ('保存 TeX…', QKeySequence.StandardKey.Save, self.save_source)]:
            item = QAction(title, self); item.setShortcut(shortcut); item.triggered.connect(action); menu.addAction(item)
        QShortcut(QKeySequence.StandardKey.Paste, self, activated=self.paste_image)
        QShortcut(QKeySequence('Ctrl+Return'), self, activated=self.preview)
        self.poll = QTimer(self); self.poll.setInterval(800); self.poll.timeout.connect(self.poll_ocr)
        self.draft_timer = QTimer(self); self.draft_timer.setSingleShot(True)
        self.draft_timer.setInterval(1000); self.draft_timer.timeout.connect(self.save_draft)
        self.source.textChanged.connect(self.edited)
        self.engine.currentTextChanged.connect(self.edited)
        self.size.valueChanged.connect(self.edited)
        self.auto.toggled.connect(lambda: self.draft_timer.start())
        self.output.currentIndexChanged.connect(lambda: self.draft_timer.start())
        self.restore_draft()
        self.update_actions()

    def button(self, title, callback, layout):
        button = QPushButton(title)
        button.clicked.connect(callback)
        layout.addWidget(button)
        return button

    def submit(self, fn, success, failure=None):
        task = Task(fn)
        self.tasks.add(task)
        task.signals.success.connect(success)
        task.signals.failure.connect(failure or self.error)
        task.signals.finished.connect(lambda: self.tasks.discard(task))
        self.pool.start(task)

    def error(self, message):
        self.status.setText(message.splitlines()[0])
        self.detail.setPlainText(message)
        self.detail.setVisible('\n' in message)

    def fingerprint(self):
        return self.source.toPlainText(), self.engine.currentData(), self.size.value()

    def toggle_ocr(self, expanded):
        self.ocr_panel.setVisible(expanded)
        self.ocr_toggle.setArrowType(Qt.ArrowType.DownArrow if expanded else Qt.ArrowType.RightArrow)

    def insert_template(self, source):
        self.source.insertPlainText(source)
        self.source.setFocus()

    def edited(self):
        self.result = None
        self.preview_area.clear_image('源码已修改，点击“预览”检查排版。')
        self.preview_size.setText('')
        self.update_actions()
        self.draft_timer.start()

    def update_actions(self):
        for button in (self.choose, self.paste_button, self.recognize, self.login):
            button.setEnabled(not self.ocr_active)
        self.cancel.setVisible(self.ocr_active)
        self.cancel.setEnabled(bool(self.job_id))
        self.progress.setVisible(self.ocr_active)
        self.preview_button.setEnabled(not self.rendering)
        self.copy_image_button.setEnabled(self.result is not None)
        self.export_button.setEnabled(self.result is not None)

    def accept_mime(self, mime):
        if self.ocr_active:
            self.ocr_message.setText('请等待当前识别结束，或先取消。')
            return
        try:
            if mime.hasImage():
                image = QImage(mime.imageData())
                if image.isNull() or image.width() * image.height() > MAX_PIXELS:
                    raise ValueError('截图无效或超过 2000 万像素。')
                buffer = QBuffer(); buffer.open(QIODevice.OpenModeFlag.WriteOnly)
                if not image.save(buffer, 'PNG'):
                    raise ValueError('无法读取剪贴板图片。')
                self.set_image(prepare_image(base64.b64encode(bytes(buffer.data())).decode()))
            elif mime.hasUrls():
                paths = [u.toLocalFile() for u in mime.urls() if u.isLocalFile()]
                if paths:
                    self.set_image(load_image(paths[0]))
            else:
                self.ocr_message.setText('剪贴板没有图片，请先截取公式。')
        except Exception as error:
            self.ocr_message.setText(str(error))

    def paste_image(self):
        mime = QApplication.clipboard().mimeData()
        if mime.hasImage() or mime.hasUrls():
            self.accept_mime(mime)
        elif self.source.hasFocus() and mime.hasText():
            self.source.insertPlainText(mime.text())
        else:
            self.ocr_message.setText('剪贴板没有图片，请先截取公式。')

    def choose_image(self):
        path, _ = QFileDialog.getOpenFileName(self, '选择公式截图', '', '图片 (*.png *.jpg *.jpeg *.webp)')
        if path:
            try:
                self.set_image(load_image(path))
            except Exception as error:
                self.ocr_message.setText(str(error))

    def set_image(self, data):
        self.ocr_toggle.setChecked(True)
        self.image_data = data
        self.drop.show_image(data)
        self.ocr_message.setText('截图已放入。')
        if self.auto.isChecked():
            self.start_ocr()

    def start_ocr(self, login=False):
        if self.ocr_active:
            return
        if not login and self.image_data is None:
            self.ocr_message.setText('请先拖入、选择或粘贴一张公式截图。')
            return
        self.ocr_active = True
        self.ocr_baseline = self.source.toPlainText()
        self.pending.hide(); self.use_result.hide()
        self.ocr_message.setText('正在连接 Chrome 中的 DeepSeek…')
        self.update_actions()
        payload = {} if login else {'data': base64.b64encode(self.image_data).decode()}
        self.submit(lambda: self.service.call('ocr/login' if login else 'ocr/start', payload),
                    self.got_job, self.ocr_error)

    def got_job(self, job):
        self.job_id = job['id']
        self.update_job(job)
        if self.ocr_active:
            self.poll.start()

    def poll_ocr(self):
        if not self.job_id or self.polling:
            return
        self.polling = True
        jid = self.job_id
        self.submit(lambda: self.service.call('ocr/status', {'id': jid}), self.update_job, self.ocr_error)

    def update_job(self, job):
        self.polling = False
        self.ocr_message.setText(job['message'])
        if job['status'] in TERMINAL:
            self.poll.stop(); self.ocr_active = False; self.job_id = None
            if job.get('source'):
                if self.source.toPlainText() == self.ocr_baseline:
                    try:
                        self.source.setPlainText(replace_formula(self.ocr_baseline, job['source']))
                        self.ocr_message.setText('识别完成，公式已填入完整文档，导言区保留。')
                        self.preview()
                    except ValueError as error:
                        self.pending_source = job['source']; self.pending.setPlainText(self.pending_source)
                        self.pending.show(); self.use_result.show(); self.error(str(error))
                else:
                    self.pending_source = job['source']
                    self.pending.setPlainText(self.pending_source)
                    self.pending.show(); self.use_result.show()
                    self.ocr_message.setText('识别完成。你已修改源码，请核对后采用下方结果。')
        self.update_actions()

    def ocr_error(self, message):
        self.poll.stop(); self.ocr_active = self.polling = False; self.job_id = None
        self.ocr_message.setText(message)
        self.update_actions()

    def cancel_ocr(self):
        if self.job_id:
            jid = self.job_id
            self.cancel.setEnabled(False)
            self.submit(lambda: self.service.call('ocr/cancel', {'id': jid}),
                        lambda _: self.ocr_message.setText('正在停止本地等待…'), self.ocr_error)

    def use_pending(self):
        try:
            self.source.setPlainText(replace_formula(self.source.toPlainText(), self.pending_source))
        except ValueError as error:
            self.error(str(error)); return
        self.pending.hide(); self.use_result.hide()
        self.preview()

    def preview(self):
        if self.rendering:
            return
        if not self.prepare_source():
            return
        snapshot = self.fingerprint()
        if not snapshot[0].strip():
            self.status.setText('先放入截图，或输入 TeX 源码。')
            return
        self.rendering = True; self.update_actions(); self.detail.hide()
        self.status.setText('正在本机编译公式…')
        def ready(result):
            self.rendering = False
            if self.fingerprint() == snapshot:
                self.result = result
                self.preview_area.show_image(result['png'])
                self.preview_size.setText(f"写入尺寸：{result['width'] * 2.54 / 72:.2f} × {result['height'] * 2.54 / 72:.2f} cm · 预览按窗口缩放")
                self.status.setText('预览完成 · 可以复制公式图片，或导出以保留源码。')
            else:
                self.status.setText('编译期间源码已修改，请再次预览。')
            self.update_actions()
        def failed(message):
            self.rendering = False; self.update_actions(); self.error(message)
        self.submit(lambda: render_formula(*snapshot), ready, failed)

    def prepare_source(self):
        try:
            original = self.source.toPlainText()
            full = complete_source(original)
            if original != full:
                self.source.setPlainText(full)
            return True
        except ValueError as error:
            self.error(str(error))
            return False

    def copy_tex(self):
        if not self.prepare_source():
            return
        QApplication.clipboard().setText(self.source.toPlainText())
        self.status.setText('完整 LaTeX 文档已复制。')

    def copy_image(self):
        if self.result is None:
            return
        mime = QMimeData()
        mime.setImageData(QImage.fromData(self.result['png']))
        mime.setData('image/png', QByteArray(self.result['png']))
        QApplication.clipboard().setMimeData(mime)
        self.status.setText('公式图片已复制。到 PowerPoint / WPS 中粘贴；再次编辑可保存 TeX 或导出 PPTX。')

    def save_source(self):
        if not self.prepare_source():
            return
        path, _ = QFileDialog.getSaveFileName(self, '保存 TeX', 'formula.tex', 'TeX 源码 (*.tex)')
        if path:
            try:
                atomic_write(path, self.source.toPlainText().encode())
                self.status.setText('已保存源码：' + path)
            except OSError as error:
                self.error(str(error))

    def export(self):
        if self.result is None:
            return
        output = self.output.currentData()
        filters = '矢量公式 (*.svg);;透明图片 (*.png);;含源码的 PowerPoint (*.pptx);;TeX 源码 (*.tex)'
        initial = '矢量公式 (*.svg)' if output == 'svg' else '透明图片 (*.png)'
        path, selected = QFileDialog.getSaveFileName(self, '导出公式', 'formula.' + output, filters, initial)
        if not path:
            return
        suffix = Path(path).suffix.lower().lstrip('.')
        if suffix not in ('svg', 'png', 'pptx', 'tex'):
            suffix = next(ext for ext in ('svg', 'png', 'pptx', 'tex') if '*.' + ext in selected)
            path += '.' + suffix
        result = self.result
        def write():
            data = (formula_pptx(result) if suffix == 'pptx' else
                    result['source'].encode() if suffix == 'tex' else result[suffix])
            atomic_write(path, data)
        self.submit(write, lambda _: self.status.setText('已导出：' + path))

    def open_source(self):
        path, _ = QFileDialog.getOpenFileName(self, '打开源码或导出的公式', '',
                                             '公式文件 (*.tex *.svg *.png *.pptx)')
        if not path:
            return
        try:
            data = read_source(path)
            self.source.setPlainText(data['source'])
            if data.get('engine') in ('xelatex', 'pdflatex', 'lualatex'):
                self.engine.setCurrentIndex(self.engine.findData(data['engine']))
            if 'point_size' in data:
                self.size.setValue(data['point_size'])
            self.preview()
        except Exception as error:
            self.error(str(error))

    def save_draft(self):
        try:
            self.directory.mkdir(parents=True, exist_ok=True)
            source, engine, size = self.fingerprint()
            atomic_write(self.directory / 'desktop-draft.json', json.dumps(dict(
                source=source, engine=engine, point_size=size, auto=self.auto.isChecked(), output=self.output.currentData()),
                ensure_ascii=False).encode())
        except OSError:
            self.status.setText('无法自动保存草稿，请使用“文件 → 保存 TeX”。')

    def restore_draft(self):
        try:
            data = json.loads((self.directory / 'desktop-draft.json').read_text(encoding='utf-8'))
            if isinstance(data.get('source'), str) and len(data['source']) <= 200_000:
                self.source.setPlainText(data['source'])
                self.engine.setCurrentIndex(max(0, self.engine.findData(data.get('engine', 'xelatex'))))
                self.size.setValue(float(data.get('point_size', 24)))
                self.auto.setChecked(bool(data.get('auto', True)))
                self.output.setCurrentIndex(max(0, self.output.findData(data.get('output', 'svg'))))
                self.status.setText('已恢复上次的 TeX 草稿。')
                if data['source'].strip():
                    self.prepare_source()
        except (OSError, ValueError, TypeError):
            pass

    def closeEvent(self, event):
        self.poll.stop(); self.draft_timer.stop(); self.save_draft()
        # Thread-affine browser shutdown is handled by the local service owner.
        if self.job_id:
            jid = self.job_id
            self.submit(lambda: self.service.call('ocr/cancel', {'id': jid}), lambda _: None)
        event.accept()


STYLE = '''
QWidget {font-size: 14px; color: #203235; background: #f5f7f7;}
QFrame#header, QFrame#header QLabel {background: white;}
QFrame#header {border-bottom: 1px solid #dfe7e7;}
QLabel#heading {font-size: 22px; font-weight: 600;}
QFrame#header QLabel#mark {font-family: Georgia; font-size: 36px; background: #176a61; color: white; border-radius: 12px;}
QFrame#header QLabel#badge {font-size: 12px; color: #176a61; background: #e9f4ef; border-radius: 15px; padding: 6px 10px;}
QLabel#muted {color: #71847f; font-size: 12px;}
QLabel#status {background: #e9f3f0; border: 1px solid #d3e5de; border-radius: 8px; padding: 11px 14px;}
QLabel#imageArea {background: white; border: 1px solid #dce6e2; border-radius: 8px; color: #8a9f99; padding: 8px;}
QPlainTextEdit {background: white; border: 1px solid #bfcfcd; border-radius: 8px; padding: 12px; color: #243d44; selection-background-color: #d3e9e0;}
QPushButton {background: white; border: 1px solid #bfcfcd; border-radius: 6px; padding: 7px 11px;}
QPushButton:hover {background: #edf5f2;}
QPushButton:disabled {color: #9baaa5; background: #edf2ef; border-color: #dce6e2;}
QPushButton#primary {background: #176a61; color: white; border-color: #176a61;}
QPushButton#primary:hover {background: #11564e;}
QPushButton#template {font-size: 12px; padding: 4px 10px;}
QComboBox, QDoubleSpinBox {background: white; padding: 6px; border: 1px solid #bfcfcd; border-radius: 6px;}
QToolButton {border: 0; font-weight: 600; padding: 3px 0;}
QProgressBar {border: 0; background: #e2eae6;}
QProgressBar::chunk {background: #459e91;}
'''


def main():
    parser = argparse.ArgumentParser(description='TeX 截图助手：独立桌面 GUI')
    parser.add_argument('--port', type=int, default=17863, help='共享本地服务端口')
    parser.add_argument('--ocr-browser', choices=['chrome', 'msedge', 'chromium'], default='chrome')
    parser.add_argument('--ocr-selectors')
    args = parser.parse_args()
    app = QApplication(sys.argv[:1])
    app.setApplicationName('IguanaTex Bridge')
    app.setOrganizationName('IguanaTexBridge')
    app.setStyle('Fusion')
    app.setStyleSheet(STYLE)
    try:
        service = LocalService(args.port, args.ocr_browser, args.ocr_selectors)
    except Exception as error:
        QMessageBox.critical(None, '无法启动', str(error))
        return 1
    window = MainWindow(service)
    window.show()
    result = app.exec()
    window.pool.waitForDone()
    service.close()
    return result


if __name__ == '__main__':
    sys.exit(main())
