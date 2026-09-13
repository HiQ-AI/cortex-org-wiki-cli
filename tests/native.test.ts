import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFile, mkdtemp, mkdir, readFile, realpath, rm, writeFile, access } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { test } from "node:test";
import { createFixture, page, previousOfficialSkills, revision } from "./fixture.js";

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
  // PowerShell uses PATHEXT to run .exe in-process and collect its exit status.
  const env = { PATH: process.env.PATH, PATHEXT: process.env.PATHEXT, SystemRoot: process.env.SystemRoot, TEMP: root, TMP: root, XDG_CONFIG_HOME: config, CORTEX_ORG_WIKI_BASE: fixture.base, CORTEX_ORG_WIKI_TOKEN: "fixture-host-token" };
  async function run(file: string, args: string[], overrides: Record<string, string | undefined> = {}) {
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
  await t.test("compiled native login performs device flow and uses its own store", async () => {
    const standalone = join(root, "standalone-config");
    const overrides = { CORTEX_ORG_WIKI_TOKEN: undefined, XDG_CONFIG_HOME: standalone };
    const login = await run(binary!, ["login", "--json"], overrides);
    assert.equal(login.code, 0, login.stderr);
    assert.match(login.stderr, /https:\/\/example.invalid\/authorize/);
    assert.ok(!login.stdout.includes("fixture-login-token"));
    assert.equal(fixture.oauth[0].body.scope, "cortex_data");
    const doctor = await run(binary!, ["doctor", "--org", "org-甲", "--json"], overrides);
    assert.equal(JSON.parse(doctor.stdout).data.user_id, "stored-user", doctor.stderr);
    assert.equal((await run(binary!, ["logout", "--json"], overrides)).code, 0);
    await assert.rejects(access(join(standalone, "cortex-org-wiki/credentials.json")));
  });
  await t.test("native JSON boolean forms preserve argument and handler error output", async () => {
    for (const [flags, json] of [
      [["--json=true"], true], [["--json", "false"], false], [["--json", "--no-json"], false],
    ] as [string[], boolean][]) {
      for (const args of [["search", "topic"], ["doctor", "--org", "org-甲"]]) {
        const handler = args[0] === "doctor";
        const result = await run(binary!, [...args, ...flags], { CORTEX_ORG_WIKI_TOKEN: "" });
        assert.equal(result.code, handler ? 2 : 3);
        assert.equal(result.stdout, "");
        if (json) assert.equal(JSON.parse(result.stderr).kind, handler ? "config" : "validation");
        else assert.throws(() => JSON.parse(result.stderr));
      }
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
  const original = await readFile(join(repo, "skills/cortex-org-wiki/SKILL.md"), "utf8");
  const version = (await run(binary!, ["version"])).stdout.trim();
  const replaceFlag = windows ? "-ReplaceSkill" : "--replace-skill";
  function install(mode: "both" | "cli" | "skill", agents: string, project: string, target: string, extra: string[] = []) {
    const args = windows
      ? ["-NoProfile", "-File", join(repo, "scripts/install.ps1"), "-Agent", agents, "-Project", project, "-InstallDir", target, "-BaseUrl", downloadBase, ...(mode === "both" ? [] : [mode === "cli" ? "-CliOnly" : "-SkillOnly"])]
      : [join(repo, "scripts/install.sh"), "--agent", agents, "--project", project, "--install-dir", target, "--base-url", downloadBase, ...(mode === "both" ? [] : [mode === "cli" ? "--cli-only" : "--skill-only"])];
    return run(windows ? "pwsh" : "sh", [...args, ...extra]);
  }
  /** Success is exactly one JSON line on stdout, with progress kept on stderr. */
  function installed(result: { code: number; stdout: string; stderr: string }) {
    assert.equal(result.code, 0, result.stderr);
    assert.match(result.stdout, /^[^\r\n]+\r?\n$/u, `stdout must be one JSON line: ${result.stdout}`);
    assert.ok(result.stderr.includes(downloadBase), result.stderr);
    const output = JSON.parse(result.stdout);
    assert.equal(output.ok, true);
    assert.equal(output.tool, "install");
    return output.data as { cli: { path: string; version: string; previous_version: string | null } | null; skills: { agent: string; path: string; status: string }[] };
  }
  /** Windows reports the long form of 8.3 temp paths (RUNNER~1 → runneradmin), so compare the resolved file. */
  async function assertCli(cli: { path: string; version: string; previous_version: string | null } | null, target: string, previous: string | null) {
    assert.ok(cli);
    assert.equal(await realpath(cli.path), await realpath(join(target, commandName)));
    assert.deepEqual([cli.version, cli.previous_version], [version, previous]);
  }
  function failure(result: { code: number; stdout: string; stderr: string }) {
    assert.notEqual(result.code, 0);
    assert.equal(result.stdout, "");
    const line = result.stderr.split(/\r?\n/u).find(item => item.startsWith('{"ok":false'));
    assert.ok(line, result.stderr);
    return JSON.parse(line) as { kind: string; code: string; message: string };
  }
  await t.test("one installer installs CLI plus the exact discoverable skill for either host", async () => {
    for (const [agent, folder] of [["codex", ".agents"], ["claude-code", ".claude"]]) {
      const project = join(root, agent); const target = join(root, `${agent}-bin`);
      const data = installed(await install("both", agent, project, target));
      await assertCli(data.cli, target, null);
      assert.deepEqual(data.skills.map(skill => [skill.agent, skill.status]), [[agent, "installed"]]);
      assert.equal(await readFile(join(project, folder, "skills/cortex-org-wiki/SKILL.md"), "utf8"), original);
      assert.equal((await run(join(target, commandName), ["search", "接口", "--org", "org-甲", "--json"])).code, 0);
      await assert.rejects(access(join(project, folder === ".agents" ? ".claude" : ".agents")));
    }
  });
  await t.test("rerunning the installer upgrades the CLI and a previously released skill for several hosts", async () => {
    const project = join(root, "upgrade-project"); const target = join(root, "upgrade-bin");
    installed(await install("both", "codex", project, target));
    await writeFile(join(project, ".agents/skills/cortex-org-wiki/SKILL.md"), (await previousOfficialSkills())[0]);
    const data = installed(await install("both", "codex,claude-code", project, target));
    await assertCli(data.cli, target, version);
    assert.deepEqual(data.skills.map(skill => [skill.agent, skill.status]), [["codex", "updated"], ["claude-code", "installed"]]);
    for (const folder of [".agents", ".claude"]) assert.equal(await readFile(join(project, folder, "skills/cortex-org-wiki/SKILL.md"), "utf8"), original);
    if (!windows) {
      const repeated = installed(await run("sh", [join(repo, "scripts/install.sh"), "--agent", "codex", "--agent", "claude-code", "--project", project, "--install-dir", target, "--base-url", downloadBase]));
      assert.deepEqual(repeated.skills.map(skill => skill.status), ["unchanged", "unchanged"]);
    }
  });
  await t.test("customized skill content fails the install without blocking the CLI upgrade", async () => {
    const project = join(root, "custom-project"); const target = join(root, "custom-bin");
    const path = join(project, ".claude/skills/cortex-org-wiki/SKILL.md");
    await mkdir(join(project, ".claude/skills/cortex-org-wiki"), { recursive: true });
    await writeFile(path, "user customized skill");
    const error = failure(await install("both", "codex,claude-code", project, target));
    assert.deepEqual([error.kind, error.code], ["config", "skill_conflict"]);
    assert.ok(error.message.includes(replaceFlag), error.message);
    assert.equal((await run(join(target, commandName), ["version"])).stdout.trim(), version);
    assert.equal(await readFile(path, "utf8"), "user customized skill");
    await assert.rejects(access(join(project, ".agents")));
    const data = installed(await install("both", "codex,claude-code", project, target, [replaceFlag]));
    assert.deepEqual(data.skills.map(skill => [skill.agent, skill.status]), [["codex", "installed"], ["claude-code", "updated"]]);
    assert.equal(await readFile(path, "utf8"), original);
  });
  await t.test("CLI-only and skill-only modes are independent and corrupt downloads fail closed", async () => {
    for (const mode of ["cli", "skill"] as const) {
      const project = join(root, `${mode}-project`); const target = join(root, `${mode}-bin`);
      const data = installed(await install(mode, "codex", project, target));
      if (mode === "cli") { assert.deepEqual(data.skills, []); await access(join(target, commandName)); await assert.rejects(access(join(project, ".agents"))); }
      else { assert.equal(data.cli, null); await access(join(project, ".agents/skills/cortex-org-wiki/SKILL.md")); await assert.rejects(access(join(target, commandName))); }
    }
    corruptChecksum = true;
    const target = join(root, "corrupt-bin");
    assert.equal(failure(await install("both", "codex", join(root, "corrupt-project"), target)).code, "checksum_mismatch");
    await assert.rejects(access(join(target, commandName)));
  });
});
