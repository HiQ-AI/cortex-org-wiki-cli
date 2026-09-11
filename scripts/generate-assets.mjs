import { readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
const root = new URL("../", import.meta.url);
const { version } = JSON.parse(readFileSync(new URL("package.json", root), "utf8"));
const skill = readFileSync(new URL("skills/cortex-org-wiki/SKILL.md", root), "utf8");
if (!skill.startsWith("---\nname: cortex-org-wiki\n")) throw new Error("Unexpected skill identity");
writeFileSync(new URL("src/version.ts", root), `/** Generated from package.json. */\nexport const VERSION = ${JSON.stringify(version)};\n`);
writeFileSync(new URL("src/skillAsset.ts", root), `/** Generated from skills/cortex-org-wiki/SKILL.md; do not edit. */\nexport const SKILL = ${JSON.stringify(skill)};\nexport const SKILL_SHA256 = ${JSON.stringify(createHash("sha256").update(skill).digest("hex"))};\n`);
