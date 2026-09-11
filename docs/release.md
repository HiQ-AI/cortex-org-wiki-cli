# 发布入口与验收

初版包 `@hiq-ai/cortex-org-wiki-cli@0.1.0`；命令/skill `cortex-org-wiki`。版本只修改 `package.json`，构建生成版本常量和内嵌技能。

`v<version>` tag 运行 release workflow。测试后生成 npm tarball 与五平台 native 产物；npm 发布和 GitHub native release 是独立 job，CDN 只依赖 GitHub release。npm 权限未就绪时应真实失败，不阻断 native 渠道，也不报告全渠道完成。

发布前需要仓库管理员完成：

- npm 包首次创建及 Trusted Publisher：organization `HiQ-AI`、repository `cortex-org-wiki-cli`、workflow `release.yml`。使用 npm OIDC/provenance，不保存 npm token。
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

## v0.1.0 发布记录

[正式发布](https://github.com/HiQ-AI/cortex-org-wiki-cli/releases/tag/v0.1.0)绑定提交 `daef8b4688821591d92f1ce33f64e1a4456dc1b7`。[发布任务 34629818792](https://github.com/HiQ-AI/cortex-org-wiki-cli/actions/runs/34629818792)中，GitHub Release、使用真实 tag OIDC 的 CDN 同步，以及 macOS、Linux x64/arm64、Windows 四个 runner 的正式 CDN 安装与 native fixture 验证均已通过。AWS 实际 trust 已同步为仓内配置。

npm job 在读取本地 tarball 时将 `npm-package/<包名>.tgz` 解析为 GitHub shorthand，尚未进入发布认证。workflow 改用 `./npm-package/<包名>.tgz`；对正式 Release 中同一 tarball 的隔离 dry-run 已验证旧路径失败、新路径成功。包 SHA-256：`9ca15bbd2b663118dcee71743f5dd29599f43cf3e38f86e1776bf60b4928d54c`。npm 首次发布及 Trusted Publisher 仍待完成；dry-run 不代表已发布。

真实组织查询及 Cowork Host 身份集成仍由 Cortex 组织知识库验收记录跟踪，本仓安装 fixture 不替代该验收。
