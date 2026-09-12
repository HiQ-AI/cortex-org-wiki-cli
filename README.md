# Cortex 组织 Wiki CLI

独立的组织知识 CLI 与标准 skill：检索当前组织已发布的 Wiki、读取页面版本和关系、追溯材料出处。命令是 `cortex-org-wiki`，npm 包是 `@hiq-ai/cortex-org-wiki-cli`。不包含 LCA 查询或 MCP server。

把这段话交给 Agent：

> 请根据 https://download.hiq.earth/cli/cortex-org-wiki/agent-setup.md 安装 Cortex 组织 Wiki CLI 和 skill。组织 ID：`<organization-id>`。需要登录时把授权链接发给我，授权后继续查询：`<你的问题>`。

## 一个安装入口

macOS / Linux：

```sh
curl -fsSL https://download.hiq.earth/cli/cortex-org-wiki/install.sh | sh -s -- --agent codex
```

Windows PowerShell：

```powershell
& ([scriptblock]::Create((irm https://download.hiq.earth/cli/cortex-org-wiki/install.ps1))) -Agent codex
```

默认安装 CLI 和当前项目的 `cortex-org-wiki` skill。Claude Code 改用 `claude-code`。支持 `--scope user` / `-Scope user`；`--cli-only` / `-CliOnly`、`--skill-only` / `-SkillOnly` 可分别安装。完整参数见 [Agent 指南](docs/agent-setup.md)。无需 Node；技能正文嵌在同版本二进制内。

已有 Node 的宿主也可以直接 `npx @hiq-ai/cortex-org-wiki-cli --version`（npm 自 0.1.1 起可用）；默认仍推荐上面的原生安装入口。Cortex Cowork 的市场安装由 Host 供给同源 skill 与 CLI；以该会话的实际 CLI 和身份检查结果确认是否接通。

## 查询与身份

```sh
cortex-org-wiki login --json
cortex-org-wiki doctor --org '<organization-id>' --json
cortex-org-wiki search '接口约定' --org '<organization-id>' --json
cortex-org-wiki read '<nodeid>' --revision '<revision>' --org '<organization-id>' --json
cortex-org-wiki links '<nodeid>' --revision '<revision>' --org '<organization-id>' --json
cortex-org-wiki sources '<nodeid>' --revision '<revision>' --org '<organization-id>' --json
```

登录使用现有 Cortex SSO device flow。授权链接写入 stderr，CLI 自动等待；成功 JSON 写入 stdout。当前 `cortex_data` consent 取得现有 SSO 登录态，不是技术上仅限 Wiki 的 token。服务端对每次读取核验当前组织成员权限。

独立登录存于 `~/.config/cortex-org-wiki/credentials.json`；绝对路径 `XDG_CONFIG_HOME` 可选择独立存储。Host 仅使用 `CORTEX_ORG_WIKI_TOKEN` 注入 Bearer 身份：变量存在时完全不读本机登录，空值、过期或权限拒绝都不回退。组织身份不接受 API key，也不读取其他 HiQ CLI 的凭据。`CORTEX_ORG_WIKI_BASE` 可覆盖默认 API `https://x.hiqlcd.com`。

成功输出为 `{ "ok": true, "tool": "search", "data": ... }`。搜索返回真实页面 ID、revision、摘要与引用；使用返回的 revision 读取同一发布版本。出站关系属于该版本，入站关系是当前图谱。sources 的下载 URL 仍需认证，CLI 不自动下载或执行材料。

错误 JSON 写入 stderr。退出码：`0` 成功，`2` 身份/配置，`3` 输入错误，`4` 上游拒绝或响应错误，`5` 网络，`1` 意外错误。帮助、版本及 skill 安装均不访问账号或远程工具目录。

## 构建与发布

```sh
npm ci
npm test
npm run build:bin
CORTEX_ORG_WIKI_TEST_BINARY=/absolute/path/to/cortex-org-wiki npm run test:bin
```

`package.json` 是版本源，`skills/cortex-org-wiki/SKILL.md` 是技能正文源；构建生成版本和内嵌技能。发布构建生成五平台裸二进制与归档；签名后的 SHA-256 注入市场 skill 的 `metadata.cli`，再生成 ZIP，避免构建哈希循环。

GitHub native、npm 与 CDN 分别报告发布状态，权限配置见 [发布说明](docs/release.md)。本地测试不代表 CDN、市场或真实组织已验收。

Apache-2.0。Wiki HTTP 客户端及错误契约源自 [HiQ Cortex CLI](https://github.com/HiQ-AI/hiq-cortex-cli)，在本仓独立维护。
