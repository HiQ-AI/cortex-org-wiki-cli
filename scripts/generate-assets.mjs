import { readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
const root = new URL("../", import.meta.url);
const skillPath = "skills/cortex-org-wiki/SKILL.md";
const sha256 = content => createHash("sha256").update(content).digest("hex");
const git = (...args) => execFileSync("git", args, { cwd: root, maxBuffer: 16 * 1024 * 1024 });
const { version } = JSON.parse(readFileSync(new URL("package.json", root), "utf8"));
const skill = readFileSync(new URL(skillPath, root), "utf8");
if (!skill.startsWith("---\nname: cortex-org-wiki\n")) throw new Error("Unexpected skill identity");
const digest = sha256(skill);

// Every released skill is the tagged SKILL.md, embedded unchanged by that tag's build. Installs
// carrying one of these digests are ours to upgrade; anything else stays a user decision.
const tags = git("tag", "--list", "v*", "--sort=version:refname").toString().split("\n").filter(Boolean);
if (process.env.GITHUB_REF_TYPE === "tag" && !tags.some(tag => tag !== process.env.GITHUB_REF_NAME)) {
  throw new Error("Release build sees no earlier v* tag; check out with fetch-depth: 0 so previous official skills can be upgraded");
}
const previous = new Set();
for (const tag of tags) {
  const entry = git("ls-tree", tag, "--", skillPath).toString().trim();
  if (!entry) continue;
  const blobDigest = sha256(git("cat-file", "blob", entry.split(/\s+/)[2]));
  if (blobDigest !== digest) previous.add(blobDigest);
}

writeFileSync(new URL("src/version.ts", root), `/** Generated from package.json. */\nexport const VERSION = ${JSON.stringify(version)};\n`);
writeFileSync(new URL("src/skillAsset.ts", root), `/** Generated from ${skillPath} and its released v* tags; do not edit. */\nexport const SKILL = ${JSON.stringify(skill)};\nexport const SKILL_SHA256 = ${JSON.stringify(digest)};\nexport const PREVIOUS_OFFICIAL_SKILL_SHA256: readonly string[] = ${JSON.stringify([...previous])};\n`);
