# macOS / Windows PowerPoint 安装

0.4.0 新增自己的 Office.js 加载项，与 Ubuntu WPS 共用本地渲染器和 DeepSeek 对话，不依赖上游 IguanaTeX。0.5.0 起面板默认使用 API，详见 [DeepSeek API 对话](API_CHAT.md)。日常截图识别也可直接使用[独立桌面 GUI](DESKTOP.md)。此加载项面向 **桌面 PowerPoint**，不包含 Word / Excel。清单允许 PowerPointApi 1.1 宿主加载页面，实际插入与更新在运行时检查 PowerPointApi 1.5；版本不足时提示更新或使用独立编辑器。

## 准备环境

- Python 3.10 或以上。
- macOS：MacTeX（推荐完整安装，包含中文宏包）；Windows：TeX Live 或 MiKTeX，安装 `amsmath`、`amssymb`、`bm`，需要中文时安装 `ctex`、Fandol 字体并选 XeLaTeX。
- AI 对话需要 DeepSeek API Key；无需 Chrome 或网页登录。
- Office 加载项需要访问微软的 Office.js CDN；图片识别需要访问 DeepSeek。

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

保持启动终端运行，在 PowerPoint 中打开测试 PPTX，从“开始 / 插入 → 加载项 → 开发人员加载项”选择 **IguanaTex Bridge**。加载后，顶部出现独立的 **IguanaTex Bridge** 标签，提供 **新建公式 / 编辑选中公式 / 截图识别** 入口。此前单按钮清单已在本机显示于原 IguanaTeX 右侧；其他插件或自定义功能区可能影响排列顺序。首次侧载流程参考[微软 Mac 加载项文档](https://learn.microsoft.com/en-us/office/dev/add-ins/testing/sideload-an-office-add-in-on-mac)。

从旧版升级时，重新运行 `setup_office.py --install-manifest`（或通过 Finder 替换 `wef/IguanaTexBridge.xml`）。保存现有工作后完全退出并重启 PowerPoint，再从“开发人员加载项”选择一次本项目，刷新功能区清单。仅重新打开右侧面板可能仍使用旧清单。

后续使用只需运行 `bash start_office_mac.sh`，然后在 PowerPoint 打开加载项。当前 Office 启动脚本以前台服务运行，尚未注册登录自动启动。已有 Ubuntu WPS 后台启动方式保持不变。

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

1. 新建或打开一页幻灯片，点击顶部 **IguanaTex Bridge → 新建公式**。
2. 输入 TeX，或按照 [DeepSeek API 对话](API_CHAT.md)配置密钥，输入文字并附图；收到回答后点击“采用 LaTeX”。
3. 选择引擎、SVG / PNG、字号，点击“预览”。
4. 核对后点击“插入当前幻灯片”，再保存 PPTX。
5. 以后选中 IguanaTeX / Bridge 公式，点击功能区或面板中的“编辑选中公式”，核对已读取源码后修改，点击“更新已读取的公式”。更新默认按当前字号重设尺寸；保留高度和固定原宽高可在“更多 → 更新尺寸”中选择。面板中的“新建公式”可清除编辑目标并开始另一条公式。
6. 截图识别可从功能区“截图识别”进入，也可点击右上角“AI 助手”，再选择、拖入或粘贴图片。

写入包含 IguanaTex 原生 Tags 和压缩备份标签，图像数据也保留源码。Office.js 1.5 无法写替代文字，故采用额外的 `IGUANABRIDGEMETA` 标签；到 WPS 后可“同步源码”，或用独立 PPTX 编辑器建立替代文字备份。PPTX 内的公式可通过 LaTeX 再编辑，不是 Office 原生数学对象。

**兼容边界：** 更新支持位置、保留宽高、保留高度、按字号缩放；PowerPointApi 1.8 额外保留层叠顺序，并可读取单条 IguanaTeX Shape 组合及选中的内部字形，将整条公式更新为带源码的 SVG / PNG。输出不保留原生逐字 Shape 结构；混合排版或多公式组合会拒绝整体替换，低版本 Office 可先用原 IguanaTeX 转 Picture。旋转、翻转、动画、特效和动作不保留，需要重新设置。读取和写入均检查对象及页面是否变化；新图片源码验证通过后才删除原公式。发生通信中断时可能留下新旧两个对象，请先检查幻灯片再重试。

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
- 端口被占用：关闭旧服务，或更换 HTTP / HTTPS 端口；不要同时启动两份使用同一个 DeepSeek 状态目录的服务。
- LaTeX 不存在：点击“环境检查”。macOS 自动查找 `/Library/TeX/texbin`；Windows 将 TeX 的可执行文件目录加入 PATH，再重启服务。
- SVG 插入失败：选 PNG；加载项会先检测 ImageCoercion 1.2 支持情况。
- DeepSeek API 调用失败：在面板检查密钥、模型与余额，见 [API 对话](API_CHAT.md)。

## 卸载与证书更新

退出服务，macOS 删除 `~/Library/Containers/com.microsoft.Powerpoint/Data/Documents/wef/IguanaTexBridge.xml`；Windows 从加载项列表移除插件，并在信任中心删除本项目的目录条目。其他加载项不受影响。

本地证书有效期一年。更新时，先在钥匙串 / 当前用户证书管理器中确认并移除旧的 **IguanaTex Bridge localhost** 证书，备份后移走状态目录的 `office` 子目录，再运行首次安装命令重新生成与信任证书。删除整个状态目录会同时清除 DeepSeek API 密钥与独立浏览器登录；不影响日常 Chrome 配置。

## 验证状态

已在 macOS PowerPoint 16.113.3（LTSC Standard for Mac 2024）完成侧载、SVG 插入、改为多行积分矩阵公式、修改字号至 28 pt、更新、保存重开和读取源码；本地解析确认源码标签及备份一致。清单 1.0.0.1 的单按钮功能区已实测可打开编辑面板，DeepSeek 真实自动上传与回填也已通过。上游 IguanaTeX 已能读取本插件的源码、引擎和字号。

清单 1.0.0.2 的三个入口及连续切换、Office Shape 组合更新和上游 ReGenerate 后返回 Bridge 再编辑，目前通过相关自动化检查，尚未完成实机验收。Windows 和本次新增 Ubuntu OCR 也仍需对应设备验证，完整记录见 [VALIDATION.md](../VALIDATION.md)。
