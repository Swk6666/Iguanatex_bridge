# macOS / Windows PowerPoint 安装

0.4.0 新增自己的 Office.js 加载项，与 Ubuntu WPS 共用本地渲染器和 AI 对话，不依赖上游 IguanaTeX。面板使用 OpenAI API，详见 [OpenAI API 对话](API_CHAT.md)。日常截图识别也可直接使用[独立桌面 GUI](DESKTOP.md)。此加载项面向 **桌面 PowerPoint**，不包含 Word / Excel。清单允许 PowerPointApi 1.1 宿主加载页面，实际插入与更新在运行时检查 PowerPointApi 1.5；版本不足时提示更新或使用独立编辑器。

## 准备环境

- Python 3.10 或以上。
- macOS：MacTeX（推荐完整安装，包含中文宏包）；Windows：TeX Live 或 MiKTeX，安装 `amsmath`、`amssymb`、`bm`，需要中文时安装 `ctex`、Fandol 字体并选 XeLaTeX。
- AI 对话需要 OpenAI API Key（本机设置、环境变量或仓库共享密钥）；无需 Chrome 或网页登录。
- Office 加载项需要访问微软的 Office.js CDN；图片识别需要访问 OpenAI API。

公式仍在本机编译。Office 加载项通过本地 HTTPS 连接服务。独立编辑器与 WPS 使用 HTTP 17863；Office 使用 HTTPS 17864，两个监听器只绑定 `127.0.0.1`，共享任务与登录浏览器。

## macOS 首次安装

在项目目录运行：

```bash
python3 -m venv .venv
.venv/bin/python -m pip install -r requirements-office.txt
.venv/bin/python setup_office.py --trust-cert --install-manifest
bash start_office_mac.sh
```

第三条命令生成仅供 localhost 使用的证书，将它加入**当前用户**的登录钥匙串，并复制清单到 PowerPoint 的 `wef` 目录。系统可能要求本机密码确认，请自行完成。证书和私钥保存在 `~/Library/Application Support/IguanaTexBridge/office/`，不进入 Git 或安装包。

若 macOS 拒绝脚本写入 PowerPoint 沙盒目录，安装器会显示 Finder 操作路径：在 Finder 按 Cmd+Shift+G，进入上面的 `office` 状态目录，只复制 `IguanaTexBridge.xml`；再前往 `~/Library/Containers/com.microsoft.Powerpoint/Data/Documents/`，创建 `wef` 文件夹并把清单粘贴到里面。不要复制私钥。无需给终端授予“完全磁盘访问”。

保持启动终端运行，在 PowerPoint 中打开测试 PPTX，从“开始 / 插入 → 加载项 → 开发人员加载项”选择 **IguanaTex Bridge**。加载后，顶部出现独立的 **IguanaTex Bridge** 标签，包含 LaTeX 公式、转换管理和跨平台三组入口；其他插件或自定义功能区可能影响排列顺序。首次侧载流程参考[微软 Mac 加载项文档](https://learn.microsoft.com/en-us/office/dev/add-ins/testing/sideload-an-office-add-in-on-mac)。

从旧版升级时，重新运行 `setup_office.py --install-manifest`（或通过 Finder 替换 `wef/IguanaTexBridge.xml`）。保存现有工作后完全退出并重启 PowerPoint，再从“开发人员加载项”选择一次本项目，刷新功能区清单。仅重新打开右侧面板可能仍使用旧清单。

后续使用只需运行 `bash start_office_mac.sh`，然后在 PowerPoint 打开加载项。当前 Office 启动脚本以前台服务运行，尚未注册登录自动启动。已有 Ubuntu WPS 后台启动方式保持不变。

如果本机另行配置了 IguanaTex Bridge 的 macOS 登录启动服务，则本地服务会随用户登录自动启动，无需再运行前台脚本。

## Windows 首次安装

在项目目录的命令提示符中运行：

```bat
py -3 -m venv .venv
.venv\Scripts\python.exe -m pip install -r requirements-office.txt
.venv\Scripts\python.exe setup_office.py --trust-cert
start_office_windows.bat
```

证书安装到当前用户的证书库，状态目录为 `%LOCALAPPDATA%\IguanaTexBridge\office`。使用 Windows 桌面的共享文件夹侧载方式：

1. 新建一个只存放加载项清单的目录，例如 `%USERPROFILE%\IguanaTexAddins`。把命令输出的 `IguanaTexBridge.xml` **复制**到其中。
2. 在文件夹属性中共享这个目录，记录 UNC 路径，例如 `\\本机名\IguanaTexAddins`。只给使用加载项的账号读取权限；不要共享项目、证书私钥或浏览器状态目录。
3. PowerPoint → 文件 → 选项 → 信任中心 → 信任中心设置 → 受信任的加载项目录，添加上面的 UNC 路径并勾选“在菜单中显示”。
4. 保存工作并重启 PowerPoint，打开测试文稿，在“插入 / 主页 → 加载项 → 我的加载项 → 共享文件夹”选择 **IguanaTex Bridge**。加载后通过顶部 **IguanaTex Bridge → 新建公式** 打开编辑面板。

网络共享目录用于开发侧载和测试；升级清单新增功能区标签或按钮后，需要移除本加载项并从共享目录重新添加，详见[微软网络共享侧载说明](https://learn.microsoft.com/en-us/office/dev/add-ins/testing/create-a-network-shared-folder-catalog-for-task-pane-and-content-add-ins)。

不同 Office 版本的入口文字可能不同；该流程依据[微软 Windows 共享目录侧载说明](https://learn.microsoft.com/en-us/office/dev/add-ins/testing/create-a-network-shared-folder-catalog-for-task-pane-and-content-add-ins)。组织策略禁用侧载时，需要管理员部署清单。

后续双击 `start_office_windows.bat` 并保持终端运行。没有安装 Chrome 时，可以运行 `start_office_windows.bat --ocr-browser msedge` 使用 Edge。

## 使用

1. 新建或打开一页幻灯片，点击顶部 **IguanaTex Bridge → 新建公式**。支持 Office Dialog API 1.2 时会打开与 WPS 版相似的完整编辑窗口；如果版本不支持，可在右侧面板继续编辑。侧栏中的“打开完整编辑器”可以再次打开窗口。
2. 输入 TeX，或按照 [OpenAI API 对话](API_CHAT.md)配置密钥，输入文字并附图；收到回答后点击“采用 LaTeX”。
3. 选择引擎、SVG / PNG、字号及行宽，也可通过“插入示例”添加常见公式；点击“预览”或按 Ctrl / ⌘ + Enter。预览区显示写入幻灯片的尺寸。
4. 核对后点击“插入当前幻灯片”，再保存 PPTX。
5. 以后选中 IguanaTeX / Bridge 公式，点击功能区或面板中的“编辑选中公式”，核对已读取源码后修改，点击“更新已读取的公式”。更新默认按当前字号重设尺寸；保留高度和固定原宽高可在“更多 → 更新尺寸”中选择。面板中的“新建公式”可清除编辑目标并开始另一条公式。
6. 在同一页中选中一张或多张未组合的图片，点击“图片转公式”，确认数量后点击“开始转换”。图片按顺序识别并编译，转换时可切换幻灯片。请保持演示文稿及批量转换窗格打开；关闭窗格或 PowerPoint 会中断后续处理。也可在“新建公式”中打开 AI 助手，选择、拖入或粘贴截图。
7. “转换设置”调整图片转换的字号、颜色、对齐方式及替换前逐张校对；“转换状态”和“取消转换”查看或停止批量任务。编译失败时最多自动纠错两次；仍失败则保留原图及源码草稿，可选中原图后使用“编辑失败草稿”。“检查与同步源码”同步当前演示文稿中公式的原生标签及备份。转换后保存 PPTX。

直接读取选中图片及后台转换需要 PowerPointApi 1.10；低版本可在 AI 助手中选择或粘贴截图。图片识别会将输入发送到所配置的 OpenAI API，并按 API 用量计费。AI 可能误识公式，建议启用逐张校对或在转换后检查。

写入包含 IguanaTex 原生 Tags 和压缩备份标签，图像数据也保留源码。支持 PowerPointApi 1.10 的版本同时写入替代文字备份；较低版本使用额外的 `IGUANABRIDGEMETA` 标签。PPTX 内的公式可通过 LaTeX 再编辑，不是 Office 原生数学对象。

**兼容边界：** 更新支持位置、保留宽高、保留高度、按字号缩放。PowerPointApi 1.8 或下面的 Windows 原生兼容接口可读取单条 IguanaTeX Shape 组合及选中的内部字形，将整条公式更新为带源码的 SVG / PNG，并保留层叠顺序。后台批量转换的 SVG 使用带图片填充的形状，以便在其他页面工作时写入原页面，含原生标签及源码备份，可在 Bridge 中再编辑。输出不保留原生逐字 Shape 结构；混合排版或多公式组合会拒绝整体替换。旋转、翻转、动画、特效和动作不保留，需要重新设置。读取和写入均检查对象及页面是否变化；新图片源码验证通过后才删除原公式。发生通信中断时可能留下新旧两个对象，请先检查幻灯片再重试。

**Windows Office 2024 LTSC 的 Shape 兼容编辑：** 该版本不提供 PowerPointApi 1.8，Bridge 会自动使用 Windows 原生 PowerPoint 对象模型（COM）读取和更新选中的公式。直接点击 **IguanaTex Bridge → 编辑选中公式** 即可，无需先执行 Convert to Picture。安装 `requirements-office.txt` 会自动安装 Windows 专用的 `pywin32`；已有安装更新后需重启 Bridge 本地服务。不会启用 VBA 宏、修改安全设置、另开 PowerPoint 实例或自动保存文稿。

此兼容接口要求文稿已保存到本地（当前未保存的编辑仍可读取），并且编辑期间保留原文稿窗口和原幻灯片。组合内的任意字形或图像发生变化时拒绝覆盖；关闭并重新打开文稿、另存为、重启服务或编辑会话超过 30 分钟后，需要重新读取公式。写回默认使用矢量 SVG，原生 IguanaTeX 标签与源码备份一并保留；公式不再是可逐字编辑的 Shape 组合。全稿“检查与同步源码”和后台图片识别仍受各自 Office.js 版本限制，此兼容接口仅用于单个 Shape 公式编辑。

其他平台的 Shape 组合编辑仍需要 PowerPointApi 1.8，或先用原 IguanaTeX 转为 Picture。Microsoft 365 的 Windows PowerPoint 从版本 2504、内部版本 18730.20030 起支持 1.8，具体以微软的 [PowerPoint API 要求集](https://learn.microsoft.com/en-us/javascript/api/requirement-sets/powerpoint/powerpoint-api-requirement-sets)为准。

## 端口、浏览器与排错

自定义端口必须同时更新清单并启动对应服务：

```bash
.venv/bin/python setup_office.py --port 17964 --install-manifest --serve --http-port 17963
```

Windows 将生成的新清单重新复制到共享目录。浏览器配置示例：

```bash
.venv/bin/python -m playwright install chromium
.venv/bin/python setup_office.py --serve --ocr-browser chromium --ocr-selectors deepseek_selectors.example.json
```

- 加载项空白：先确认服务终端运行，浏览器打开 `https://localhost:17864/office/taskpane.html`；浏览器中会提示“请在 PowerPoint 中打开”，这只证明本地页面已可达。
- HTTPS 报错：重新运行显式的 `--trust-cert` 安装步骤，检查证书日期和系统时间；不需要关闭浏览器证书校验。
- 端口被占用：关闭旧服务，或更换 HTTP / HTTPS 端口；不要同时启动两份使用同一个状态目录的服务。
- LaTeX 不存在：点击“环境检查”。macOS 自动查找 `/Library/TeX/texbin`；Windows 将 TeX 的可执行文件目录加入 PATH，再重启服务。
- SVG 插入失败：选 PNG；加载项会先检测 ImageCoercion 1.2 支持情况。
- OpenAI API 调用失败：在面板检查密钥、模型与额度，见 [API 对话](API_CHAT.md)。

## 卸载与证书更新

退出服务，macOS 删除 `~/Library/Containers/com.microsoft.Powerpoint/Data/Documents/wef/IguanaTexBridge.xml`；Windows 从加载项列表移除插件，并在信任中心删除本项目的目录条目。其他加载项不受影响。

本地证书有效期一年。更新时，先在钥匙串 / 当前用户证书管理器中确认并移除旧的 **IguanaTex Bridge localhost** 证书，备份后移走状态目录的 `office` 子目录，再运行首次安装命令重新生成与信任证书。删除整个状态目录会同时清除本机 OpenAI API 密钥与独立浏览器登录；不影响日常 Chrome 配置。

## 验证状态

已在 macOS PowerPoint 16.113.3（LTSC Standard for Mac 2024）完成侧载、SVG 插入、改为多行积分矩阵公式、修改字号至 28 pt、更新、保存重开和读取源码；本地解析确认源码标签及备份一致。清单 1.0.0.1 的单按钮功能区已实测可打开编辑面板，DeepSeek 真实自动上传与回填也已通过。上游 IguanaTeX 已能读取本插件的源码、引擎和字号。

macOS PowerPoint 16.114.2 已实测新版三组九按钮功能区、完整编辑窗口、行宽 0.6 的预览、SVG 插入、重新读取源码及更新公式；并在临时文稿中验证读取所选图片、加载到 AI 助手、手动预览替换、失败草稿恢复，以及公式源码同步。本次未发送图片进行在线识别。

同一版本已用本地模拟 AI 在临时文稿中验证三图批量转换、切换幻灯片后的后台写入、取消并保留未处理图片、逐张校对与跳过、两次自动纠错和失败草稿恢复。保存的 PPTX 包含 SVG 与源码标签；Bridge 和原 IguanaTeX 编辑窗口均能读取测试公式源码。模拟测试没有向 OpenAI 发送图片。

另用真实 OpenAI API 识别了三张合成公式图片：上标、根号分式和定积分均成功转换，切换到另一页后仍能写回原页；检查了保存后的 SVG、源码标签和编辑器读取。公式内容与样例一致，生成结果按照 18 pt 设置重新排版，积分的上下限位置和微分字体与原图有差别。此次尚未在 Ubuntu WPS 上对相同图片进行实机比较。

Windows 和本次新增 Ubuntu OCR 仍需对应设备验证，完整记录见 [VALIDATION.md](../VALIDATION.md)。
