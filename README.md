# IguanaTex Bridge · 个人项目

在 WPS 演示工具栏中编辑 LaTeX 公式，支持 IguanaTex Shape 组合、SVG 矢量输出和字号调整。源码随 PPTX 保存，使用 IguanaTex 原生标签格式。

当前版本 **0.3.2**。个人私有仓库：[Swk6666/Iguanatex_bridge](https://github.com/Swk6666/Iguanatex_bridge)。访问仓库及版本附件需要有权限的 GitHub 账号。

[下载最新安装包](https://github.com/Swk6666/Iguanatex_bridge/releases/latest) · [Ubuntu 完整安装流程](docs/INSTALL_UBUNTU.md)

## 从这里开始

| 目的 | 文档 |
| --- | --- |
| 在另一台 Ubuntu 安装、升级、卸载、排查故障 | [Ubuntu 安装说明](docs/INSTALL_UBUNTU.md) |
| 日常编辑公式、Shape、SVG、字号与跨平台使用 | [使用手册](README_中文.md) |
| 维护范围、待办、版本管理与打包 | [项目管理](PROJECT.md) |
| 各版本变更 | [更新记录](CHANGELOG.md) |
| 哪些功能已实测、哪些仍待验证 | [验证记录](VALIDATION.md) |

## 在另一台 Ubuntu 快速安装

准备支持 **JS 加载项**的 WPS 演示、Python 3.10+，以及本项目的 ZIP 安装包。当前已实测 WPS 365 教育版 12.8.2.21176；其他版本的加载项能力需确认。

首次安装依赖：

```bash
sudo apt update
sudo apt install python3 python3-venv unzip texlive-xetex texlive-latex-extra texlive-fonts-recommended texlive-lang-chinese
```

下载、解压和安装都可以用命令行完成。从私有仓库直接下载的完整命令见 [命令行下载步骤](docs/INSTALL_UBUNTU.md#3-下载并解压到固定目录)，首次需要登录有权访问仓库的 GitHub 账号。

**已有 ZIP 和同名 `.zip.sha256` 文件时**，把下面的 `/安装包所在目录/` 换成实际路径，整段复制执行，即可校验、解压到 `~/Applications/` 并安装。使用日常运行 WPS 的普通用户，**不要加 `sudo`**：

```bash
(
set -e
cd "/安装包所在目录/"
if [ -e "$HOME/Applications/iguanatex_bridge" ] || [ -L "$HOME/Applications/iguanatex_bridge" ]; then
    echo '已有安装目录，请按文档中的升级流程操作。' >&2
    exit 1
fi
sha256sum -c IguanaTex_Bridge_WPS_v0.3.2.zip.sha256
mkdir -p "$HOME/Applications"
unzip -q IguanaTex_Bridge_WPS_v0.3.2.zip -d "$HOME/Applications"
cd "$HOME/Applications/iguanatex_bridge"
bash install_wps_linux_mac.sh
)
```

命令遇到下载包损坏或目录已存在时会停止，不会继续安装；已有版本请看 [升级与迁移](docs/INSTALL_UBUNTU.md#升级与迁移)。

保存文稿并完全退出、重新打开 WPS 演示，顶部应出现 **IguanaTex**。详细验收及故障处理见 [完整安装说明](docs/INSTALL_UBUNTU.md)。

安装脚本需要联网下载依赖，安装完成后公式在本机编译。日常不需要打开终端，也不需要安装 Codex 或 PowerPoint。安装目录需要保留；移动后必须在新位置重新运行安装脚本。

## 项目文件

```text
app.py / bridge.py / wps_support.py   本地服务、LaTeX 渲染与 PPTX 元数据
wps_addin/                           WPS 功能区和公式编辑窗口
install_wps*                         安装、注册和自动启动
docs/                               安装说明与使用截图
examples/                           人工生成的验收 PPTX
test_*                              自动化测试
scripts/build_release.py             按白名单打包并生成 SHA-256
RELEASE_FILES.txt                    安装包文件白名单
VERSION / CHANGELOG.md               版本号与更新记录
dist/                               本机生成的安装包，不纳入 Git
.work/                              本机实验与真实文稿副本，不纳入 Git 或安装包
```

Ubuntu WPS 实机已验证工具栏、PNG / SVG、Shape 读取更新、字号调整和保存后读取。Windows / macOS PowerPoint + IguanaTex 实机往返尚未完成，不能视为已经通过三端验收。

已有 MIT 许可及第三方说明保留，见 [LICENSE](LICENSE) 和 [THIRD_PARTY.md](THIRD_PARTY.md)。
