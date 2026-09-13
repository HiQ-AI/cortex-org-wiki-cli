#!/usr/bin/env node
import yargs from "yargs";
import { formatKnowledge, organizationIdentity, PAGE_TYPES, readKnowledge, type KnowledgeCommand } from "./knowledge.js";
import { runLogin, runLogout } from "./login.js";
import { setupSkills, SKILL_AGENTS, type SkillAgent, type SkillScope } from "./skill.js";
import { CortexClientError, exitCodeFor } from "./types.js";
import { VERSION } from "./version.js";

const cli = yargs(process.argv.slice(2)).scriptName("cortex-org-wiki").usage("$0 <command> [options]")
  .option("json", { type: "boolean", default: false, describe: "机器可读输出" });
function emit(tool: string, data: Record<string, unknown>, human: string, json: boolean): void {
  process.stdout.write(json ? JSON.stringify({ ok: true, tool, data }) + "\n" : human + "\n");
}
async function main(): Promise<void> {
  for (const [command, description] of [
    ["search", "按关键词检索已发布 Wiki 页面（空格分隔多个关键词，全部命中）"], ["browse", "不带关键词，按类型或主题浏览已发布页面，最近发布在前"],
    ["read", "读取页面正文与引用"], ["links", "读取页面关系"], ["sources", "读取材料来源与授权下载入口"],
  ] as [KnowledgeCommand, string][]) {
    const listing = command === "search" || command === "browse";
    cli.command(command === "browse" ? "browse" : `${command} <value>`, description, sub => {
      const base = (command === "browse" ? sub : sub.positional("value", { type: "string", describe: command === "search" ? "查询关键词" : "稳定页面 ID" }))
        .option("org", { type: "string", demandOption: true, describe: "用户或宿主选择的组织 ID" });
      return listing ? base.option("type", { choices: PAGE_TYPES, describe: "页面类型" }).option("tag", { type: "string", describe: "主题标签" })
        .option("after", { type: "string" }).option("limit", { type: "number" })
        : base.option("revision", { type: "string", describe: "指定发布版本；省略时取当前发布版" });
    }, async args => {
      const data = await readKnowledge(command, command === "browse" ? "" : String(args.value), {
        org: args.org, revision: args.revision as string | undefined, type: args.type as string | undefined,
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
    .command("skill", "安装同包标准 skill", sub => sub.command("setup", "只安装到明确选择的宿主；可重复 --agent", setup => setup
      .option("agent", { type: "string", array: true, choices: SKILL_AGENTS, demandOption: true, describe: "目标宿主，可重复指定" })
      .option("scope", { choices: ["project", "user"] as const, default: "project" })
      .option("replace", { type: "boolean", default: false, describe: "明确替换已存在的不同 skill 内容" })
      .option("project", { type: "string", describe: "项目目录；默认当前目录" }), async args => {
      const data = await setupSkills(args.agent as SkillAgent[], args.scope as SkillScope, args.project, args.replace);
      emit("skill setup", data, data.skills.map(skill => `Skill ${skill.status}: ${skill.path}`).join("\n"), args.json);
    }).demandCommand(1))
    .command("version", "打印版本", {}, () => { process.stdout.write(VERSION + "\n"); })
    .demandCommand(1).strict().help().alias("h", "help").version(VERSION)
    .fail((message, error) => { throw error ?? new CortexClientError("validation", message); }).parse();
}
main().catch(error => {
  const kind = error instanceof CortexClientError ? error.kind : "unknown";
  const message = error instanceof Error ? error.message : String(error);
  const json = cli.parsed && cli.parsed.argv.json;
  process.stderr.write(json ? JSON.stringify({ ok: false, kind, message, code: error instanceof CortexClientError ? error.code : undefined }) + "\n" : message + "\n");
  process.exitCode = exitCodeFor(error);
});
