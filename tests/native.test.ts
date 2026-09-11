import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFile, mkdtemp, mkdir, readFile, rm, writeFile, access } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { test } from "node:test";
import { createFixture, page, revision } from "./fixture.js";

const exec = promisify(execFile);
const binary = process.env.CORTEX_ORG_WIKI_TEST_BINARY;
const repo = fileURLToPath(new URL("..", import.meta.url));
test("native binary and unified installer in isolated projects", { skip: !binary, timeout: 120_000 }, async t => {
  const root = await mkdtemp(join(tmpdir(), "wiki-native-"));
  const fixture = await createFixture();
  t.after(async () => { await fixture.close(); await rm(root, { recursive: true, force: true }); });
  const config = join(root, "config");
  const store = join(config, "cortex-org-wiki");
  await mkdir(store, { recursive: true });
  await writeFile(join(store, "credentials.json"), '{"token":"fixture-login-token"}');
  const env = { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot, TEMP: root, TMP: root, XDG_CONFIG_HOME: config, CORTEX_ORG_WIKI_BASE: fixture.base, CORTEX_ORG_WIKI_TOKEN: "fixture-host-token" };
  async function run(file: string, args: string[], overrides: Record<string, string> = {}) {
    try { return { code: 0, ...await exec(file, args, { env: { ...env, ...overrides }, timeout: 25_000 }) }; }
    catch (error) {
      const result = error as Error & { code: number; stdout: string; stderr: string };
      if (typeof result.code !== "number") throw error;
      return { code: result.code, stdout: result.stdout, stderr: result.stderr };
    }
  }
  await t.test("native help, four reads and Host identity failure preserve boundaries", async () => {
    assert.equal((await run(binary!, ["--version"])).code, 0);
    const doctor = await run(binary!, ["doctor", "--org", "org-甲", "--json"]);
    assert.equal(JSON.parse(doctor.stdout).data.user_id, "host-user", doctor.stderr);
    for (const command of ["search", "read", "links", "sources"]) {
      const args = command === "search" ? [command, "接口"] : [command, page.nodeid, "--revision", revision];
      assert.equal((await run(binary!, [...args, "--org", "org-甲", "--json"])).code, 0);
    }
    for (const token of ["", "expired-token"]) assert.equal((await run(binary!, ["doctor", "--org", "org-甲", "--json"], { CORTEX_ORG_WIKI_TOKEN: token })).code, 2);
    if (process.platform !== "win32") {
      await rm(join(store, "credentials.json"));
      await exec("mkfifo", [join(store, "credentials.json")]);
      // A stored-credential read would block on this FIFO and fail the timeout.
      assert.equal((await run(binary!, ["doctor", "--org", "org-甲", "--json"])).code, 0);
      assert.equal((await run(binary!, ["doctor", "--org", "org-甲", "--json"], { CORTEX_ORG_WIKI_TOKEN: "" })).code, 2);
      await rm(join(store, "credentials.json"));
    }
  });
  const windows = process.platform === "win32";
  const platform = `${process.platform === "darwin" ? "darwin" : windows ? "windows" : "linux"}-${process.arch === "arm64" ? "arm64" : "x64"}`;
  const commandName = `cortex-org-wiki${windows ? ".exe" : ""}`;
  const stage = join(root, "stage"); await mkdir(stage);
  await copyFile(binary!, join(stage, commandName));
  const archiveName = `cortex-org-wiki-${platform}.${windows ? "zip" : "tar.gz"}`;
  const archivePath = join(root, archiveName);
  if (windows) {
    const quote = (value: string) => `'${value.replaceAll("'", "''")}'`;
    await exec("pwsh", ["-NoProfile", "-Command", `Compress-Archive -LiteralPath ${quote(join(stage, commandName))} -DestinationPath ${quote(archivePath)}`]);
  } else await exec("tar", ["czf", archivePath, "-C", stage, commandName]);
  const archive = await readFile(archivePath);
  let corruptChecksum = false;
  const downloads = createServer((req, res) => {
    if (req.url === `/${archiveName}`) res.end(archive);
    else if (req.url === "/checksums.txt") res.end(`${corruptChecksum ? "0".repeat(64) : createHash("sha256").update(archive).digest("hex")}  ./${archiveName}\n`);
    else res.writeHead(404).end();
  });
  await new Promise<void>(done => downloads.listen(0, "127.0.0.1", done));
  t.after(async () => { downloads.closeAllConnections(); await new Promise<void>(done => downloads.close(() => done())); });
  const address = downloads.address(); assert.ok(address && typeof address !== "string");
  const downloadBase = `http://127.0.0.1:${address.port}`;
  function installArgs(mode: "both" | "cli" | "skill", agent: string, project: string, target: string) {
    if (windows) return ["-NoProfile", "-File", join(repo, "scripts/install.ps1"), "-Agent", agent, "-Project", project, "-InstallDir", target, "-BaseUrl", downloadBase, ...(mode === "both" ? [] : [mode === "cli" ? "-CliOnly" : "-SkillOnly"])];
    return [join(repo, "scripts/install.sh"), "--agent", agent, "--project", project, "--install-dir", target, "--base-url", downloadBase, ...(mode === "both" ? [] : [mode === "cli" ? "--cli-only" : "--skill-only"])];
  }
  await t.test("one installer installs CLI plus the exact discoverable skill for either host", async () => {
    for (const [agent, folder] of [["codex", ".agents"], ["claude-code", ".claude"]]) {
      const project = join(root, agent); const target = join(root, `${agent}-bin`);
      const result = await run(windows ? "pwsh" : "sh", installArgs("both", agent, project, target));
      assert.equal(result.code, 0, result.stderr);
      assert.equal(await readFile(join(project, folder, "skills/cortex-org-wiki/SKILL.md"), "utf8"), await readFile(join(repo, "skills/cortex-org-wiki/SKILL.md"), "utf8"));
      assert.equal((await run(join(target, commandName), ["search", "接口", "--org", "org-甲", "--json"])).code, 0);
      await assert.rejects(access(join(project, folder === ".agents" ? ".claude" : ".agents")));
    }
  });
  await t.test("CLI-only and skill-only modes are independent and corrupt downloads fail closed", async () => {
    for (const mode of ["cli", "skill"] as const) {
      const project = join(root, `${mode}-project`); const target = join(root, `${mode}-bin`);
      const result = await run(windows ? "pwsh" : "sh", installArgs(mode, "codex", project, target));
      assert.equal(result.code, 0, result.stderr);
      if (mode === "cli") { await access(join(target, commandName)); await assert.rejects(access(join(project, ".agents"))); }
      else { await access(join(project, ".agents/skills/cortex-org-wiki/SKILL.md")); await assert.rejects(access(join(target, commandName))); }
    }
    corruptChecksum = true;
    const target = join(root, "corrupt-bin");
    assert.notEqual((await run(windows ? "pwsh" : "sh", installArgs("both", "codex", join(root, "corrupt-project"), target))).code, 0);
    await assert.rejects(access(join(target, commandName)));
  });
});
