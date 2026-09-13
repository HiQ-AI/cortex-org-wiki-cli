import { createHash } from "node:crypto";
import { lstat, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { PREVIOUS_OFFICIAL_SKILL_SHA256, SKILL, SKILL_SHA256 } from "./skillAsset.js";
import { VERSION } from "./version.js";
import { CortexClientError } from "./types.js";

export const SKILL_AGENTS = ["codex", "claude-code"] as const;
export type SkillAgent = typeof SKILL_AGENTS[number];
export type SkillScope = "project" | "user";

/** Installs the embedded skill for each selected host; any unknown existing content refuses the whole set before writing. */
export async function setupSkills(agents: SkillAgent[], scope: SkillScope, project?: string, replace = false): Promise<{ skills: Record<string, unknown>[] }> {
  if (agents.length === 0 || agents.some(agent => !SKILL_AGENTS.includes(agent)) || !["project", "user"].includes(scope)) throw new CortexClientError("validation", "请指定受支持的 --agent codex|claude-code 和 --scope project|user");
  if (scope === "user" && project !== undefined) throw new CortexClientError("validation", "--project 仅用于项目范围");
  const root = scope === "user" ? homedir() : resolve(project ?? process.cwd());
  const targets = [];
  for (const agent of new Set(agents)) {
    const directory = join(root, agent === "codex" ? ".agents" : ".claude", "skills", "cortex-org-wiki");
    const path = join(directory, "SKILL.md");
    for (const candidate of [directory, path]) {
      const info = await lstat(candidate).catch((error: NodeJS.ErrnoException) => { if (error.code !== "ENOENT") throw error; });
      if (info?.isSymbolicLink()) throw new CortexClientError("config", `安装目标是符号链接，请使用宿主的安装方式管理：${candidate}`, "skill_target_symlink");
    }
    let current: Buffer | undefined;
    try { current = await readFile(path); } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
    const digest = current && createHash("sha256").update(current).digest("hex");
    const status = current === undefined ? "installed" : digest === SKILL_SHA256 ? "unchanged"
      : replace || PREVIOUS_OFFICIAL_SKILL_SHA256.includes(digest!) ? "updated" : "conflict";
    targets.push({ agent, directory, path, status });
  }
  const conflicts = targets.filter(target => target.status === "conflict").map(target => target.path);
  if (conflicts.length > 0) {
    throw new CortexClientError("config", `已有与本版本不同且不在以往正式发布版本中的 skill 内容（本地修改、较新版本或来源不明），全部未写入：${conflicts.join("、")}；确认替换后使用 --replace 重新运行。`, "skill_conflict");
  }
  for (const { directory, path, status } of targets) {
    if (status === "unchanged") continue;
    await mkdir(directory, { recursive: true });
    const temporary = `${path}.${process.pid}.tmp`;
    try {
      await writeFile(temporary, SKILL, { flag: "wx" });
      await rename(temporary, path);
    } finally { await rm(temporary, { force: true }); }
  }
  return { skills: targets.map(({ agent, path, status }) => ({ agent, scope, path, version: VERSION, sha256: SKILL_SHA256, status })) };
}
