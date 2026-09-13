import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, stat, writeFile, access } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { test } from "node:test";
import { createFixture, page, previousOfficialSkills, revision, source } from "./fixture.js";

const exec = promisify(execFile);
const repo = fileURLToPath(new URL("..", import.meta.url));
test("standalone CLI, host identity and clean npm installation", { timeout: 120_000 }, async t => {
  const root = await mkdtemp(join(tmpdir(), "wiki-cli-"));
  const fixture = await createFixture();
  t.after(async () => { await fixture.close(); await rm(root, { recursive: true, force: true }); });
  const config = join(root, "config");
  const credentials = join(config, "cortex-org-wiki", "credentials.json");
  await mkdir(dirname(credentials), { recursive: true });
  await writeFile(credentials, JSON.stringify({ token: "fixture-login-token" }), { mode: 0o600 });
  const env = {
    PATH: process.env.PATH, SystemRoot: process.env.SystemRoot, XDG_CONFIG_HOME: config, CORTEX_ORG_WIKI_BASE: fixture.base,
    npm_config_userconfig: join(root, "npmrc"), npm_config_globalconfig: join(root, "global-npmrc"), npm_config_cache: join(root, "npm-cache"),
  };
  const cli = join(repo, "dist", "cli.js");
  async function run(args: string[], override: Record<string, string> = {}, entry = cli, prefix: string[] = []) {
    try { return { code: 0, ...await exec(process.execPath, [...prefix, entry, ...args], { env: { ...env, ...override }, timeout: 15_000 }) }; }
    catch (error) {
      const result = error as Error & { code: number; stdout: string; stderr: string };
      if (typeof result.code !== "number") throw error;
      return { code: result.code, stdout: result.stdout, stderr: result.stderr };
    }
  }
  async function success(args: string[], override: Record<string, string> = {}, entry = cli) {
    const result = await run([...args, "--org", "org-甲", "--json"], override, entry);
    assert.equal(result.code, 0, result.stderr);
    assert.equal(result.stderr, "");
    assert.ok(!result.stdout.includes("fixture-login-token") && !result.stdout.includes("fixture-host-token"));
    return JSON.parse(result.stdout).data;
  }
  await t.test("four reads preserve literal input, organization, revision and citations", async () => {
    const data = await success(["search", "接口 % & 项目", "--tag", "标签 %", "--after", "上一页", "--limit", "2"]);
    assert.deepEqual(data.pages, [page]);
    assert.deepEqual(fixture.requests.at(-1)!.query, { organization_id: "org-甲", q: "接口 % & 项目", tag: "标签 %", after: "上一页", limit: "2" });
    await success(["search", "接口", "--type", "concept"]);
    assert.equal(fixture.requests.at(-1)!.query.type, "concept");
    const browsed = await success(["browse", "--type", "project", "--tag", "接口", "--limit", "5"]);
    assert.deepEqual(browsed.pages, [page]);
    assert.deepEqual(fixture.requests.at(-1)!.query, { organization_id: "org-甲", order: "recent", type: "project", tag: "接口", limit: "5" });
    const invalidType = await run(["browse", "--type", "novel", "--org", "org-甲", "--json"]);
    assert.equal(invalidType.code, 3);
    for (const command of ["read", "links", "sources"]) {
      const found = await success([command, page.nodeid, "--revision", revision]);
      assert.equal(found.revision, revision);
      assert.equal(fixture.requests.at(-1)!.query.revision, revision);
      if (command === "read") assert.ok(found.markdown.includes(source.quote));
      if (command === "sources") {
        assert.deepEqual(found.sources[0].locator, source.locator);
        const url = new URL(found.sources[0].downloadUrl);
        assert.equal(url.searchParams.get("organization_id"), "org-甲");
        assert.equal(url.searchParams.size, 1);
      }
    }
    assert.equal((await success(["doctor"])).user_id, "stored-user");
  });
  await t.test("Host token wins and credential file is never read, including empty Host", async () => {
    const marker = join(root, "credential-read-attempt");
    const guard = join(root, "guard.mjs");
    await writeFile(guard, `import fs from 'node:fs'; import {syncBuiltinESMExports} from 'node:module'; const original=fs.readFileSync; fs.readFileSync=function(p,...a){ if(String(p).replaceAll('\\\\','/').endsWith('/cortex-org-wiki/credentials.json')) fs.writeFileSync(${JSON.stringify(marker)}, 'read'); return original.call(this,p,...a); }; syncBuiltinESMExports();`);
    for (const token of ["fixture-host-token", "", "expired-token"]) {
      const result = await run(["doctor", "--org", "org-甲", "--json"], { CORTEX_ORG_WIKI_TOKEN: token }, cli, ["--import", pathToFileURL(guard).href]);
      assert.equal(result.code, token === "fixture-host-token" ? 0 : 2, result.stderr);
      if (result.code === 0) assert.equal(JSON.parse(result.stdout).data.user_id, "host-user");
      await assert.rejects(access(marker));
    }
    assert.equal(fixture.requests.at(-1)!.auth, "Bearer expired-token");
    assert.equal(JSON.parse(await readFile(credentials, "utf8")).token, "fixture-login-token");
  });
  await t.test("Host login/logout cannot create or change a standalone identity", async () => {
    const count = fixture.oauth.length;
    for (const command of ["login", "logout"]) {
      const result = await run([command, "--json"], { CORTEX_ORG_WIKI_TOKEN: "fixture-host-token" });
      assert.equal(result.code, 2);
      assert.equal(JSON.parse(result.stderr).code, "host_identity_selected");
    }
    assert.equal(fixture.oauth.length, count);
    assert.equal(JSON.parse(await readFile(credentials, "utf8")).token, "fixture-login-token");
  });
  await t.test("missing login does not use legacy stores or API keys", async () => {
    const isolated = join(root, "empty-config");
    const result = await run(["doctor", "--org", "org-甲", "--json"], { XDG_CONFIG_HOME: isolated, HIQ_API_KEY: "irrelevant", HIQ_SSO_TOKEN: "irrelevant" });
    assert.equal(result.code, 2);
    assert.equal(JSON.parse(result.stderr).code, "login_required");
  });
  await t.test("JSON boolean forms agree for successful commands, argument errors and handler failures", async () => {
    const variants: [string[], boolean][] = [
      [[], false], [["--json"], true], [["--json=true"], true], [["--json", "true"], true],
      [["--json=false"], false], [["--json", "false"], false], [["--no-json"], false],
      [["--json", "--no-json"], false], [["--no-json", "--json=true"], true],
    ];
    for (const [flags, json] of variants) {
      const result = await run(["doctor", "--org", "org-甲", ...flags]);
      assert.equal(result.code, 0, result.stderr);
      assert.equal(result.stderr, "");
      if (json) assert.equal(JSON.parse(result.stdout).data.user_id, "stored-user");
      else assert.match(result.stdout, /^账号: stored-user\n组织: org-甲\n/);
      for (const args of [[], ["unknown-command"], ["search", "topic"], ["read", "--org", "org-甲"], ["doctor", "--org", "org-甲"]]) {
        const handler = args[0] === "doctor";
        const failure = await run([...args, ...flags], { CORTEX_ORG_WIKI_TOKEN: "" });
        assert.equal(failure.code, handler ? 2 : 3, failure.stderr);
        assert.equal(failure.stdout, "");
        assert.ok(failure.stderr.trim());
        if (json) {
          const error = JSON.parse(failure.stderr);
          assert.equal(error.ok, false);
          assert.equal(error.kind, handler ? "config" : "validation");
          if (handler) assert.equal(error.code, "host_identity_missing");
        } else assert.throws(() => JSON.parse(failure.stderr));
      }
    }
  });
  await t.test("local help and invalid arguments never use network", async () => {
    const count = fixture.requests.length;
    for (const args of [["--help"], ["search", "--help"], ["login", "--help"], ["skill", "setup", "--help"], ["--version"]]) assert.equal((await run(args)).code, 0);
    for (const args of [["search", ""], ["search", "topic"], ["search", "topic", "--org", "org-甲", "--limit", "1.5"], ["read", "../page", "--org", "org-甲"], ["publish", "anything"], ["skill", "setup", "--agent", "cortex"]]) {
      const result = await run([...args, "--json"]);
      assert.equal(result.code, 3, result.stderr);
      assert.deepEqual([JSON.parse(result.stderr).kind, JSON.parse(result.stderr).code], ["validation", "invalid_argument"]);
    }
    assert.equal(fixture.requests.length, count);
  });
  await t.test("docs state the real minimum version for browse and search --type, shipped in a newer embedded skill", async () => {
    for (const doc of ["skills/cortex-org-wiki/SKILL.md", "docs/agent-setup.md", "README.md"]) {
      const text = (await readFile(join(repo, doc), "utf8")).replace(/\s+/gu, " ");
      assert.match(text, /`browse` (?:and|与) `search --type`[^;；。]*0\.1\.3/u, doc);
      assert.doesNotMatch(text, /最低版本 0\.1\.0|0\.1\.0 or later supports these commands/u, doc);
    }
    const version = (await run(["--version"])).stdout.trim();
    assert.ok(version.localeCompare("0.1.3", "en", { numeric: true }) > 0, version);
  });
  await t.test("HTTP errors, wrong organization, revision mismatch and empty results remain honest", async () => {
    for (const [status, code] of [[401, 2], [403, 2], [400, 3], [422, 3], [404, 4], [503, 4]]) {
      assert.equal((await run(["search", `status-${status}`, "--org", "org-甲", "--json"])).code, code);
    }
    for (const query of ["broken-json", "broken-data"]) assert.equal((await run(["search", query, "--org", "org-甲", "--json"])).code, 4);
    assert.equal((await run(["search", "redirect", "--org", "org-甲", "--json"])).code, 5);
    assert.equal((await run(["doctor", "--org", "other", "--json"], { CORTEX_ORG_WIKI_TOKEN: "fixture-host-token" })).code, 2);
    assert.equal((await run(["read", page.nodeid, "--revision", "wrong", "--org", "org-甲", "--json"])).code, 4);
    assert.deepEqual((await success(["search", "empty"])).pages, []);
  });
  await t.test("device flow polls the existing endpoint, exposes link and writes only native store", async () => {
    const isolated = join(root, "login-config");
    const result = await run(["login", "--json"], { XDG_CONFIG_HOME: isolated });
    assert.equal(result.code, 0, result.stderr);
    assert.match(result.stderr, /https:\/\/example.invalid\/authorize/);
    assert.equal(fixture.oauth[0].body.scope, "cortex_data");
    assert.equal(fixture.oauth[0].body.agent_id, "cortex-org-wiki");
    assert.equal(fixture.oauth.filter(item => item.path.endsWith("/token")).length, 2);
    const path = join(isolated, "cortex-org-wiki", "credentials.json");
    assert.equal(JSON.parse(await readFile(path, "utf8")).token, "fixture-login-token");
    if (process.platform !== "win32") assert.equal((await stat(path)).mode & 0o777, 0o600);
    assert.ok(!result.stdout.includes("fixture-login-token"));
    assert.equal((await run(["logout", "--json"], { XDG_CONFIG_HOME: isolated })).code, 0);
    await assert.rejects(access(path));
    fixture.denyLogin();
    assert.equal((await run(["login", "--json"], { XDG_CONFIG_HOME: isolated })).code, 4);
    await assert.rejects(access(path));
  });
  await t.test("skill setup targets selected hosts, is idempotent, upgrades official releases and preserves customized content", async () => {
    const original = await readFile(join(repo, "skills/cortex-org-wiki/SKILL.md"), "utf8");
    const skillPath = (project: string, directory: string) => join(project, directory, "skills/cortex-org-wiki/SKILL.md");
    for (const [agent, directory] of [["codex", ".agents"], ["claude-code", ".claude"]]) {
      const project = join(root, agent);
      const args = ["skill", "setup", "--agent", agent, "--project", project, "--json"];
      const installed = await run(args, { XDG_CONFIG_HOME: join(root, "no-login") });
      assert.equal(installed.code, 0, installed.stderr);
      const path = skillPath(project, directory);
      assert.deepEqual(JSON.parse(installed.stdout).data.skills.map((skill: { agent: string; path: string; status: string }) => [skill.agent, skill.path, skill.status]), [[agent, path, "installed"]]);
      assert.equal(await readFile(path, "utf8"), original);
      assert.equal(JSON.parse((await run(args)).stdout).data.skills[0].status, "unchanged");
      for (const previous of await previousOfficialSkills()) {
        await writeFile(path, previous);
        const upgraded = await run(args);
        assert.equal(upgraded.code, 0, upgraded.stderr);
        assert.equal(JSON.parse(upgraded.stdout).data.skills[0].status, "updated");
        assert.equal(await readFile(path, "utf8"), original);
      }
      await writeFile(path, "user customized skill");
      const conflict = await run(args);
      assert.equal(conflict.code, 2);
      assert.equal(JSON.parse(conflict.stderr).code, "skill_conflict");
      assert.match(JSON.parse(conflict.stderr).message, / --replace /);
      assert.equal(await readFile(path, "utf8"), "user customized skill");
      assert.equal((await run([...args, "--replace"])).code, 0);
      assert.equal(await readFile(path, "utf8"), original);
    }
    const project = join(root, "both-hosts");
    const both = ["skill", "setup", "--agent", "codex", "--agent", "claude-code", "--project", project, "--json"];
    const installed = await run(both);
    assert.equal(installed.code, 0, installed.stderr);
    assert.deepEqual(JSON.parse(installed.stdout).data.skills.map((skill: { agent: string; status: string }) => [skill.agent, skill.status]), [["codex", "installed"], ["claude-code", "installed"]]);
    for (const directory of [".agents", ".claude"]) assert.equal(await readFile(skillPath(project, directory), "utf8"), original);
    await writeFile(skillPath(project, ".claude"), "user customized skill");
    await writeFile(skillPath(project, ".agents"), (await previousOfficialSkills())[0]);
    const conflict = await run(both);
    assert.equal(conflict.code, 2);
    assert.equal(JSON.parse(conflict.stderr).code, "skill_conflict");
    assert.equal(conflict.stdout, "");
    assert.notEqual(await readFile(skillPath(project, ".agents"), "utf8"), original, "a conflict on one host writes no host");
    // A file where the project directory should be is an unexpected filesystem error, still with a code.
    const notDirectory = join(root, "not-a-directory"); await writeFile(notDirectory, "");
    const unexpected = await run(["skill", "setup", "--agent", "codex", "--project", notDirectory, "--json"]);
    assert.equal(unexpected.code, 1, unexpected.stderr);
    assert.deepEqual([JSON.parse(unexpected.stderr).kind, JSON.parse(unexpected.stderr).code], ["unknown", "unexpected_error"]);
  });
  await t.test("clean npm package installs independently with guide and same embedded skill", { timeout: 60_000 }, async () => {
    const npm = process.env.npm_execpath; assert.ok(npm);
    const packed = await exec(process.execPath, [npm, "pack", "--ignore-scripts", "--json", "--pack-destination", root], { cwd: repo, env });
    const metadata = JSON.parse(packed.stdout)[0];
    for (const path of ["docs/agent-setup.md", "skills/cortex-org-wiki/SKILL.md", "dist/cli.js"]) assert.ok(metadata.files.some((file: { path: string }) => file.path === path));
    assert.ok(metadata.files.every((file: { path: string }) => !/(credentials|\.env|mcpClient)/u.test(file.path)));
    const install = join(root, "npm"); await mkdir(install);
    await writeFile(join(install, "package.json"), '{"name":"wiki-install-fixture","private":true}');
    await exec(process.execPath, [npm, "install", "--ignore-scripts", "--omit=dev", "--no-audit", "--no-fund", join(root, metadata.filename)], { cwd: install, env });
    const packageRoot = join(install, "node_modules/@hiq-ai/cortex-org-wiki-cli");
    const manifest = JSON.parse(await readFile(join(packageRoot, "package.json"), "utf8"));
    assert.ok(!JSON.stringify(manifest.dependencies).includes("modelcontextprotocol"));
    const entry = resolve(packageRoot, manifest.bin["cortex-org-wiki"]);
    const invalid = await run(["search", "topic", "--json=true"], {}, entry);
    assert.equal(invalid.code, 3);
    assert.equal(JSON.parse(invalid.stderr).kind, "validation");
    assert.equal((await success(["doctor"], {}, entry)).user_id, "stored-user");
    for (const command of ["read", "links", "sources"]) assert.equal((await success([command, page.nodeid, "--revision", revision], {}, entry)).revision, revision);
    assert.equal((await success(["search", "接口"], {}, entry)).pages[0].nodeid, page.nodeid);
    const result = await run(["skill", "setup", "--agent", "codex", "--project", join(root, "npm-skills"), "--json"], {}, entry);
    assert.equal(result.code, 0, result.stderr);
    assert.equal(await readFile(JSON.parse(result.stdout).data.skills[0].path, "utf8"), await readFile(join(packageRoot, "skills/cortex-org-wiki/SKILL.md"), "utf8"));
  });
  assert.ok(fixture.requests.every(request => request.apiKey === undefined && !request.path.includes("mcp")));
});
