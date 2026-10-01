# IguanaTex Bridge 0.4.0 · 桌面公式编辑器与 PowerPoint / WPS 加载项

推荐：[独立桌面 GUI](docs/DESKTOP.md)，界面沿用 Ubuntu 版，新增截图自动识别入口。另有 [macOS / Windows PowerPoint 安装](docs/INSTALL_OFFICE.md) · [DeepSeek 图片转 TeX](docs/DEEPSEEK.md)。本项目不依赖上游 IguanaTeX；下文原有 WPS 工作流和可选兼容工作流仍适用。

在 Ubuntu 的 **WPS 演示顶部 IguanaTex 功能区**中直接新建和编辑 LaTeX 公式。完整源码随 PPTX 保存，使用 IguanaTex 的原生标签格式，供 Windows / macOS 的 PowerPoint + IguanaTex 继续编辑。

**原有功能已在 Ubuntu + WPS 12.8.2.21176 实测；0.4.0 已在 Mac PowerPoint 16.113.3 实测自己的 Office 加载项和桌面识别流程。Windows 与新增 Ubuntu GUI / OCR 仍待实机验证。**

## 此前 Ubuntu 电脑的安装状态

本项目所在目录已注册到 WPS，并配置当前用户的后台服务。WPS 顶部已有 **IguanaTex** 标签。日常无需手动打开终端或导入、导出文稿。

此目录是当前安装位置，请保留。移动目录后，应在新位置重新运行安装脚本。安装包不携带 Python、TeX Live 或上游 IguanaTex。

## 日常使用

1. 在 WPS 演示中打开或新建文稿，选中目标幻灯片。
2. 点击 **IguanaTex → 新建公式**，输入公式片段或完整 LaTeX 文档。
3. 点击 **预览**（快捷键 Ctrl+Enter，Mac 为 Command+Enter），再点击 **插入当前幻灯片**。
4. 以后选中公式图片、SVG 或 IguanaTex Shape 组合，点击 **编辑选中公式**，修改后点击 **更新此公式**。
5. 点击编辑器右上角“关闭”，在 WPS 中正常保存为 `.pptx`。图片为嵌入对象，换电脑不依赖临时图片路径。

功能区还提供：

- **检查与同步源码**：扫描当前演示文稿，以 IguanaTex 原生标签为准更新替代文字备份；标签丢失时尝试恢复。完成后请保存文稿。
- **环境与帮助**：检查 XeLaTeX / pdfLaTeX / LuaLaTeX 是否可用，查看操作说明。

**IguanaTex Shape / 矢量组合可以直接编辑，无需 Convert to Picture。** 插件读取原生源码，更新为 SVG 矢量图形；字体转换为轮廓，放大清晰，接收方无需安装相同字体。也可手动选择透明 PNG。点击 Shape 组合中的单个字符时，会定位到整条公式。

Shape 默认**保留原宽高**，避免改变已有排版；也可选择“保留高度，宽度随公式变化”。位置、旋转、翻转和前后层叠顺序保持。更新后的 SVG 可继续用 LaTeX 编辑，但不会保留原来的逐字 Shape 结构。**动画、手动字形配色、特效和交互动作需重新设置**。包含其他内容或多条公式的外层排版组合，请先取消外层组合，保留公式自身的组合。

### 调节字号

新建和编辑公式时，都可以在顶部的 **字号** 输入框输入 4–200 pt，支持小数，例如 22.5。修改已有公式的字号，会自动切换为 **按字号重设尺寸**；预览后点击“更新此公式”即可生效。

字号采用 IguanaTex 的 10 pt 模板缩放规则：同一份源码从 24 改为 36，生成的宽高为原 24 pt 渲染尺寸的 1.5 倍。它调整整条公式的显示尺寸，不改写 LaTeX 源码中的字号命令。完整文档自行使用 12 pt 或 `\Huge` 时，会叠加源码本身的字号设置。

手动拉伸过的公式在“按字号重设尺寸”时恢复自然宽高比例；需要沿用现有布局时，可改回“保留原宽高”，字号也会回到上次记录值。连续更新同一字号不会重复放大。预览下方显示实际写入尺寸；超大公式不会自动缩小字号，请自行减小字号或缩短内容。

## 在另一台 Ubuntu 电脑安装

完整流程、升级、卸载和排错见 [Ubuntu 安装与维护](docs/INSTALL_UBUNTU.md)。项目管理和待办见 [PROJECT.md](PROJECT.md)。

需要 Python 3.10+、支持 JS 加载项的 WPS 演示和本机 LaTeX。已有 TeX Live 时可以先用 `xelatex --version` 检查。

Ubuntu 推荐直接克隆仓库，然后在项目目录执行：

```bash
bash install.sh
```

脚本自动补齐 Ubuntu 的 Python / venv、XeLaTeX 和中文宏包。使用普通用户运行，仅安装系统包时会提示 `sudo` 密码。具体克隆、身份验证、升级和卸载步骤见 [Ubuntu 安装说明](docs/INSTALL_UBUNTU.md)。

脚本建立 `.venv`、安装 Python 依赖、启动本地服务，并合并 WPS 的 `publish.xml`，不会覆盖其他加载项。修改已有配置前会保存带时间戳的备份。

保存工作并重启 WPS 后可见 IguanaTex 功能区。Linux 优先使用用户级 systemd 服务，环境不支持时改用桌面登录自动启动。

## Windows / Mac 与 IguanaTex 互通

Windows / macOS 推荐使用自己的桌面 GUI 或 Office 加载项；如果已有上游 IguanaTex，也可以选择以下互通方式：

1. 按 [IguanaTex 官方说明](https://github.com/Jonathan-LeRoux/IguanaTex) 安装并确认它能独立生成公式。
2. 打开 WPS 保存的 `.pptx`，选中公式图片。
3. 点击 IguanaTex 的 **Edit LaTeX display**，修改源码后点击 **ReGenerate**。
4. 保存 PPTX，传回 Ubuntu。选中公式并使用本插件的 **编辑选中公式**。
5. 交接前可点击 **检查与同步源码**，同步上次在 IguanaTex 中修改后的最新源码。

适配字段包括 `LATEXADDIN`、`LATEXENGINEID`、`IGUANATEXSIZE`、`BITMAPVECTOR`、`OUTPUTTYPE`、`OUTPUTDPI`、`ORIGINALWIDTH`、`ORIGINALHEIGHT` 等。使用完整文档源码，不写入另一台机器的临时目录配置。

源码同时写入原生标签、替代文字和 PNG / SVG 文件元数据。本机 WPS 保存后均已验证保留。插件可从替代文字恢复标签；独立编辑器还支持从 PNG 恢复（尚不读取 SVG 文件元数据备份）。若全部源码信息被删除，可用新增 DeepSeek 图片识别重新转写公式；它不能保证恢复与原稿完全相同的源码。

### Windows / Mac 也使用 WPS 时

- Windows：安装 Python 3.10+（带 `py` 启动器）、TeX Live 或 MiKTeX，双击 `install_wps_windows.bat`。后台服务通过当前用户的“启动”文件夹启动。
- macOS：安装 Python 3.10+ 和 MacTeX，运行 `bash install_wps_linux_mac.sh`。后台服务通过用户 LaunchAgent 启动；默认使用沙盒版 WPS 的加载项目录。
- Mac 或定制版 WPS 的配置目录不同时，可用 `--addons-dir /实际/jsaddons/目录` 指定。
- 这两套 WPS 安装脚本已提供，但未在对应系统实测。WPS 版本必须支持 JS 加载项。

## 公式与中文

例如直接输入：

```latex
\begin{aligned}
M(q)\ddot q+C(q,\dot q)\dot q+g(q)&=\tau,\\
A x&=b.
\end{aligned}
```

片段会补全 `article`、`amsmath`、`amssymb` 和 `bm`。中文片段会添加 `ctex`，使用 TeX 发行版提供的 Fandol 字体。中文建议用 XeLaTeX：

```latex
\underbrace{M(q)\ddot q}_{\text{惯性项}}+g(q)=\tau
```

完整文档会原样编译；工具不会替完整文档自动补包。每个公式应只输出一页，建议 `\pagestyle{empty}`。外部绝对路径、系统专属字体、`\input` 文件及需要 shell-escape 的宏包不属于便携工作流。

## 独立 PPTX 编辑器仍可用

原 0.1 文件工作流保留，适用于不支持加载项的 WPS 或源码恢复：

```bash
bash start_linux_mac.sh
```

Windows 双击 `start_windows.bat`。或者在后台服务已运行时访问 [独立编辑器](http://127.0.0.1:17863/)。

操作：WPS 保存并关闭目标文稿 → 独立编辑器打开 PPTX → 修改或保护源码 → 下载副本 → WPS 打开副本。此模式直接修改 PPTX 包，更新已有图片时保留对象 ID 和现有 XML。独立模式仍输出 PNG；Shape 组合的编辑请使用 WPS 工具栏。

## 检查、恢复与卸载

查看后端：

```bash
.venv/bin/python app.py --doctor
systemctl --user status iguanatex-bridge.service
journalctl --user -u iguanatex-bridge.service -n 40
```

默认端口为 `17863`，仅监听 `127.0.0.1`。可通过安装器 `--port 其他端口` 改动，随后重启 WPS。

若功能区没有出现，先确认 [本地服务状态](http://127.0.0.1:17863/health)，再保存工作并完整退出、重开 WPS。检查 WPS 版本是否支持 JS 加载项。不要直接覆盖安装目录里的 `oem.ini`。

卸载注册和自动启动配置：

```bash
.venv/bin/python install_wps.py --uninstall
```

Windows：`.venv\Scripts\python.exe install_wps.py --uninstall`。卸载后重新启动 WPS。Windows 或自动启动降级模式的既有后台进程会在注销后退出；项目文件保留。

## 验证与边界

- 56 项 Python 测试和 51 项 JavaScript 测试覆盖渲染、字号、源码兼容、安装与本地服务、GUI 支持模块、图片识别、Office / WPS 组合识别、目标冲突检查与替换失败回滚；详细范围见 [VALIDATION.md](VALIDATION.md)。
- Ubuntu 实机验证：工具栏打开编辑器、透明 PNG 插入、读取选中公式、中文修改、WPS 保存后的原生 Tags / 替代文字 / PNG 三层源码保留。
- 新建默认 SVG；Shape 更新默认 SVG，旧 PNG 更新默认 PNG。SVG 是矢量图形；PNG 为 300 DPI 透明图片。两者均不是 WPS 原生数学公式。
- WPS 若未返回 SVG 图形类型，会取消替换并保留原公式；可手动选择 PNG。不会静默降为位图。
- `.ppt`、Word 公式、MathType/OLE、普通截图、带签名或宏的文件不在独立编辑器支持范围内。
- 不自动保存或覆盖文稿；请按正常 WPS 操作保存。
- macOS 上游 IguanaTeX 已实测读取本插件生成公式的源码、引擎和字号；ReGenerate 后返回 Bridge / WPS 再编辑、最新三个功能区入口及 Office Shape 组合更新仍待实机验证。Windows 往返也尚未验收。可用 `examples/wps_roundtrip_test.pptx` 做测试。

```bash
.venv/bin/python -m unittest -v
node test_wps_adapter.js
node test_wps_editor.js
node test_office_adapter.js
node test_office_taskpane.js
node test_ocr_ui.js
```

实现依据：[WPS 加载项开发说明](https://open.wps.cn/documents/app-integration-dev/wps365/client/wpsoffice/wps-integration-mode/wps-addin-development/wps-addin-development-instructions)、[WPS AddPicture](https://open.wps.cn/documents/app-integration-dev/wps365/client/wpsoffice/jsapi/wpp/Shapes/member/AddPicture)、[WPS Tags.Add](https://open.wps.cn/documents/app-integration-dev/wps365/client/wpsoffice/jsapi/wpp/Tags/member/Add)、[IguanaTex 标签读写源码](https://github.com/Jonathan-LeRoux/IguanaTex/blob/master/LatexForm.frm)。

本项目为独立 MIT 许可工具，不是 WPS 或上游 IguanaTex 官方发行版。
