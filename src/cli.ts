#!/usr/bin/env node
import yargs from "yargs";
import { formatKnowledge, organizationIdentity, readKnowledge, type KnowledgeCommand } from "./knowledge.js";
import { runLogin, runLogout } from "./login.js";
import { setupSkill, type SkillAgent, type SkillScope } from "./skill.js";
import { CortexClientError, exitCodeFor } from "./types.js";
import { VERSION } from "./version.js";

const raw = process.argv.slice(2);
function emit(tool: string, data: Record<string, unknown>, human: string, json: boolean): void {
  process.stdout.write(json ? JSON.stringify({ ok: true, tool, data }) + "\n" : human + "\n");
}
async function main(): Promise<void> {
  let cli = yargs(raw).scriptName("cortex-org-wiki").usage("$0 <command> [options]")
    .option("json", { type: "boolean", default: false, describe: "机器可读输出" });
  for (const [command, description] of [
    ["search", "检索已发布 Wiki 页面"], ["read", "读取页面正文与引用"],
    ["links", "读取页面关系"], ["sources", "读取材料来源与授权下载入口"],
  ] as [KnowledgeCommand, string][]) {
    cli = cli.command(`${command} <value>`, description, sub => {
      const base = sub.positional("value", { type: "string", describe: command === "search" ? "查询主题" : "稳定页面 ID" })
        .option("org", { type: "string", demandOption: true, describe: "用户或宿主选择的组织 ID" });
      return command === "search" ? base.option("tag", { type: "string" }).option("after", { type: "string" }).option("limit", { type: "number" })
        : base.option("revision", { type: "string", describe: "指定发布版本；省略时取当前发布版" });
    }, async args => {
      const data = await readKnowledge(command, String(args.value), {
        org: args.org, revision: args.revision as string | undefined,
        tag: args.tag as string | undefined, after: args.after as string | undefined, limit: args.limit as number | undefined,
      });
      emit(command, data, formatKnowledge(command, data), args.json);
    });
  }
  await cli.command("doctor", "核实当前账号及所选组织", sub => sub.option("org", { type: "string", demandOption: true }), async args => {
    const data = await organizationIdentity({ org: args.org });
    emit("doctor", data, `账号: ${data.user_id}\n组织: ${data.organization_id}\n组织管理员: ${data.is_organization_admin ? "是" : "否"}`, args.json);
  }).command("login", "打开授权链接登录；CLI 自动等待授权", {}, args => runLogin(Boolean(args.json)))
    .command("logout", "退出本机 CLI 登录", {}, args => runLogout(Boolean(args.json)))
    .command("skill", "安装同包标准 skill", sub => sub.command("setup", "只安装到明确选择的宿主", setup => setup
      .option("agent", { choices: ["codex", "claude-code"] as const, demandOption: true })
      .option("scope", { choices: ["project", "user"] as const, default: "project" })
      .option("replace", { type: "boolean", default: false, describe: "明确替换已存在的不同 skill 内容" })
      .option("project", { type: "string", describe: "项目目录；默认当前目录" }), async args => {
      const data = await setupSkill(args.agent as SkillAgent, args.scope as SkillScope, args.project, args.replace);
      emit("skill setup", data, `Skill ${data.status}: ${data.path}`, args.json);
    }).demandCommand(1))
    .command("version", "打印版本", {}, () => { process.stdout.write(VERSION + "\n"); })
    .demandCommand(1).strict().help().alias("h", "help").version(VERSION)
    .fail((message, error) => { throw error ?? new CortexClientError("validation", message); }).parse();
}
main().catch(error => {
  const kind = error instanceof CortexClientError ? error.kind : "unknown";
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(raw.includes("--json") ? JSON.stringify({ ok: false, kind, message, code: error instanceof CortexClientError ? error.code : undefined }) + "\n" : message + "\n");
  process.exitCode = exitCodeFor(error);
});
