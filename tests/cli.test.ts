import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, stat, writeFile, access } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { test } from "node:test";
import { createFixture, page, revision, source } from "./fixture.js";

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
  const env = { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot, XDG_CONFIG_HOME: config, CORTEX_ORG_WIKI_BASE: fixture.base };
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
      const result = await run(["doctor", "--org", "org-甲", "--json"], { CORTEX_ORG_WIKI_TOKEN: token }, cli, ["--import", guard]);
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
  await t.test("local help and invalid arguments never use network", async () => {
    const count = fixture.requests.length;
    for (const args of [["--help"], ["search", "--help"], ["login", "--help"], ["skill", "setup", "--help"], ["--version"]]) assert.equal((await run(args)).code, 0);
    for (const args of [["search", ""], ["search", "topic"], ["search", "topic", "--org", "org-甲", "--limit", "1.5"], ["read", "../page", "--org", "org-甲"], ["publish", "anything"], ["skill", "setup", "--agent", "cortex"]]) {
      const result = await run([...args, "--json"]);
      assert.equal(result.code, 3, result.stderr);
    }
    assert.equal(fixture.requests.length, count);
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
  await t.test("skill setup targets one host, is idempotent and preserves customized content", async () => {
    const original = await readFile(join(repo, "skills/cortex-org-wiki/SKILL.md"), "utf8");
    for (const [agent, directory] of [["codex", ".agents"], ["claude-code", ".claude"]]) {
      const project = join(root, agent);
      const args = ["skill", "setup", "--agent", agent, "--project", project, "--json"];
      const installed = await run(args, { XDG_CONFIG_HOME: join(root, "no-login") });
      assert.equal(installed.code, 0, installed.stderr);
      const path = join(project, directory, "skills/cortex-org-wiki/SKILL.md");
      assert.equal(await readFile(path, "utf8"), original);
      assert.equal(JSON.parse((await run(args)).stdout).data.status, "unchanged");
      await writeFile(path, "user customized skill");
      assert.equal((await run(args)).code, 2);
      assert.equal(await readFile(path, "utf8"), "user customized skill");
      assert.equal((await run([...args, "--replace"])).code, 0);
      assert.equal(await readFile(path, "utf8"), original);
    }
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
    assert.equal((await success(["doctor"], {}, entry)).user_id, "stored-user");
    for (const command of ["read", "links", "sources"]) assert.equal((await success([command, page.nodeid, "--revision", revision], {}, entry)).revision, revision);
    assert.equal((await success(["search", "接口"], {}, entry)).pages[0].nodeid, page.nodeid);
    const result = await run(["skill", "setup", "--agent", "codex", "--project", join(root, "npm-skills"), "--json"], {}, entry);
    assert.equal(result.code, 0, result.stderr);
    assert.equal(await readFile(JSON.parse(result.stdout).data.path, "utf8"), await readFile(join(packageRoot, "skills/cortex-org-wiki/SKILL.md"), "utf8"));
  });
  assert.ok(fixture.requests.every(request => request.apiKey === undefined && !request.path.includes("mcp")));
});
