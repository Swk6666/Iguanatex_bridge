#!/usr/bin/env bash
# Install from a Git checkout or extracted release as the desktop user.
set -euo pipefail
cd -- "$(dirname -- "$0")"

bridge_skip_system_deps=0
bridge_uninstall=0
bridge_with_ocr=0
bridge_installer_args=()

bridge_usage() {
    cat <<'USAGE'
用法：bash install.sh [选项]

Ubuntu：自动补齐 Python / venv 和 TeX Live，安装 Python 依赖、注册 WPS、配置后台启动。
用日常运行 WPS 的普通用户执行；只有安装系统包时会调用 sudo。
WPS 演示须事先安装，且支持 JS 加载项。克隆目录就是安装位置，请保留。

选项：
  --skip-system-deps     已自行准备 Python 和 TeX 时，跳过 APT 系统包安装
  --port PORT            本地服务端口（默认 17863）
  --addons-dir DIR       自定义 WPS jsaddons 目录
  --no-autostart         不设置登录后自动启动
  --with-ocr             安装 DeepSeek 网页识别依赖（另需 Google Chrome）
  --uninstall            仅移除 WPS 注册和自动启动，不安装任何依赖
  -h, --help             显示帮助
USAGE
}

while [ "$#" -gt 0 ]; do
    case "$1" in
        -h|--help) bridge_usage; exit 0 ;;
        --skip-system-deps) bridge_skip_system_deps=1; shift ;;
        --with-ocr) bridge_with_ocr=1; shift ;;
        --uninstall) bridge_uninstall=1; bridge_installer_args+=("$1"); shift ;;
        --no-autostart) bridge_installer_args+=("$1"); shift ;;
        --port|--addons-dir)
            if [ "$#" -lt 2 ] || [ -z "$2" ] || [[ "$2" == --* ]]; then
                echo "$1 需要一个参数。" >&2; exit 2
            fi
            if [ "$1" = --port ] && ! [[ "$2" =~ ^[1-9][0-9]{0,4}$ ]]; then
                echo '端口应为 1–65535 的整数。' >&2; exit 2
            fi
            if [ "$1" = --port ] && [ "$2" -gt 65535 ]; then
                echo '端口应为 1–65535 的整数。' >&2; exit 2
            fi
            bridge_installer_args+=("$1" "$2"); shift 2 ;;
        *) echo "未知选项：$1；用 bash install.sh --help 查看用法。" >&2; exit 2 ;;
    esac
done

if [ "$EUID" -eq 0 ]; then
    echo '请不要用 sudo bash install.sh 或 root 安装。请用运行 WPS 的普通用户重试。' >&2
    exit 1
fi

trap 'echo "安装未完成。请解决上方错误后重新运行 bash install.sh。" >&2' ERR

bridge_python_ready() {
    "$1" -c 'import sys; sys.exit(0 if sys.version_info >= (3, 10) else 1)' >/dev/null 2>&1
}

bridge_python=python3
if [ -e .venv ] || [ -L .venv ]; then
    if ! bridge_python_ready .venv/bin/python; then
        echo '现有 .venv 无法运行 Python 3.10+。请先将 .venv 改名备份，再重试。' >&2
        exit 1
    fi
    bridge_python="$PWD/.venv/bin/python"
fi

# Uninstall only needs the Python standard library; it must work offline.
if [ "$bridge_uninstall" -eq 1 ]; then
    if ! bridge_python_ready "$bridge_python"; then
        echo '卸载需要 Python 3.10+；未修改安装配置。' >&2; exit 1
    fi
    exec "$bridge_python" install_wps.py "${bridge_installer_args[@]}"
fi

bridge_platform="$(uname -s)"
if [ "$bridge_platform" = Linux ] && [ "$bridge_skip_system_deps" -eq 0 ]; then
    if ! command -v apt-get >/dev/null || ! command -v dpkg-query >/dev/null; then
        echo '自动安装系统包需要 Ubuntu / Debian 的 APT。其他发行版请准备依赖后使用 --skip-system-deps。' >&2
        exit 1
    fi
    bridge_required=(texlive-xetex texlive-latex-extra texlive-fonts-recommended texlive-lang-chinese)
    if [ "$bridge_python" = python3 ] && { ! bridge_python_ready python3 || ! python3 -c 'import venv, ensurepip' >/dev/null 2>&1; }; then
        bridge_required+=(python3 python3-venv)
    fi
    bridge_missing=()
    for bridge_package in "${bridge_required[@]}"; do
        if [ "$(dpkg-query -W -f='${Status}' "$bridge_package" 2>/dev/null || true)" != 'install ok installed' ]; then
            bridge_missing+=("$bridge_package")
        fi
    done
    if [ "${#bridge_missing[@]}" -gt 0 ]; then
        if ! command -v sudo >/dev/null; then
            echo '缺少 sudo。请让管理员安装以下包后重试：' >&2
            printf '  %s\n' "${bridge_missing[@]}" >&2
            exit 1
        fi
        echo '将安装缺少的系统包；TeX Live 下载较大，可能需要输入 sudo 密码：'
        printf '  %s\n' "${bridge_missing[@]}"
        sudo apt-get update
        sudo apt-get install -y "${bridge_missing[@]}"
    else
        echo '系统依赖已就绪，跳过 APT。'
    fi
elif [ "$bridge_platform" != Linux ] && [ "$bridge_platform" != Darwin ]; then
    echo '此脚本适用于 Linux / macOS；Windows 请使用 install_wps_windows.bat。' >&2
    exit 1
fi

if ! bridge_python_ready "$bridge_python"; then
    echo '需要 Python 3.10+。请升级 Python 或 Ubuntu 后重试。' >&2; exit 1
fi
if ! command -v xelatex >/dev/null || ! command -v kpsewhich >/dev/null; then
    echo '未找到 XeLaTeX。请安装 TeX Live（macOS 可用 MacTeX）并加入 PATH 后重试。' >&2; exit 1
fi
for bridge_tex_file in ctex.sty standalone.cls; do
    if ! kpsewhich "$bridge_tex_file" >/dev/null; then
        echo "缺少 TeX 文件 ${bridge_tex_file}；请安装中文和 LaTeX 扩展宏包后重试。" >&2; exit 1
    fi
done

if [ "$bridge_python" = python3 ]; then
    echo '创建本机 Python 虚拟环境……'
    python3 -m venv .venv
    bridge_python="$PWD/.venv/bin/python"
fi
if ! "$bridge_python" -m pip --version >/dev/null 2>&1; then
    "$bridge_python" -m ensurepip --upgrade
fi
echo '安装 Python 依赖……'
"$bridge_python" -m pip install -r requirements.txt
if [ "$bridge_with_ocr" -eq 1 ]; then
    "$bridge_python" -m pip install -r requirements-ocr.txt
fi
echo '注册 WPS 插件并配置本地服务……'
# The conditional expansion also supports macOS's older Bash with nounset.
"$bridge_python" install_wps.py ${bridge_installer_args[@]+"${bridge_installer_args[@]}"}
