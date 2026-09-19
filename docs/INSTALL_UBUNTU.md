# Ubuntu 安装与维护

适用安装包：**IguanaTex_Bridge_WPS_v0.3.2.zip**。目标是在另一台 Ubuntu 的 WPS 演示工具栏中直接使用插件。下面操作在目标电脑执行，安装一次即可。

## 安装前准备

| 项目 | 要求 |
| --- | --- |
| WPS | WPS 演示支持 JS 加载项。已实测 WPS 365 教育版 12.8.2.21176；其他版本需确认此能力 |
| Python | Python 3.10 或更高版本，并有 `venv` 模块 |
| LaTeX | 推荐 XeLaTeX，中文需要相应 TeX 宏包和字体 |
| 网络 | 首次安装需要下载系统及 Python 依赖 |
| 安装文件 | 本项目 ZIP 和同名 `.zip.sha256` 校验文件，下方命令会一起下载 |

插件不包含 WPS、Python 或 TeX Live。WPS 安装包需来自你有权使用的发行渠道；选择与你当前电脑相同、已验证的版本有助于减少差异。加载项功能是 WPS 版本的能力，见 [WPS 官方加载项说明](https://open.wps.cn/documents/app-integration-dev/wps365/client/wpsoffice/jsapi/addin-api/wps-addin-availability)。

安装完成后公式在本机编译，日常不需要 Codex、PowerPoint、Node.js 或手动开终端。Ubuntu 端使用本插件；Windows / Mac 的 PowerPoint 端按需使用上游 IguanaTex。

## 首次安装

下面使用命令行完成依赖安装、私有仓库下载、校验、解压和插件注册。首次 GitHub 登录需要按终端提示完成浏览器授权。也可从 [项目 Releases](https://github.com/Swk6666/Iguanatex_bridge/releases/latest) 下载 ZIP 和对应 `.sha256` 文件，或从已有电脑复制这两个文件，然后选择下方“已有安装包”的步骤。

本仓库是私有仓库，未登录或账号无权限时，GitHub 可能显示 404。安装包可在两台电脑之间复制，目标电脑不必配置 Git。需要开发源码时，才使用 Git 克隆私有仓库。

### 1. 准备 WPS

在目标 Ubuntu 上安装 WPS，打开一次 **WPS 演示**，确认能新建和保存 `.pptx`。记录“关于 WPS”中的版本号。已经安装 WPS 时不必重复安装。

### 2. 安装系统依赖

打开终端，执行：

```bash
sudo apt update
sudo apt install python3 python3-venv unzip texlive-xetex texlive-latex-extra texlive-fonts-recommended texlive-lang-chinese
```

这些命令需要系统安装权限；TeX 相关包下载较大，请等终端执行完毕。APT 会跳过已经满足的依赖。

检查：

```bash
python3 --version
xelatex --version
```

Python 应为 3.10 或更高，XeLaTeX 应能显示版本。如果已有自行安装的 TeX Live，也可以继续使用，但其可执行文件必须能被后台服务找到；系统包方式通常更省事。

### 3. 下载并解压到固定目录

建议安装到 `~/Applications/iguanatex_bridge`。以下两种方式任选一种，均不需要手工解压。

#### 方式 A：从私有仓库命令行下载

先安装 GitHub CLI。以下命令使用 [GitHub CLI 官方 APT 源](https://github.com/cli/cli/blob/trunk/docs/install_linux.md#debian)；官方文档说明 Ubuntu 源中的旧版 2.45 / 2.46 存在 GitHub API 兼容问题，因此这里配置官方源。已经从官方源安装了新版 `gh` 时可跳过此段。

```bash
(
set -e
sudo apt update
sudo apt install curl ca-certificates
bridge_keyring="$(mktemp)"
curl -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg -o "$bridge_keyring"
sudo install -d -m 755 /etc/apt/keyrings /etc/apt/sources.list.d
sudo install -m 644 "$bridge_keyring" /etc/apt/keyrings/githubcli-archive-keyring.gpg
printf '%s\n' "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" | sudo tee /etc/apt/sources.list.d/github-cli.list > /dev/null
sudo apt update
sudo apt install gh
)
```

用普通用户登录一次，按终端提示完成授权，账号需要有权访问 `Swk6666/Iguanatex_bridge`。已登录正确账号时可跳过。参见 [GitHub CLI 登录说明](https://cli.github.com/manual/gh_auth_login)。

```bash
gh auth login --hostname github.com --git-protocol https --web
```

登录成功后，整段复制执行，自动下载本版 ZIP 和校验文件，校验成功后解压：

```bash
(
set -e
if [ -e "$HOME/Applications/iguanatex_bridge" ] || [ -L "$HOME/Applications/iguanatex_bridge" ]; then
    echo '已有安装目录，请按文档中的升级流程操作。' >&2
    exit 1
fi
bridge_download_dir="$(mktemp -d)"
gh release download v0.3.2 --repo Swk6666/Iguanatex_bridge \
    --pattern 'IguanaTex_Bridge_WPS_v0.3.2.zip*' --dir "$bridge_download_dir"
cd "$bridge_download_dir"
sha256sum -c IguanaTex_Bridge_WPS_v0.3.2.zip.sha256
mkdir -p "$HOME/Applications"
unzip -q IguanaTex_Bridge_WPS_v0.3.2.zip -d "$HOME/Applications"
)
```

这里使用 [gh release download](https://cli.github.com/manual/gh_release_download) 下载指定版本的发布附件；私有附件需通过上述登录访问。下载暂存在系统临时目录，解压后的程序保存在 `~/Applications/iguanatex_bridge`。

#### 方式 B：已有安装包，只需命令行解压

跳过 GitHub CLI 安装及登录，把下面的 `/安装包所在目录/` 换成 ZIP 和校验文件实际所在的目录，再整段执行：

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
)
```

两种方式的校验结果都应为 `OK`（中文环境也可能显示“成功”）。括号和 `set -e` 会让这组命令在出错时停止，校验失败不会继续解压。已有旧版时请使用下方升级流程。

### 4. 运行安装脚本

使用你日常登录和运行 WPS 的普通用户执行。这里**不要加 `sudo`**，否则会注册到错误用户的目录。

```bash
cd "$HOME/Applications/iguanatex_bridge" &&
bash install_wps_linux_mac.sh
```

脚本会：

1. 在此目录创建 `.venv` 并安装 Python 依赖。
2. 启动本地服务，默认地址为 `http://127.0.0.1:17863`。
3. 合并当前用户的 WPS 加载项配置，修改前备份旧配置。
4. 配置用户登录后自动启动，优先使用 systemd 用户服务；不可用时使用桌面自动启动。

成功时终端显示“已安装 IguanaTex Bridge 0.3.2”，以及配置路径和本地服务地址。请等待完成后再关闭终端。

### 5. 重启 WPS

保存正在编辑的文稿，完全退出 WPS，再打开 **WPS 演示**。顶部应出现 **IguanaTex** 功能区，包含新建公式、编辑选中公式、检查与同步源码、环境与帮助。

首次安装完成。安装目录要保留，后台服务会从此处读取程序；不要在安装后把它当临时解压文件删除。

## 安装验收

1. 新建空白演示文稿，点击 **IguanaTex → 新建公式**。
2. 输入 `E=mc^2`，选择 SVG，字号设为 24，预览并插入。
3. 选中公式，点击 **编辑选中公式**，字号改为 36，预览并更新。
4. 保存为测试 `.pptx`，关闭再打开，确认公式能显示、源码可读、字号显示 36。
5. 测试中文公式：

```latex
\underbrace{M(q)\ddot q}_{\text{惯性项}}+g(q)=\tau
```

中文选择 XeLaTeX。也可打开 `examples/font_size_test.pptx` 验证 SVG 和字号，或 `examples/wps_roundtrip_test.pptx` 验证 PNG 与中文。请另存自己的测试副本。

最后注销并重新登录一次，确认无需手动运行脚本就能打开编辑器。另一台 Ubuntu 的实测结果请记录到项目的 `VALIDATION.md`，包括 Ubuntu、WPS、Python 和 TeX 版本。

## 日常使用

- 直接从 WPS 工具栏进入，不必启动终端。
- 公式随 `.pptx` 携带源码和图形；换电脑后，安装插件即可继续编辑。
- Shape 组合可以直接读源码，更新后为 SVG 图形或 PNG；不保留原生逐字 Shape 结构。
- 修改字号会自动按字号重设尺寸；想沿用排版时选择“保留原宽高”。
- 正常在 WPS 中保存文稿。插件不会自动替你保存整个文件。
- 完整 LaTeX 文档中引用的自定义字体、宏包或外部文件，目标电脑仍须具备对应依赖。

## 升级与迁移

升级前保存工作并退出 WPS。下面以默认安装目录为例：

1. 保留上一版 ZIP 和校验文件，作为恢复用的安装包。
2. 若使用 systemd，先暂停服务：

```bash
systemctl --user stop iguanatex-bridge.service
```

3. 在文件管理器中把整个旧目录改名备份，例如 `iguanatex_bridge-backup-旧版本号`；将新版 ZIP 解压回原来的 `~/Applications/iguanatex_bridge`。新版目录由安装脚本重新建立 `.venv`。
4. 运行：

```bash
cd "$HOME/Applications/iguanatex_bridge"
bash install_wps_linux_mac.sh
```

5. 重新打开 WPS，检查健康状态和一条测试公式。成功后再自行决定何时删除备份。

恢复旧版也采用同样流程：退出 WPS、暂停服务、把旧版解压回正式安装路径，然后重新运行安装脚本。不要直接运行改名备份目录中的 `.venv`，虚拟环境可能仍引用原路径。

**从 Git 源码更新且安装路径不变时**，更新已提交的源码后重新运行安装脚本即可。移动项目目录后，也必须在新目录运行安装脚本，以更新后台服务中的绝对路径。

若安装时使用了自定义端口或 `--addons-dir`，升级时传入同样参数。桌面自动启动降级模式下，更新后注销并重新登录，确保旧后台进程退出。

## 常见问题

### 没有 IguanaTex 功能区

先在浏览器打开 [本地服务状态](http://127.0.0.1:17863/health)。正常应显示类似：

```json
{"app": "IguanaTexBridge", "version": "0.3.2"}
```

如果能打开：保存后完整退出、重开 WPS，确认使用的是 WPS 演示，并核对 WPS 版本支持 JS 加载项。

插件注册文件默认位于：

```text
~/.local/share/Kingsoft/wps/jsaddons/publish.xml
```

可以重新运行安装脚本修复注册。脚本会保留其他插件并备份原配置。企业版策略或不同发行方式可能使用其他目录，可在确认实际目录后指定：

```bash
bash install_wps_linux_mac.sh --addons-dir "/实际的/jsaddons/目录"
```

服务正常而工具栏仍不出现时，需要检查 WPS 的加载项能力和策略；不要用其他机器的整个 WPS 配置覆盖本机配置。

### 服务地址打不开，或者编辑器空白

使用默认的 systemd 安装时：

```bash
systemctl --user status iguanatex-bridge.service --no-pager
journalctl --user -u iguanatex-bridge.service -n 60 --no-pager
systemctl --user restart iguanatex-bridge.service
```

如提示用户 systemd 不可用，查看 `~/.config/autostart/iguanatex-bridge.desktop` 和 `~/.local/state/iguanatex-bridge/service.log`，并注销后重新登录。

仍无法启动时，可以在安装目录手动运行以查看错误：

```bash
.venv/bin/python app.py --no-browser --port 17863
```

此方式仅用于排错，运行期间保留终端。若已有服务占用该端口，先查看下面的端口问题。

### 提示未找到 xelatex，或中文编译失败

```bash
cd "$HOME/Applications/iguanatex_bridge"
.venv/bin/python app.py --doctor
xelatex --version
kpsewhich ctex.sty
```

`doctor` 应给出引擎路径；`kpsewhich` 应返回中文宏包路径。缺少时安装前述 TeX 包，再重启后台服务。若普通公式可编译而某份完整源码失败，请检查该源码需要的字体和宏包。

自行安装到非系统 PATH 的 TeX Live 可能在终端可用、后台服务却不可用。优先使用上述 Ubuntu 包，或按自己的 TeX 安装路径配置用户服务环境后重启服务。

### 提示 venv 或 Python 版本错误

```bash
python3 --version
command -v python3
sudo apt install python3-venv
```

确认脚本使用 Python 3.10+。如处于 Conda 或另一个虚拟环境，请先退出该环境再检查；不要把另一台电脑的 `.venv` 拷贝过来使用。新机器应从 ZIP 安装，由脚本创建自己的环境。

### Python 依赖下载失败

安装脚本中的 pip 需要访问包源。恢复网络后重新执行安装脚本即可；默认脚本不依赖某个特定第三方镜像。是否安装完成，以脚本最终成功提示及 `/health` 检查为准。

### 端口 17863 被其他程序占用

可以选择另一个可用端口并重新注册：

```bash
bash install_wps_linux_mac.sh --port 17864
```

然后重启 WPS。后续健康检查地址和排错命令中的端口也改为 `17864`。

## 卸载

先退出 WPS，再从实际安装目录执行：

```bash
cd "$HOME/Applications/iguanatex_bridge"
.venv/bin/python install_wps.py --uninstall
```

这会移除本插件的注册和自动启动配置，项目文件及 PPTX 文稿保留。桌面自动启动降级模式的既有进程会在注销后退出；确认卸载后，可自行删除安装目录。

## 安装位置速查

| 内容 | 默认位置 |
| --- | --- |
| 程序和虚拟环境 | 你解压的 `iguanatex_bridge/` 及其中 `.venv/` |
| WPS 注册 | `~/.local/share/Kingsoft/wps/jsaddons/publish.xml` |
| 注册文件备份 | 同目录 `publish.xml.iguanatex-backup-*` |
| systemd 用户服务 | `~/.config/systemd/user/iguanatex-bridge.service` |
| 降级自动启动文件 | `~/.config/autostart/iguanatex-bridge.desktop` |
| 非 systemd 启动日志 | `~/.local/state/iguanatex-bridge/service.log` |
| 本地服务 | `http://127.0.0.1:17863`，只监听本机 |

这份文档描述安装包的行为。当前这台 Ubuntu 已完成实机验证；另一台机器需要按上述验收步骤确认，尤其是 WPS 版本与加载项能力。
