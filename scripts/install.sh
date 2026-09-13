#!/usr/bin/env sh
# Unified CLI + skill installer. No runtime dependency on Node or npm.
# stdout carries exactly one JSON result line; progress and the JSON failure line go to stderr.
set -euf
json() { printf '"%s"' "$(printf '%s' "$1" | sed 's/\\/\\\\/g; s/"/\\"/g')"; }
fail() {
  case "$1" in config) status=2 ;; validation) status=3 ;; upstream) status=4 ;; transport) status=5 ;; *) status=1 ;; esac
  printf '{"ok":false,"kind":"%s","code":"%s","message":%s}\n' "$1" "$2" "$(json "$3")" >&2
  exit "$status"
}
say() { printf '%s\n' "$*" >&2; }
mode=both
agents=
scope=project
project=
replace=false
install_dir="${CORTEX_ORG_WIKI_INSTALL:-}"
base="${CORTEX_ORG_WIKI_DOWNLOAD_BASE:-https://download.hiq.earth/cli/cortex-org-wiki/latest}"
while [ "$#" -gt 0 ]; do
  case "$1" in
    --agent|--scope|--project|--install-dir|--base-url)
      [ "$#" -ge 2 ] || fail validation invalid_argument "缺少 $1 的值"
      case "$1" in
        --agent) agents="${agents:+$agents,}$2" ;; --scope) scope=$2 ;; --project) project=$2 ;;
        --install-dir) install_dir=$2 ;; --base-url) base=$2 ;;
      esac
      shift 2 ;;
    --cli-only) [ "$mode" = both ] || fail validation invalid_argument '不能同时指定 --cli-only 和 --skill-only'; mode=cli; shift ;;
    --skill-only) [ "$mode" = both ] || fail validation invalid_argument '不能同时指定 --cli-only 和 --skill-only'; mode=skill; shift ;;
    --replace-skill) replace=true; shift ;;
    --help|-h) printf '%s\n' 'install.sh --agent codex|claude-code [--agent ...] [--scope project|user] [--project DIR]' '  默认安装 CLI + skill；--agent 可重复或逗号分隔；--cli-only 或 --skill-only 可单独安装' '  --install-dir DIR --base-url URL --replace-skill' '  成功时 stdout 只有一行 JSON 结果，进度与失败 JSON 在 stderr'; exit 0 ;;
    *) fail validation invalid_argument "未知参数: $1" ;;
  esac
done
if [ "$mode" != cli ]; then
  [ -n "$agents" ] || fail validation invalid_argument '请明确指定 --agent codex|claude-code，多个宿主可重复或逗号分隔（Cortex 市场技能由 Host 安装）'
  IFS=,
  for agent in $agents; do
    case "$agent" in codex|claude-code) ;; *) fail validation invalid_argument "不支持的 agent: $agent（可选 codex、claude-code）" ;; esac
  done
  unset IFS
fi
case "$scope" in project|user) ;; *) fail validation invalid_argument 'scope 必须是 project 或 user' ;; esac
[ "$scope" != user ] || [ -z "$project" ] || fail validation invalid_argument '--project 仅用于项目范围'
if [ "$mode" != skill ] && [ -z "$install_dir" ]; then
  [ -n "${HOME:-}" ] || fail config invalid_argument '缺少 HOME；请指定 --install-dir'
  install_dir="$HOME/.local/bin"
fi
case "$(uname -s)" in Darwin) os=darwin ;; Linux) os=linux ;; *) fail config unsupported_platform '此脚本支持 macOS/Linux；Windows 请用 install.ps1' ;; esac
case "$(uname -m)" in arm64|aarch64) arch=arm64 ;; x86_64|amd64) arch=x64 ;; *) fail config unsupported_platform '不支持的 CPU 架构' ;; esac
archive="cortex-org-wiki-$os-$arch.tar.gz"
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
say "下载 $base/$archive"
curl -fsSL "$base/$archive" -o "$tmp/$archive" || fail transport download_failed "下载失败：$base/$archive"
curl -fsSL "$base/checksums.txt" -o "$tmp/checksums.txt" || fail transport download_failed "下载失败：$base/checksums.txt"
expected=$(awk -v name="$archive" '$2 == name || $2 == "./" name { print $1 }' "$tmp/checksums.txt")
[ -n "$expected" ] || fail upstream checksum_missing 'checksum 缺少当前平台产物'
if command -v shasum >/dev/null 2>&1; then actual=$(shasum -a 256 "$tmp/$archive" | cut -d ' ' -f1)
elif command -v sha256sum >/dev/null 2>&1; then actual=$(sha256sum "$tmp/$archive" | cut -d ' ' -f1)
else fail config checksum_tool_missing '需要 shasum 或 sha256sum 校验下载'; fi
[ "$actual" = "$expected" ] || fail upstream checksum_mismatch 'checksum 不匹配，未安装'
tar xzf "$tmp/$archive" -C "$tmp" cortex-org-wiki || fail upstream archive_invalid "无法解压 $archive"
chmod +x "$tmp/cortex-org-wiki"
cli="$tmp/cortex-org-wiki"
cli_json=null
# The CLI goes into place first: a skill that cannot be written must not block the CLI upgrade.
if [ "$mode" != skill ]; then
  mkdir -p "$install_dir" || fail config install_failed "无法创建 CLI 目录：$install_dir"
  target="$(CDPATH= cd -- "$install_dir" && pwd)/cortex-org-wiki"
  previous=null
  if [ -x "$target" ] && current=$("$target" version 2>/dev/null); then previous=$(json "$current"); fi
  mv "$tmp/cortex-org-wiki" "$target" || fail config install_failed "无法写入 CLI：$target"
  version=$("$target" version) || fail unknown cli_unusable "已安装的 CLI 无法运行：$target"
  say "CLI 已安装: $target ($version)"
  cli_json="{\"path\":$(json "$target"),\"version\":$(json "$version"),\"previous_version\":$previous}"
  cli=$target
fi
skills='"skills":[]'
if [ "$mode" != cli ]; then
  set -- skill setup --scope "$scope" --json
  IFS=,
  for agent in $agents; do set -- "$@" --agent "$agent"; done
  unset IFS
  [ -z "$project" ] || set -- "$@" --project "$project"
  [ "$replace" != true ] || set -- "$@" --replace
  say "安装 skill: $agents ($scope)"
  status=0
  result=$("$cli" "$@" 2>"$tmp/skill-error") || status=$?
  if [ "$status" -ne 0 ]; then
    # The CLI already printed a JSON failure; only its flag name differs for installer users.
    sed 's/ --replace / --replace-skill /' "$tmp/skill-error" >&2
    exit "$status"
  fi
  case "$result" in
    '{"ok":true,"tool":"skill setup","data":{"skills":['*']}}') ;;
    *) fail unknown unexpected_output 'skill setup 输出无法识别；请确认下载的 CLI 与安装脚本来自同一版本' ;;
  esac
  skills=${result#'{"ok":true,"tool":"skill setup","data":{'}
  skills=${skills%'}}'}
fi
printf '{"ok":true,"tool":"install","data":{"cli":%s,%s}}\n' "$cli_json" "$skills"
