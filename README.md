# IguanaTex Bridge · 个人项目

在 WPS 工具栏中打开公式编辑器，编写完整 LaTeX 文档、预览并插入或更新公式。内置 OpenAI API 对话，支持文字、截图和连续追问，显示完整回答并按需采用 LaTeX。另有独立桌面 GUI 和 macOS / Windows PowerPoint 加载项，支持 SVG / PNG、字号与源码保存，以及与原 IguanaTeX 的源码兼容。

当前版本 **0.6.1**。个人私有仓库：[Swk6666/Iguanatex_bridge](https://github.com/Swk6666/Iguanatex_bridge)。访问仓库及版本附件需要有权限的 GitHub 账号。

[下载最新安装包](https://github.com/Swk6666/Iguanatex_bridge/releases/latest) · [Ubuntu 完整安装流程](docs/INSTALL_UBUNTU.md)

0.4.1 默认显示并编辑完整 LaTeX 文档，宏包与自定义命令都在编辑区中；预览编译和保存的源码保持一致。详见 [完整文档编辑](README_中文.md#完整-latex-文档编辑)。

0.4.2 修复公式更新时的比例失真；WPS 预览和操作按钮固定可见，新建公式记住上次字号（首次 18 pt），成功写入后自动关闭窗口。

WPS、PowerPoint 加载项与浏览器编辑器的 AI 面板使用 **OpenAI API**（0.5.0 时为 DeepSeek API），默认模型 `gpt-6-astra`，无需 Chrome 或网页登录。可在面板的“API 设置”中保存本机 **OpenAI API Key**，也可使用环境变量或仓库共享密钥。详见 [API 对话使用说明](docs/API_CHAT.md)。

## 从这里开始

| 目的 | 文档 |
| --- | --- |
| 启动独立桌面 GUI（推荐） | [桌面版使用说明](docs/DESKTOP.md) |
| 在 Mac / Windows PowerPoint 使用 | [Office 安装说明](docs/INSTALL_OFFICE.md) |
| 在插件内用文字、图片与 AI 对话 | [OpenAI API 对话](docs/API_CHAT.md) |
| 独立桌面 GUI 的旧版截图识别 | [DeepSeek 网页识别](docs/DEEPSEEK.md) |
| 在另一台 Ubuntu 安装、升级、卸载、排查故障 | [Ubuntu 安装说明](docs/INSTALL_UBUNTU.md) |
| 日常编辑公式、Shape、SVG、字号与跨平台使用 | [使用手册](README_中文.md) |
| 维护范围、待办、版本管理与打包 | [项目管理](PROJECT.md) |
| 各版本变更 | [更新记录](CHANGELOG.md) |
| 哪些功能已实测、哪些仍待验证 | [验证记录](VALIDATION.md) |

## 在另一台 Ubuntu 快速安装

准备支持 **JS 加载项**的 WPS 演示，以及能访问本私有仓库的 GitHub 账号。当前已实测 WPS 365 教育版 12.8.2.21176；其他版本的加载项能力需确认。

**克隆后运行一个安装脚本即可：**

```bash
mkdir -p "$HOME/Applications" &&
git clone https://github.com/Swk6666/Iguanatex_bridge.git "$HOME/Applications/iguanatex_bridge" &&
cd "$HOME/Applications/iguanatex_bridge" &&
bash install.sh
```

已有本项目的 Git 克隆时，直接在该目录执行 `bash install.sh`。安装位置不限于 `~/Applications/`，无需再下载 ZIP、解压或搬动目录。若电脑没有 Git，先运行 `sudo apt update && sudo apt install -y git`；私有仓库的首次身份验证见 [完整安装说明](docs/INSTALL_UBUNTU.md)。

API 对话不需要浏览器或额外 Python 依赖。安装后在插件里填写 OpenAI API Key（未填写时使用仓库共享密钥）；公式编译无需密钥。独立 Qt 桌面 GUI 仍使用旧版网页识别，只有该模式需要 `--with-ocr`、Chrome 和网页登录。

脚本会检查并补齐 Ubuntu 的 Python / venv、XeLaTeX、中文和扩展宏包，然后安装 Python 依赖、注册 WPS 插件并配置后台自动启动。**用普通用户运行，不要用 `sudo bash install.sh`**；只有缺少系统包时脚本才调用 `sudo`，可能需要输入系统密码。TeX Live 首次下载较大，请等待完成。

保存文稿并完全退出、重新打开 WPS 演示，顶部应出现 **IguanaTex**。详细验收及故障处理见 [完整安装说明](docs/INSTALL_UBUNTU.md)。

安装脚本需要联网下载依赖，安装完成后公式在本机编译。日常不需要打开终端，也不需要安装 Codex 或 PowerPoint。安装目录需要保留；移动后必须在新位置重新运行安装脚本。

## 项目文件

```text
app.py / bridge.py / wps_support.py   本地服务、LaTeX 渲染与 PPTX 元数据
desktop.py / desktop_support.py      沿用 WPS 布局的独立桌面 GUI
start_desktop*                      macOS / Windows / Ubuntu 桌面启动入口
wps_addin/                           WPS 功能区和公式编辑窗口
office_addin/                        Mac / Windows PowerPoint 加载项
ai_chat.py / shared/chat.*           OpenAI API、多轮对话与本机密钥设置
ocr.py / shared/ocr.*                独立 Qt GUI 保留的旧版网页识别
setup_office.py / start_office*       Office HTTPS 证书、清单与启动入口
install.sh / install_wps*            一键安装、注册和自动启动
docs/                               安装说明与使用截图
examples/                           人工生成的验收 PPTX
test_*                              自动化测试
scripts/build_release.py             按白名单打包并生成 SHA-256
RELEASE_FILES.txt                    安装包文件白名单
VERSION / CHANGELOG.md               版本号与更新记录
dist/                               本机生成的安装包，不纳入 Git
.work/                              本机实验与真实文稿副本，不纳入 Git 或安装包
```

0.4.0 已在本机 macOS 实测桌面截图自动识别、TeX 回填和预览，以及 PowerPoint 加载项插入、更新、保存重开读取。此前版本的 Ubuntu WPS 工具栏、PNG / SVG、Shape 更新已实测。Windows 与本次新增 Ubuntu GUI/OCR 仍需对应设备验收，详见验证记录。

已有 MIT 许可及第三方说明保留，见 [LICENSE](LICENSE) 和 [THIRD_PARTY.md](THIRD_PARTY.md)。
