#!/usr/bin/env sh
# Unified CLI + skill installer. No runtime dependency on Node or npm.
set -eu
die() { printf '%s\n' "$*" >&2; exit 1; }
mode=both
agent=
scope=project
project=
replace=false
install_dir="${CORTEX_ORG_WIKI_INSTALL:-}"
base="${CORTEX_ORG_WIKI_DOWNLOAD_BASE:-https://download.hiq.earth/cli/cortex-org-wiki/latest}"
while [ "$#" -gt 0 ]; do
  case "$1" in
    --agent|--scope|--project|--install-dir|--base-url)
      [ "$#" -ge 2 ] || die "缺少 $1 的值"
      case "$1" in
        --agent) agent=$2 ;; --scope) scope=$2 ;; --project) project=$2 ;;
        --install-dir) install_dir=$2 ;; --base-url) base=$2 ;;
      esac
      shift 2 ;;
    --cli-only) [ "$mode" = both ] || die '不能同时指定 --cli-only 和 --skill-only'; mode=cli; shift ;;
    --skill-only) [ "$mode" = both ] || die '不能同时指定 --cli-only 和 --skill-only'; mode=skill; shift ;;
    --replace-skill) replace=true; shift ;;
    --help|-h) printf '%s\n' 'install.sh --agent codex|claude-code [--scope project|user] [--project DIR]' '  默认安装 CLI + skill；--cli-only 或 --skill-only 可单独安装' '  --install-dir DIR --base-url URL --replace-skill'; exit 0 ;;
    *) die "未知参数: $1" ;;
  esac
done
if [ "$mode" != cli ]; then
  case "$agent" in codex|claude-code) ;; *) die '请明确指定 --agent codex|claude-code（Cortex 市场技能由 Host 安装）' ;; esac
fi
case "$scope" in project|user) ;; *) die 'scope 必须是 project 或 user' ;; esac
[ "$scope" != user ] || [ -z "$project" ] || die '--project 仅用于项目范围'
if [ "$mode" != skill ] && [ -z "$install_dir" ]; then
  [ -n "${HOME:-}" ] || die '缺少 HOME；请指定 --install-dir'
  install_dir="$HOME/.local/bin"
fi
case "$(uname -s)" in Darwin) os=darwin ;; Linux) os=linux ;; *) die '此脚本支持 macOS/Linux；Windows 请用 install.ps1' ;; esac
case "$(uname -m)" in arm64|aarch64) arch=arm64 ;; x86_64|amd64) arch=x64 ;; *) die '不支持的 CPU 架构' ;; esac
archive="cortex-org-wiki-$os-$arch.tar.gz"
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
curl -fsSL "$base/$archive" -o "$tmp/$archive"
curl -fsSL "$base/checksums.txt" -o "$tmp/checksums.txt"
expected=$(awk -v name="$archive" '$2 == name || $2 == "./" name { print $1 }' "$tmp/checksums.txt")
[ -n "$expected" ] || die 'checksum 缺少当前平台产物'
if command -v shasum >/dev/null 2>&1; then actual=$(shasum -a 256 "$tmp/$archive" | cut -d ' ' -f1)
elif command -v sha256sum >/dev/null 2>&1; then actual=$(sha256sum "$tmp/$archive" | cut -d ' ' -f1)
else die '需要 shasum 或 sha256sum 校验下载'; fi
[ "$actual" = "$expected" ] || die 'checksum 不匹配，未安装'
tar xzf "$tmp/$archive" -C "$tmp" cortex-org-wiki
chmod +x "$tmp/cortex-org-wiki"
if [ "$mode" != cli ]; then
  set -- skill setup --agent "$agent" --scope "$scope" --json
  [ -z "$project" ] || set -- "$@" --project "$project"
  [ "$replace" != true ] || set -- "$@" --replace
  "$tmp/cortex-org-wiki" "$@"
fi
if [ "$mode" != skill ]; then
  mkdir -p "$install_dir"
  mv "$tmp/cortex-org-wiki" "$install_dir/cortex-org-wiki"
  printf 'CLI 已安装: %s/cortex-org-wiki\n' "$install_dir"
fi
