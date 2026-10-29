# 旧版网页识别（独立 Qt 桌面 GUI）

从 0.5.0 起，WPS、PowerPoint 加载项与浏览器编辑器默认使用 [DeepSeek API 对话](API_CHAT.md)，不需要网页登录。本文保留独立 Qt 桌面 GUI 与旧接口的网页识别操作。

0.4.0 曾在独立桌面 GUI、WPS、PowerPoint 和浏览器版 PPTX 编辑器中提供网页图片识别。推荐使用[桌面 GUI](DESKTOP.md)，截图放入后自动识别和预览；加载项与浏览器编辑器点击识别按钮发送。接入的是 `https://chat.deepseek.com/` 的可见网页，使用 Playwright 驱动专用 Chrome 窗口，不需要 API Key。它不是 DeepSeek 官方提供的稳定集成接口；网页改版、账号能力和登录验证可能影响自动操作。

## 安装与使用

Ubuntu 新安装可运行：

```bash
bash install.sh --with-ocr
```

已有安装仅补齐可选依赖：

```bash
.venv/bin/python -m pip install -r requirements-ocr.txt
```

macOS / Windows 的 Office 启动脚本已安装识别依赖。默认使用 Google Chrome，请先安装 Chrome。也可安装项目专用 Chromium，然后启动服务时指定浏览器：

```bash
.venv/bin/python -m playwright install chromium
.venv/bin/python app.py --port 17863 --ocr-browser chromium
```

此方式需要先停止占用 17863 的旧服务。Ubuntu 后台服务若要长期使用 Chromium，可执行 `systemctl --user edit iguanatex-bridge.service`，清空原 `ExecStart` 后填入项目 Python、`app.py --no-browser --port 17863 --ocr-browser chromium` 的绝对路径，再重启用户服务。默认 Chrome 不需要这一步。

Ubuntu 后台服务会在打开浏览器时从 systemd 用户会话刷新 DISPLAY / Wayland 等图形连接变量。若提示没有图形会话，请在桌面终端执行 `systemctl --user import-environment DISPLAY WAYLAND_DISPLAY XAUTHORITY` 后重试；无桌面的 SSH 会话无法显示登录窗口。

1. 点击“打开 / 登录 DeepSeek”，在新浏览器中自行登录。密码、验证码或网页验证由你操作。
2. 选择、拖入或粘贴**包含公式的图片**，支持 PNG / JPEG / WebP，限制 10 MB / 2000 万像素。最好裁剪到公式区域。
3. 点击“发送到 DeepSeek 识别”。程序开始新对话、上传图片、确认附件出现且不在解析中、发送公式转写请求，等待完整答案。
4. TeX 自动填入编辑区。核对上下标、矩阵、分段及多行公式，预览后写入文稿。若识别期间修改了编辑区，程序保留新修改，把结果放在单独区域供采用。

等待登录和等待识别分别最多 180 秒；附件就绪最多 60 秒。可以取消本地等待；取消不能撤回已经上传到 DeepSeek 的图片或删除云端对话。程序不自动处理验证码或绕过登录限制。

## 数据与登录状态

- 只上传主动选择的图片，重新编码去掉 EXIF 等元数据，不上传 PPTX、其他文档或整个截图目录。
- 图片与识别任务结果保留在当前服务内存和 DeepSeek 网页会话中，最多保留 20 条本地任务记录；不会写到服务日志。桌面 GUI 会另行保存已经填入编辑区的 TeX 草稿，截图不进入草稿；用户导出的公式文件也会携带源码。浏览器缓存及 DeepSeek 云端会话遵循它们各自的行为。
- 专用浏览器状态存放于：macOS `~/Library/Application Support/IguanaTexBridge/deepseek-profile`；Windows `%LOCALAPPDATA%\IguanaTexBridge\deepseek-profile`；Linux `$XDG_STATE_HOME/iguanatex-bridge/deepseek-profile`（默认 `~/.local/state/iguanatex-bridge/deepseek-profile`）。
- 状态目录含登录会话，不共享、不打包，也不复用日常 Chrome 配置。需要退出登录可在该浏览器内退出；完全清理前先关闭服务和浏览器，再移走专用 profile。

## 网页改版与选择器

默认选择器集中在 `ocr.py`，可把 `deepseek_selectors.example.json` 复制到自己的配置文件后覆盖。允许的字段：

| 字段 | 用途 |
| --- | --- |
| `composer` | 可编辑消息输入区，默认 `textarea` |
| `file_input` | 网页实际的文件上传 input |
| `upload_busy` | 上传 / 解析期间可见的进度元素 |
| `upload_error` | 上传失败提示 |
| `response` | 助手答案区域，默认 `.ds-markdown` |
| `send_button` | 发送按钮；留空时在输入区按 Enter |
| `stop_button` | 生成期间的“停止生成”按钮 |

启动参数：`app.py --ocr-selectors /你的路径/selectors.json`；Office 启动器也透传同名参数。服务启动时读取配置，修改后重启。只支持修改选择器，不支持把上传网址改成任意站点。

程序要求答案具有每次请求唯一的开始 / 结束标记，并要求标记与源码放在同一个 LaTeX 代码块内，避免网页渲染吞掉反斜杠和换行。取得完整且稳定的结果后才回填。附件同时检查图片 alt 名称与文本名称，忽略已经透明的加载动画。如果标记未返回，可在网页复制 TeX 手动粘贴回编辑区。

**已知限制：** 默认选择器已经过 2026-10-02 本机 Chrome 登录后真实页面验证，积分与矩阵截图的自动上传、识别、回填和预览通过。它不保证所有账号或未来网页都兼容；账号没有图片入口或页面变化时会报错并保留编辑区。不能把官方“文件上传与文字提取”的说明理解为数学公式识别精度保证。参考 [DeepSeek 官方产品说明](https://www.deepseek.com/news/deepseek-app/) 与 [Playwright 持久浏览器说明](https://playwright.dev/python/docs/api/class-browsertype#browser-type-launch-persistent-context)。

实机验收建议依次测试一张 `E=mc^2` 截图、一张分式及上下标截图、一张矩阵和一张中文标注截图。核对源码、预览、写入和保存后重开；同时测试未登录、关闭浏览器、上传失败、取消和识别期间修改源码。
