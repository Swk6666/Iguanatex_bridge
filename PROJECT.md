# 个人项目管理

## 项目定位

- 名称：IguanaTex Bridge。
- 用途：自己的独立桌面公式编辑器，界面沿用 Ubuntu WPS 版，新增截图转 TeX；附带 macOS / Windows PowerPoint 与 Ubuntu WPS 加载项。不依赖上游 IguanaTeX，保留其源码标签兼容性。
- 当前版本：见 [VERSION](VERSION)。
- 管理方式：本地 Git，主分支 `main`；远程 `origin` 为本人指定的私有仓库 [Swk6666/Iguanatex_bridge](https://github.com/Swk6666/Iguanatex_bridge)。
- 访问安排：源码、安装包和实验文件由本人保管。项目按私人方式管理，既有代码及第三方许可保持原样。
- 当前目录也是本机后台服务的安装位置。迁移目录时按 [迁移说明](docs/INSTALL_UBUNTU.md#升级与迁移) 重新注册。

## 已完成（新增入口的实机状态另见 VALIDATION.md）

- [x] WPS 工具栏入口：新建、编辑、同步源码、帮助。
- [x] XeLaTeX / pdfLaTeX / LuaLaTeX 编译；中文公式。
- [x] IguanaTex Shape 组合直接读取，重新生成 SVG 或 PNG。
- [x] SVG 字形轮廓和源码保留，保存后继续编辑。
- [x] 原宽高、保留高度、按字号重设尺寸；字号 4–200 pt。
- [x] Ubuntu 克隆后 `bash install.sh` 一键安装系统依赖、注册插件和后台自动启动。
- [x] 本地 Git、GitHub 私有仓库、安装手册、变更记录、白名单打包。

- [x] 0.4.0 Office.js 加载项、HTTPS 启动、共享图片识别界面和可配置 DeepSeek 网页自动化。
- [x] 独立桌面 GUI、截图自动识别回填和预览、剪贴板输出、文件导出与源码重开。
- [x] Mac 真实 Chrome / DeepSeek 自动识别；PowerPoint 加载项 SVG 插入、更新、保存重开读取；桌面图片粘贴。

- [x] 0.4.2 公式自然比例、固定预览操作区、WPS 字号记忆和成功写入后自动关闭。
- [x] 0.5.0 默认 DeepSeek API：本机密钥设置、文字＋图片、多轮对话、完整回答与显式采用 LaTeX。
- [x] 0.5.1 真实 DeepSeek 文字请求、完整 LaTeX 回传、采用及 XeLaTeX 裁边预览。
- [x] 0.6.0 紧凑工作台、AI 可收起侧栏、低频选项折叠，统一 WPS / Office / 独立网页。
- [x] 0.5.2 WPS / PowerPoint 编辑公式默认按字号重设尺寸，保留高度和固定原宽高改为手动选择。
- [ ] 真实 DeepSeek 图片调用验收（现有图片流程通过模拟接口测试）。
- [x] 0.4.1 完整 LaTeX 文档编辑、预览前显示实际编译源码、识别回填保留导言区。

## 待办与验收标准

| 优先级 | 事项 | 完成条件 |
| --- | --- | --- |
| 高 | Windows / Ubuntu 新桌面 GUI 与识别验收 | 启动、截图拖放 / 剪贴板、浏览器登录、回填、导出与重开通过 |
| 高 | Office.js Windows 侧载验收 | 本地证书、加载项启动、SVG / PNG 写入、源码再编辑和保存重开通过 |
| 中 | DeepSeek 异常流程实测 | 常规积分 / 矩阵识别已通过；补测中文、断网、取消、验证码和网页版本变化 |
| 高 | 另一台 Ubuntu 安装验收 | 按文档克隆后运行 `install.sh`，工具栏可用，中文/SVG/字号保存并重新读取，登录后自动启动 |
| 高 | Windows PowerPoint + IguanaTex 往返 | 示例文件能 Edit LaTeX display、ReGenerate，传回 WPS 后源码和尺寸正确 |
| 高 | 新建 / 编辑 / 截图功能区入口与 Shape 组合验收 | 最新清单在真实 PowerPoint 刷新、连续切换入口、读取组合字形并更新通过 |
| 中 | macOS 上游 IguanaTex 双向重生成 | 已确认其 Edit LaTeX display 能读取本插件的源码和字号；ReGenerate 后返回 Bridge 及 WPS 再编辑仍需测试 |
| 中 | Windows / macOS WPS 安装 | 安装、自启动、工具栏和渲染均在对应实机验证 |
| 中 | 保留原生逐字 Shape 输出 | 更新后仍为原生 Shape，字符结构与样式正确；当前 SVG 更新不等于此项完成 |
| 中 | 外层排版组合中的公式更新 | 保留同组其他对象、层叠和组结构，具有失败恢复验证 |

待办不是已实现功能。每次完成验收，在 `VALIDATION.md` 写明环境、步骤、结果与限制，再勾选相应状态。

## 日常开发

```bash
git status
git switch -c codex/本次功能名称
```

完成修改后，按变更范围运行检查。完整回归命令：

```bash
.venv/bin/python -m unittest -v
node test_wps_adapter.js
node test_wps_editor.js
node test_office_adapter.js
node test_office_taskpane.js
node test_ocr_ui.js
```

Node.js 仅用于开发测试，插件运行不需要 Node.js。实际 WPS 验证使用 `.work/` 中的专用副本，避免修改正式演示文稿。当前已完成的测试及其范围见 `VALIDATION.md`。

提交前用 `git diff` 查看变更，明确添加需要版本管理的文件：

```bash
git add 本次修改的文件
git commit -m "说明本次变更"
```

`.venv/`、`.work/`、`dist/`、缓存、日志、环境文件和 WPS 生成的注册表样式文件均已排除。项目中的 `examples/` 只存放人工生成的验收文稿，真实研究文稿放在项目外或 `.work/`。

## 版本与打包

1. 修改 `VERSION`，并同步 `app.py` 的服务版本、`install_wps.py` 的安装提示、`wps_addin/editor.js` 的帮助版本及文档标题。
2. 更新 `CHANGELOG.md`、受影响的使用/安装说明以及 `VALIDATION.md`。
3. 如新增分发文件，在 `RELEASE_FILES.txt` 中明确列出。打包脚本只读取此白名单。
4. 完成适合本次变更的验证，再执行：

```bash
python3 scripts/build_release.py
```

输出位于 `dist/`：版本 ZIP 和相应的 `.sha256` 校验文件。首次安装的接收方只需 ZIP；校验文件可用于确认复制完整。

5. 记录 Git 提交，并为本次发行打标签：

```bash
git tag -a v版本号 -m "版本说明"
```

6. 推送已确认的提交和标签到本人私有仓库，在 GitHub Releases 中创建对应版本，上传 ZIP 及 `.sha256` 两个文件。不要把 `.venv` 或实验文稿作为版本附件。

不移动已经发布的版本标签。日常功能开发用新提交，准备下一次发行时递增版本号。仓库维持 Private；GitHub 发布版本不改变仓库的访问范围。

## 备份

安装 ZIP 适合迁移运行环境；需要保留开发历史时，可另做 Git 备份：

```bash
git bundle create ../iguanatex-bridge-history.bundle --all
git bundle verify ../iguanatex-bridge-history.bundle
```

Git bundle 只包含已提交的仓库历史，不含忽略文件或未提交修改。真实文稿请随个人文件备份另行保存。GitHub 私有仓库保存已推送的代码历史和版本附件，实验目录仍需按需本地备份。
