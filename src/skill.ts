import { lstat, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { SKILL, SKILL_SHA256 } from "./skillAsset.js";
import { VERSION } from "./version.js";
import { CortexClientError } from "./types.js";

export type SkillAgent = "codex" | "claude-code";
export type SkillScope = "project" | "user";

export async function setupSkill(agent: SkillAgent, scope: SkillScope, project?: string, replace = false): Promise<Record<string, unknown>> {
  if (!["codex", "claude-code"].includes(agent) || !["project", "user"].includes(scope)) throw new CortexClientError("validation", "请指定受支持的 --agent codex|claude-code 和 --scope project|user");
  if (scope === "user" && project !== undefined) throw new CortexClientError("validation", "--project 仅用于项目范围");
  const root = scope === "user" ? homedir() : resolve(project ?? process.cwd());
  const directory = join(root, agent === "codex" ? ".agents" : ".claude", "skills", "cortex-org-wiki");
  const path = join(directory, "SKILL.md");
  for (const candidate of [directory, path]) {
    const info = await lstat(candidate).catch((error: NodeJS.ErrnoException) => { if (error.code !== "ENOENT") throw error; });
    if (info?.isSymbolicLink()) throw new CortexClientError("config", `安装目标是符号链接，请使用宿主的安装方式管理：${candidate}`);
  }
  let current: string | undefined;
  try { current = await readFile(path, "utf8"); } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
  if (current === SKILL) return { agent, scope, path, version: VERSION, sha256: SKILL_SHA256, status: "unchanged" };
  if (current !== undefined && !replace) {
    throw new CortexClientError("config", `已有不同内容的 skill，未覆盖：${path}；确认替换后使用 --replace。`, "skill_conflict");
  }
  await mkdir(directory, { recursive: true });
  const temporary = `${path}.${process.pid}.tmp`;
  try {
    await writeFile(temporary, SKILL, { flag: "wx" });
    await rename(temporary, path);
  } finally { await rm(temporary, { force: true }); }
  return { agent, scope, path, version: VERSION, sha256: SKILL_SHA256, status: current === undefined ? "installed" : "updated" };
}
