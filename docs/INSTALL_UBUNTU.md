# Ubuntu 安装与维护

当前版本：**0.4.1**。推荐克隆私有仓库，然后运行 `bash install.sh`；同一脚本也能在解压后的安装包中运行。

## 安装前准备

- 已安装支持 **JS 加载项**的 WPS 演示，并能新建和保存 `.pptx`。本项目已实测 WPS 365 教育版 12.8.2.21176；其他版本需确认加载项能力。WPS 本身需要单独安装，插件脚本不会下载 WPS。
- 使用日常运行 WPS 的普通用户。缺少系统包时，需要该用户能够使用 `sudo`。
- 首次安装需要联网访问 GitHub、Ubuntu 软件源和 Python 包源；Python / venv 和 TeX Live 可由脚本自动安装。Python 最低为 3.10，Ubuntu 软件源仍提供更旧 Python 时需要先升级系统或自行准备受支持的 Python。
- 私有仓库需要有访问权限的 GitHub 账号。已经克隆或拿到 ZIP 后，安装脚本本身不需要 GitHub 登录。

安装完成后公式在本机编译，日常不需要 Codex、PowerPoint、Node.js 或手动开终端。Ubuntu 端使用 WPS 插件；Windows / Mac 的 PowerPoint 端可使用[新增 Office 加载项](INSTALL_OFFICE.md)或上游 IguanaTex。

需要图片转 TeX 时使用 `bash install.sh --with-ocr`，并安装 Google Chrome。首次在编辑器点击“打开 / 登录 DeepSeek”，流程见[图片识别说明](DEEPSEEK.md)。仅图片识别需要上传所选图片；公式渲染仍在本机进行。

## 推荐：克隆后一键安装

### 1. 准备 Git 和仓库访问

如果 `git --version` 能显示版本，可跳过安装 Git：

```bash
sudo apt update && sudo apt install -y git
```

如果当前电脑已配置能访问此仓库的 Git HTTPS 凭据，继续下一步即可。已配置 SSH 密钥时，把下一步的仓库 URL 换成 `git@github.com:Swk6666/Iguanatex_bridge.git`。使用 HTTPS 克隆且提示 Username / Password 时，输入 GitHub 用户名和有权读取该仓库的个人访问令牌；Password 处不是 GitHub 账户密码。不要把令牌写进仓库 URL、安装脚本或发送到聊天中。令牌设置见 [GitHub 官方说明](https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/managing-your-personal-access-tokens)。

如果已安装 GitHub CLI，也可以通过下面两条命令完成登录及 Git 凭据配置，再使用下一步的 HTTPS 克隆命令：

```bash
gh auth login --hostname github.com --git-protocol https --web &&
gh auth setup-git
```

登录方式说明见 [GitHub CLI 官方文档](https://cli.github.com/manual/gh_auth_login)。首次浏览器授权需要本人完成，插件脚本不保存 GitHub 凭据。仓库显示 404 或拒绝克隆时，先确认登录账号和仓库访问权限。

### 2. 克隆并运行安装脚本

在终端整段执行：

```bash
mkdir -p "$HOME/Applications" &&
git clone https://github.com/Swk6666/Iguanatex_bridge.git "$HOME/Applications/iguanatex_bridge" &&
cd "$HOME/Applications/iguanatex_bridge" &&
bash install.sh
```

已有 Git 克隆时，在它所在的目录直接运行 `bash install.sh`，不需要再次克隆，也不需要移到 `~/Applications/`。如果目标目录已有旧 ZIP 安装，先按“升级与迁移”备份它，或把 Git 克隆放到另一个固定目录，随后在新目录安装。

**不要运行 `sudo bash install.sh`**：WPS 插件属于当前桌面用户。脚本会拒绝 root 执行，仅在补齐系统包时调用 `sudo`。安装缺少的 TeX Live 包可能需要较长时间。

脚本自动完成：

1. 检查现有 Python 3.10+ / 虚拟环境；需要时通过 APT 安装 `python3` 和 `python3-venv`。
2. 补齐 `texlive-xetex`、`texlive-latex-extra`、`texlive-fonts-recommended`、`texlive-lang-chinese`；已有系统包会跳过。
3. 检查 XeLaTeX、中文宏包和 `standalone` 文档类，创建或复用当前目录的 `.venv`，安装 Python 依赖。
4. 启动本地服务，并合并当前用户的 WPS 加载项配置；修改前备份旧配置。
5. 配置登录后自动启动，优先使用 systemd 用户服务，不可用时使用桌面自动启动。

安装过程中任何一步失败都会停止；解决错误后可重新执行同一命令。成功时显示“已安装 IguanaTex Bridge 0.4.1”以及本地服务地址。

### 3. 重启 WPS

保存正在编辑的文稿，完全退出 WPS，再打开 **WPS 演示**。顶部应出现 **IguanaTex** 功能区。

克隆目录就是安装目录，后台服务会从此处读取程序，请保留。移动目录后，在新位置重新运行 `bash install.sh`。

## 安装选项

默认命令面向 Ubuntu / Debian 的 APT 环境。自行安装了完整 Python 和 TeX Live、不想使用 APT 时：

```bash
bash install.sh --skip-system-deps
```

该选项仍会检查 Python 和 TeX，安装项目的 Python 依赖并注册插件。自备 TeX 的路径必须能被后台服务找到。macOS 仍需事先准备 Python 和 MacTeX；其 WPS 实机安装尚未验证。

其他选项可组合使用：

```bash
bash install.sh --help
bash install.sh --port 17864
bash install.sh --addons-dir "/实际的/jsaddons/目录"
bash install.sh --no-autostart
```

`--no-autostart` 只取消本次配置自动启动的步骤，仍会启动服务；不会删除此前已有的自动启动配置。旧入口 `install_wps_linux_mac.sh` 转发到 `install.sh`，仍可使用。

## 备用：从 ZIP 安装

ZIP 用于不使用 Git 的电脑或复制安装包。登录 [项目 Releases](https://github.com/Swk6666/Iguanatex_bridge/releases/latest) 下载 `IguanaTex_Bridge_WPS_v0.4.1.zip` 和同名 `.zip.sha256`。本仓库及附件保持私有访问。

已有 GitHub CLI 并登录的用户，也可在一个空目录下载附件：

```bash
gh release download v0.4.1 --repo Swk6666/Iguanatex_bridge --pattern 'IguanaTex_Bridge_WPS_v0.4.1.zip*'
```

在 ZIP 和校验文件所在目录运行以下命令。只在目标安装目录尚不存在时使用；已有旧版时按升级流程操作。若没有 `unzip`，先运行 `sudo apt install unzip`。

```bash
(
set -e
if [ -e "$HOME/Applications/iguanatex_bridge" ] || [ -L "$HOME/Applications/iguanatex_bridge" ]; then
    echo '已有安装目录，请按文档中的升级流程操作。' >&2
    exit 1
fi
sha256sum -c IguanaTex_Bridge_WPS_v0.4.1.zip.sha256
mkdir -p "$HOME/Applications"
unzip -q IguanaTex_Bridge_WPS_v0.4.1.zip -d "$HOME/Applications"
cd "$HOME/Applications/iguanatex_bridge"
bash install.sh
)
```

校验失败会停止。解压后使用同一个 `install.sh`，不需要手动安装 Python 和 TeX 依赖。

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

### 从 Git 克隆安装的用户

保存工作并退出 WPS，然后在原安装目录运行：

```bash
cd "$HOME/Applications/iguanatex_bridge" &&
git pull --ff-only &&
bash install.sh
```

在其他目录克隆时，将第一行换成实际路径。`git pull --ff-only` 失败时先解决 Git 提示，后续安装不会继续。自己修改过源码时先提交或备份更改；不要强制重置覆盖本地工作。

### 从 ZIP 安装的用户

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
bash install.sh
```

5. 重新打开 WPS，检查健康状态和一条测试公式。成功后再自行决定何时删除备份。

恢复旧版也采用同样流程：退出 WPS、暂停服务、把旧版解压回正式安装路径，然后重新运行安装脚本。不要直接运行改名备份目录中的 `.venv`，虚拟环境可能仍引用原路径。

**从 Git 源码更新且安装路径不变时**，更新已提交的源码后重新运行安装脚本即可。移动项目目录后，也必须在新目录运行安装脚本，以更新后台服务中的绝对路径。

若安装时使用了自定义端口或 `--addons-dir`，升级时传入同样参数。桌面自动启动降级模式下，更新后注销并重新登录，确保旧后台进程退出。

## 常见问题

### 没有 IguanaTex 功能区

先在浏览器打开 [本地服务状态](http://127.0.0.1:17863/health)。正常应显示类似：

```json
{"app": "IguanaTexBridge", "version": "0.4.1"}
```

如果能打开：保存后完整退出、重开 WPS，确认使用的是 WPS 演示，并核对 WPS 版本支持 JS 加载项。

插件注册文件默认位于：

```text
~/.local/share/Kingsoft/wps/jsaddons/publish.xml
```

可以重新运行安装脚本修复注册。脚本会保留其他插件并备份原配置。企业版策略或不同发行方式可能使用其他目录，可在确认实际目录后指定：

```bash
bash install.sh --addons-dir "/实际的/jsaddons/目录"
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

确认脚本使用 Python 3.10+。如处于 Conda 或另一个虚拟环境，请先退出该环境再检查；不要把另一台电脑的 `.venv` 拷贝过来使用。新机器应重新克隆或解压，由 `install.sh` 创建自己的环境。

### Python 依赖下载失败

安装脚本中的 pip 需要访问包源。恢复网络后重新执行安装脚本即可；默认脚本不依赖某个特定第三方镜像。是否安装完成，以脚本最终成功提示及 `/health` 检查为准。

### 端口 17863 被其他程序占用

可以选择另一个可用端口并重新注册：

```bash
bash install.sh --port 17864
```

然后重启 WPS。后续健康检查地址和排错命令中的端口也改为 `17864`。

## 卸载

先退出 WPS，再从实际安装目录执行：

```bash
cd "$HOME/Applications/iguanatex_bridge"
bash install.sh --uninstall
```

这会移除本插件的注册和自动启动配置，项目文件及 PPTX 文稿保留。桌面自动启动降级模式的既有进程会在注销后退出；确认卸载后，可自行删除安装目录。

## 安装位置速查

| 内容 | 默认位置 |
| --- | --- |
| 程序和虚拟环境 | 你克隆或解压的 `iguanatex_bridge/` 及其中 `.venv/` |
| WPS 注册 | `~/.local/share/Kingsoft/wps/jsaddons/publish.xml` |
| 注册文件备份 | 同目录 `publish.xml.iguanatex-backup-*` |
| systemd 用户服务 | `~/.config/systemd/user/iguanatex-bridge.service` |
| 降级自动启动文件 | `~/.config/autostart/iguanatex-bridge.desktop` |
| 非 systemd 启动日志 | `~/.local/state/iguanatex-bridge/service.log` |
| 本地服务 | `http://127.0.0.1:17863`，只监听本机 |

这份文档描述 Git 源码及版本安装包的安装行为。当前这台 Ubuntu 已完成实机验证；另一台机器需要按上述验收步骤确认，尤其是 WPS 版本与加载项能力。
