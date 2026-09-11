import { mkdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { config, credentialsPath, hostIdentitySelected } from "./config.js";
import { CortexClientError } from "./types.js";
import { VERSION } from "./version.js";

function requireStandalone(): void {
  if (hostIdentitySelected()) throw new CortexClientError("config", "当前身份由宿主管理，请在宿主登录或退出；不会改写本机 CLI 登录。", "host_identity_selected");
}

async function post(path: string, body: unknown): Promise<Response> {
  try {
    return await fetch(`${config.base}/api/cortex/oauth/${path}`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body), redirect: "error", signal: AbortSignal.timeout(30_000),
    });
  } catch (error) {
    throw new CortexClientError("transport", `无法连接登录服务：${(error as Error).message}`);
  }
}

export async function runLogin(json: boolean): Promise<void> {
  requireStandalone();
  const response = await post("device_authorization", {
    agent_id: "cortex-org-wiki", agent_name: "Cortex 组织 Wiki CLI", scope: "cortex_data",
    client_skill: "cortex-org-wiki", client_host: "cli", client_version: VERSION,
  });
  if (!response.ok) throw new CortexClientError("upstream", `登录授权 HTTP ${response.status}`);
  const device = await response.json() as Record<string, unknown>;
  if (typeof device.device_code !== "string" || !device.device_code || typeof device.user_code !== "string" ||
      typeof device.verification_uri_complete !== "string" || !device.verification_uri_complete.startsWith("https://")) {
    throw new CortexClientError("upstream", "登录服务返回了不完整的设备授权信息");
  }
  const url = device.verification_uri_complete;
  const qr = (await import("qrcode-terminal")).default;
  qr.generate(url, { small: true }, value => process.stderr.write(value + "\n"));
  process.stderr.write(`请打开链接确认授权（验证码 ${device.user_code}）：\n${url}\n等待授权…\n`);
  const expires = typeof device.expires_in === "number" && device.expires_in > 0 ? device.expires_in : 600;
  const deadline = Date.now() + expires * 1000;
  let interval = typeof device.interval === "number" && device.interval > 0 ? device.interval : 5;
  while (Date.now() < deadline) {
    await new Promise(resolve => setTimeout(resolve, Math.min(interval * 1000, Math.max(0, deadline - Date.now()))));
    if (Date.now() >= deadline) break;
    const result = await post("token", { device_code: device.device_code });
    if (result.status === 428) continue;
    const data = await result.json().catch(() => ({})) as Record<string, unknown>;
    if (!result.ok) {
      if (data.error === "authorization_pending") continue;
      if (data.error === "slow_down") { interval += 5; continue; }
      throw new CortexClientError("upstream", `登录授权未完成（HTTP ${result.status}）`, typeof data.error === "string" ? data.error : undefined);
    }
    if (typeof data.access_token !== "string" || !data.access_token.trim()) throw new CortexClientError("upstream", "登录服务没有返回有效身份");
    const path = credentialsPath();
    mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    const temporary = `${path}.${process.pid}.tmp`;
    try {
      writeFileSync(temporary, JSON.stringify({ token: data.access_token, owner: data.owner ?? null, scope: data.scope ?? null, obtained_at: new Date().toISOString() }) + "\n", { mode: 0o600, flag: "wx" });
      renameSync(temporary, path);
    } finally { rmSync(temporary, { force: true }); }
    process.stdout.write(json ? JSON.stringify({ ok: true, owner: data.owner ?? null, credentials: path }) + "\n" : "已登录。\n");
    return;
  }
  throw new CortexClientError("upstream", "授权已超时，请重新运行 cortex-org-wiki login。", "authorization_expired");
}

export function runLogout(json: boolean): void {
  requireStandalone();
  rmSync(credentialsPath(), { force: true });
  process.stdout.write(json ? JSON.stringify({ ok: true }) + "\n" : "已退出本机 CLI 登录。\n");
}
