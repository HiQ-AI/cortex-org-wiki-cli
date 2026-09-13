# 发布入口与验收

初版包 `@hiq-ai/cortex-org-wiki-cli@0.1.0`；命令/skill `cortex-org-wiki`。版本只修改 `package.json`，构建生成版本常量和内嵌技能。

`v<version>` tag 运行 release workflow。测试后生成 npm tarball 与五平台 native 产物；npm 发布和 GitHub native release 是独立 job，CDN 只依赖 GitHub release。npm 权限未就绪时应真实失败，不阻断 native 渠道，也不报告全渠道完成。

发布前需要仓库管理员完成：

- npm 包首次创建及 Trusted Publisher：organization `HiQ-AI`、repository `cortex-org-wiki-cli`、workflow `release.yml`。使用 npm OIDC/provenance，不保存 npm token。（2026-09-12 已配置，自 v0.1.2 起由 CI 自动发布。）
- GitHub Actions 对本仓的 Release 写权限。
- `DOWNLOAD_AWS_ROLE_ARN`、`DOWNLOAD_S3_BUCKET`、`DOWNLOAD_CF_DIST_ID` 三个 repository variables。AWS OIDC trust 使用本仓原生 immutable subject（组织 ID `160565119`、仓库 ID `1366482576`），只允许 `refs/tags/v*`，角色只写 S3 `cli/cortex-org-wiki/*` 并对指定 CloudFront distribution 建立 invalidation，不复用其他仓库长效 key。

配套角色配置保存在 `infra/aws/trust.json` 和 `infra/aws/policy.json`。按 [GitHub immutable subject 文档](https://docs.github.com/en/actions/reference/security/oidc#immutable-subject-claims)配置；本仓 `actions/oidc/customization/sub` 接口已核实返回 `use_immutable_subject: true` 和对应 `sub_claim_prefix`。

| 内容 | 路径/命名 |
|---|---|
| CLI 归档 | `cortex-org-wiki-<platform>.tar.gz`；Windows 为 `.zip` |
| 裸二进制 | `cortex-org-wiki-<platform>`；Windows 附 `.exe` |
| 市场 skill | `cortex-org-wiki-skill.zip`，内部 `cortex-org-wiki/SKILL.md` |
| 校验 | `checksums.txt` 覆盖签名后二进制、归档、skill 和 guide |
| 稳定 CDN | `/cli/cortex-org-wiki/install.sh`、`install.ps1`、`agent-setup.md` |
| 最新/版本归档 | `/cli/cortex-org-wiki/latest/<asset>`、`releases/v<version>/<asset>` |
| Desktop cliProvisioner | `/cli/cortex-org-wiki/v<version>/cortex-org-wiki-<platform>[.exe]` |

五平台为 darwin-arm64、darwin-x64、linux-x64、linux-arm64、windows-x64。构建为市场 skill 装入 `metadata.cli: {name, version, sha256: {<platform>: <raw-binary-sha256>}}`。技能正文不写二进制 hash，避免嵌入内容与 hash 自引用。版本来自 package，正文来自唯一源文件。

发布后分别验证正式 CDN 安装、目标宿主发现、原生版本/哈希、Host 身份优先级与真实组织查询。`verify-install` 用隔离项目且不登录。CI fixture、渠道可访问与真实知识验收分别记录。

## v0.1.4 发布记录

[PR #10](https://github.com/HiQ-AI/cortex-org-wiki-cli/pull/10) 修正 skill、Agent 指南与 README 中的最低版本说明：`browse` 与 `search --type` 需要 0.1.3 及以上，旧版本会以退出码 3 拒绝；skill 正文随二进制内嵌，因此发 0.1.4。无代码行为变化。[正式发布](https://github.com/HiQ-AI/cortex-org-wiki-cli/releases/tag/v0.1.4)绑定 main 提交 `35aac9b6e16492998fb0634bed5e357be14ed58c`。

[发布任务 34741681817](https://github.com/HiQ-AI/cortex-org-wiki-cli/actions/runs/34741681817)全部 job 成功；npm 经 Trusted Publishing 发布并带 provenance，shasum `5d1c5cd515d717b7f8f02736751efe80da63d5ad`，`latest` 指向 0.1.4；干净环境安装后 `--version` 输出 0.1.4，`npm audit signatures` 通过；CDN 指南已更新为新的最低版本说明。

## v0.1.3 发布记录

[PR #8](https://github.com/HiQ-AI/cortex-org-wiki-cli/pull/8) 新增 `browse`（不带关键词，`--type` / `--tag` 浏览，服务端 `order=recent`）与 `search --type`，并在帮助、README、Agent 指南与 skill 中说明多关键词全部命中、标题别名优先；[正式发布](https://github.com/HiQ-AI/cortex-org-wiki-cli/releases/tag/v0.1.3)绑定 main 提交 `7b38dbefaeba1eb3de099908b2cfed3ffe417bec`。服务端能力随 Cortex `nomad-v0.0.333`（#1326）与 `deck-v0.7.259`（#1327）先行上线。

[发布任务 34739552431](https://github.com/HiQ-AI/cortex-org-wiki-cli/actions/runs/34739552431)全部 job 成功：package、五平台 native、npm（Trusted Publishing，带 provenance，`latest` 指向 0.1.3，shasum `5e5e6f2baa31b01638dc314d52b1461aa306e8a3`）、GitHub Release、CDN 同步，以及四个 runner 从稳定 CDN 安装后实际运行。干净环境 `npm install` 后 `--version` 输出 0.1.3，`browse --help` 列出 `--type` 八种页面类型与 `--tag`，`npm audit signatures` 通过；CDN `agent-setup.md` 已含 `cortex-org-wiki browse`。未用 CLI 对生产组织实际执行 `browse`；同一查询语义已由 Desktop 经 Deck 调用生产接口验证（类型筛选、最近发布排序、多关键词、按 ID 读取）。

## v0.1.2 发布记录

[PR #5](https://github.com/HiQ-AI/cortex-org-wiki-cli/pull/5) 更新 README 与 Agent 指南的 npm 说明，[PR #6](https://github.com/HiQ-AI/cortex-org-wiki-cli/pull/6) 只 bump 版本，无代码改动；[正式发布](https://github.com/HiQ-AI/cortex-org-wiki-cli/releases/tag/v0.1.2)绑定 main 提交 `22e20bb0f36193f325cfc307bb654e2f3bf4c65e`。目的是验证刚配置的 npm Trusted Publisher，并把新指南推上 CDN。

[发布任务 34719606929](https://github.com/HiQ-AI/cortex-org-wiki-cli/actions/runs/34719606929)全部 job 成功。[npm job](https://github.com/HiQ-AI/cortex-org-wiki-cli/actions/runs/34719606929/job/103622987870)通过 OIDC 自动发布 `@hiq-ai/cortex-org-wiki-cli@0.1.2`（shasum `fe7cbfc39bf80837077d67d50e6438406b726246`），provenance 写入 Sigstore 透明日志 `logIndex=2811424417`，registry `dist.attestations` 为 SLSA provenance v1，`latest` 指向 0.1.2；干净环境 `npm install` 后 `--version` 输出 0.1.2，`npm audit signatures` 验证签名与 attestation 通过。GitHub Release 与 CDN 同步成功，CDN `agent-setup.md` 已含 npx 说明；macOS ARM64、Linux x64、Linux ARM64、Windows x64 四个 runner 从稳定 CDN 安装 0.1.2 并实际运行通过。

## v0.1.1 发布记录

[PR #3](https://github.com/HiQ-AI/cortex-org-wiki-cli/pull/3) 经 Linux/Windows CI 和独立审查后合并；[正式发布](https://github.com/HiQ-AI/cortex-org-wiki-cli/releases/tag/v0.1.1)绑定 main 提交 `dc22fc29feb6bc915dca0d25d19b574645e83b61`。旧 `v0.1.0` tag 和发布资产未改动。

错误输出使用 yargs 已解析的 `json` 布尔值，使 `--json=true`、显式 false、`--no-json` 及覆盖顺序在成功、参数验证失败和 handler 失败时一致。README 与唯一 Agent 指南撤下不可用的 npm 安装承诺，继续推荐正式原生安装入口。

[发布任务 34650778157](https://github.com/HiQ-AI/cortex-org-wiki-cli/actions/runs/34650778157)的 package、五平台 native 构建、GitHub Release、CDN 同步均成功。四个 runner 分别从稳定 CDN 安装 0.1.1 并实际运行原生程序，各 6 项通过，涵盖读取/Host 身份、原生登录 fixture、JSON 错误格式、Codex/Claude Code 安装和下载校验。macOS x64 仅有交叉构建及正式二进制摘要核对，不声称完成该架构的实机运行。

| 正式安装 runner | 结果 |
|---|---|
| [macOS ARM64](https://github.com/HiQ-AI/cortex-org-wiki-cli/actions/runs/34650778157/job/103432923659) | 0.1.1，6/6 |
| [Linux x64](https://github.com/HiQ-AI/cortex-org-wiki-cli/actions/runs/34650778157/job/103432923683) | 0.1.1，6/6 |
| [Linux ARM64](https://github.com/HiQ-AI/cortex-org-wiki-cli/actions/runs/34650778157/job/103432923765) | 0.1.1，6/6 |
| [Windows x64](https://github.com/HiQ-AI/cortex-org-wiki-cli/actions/runs/34650778157/job/103432923646) | 0.1.1，6/6 |

[npm job](https://github.com/HiQ-AI/cortex-org-wiki-cli/actions/runs/34650778157/job/103432285053)已正确读取 tarball，但 registry PUT 返回 `E404`（包不存在或无发布权限），所以整个 workflow 为 failure。2026-09-12 由仓库管理员在本机用 npm 账号登录后发布了该 Release 附带的同一 tarball（`npm publish --access public`），registry 上 `@hiq-ai/cortex-org-wiki-cli@0.1.1` 的 shasum `be49f5a578721854fe5141135dd2d786dcb01899` 与 GitHub Release 附件一致；干净环境 `npm exec --package=@hiq-ai/cortex-org-wiki-cli@0.1.1 -- cortex-org-wiki --version` 输出 `0.1.1`。首版没有 provenance；后续 tag 要由 CI 自动发布，仍需在 npmjs.com 该包的 Publishing access 里添加 Trusted Publisher（见上）。

独立回查五个正式 `/v0.1.1/` 裸二进制的全部字节，SHA-256 均与 GitHub `checksums.txt` 相符。CDN 版本目录和 latest 的 checksums、技能 MD/ZIP、指南与 GitHub 相同，稳定安装器和指南与 tag 源码相同；ZIP 内 SKILL 与独立 MD 逐字一致。市场同步必须采用这份发布件，不能使用本机构建摘要。

| 发布资产 | SHA-256 |
|---|---|
| `cortex-org-wiki-darwin-arm64` | `802e5c0d6f2f1862eb1acded5d1693d639ec3169992ba2716fb6b266c66f72af` |
| `cortex-org-wiki-darwin-x64` | `d039bb4bc66470cc8ada592e1c59a01fe2761986961ba818b3cb9157fe246fbb` |
| `cortex-org-wiki-linux-x64` | `8af505058ed3bff68302c04fba3d42aa7095201a561a127f272e2f5863014758` |
| `cortex-org-wiki-linux-arm64` | `332dd7cfcdc67f937e40690d336c71b6d8a2477b3db1dee94f12cb0e3fc94638` |
| `cortex-org-wiki-windows-x64.exe` | `fa2fb80d38064a4be93b3a867fce6882c78d5d182ab6cb137688e7600f274b66` |
| `cortex-org-wiki-skill.md` | `462a94b470244d23422752e74ca5a5134d077dd8ba3b56991a1c1450819adf6b` |
| `cortex-org-wiki-skill.zip` | `7091829a4bb9616178c9af5a4070dd57fc8833bca41d885f9be541c0aadf5c98` |
| `agent-setup.md` | `47fefde952a0ed663a345d0a6c1fb0314de223347864b9872e378b8dd48028b3` |
| `hiq-ai-cortex-org-wiki-cli-0.1.1.tgz` | `26e4cf456f9e5b793d685ff741953082221458a16ad0cbcdafc70dc280e663a3` |

本地完整测试 11 项、macOS ARM64 native 6 项通过；将错误分支恢复为旧 `includes("--json")` 后，新增布尔矩阵因参数错误输出不是 JSON 而失败，恢复修复后通过。上述自动化仅使用隔离 fixture。主会话另从正式稳定安装器安装 0.1.1（macOS ARM64 SHA 与上表一致），复用本轮已授权的独立 CLI 登录，真实生产 `search` 返回一页，`read` 返回组织页 revision `51860f7d-e799-4f00-a8fc-bb1611f4af00`；`--json=true` 参数错误输出 JSON、`--json false` 输出纯文本均通过。去敏回执 `/tmp/cortex-org-wiki-v011-live/proof.json`。这项只读验证不替代 Nora 自动维护质量或 Cowork 模型调用验收。去敏发布回执：`/tmp/cortex-org-wiki-v011-release/{assets,run,job-markers}.json`。

## v0.1.0 发布记录

[正式发布](https://github.com/HiQ-AI/cortex-org-wiki-cli/releases/tag/v0.1.0)绑定提交 `daef8b4688821591d92f1ce33f64e1a4456dc1b7`。[发布任务 34629818792](https://github.com/HiQ-AI/cortex-org-wiki-cli/actions/runs/34629818792)中，GitHub Release、使用真实 tag OIDC 的 CDN 同步，以及 macOS、Linux x64/arm64、Windows 四个 runner 的正式 CDN 安装与 native fixture 验证均已通过。AWS 实际 trust 已同步为仓内配置。

npm job 在读取本地 tarball 时将 `npm-package/<包名>.tgz` 解析为 GitHub shorthand，尚未进入发布认证。workflow 改用 `./npm-package/<包名>.tgz`；对正式 Release 中同一 tarball 的隔离 dry-run 已验证旧路径失败、新路径成功。包 SHA-256：`9ca15bbd2b663118dcee71743f5dd29599f43cf3e38f86e1776bf60b4928d54c`。npm 首次发布及 Trusted Publisher 仍待完成；dry-run 不代表已发布。

真实组织查询及 Cowork Host 身份集成仍由 Cortex 组织知识库验收记录跟踪，本仓安装 fixture 不替代该验收。
