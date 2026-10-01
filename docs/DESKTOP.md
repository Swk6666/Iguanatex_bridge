# 独立桌面公式编辑器

桌面版沿用 Ubuntu WPS 编辑器的绿色标题栏、编译引擎 / 输出 / 字号、源码框、四个公式示例与下方预览。源码框上方新增可收起的截图入口。程序由本项目独立实现，不需要安装上游 IguanaTeX，也不依赖 Codex。

## 启动

需要 Python 3.10 或更高版本、Google Chrome，以及本机 LaTeX：MacTeX、Windows MiKTeX / TeX Live，或 Ubuntu TeX Live。识别和编辑源码本身不需要 LaTeX；预览和输出图片需要。

- macOS：双击项目中的 `start_desktop_mac.command`，或在项目目录运行 `bash start_desktop.sh`。
- Windows：双击 `start_desktop_windows.bat`。
- Ubuntu：在项目目录运行 `bash start_desktop.sh`。Qt 桌面窗口需要可用的图形会话；系统若缺少 Qt 的 xcb 库，按错误提示安装对应发行版依赖。

首次启动会在项目 `.venv` 中安装 `requirements-desktop.txt`；之后直接启动 GUI。若更新了依赖，手动运行 `.venv/bin/python -m pip install -r requirements-desktop.txt`（Windows 使用 `.venv\Scripts\python.exe`）。当前交付是源码版启动入口，不是已经签名、公证的安装包；项目目录和 `.venv` 需要保留。

## 截图转 TeX

1. 在截图入口拖入 PNG / JPEG / WebP、点击“选择图片”，或用 Cmd+V / Ctrl+V 粘贴剪贴板中的图片。macOS 可先用 Ctrl+Shift+Cmd+4 截取区域到剪贴板；Windows 可用 Win+Shift+S。
2. 默认勾选“放入截图后自动识别”，放入的这一张图片会发送到 DeepSeek 网页。取消勾选后，点击“识别 / 重试”才发送。程序不会监听并上传你日常复制的其他图片。
3. 首次使用，在程序打开的专用 Chrome 窗口登录 DeepSeek。登录状态保存在本机，之后复用。它与日常 Chrome 窗口的账号配置分开；不会复制日常浏览器 Cookie 或密码。无需 DeepSeek API key。
4. 识别完成后 TeX 自动回填，自动进行本机预览。识别等待期间若编辑区有新修改，结果显示为待采用内容，不覆盖你的修改。
5. 修改字号、引擎或源码后，使用原有“预览”按钮或 Ctrl+Enter / Cmd+Enter 重新编译。无法识别、登录过期或浏览器关闭时，按界面提示重试。

截图仅处理用户主动放入的单张图片；不含内置区域截图工具。取消会停止本地等待，已上传的图片不会从 DeepSeek 撤回。更多网页配置见 [DeepSeek 说明](DEEPSEEK.md)。

## 放入幻灯片与再次编辑

- **复制图片**：复制透明 PNG，然后在 PowerPoint / WPS 中粘贴。剪贴板粘贴是否保留图片内的源码取决于宿主，因此不能把它当作可靠的源码保存方式。
- **导出 SVG / PNG**：顶部输出格式决定默认导出类型；保存对话框中仍可切换。两种文件均内嵌 TeX，SVG 使用字形轮廓。需要矢量质量时导出 SVG 再插入演示文稿。
- **导出含源码 PPTX**：生成一个独立的单公式 PPTX，图形为 PNG，保存编译引擎、字号和公式源码。用 PowerPoint / WPS 打开即可；不修改当前打开的正式演示文稿。
- **保存 TeX**：文件菜单 → 保存 TeX，或 Cmd+S / Ctrl+S。
- **重新编辑**：文件菜单 → 打开源码 / 公式，支持 `.tex`、本程序导出的 `.svg` / `.png`，以及恰好含一条可识别公式的 `.pptx`。

桌面主窗口保留相同的编辑布局；由于它没有当前幻灯片的宿主上下文，底部使用“复制图片 / 导出公式”。要在当前幻灯片中原位读取、替换选中公式，使用本项目的 [PowerPoint 加载项](INSTALL_OFFICE.md) 或 [Ubuntu WPS 加载项](INSTALL_UBUNTU.md)，其中仍是“插入当前幻灯片 / 更新此公式”。这些加载项也不需要上游 IguanaTeX。

## 本机状态

当前 TeX 草稿与选项自动保存在 `desktop-draft.json`；截图不会保存到草稿。它与 DeepSeek 登录资料均位于项目外的用户状态目录：

- macOS：`~/Library/Application Support/IguanaTexBridge/`
- Windows：`%LOCALAPPDATA%\IguanaTexBridge\`
- Ubuntu：`~/.local/state/iguanatex-bridge/`（尊重 `XDG_STATE_HOME`）

桌面程序复用已经运行的本地服务，避免 Chrome 配置目录被两个进程占用；没有服务时自动启动仅监听本机的服务。若 Office 的本地证书已经准备好，也会启动对应 HTTPS 入口；桌面 GUI 不会修改证书信任。由桌面程序启动的服务随桌面退出而关闭，复用的已有服务保持运行。
