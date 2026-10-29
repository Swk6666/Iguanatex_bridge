# DeepSeek API 对话

0.5.0 起，WPS、PowerPoint 加载项和浏览器 PPTX 编辑器内的“AI 对话”默认调用 DeepSeek 官方 API。支持纯文字、单张图片或文字＋图片，同一对话可以继续追问，完整回答显示在面板中。

## 安装与首次设置

新电脑克隆本私有仓库后，在项目目录执行：

```bash
bash install.sh
```

已有安装更新：

```bash
git pull --ff-only
bash install.sh
```

关闭旧公式编辑窗口，再从 WPS 的 IguanaTex 工具栏打开。点击右上角 **AI 助手 → API 设置**，填写 [DeepSeek 开放平台](https://platform.deepseek.com/api_keys) 的 API Key 并保存。模型默认 **deepseek-flash**，接口固定为 `https://api.deepseek.com/chat/completions`。不需要浏览器登录、Playwright、OpenAI SDK 或额外 Python 依赖。OpenAI 的 API Key 不能用于 DeepSeek 接口。

保存后密钥输入框清空，只显示是否已经配置。之后留空保存设置会保留原密钥；“删除本机密钥”只删除本机文件中的密钥。也可以在启动服务的环境中设置 `DEEPSEEK_API_KEY`，本机设置优先；如果删除本机密钥后仍显示已配置，检查是否设置了此环境变量。Ubuntu systemd 用户服务不会自动继承终端里新执行的 `export`，推荐直接使用插件设置。

## 使用

1. 输入文字，或选择、拖入、粘贴一张 PNG / JPEG / WebP 图片。每张不超过 10 MB / 2000 万像素；建议裁剪到需要识别的部分。
2. 点击 **发送**（文字框内也可按 Ctrl / Command + Enter）。只有点击发送才会调用 API；选择图片或保存设置不会上传。
3. 回答逐步显示，保留说明文字和代码。可以复制完整回答；有 LaTeX 代码块时，每个代码块提供 **采用 LaTeX** 按钮。采用完整文档会替换源码；采用公式片段时会合入现有文档并保留宏包。最后由你预览、写入幻灯片。
4. 在同一面板继续输入可追问；会重新发送当前对话中已成功完成的文字、图片和回答作为上下文。不会自动发送编辑区源码或 PPTX；需要分析代码时请粘贴到消息中。
5. **新对话**从空上下文开始。关闭并重新打开窗口会恢复此服务中最近使用的对话；**刷新对话**可恢复网络短暂中断或其他窗口更新后的状态。

AI 以侧栏打开，回答区独立滚动，输入区固定在下方；点击右上角 × 或按 Esc 收起，草稿和附件仍保留。小窗口使用抽屉，收起后可查看被遮住的源码与预览。插入／更新按钮始终在底部；WPS 字号记忆及成功写入后自动关闭保持不变。

## 数据、范围与故障

密钥保存在用户状态目录的 `deepseek-api.json`：

| 系统 | 路径 |
| --- | --- |
| Ubuntu / Linux | `~/.local/state/iguanatex-bridge/deepseek-api.json`（设置 `XDG_STATE_HOME` 时遵循该变量） |
| macOS | `~/Library/Application Support/IguanaTexBridge/deepseek-api.json` |
| Windows | `%LOCALAPPDATA%\IguanaTexBridge\deepseek-api.json` |

文件是本机配置；Linux / macOS 权限为仅当前用户读写（0600）。密钥不返回给页面、不写入 localStorage、PPTX、日志或 Git，也不进入发布 ZIP。重装新电脑后在当地重新配置。

对话和经过重编码的图片只在本地服务内存中保留，最多 5 个会话、每会话 20 轮、图片合计 30 MB；单条消息最多 8,000 字符。服务重启会清空本地对话，网页存储只记录会话 ID。上传的图片会去除 EXIF 等元数据。DeepSeek 端的数据处理以其服务政策为准，API 产生的费用由你的 DeepSeek 账号承担。

默认关闭深度思考，每次回答输出上限 8,192 tokens，最多等待 180 秒，单次网络读取超时 30 秒。停止等待不会撤回已经发送的请求，也不保证取消已经产生的用量；停止响应最多可能需要等待网络读取超时。失败、取消、输出截断时保留部分回答和输入草稿，不提供“采用 LaTeX”以免误用不完整代码；可以复制检查后重试。程序不会自动重试收费请求。

- **401 / 密钥无效**：重新填写 DeepSeek Key；不是 ChatGPT / OpenAI Key。
- **402 / 余额不足**：在 DeepSeek 开放平台检查余额。
- **429 / 请求受限**：稍后手动重试。
- **模型或图片参数错误**：恢复默认 `deepseek-flash`，检查图片格式和大小。
- **其他窗口已更新**：点击“刷新对话”，再继续发送。
- **服务重启后对话过期**：开始新对话；LaTeX 源码仍保存在你写入并保存的 PPTX 中。

接口协议和 UI 已用模拟服务测试；0.5.1 已完成真实 DeepSeek 文字请求、完整 LaTeX 回传、采用及本机 XeLaTeX 编译。真实图片调用仍待验证。生成公式文档时要求加入 `\pagestyle{empty}`，避免页码把公式裁边撑成整页。独立 Qt 桌面 GUI 仍沿用[网页识别模式](DEEPSEEK.md)，不使用此 API 面板。

接口依据（2026-10-29 核对）：[DeepSeek 图片输入](https://api-docs.deepseek.com/guides/vision/) · [Chat Completions](https://api-docs.deepseek.com/api/create-chat-completion/)。
