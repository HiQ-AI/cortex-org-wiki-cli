import { readFileSync, writeFileSync, mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { execFileSync } from "node:child_process";

const { version } = JSON.parse(readFileSync("package.json", "utf8"));
const platforms = ["darwin-arm64", "darwin-x64", "linux-x64", "linux-arm64", "windows-x64"];
const sha256 = Object.fromEntries(platforms.map(platform => [platform,
  createHash("sha256").update(readFileSync(`dist-bin/cortex-org-wiki-${platform}${platform.startsWith("windows") ? ".exe" : ""}`)).digest("hex"),
]));
const source = readFileSync("skills/cortex-org-wiki/SKILL.md", "utf8");
const metadata = `metadata:\n  cli:\n    name: cortex-org-wiki\n    version: '${version}'\n    sha256:\n${platforms.map(p => `      ${p}: ${sha256[p]}`).join("\n")}`;
const marketSkill = source.replace("\n---\n", `\n${metadata}\n---\n`);
const temporary = mkdtempSync(join(tmpdir(), "cortex-org-wiki-market-"));
try {
  mkdirSync(join(temporary, "cortex-org-wiki"));
  writeFileSync(join(temporary, "cortex-org-wiki", "SKILL.md"), marketSkill);
  const zip = resolve("dist-bin/cortex-org-wiki-skill.zip");
  rmSync(zip, { force: true });
  execFileSync("zip", ["-q", zip, "cortex-org-wiki/SKILL.md"], { cwd: temporary });
} finally { rmSync(temporary, { recursive: true, force: true }); }
writeFileSync("dist-bin/cortex-org-wiki-skill.md", marketSkill);
