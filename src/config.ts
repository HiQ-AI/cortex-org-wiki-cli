import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { isAbsolute, join } from "node:path";
import { CortexClientError } from "./types.js";

export const config = {
  base: (process.env.CORTEX_ORG_WIKI_BASE?.trim() || "https://x.hiqlcd.com").replace(/\/+$/, ""),
};

export function credentialsPath(): string {
  const selected = process.env.XDG_CONFIG_HOME?.trim();
  return join(selected && isAbsolute(selected) ? selected : join(homedir(), ".config"), "cortex-org-wiki", "credentials.json");
}

export function hostIdentitySelected(): boolean {
  // Presence is intentional even when empty: never fall back to another identity.
  return process.env.CORTEX_ORG_WIKI_TOKEN !== undefined;
}

export function credential(): { token: string; source: "host" | "login" } {
  if (hostIdentitySelected()) {
    const token = process.env.CORTEX_ORG_WIKI_TOKEN!.trim();
    if (!token) throw new CortexClientError("config", "宿主未提供有效组织身份，请在宿主重新登录。", "host_identity_missing");
    return { token, source: "host" };
  }
  let token: unknown;
  try { token = JSON.parse(readFileSync(credentialsPath(), "utf8")).token; } catch { /* No alternate credential stores. */ }
  if (typeof token !== "string" || !token.trim()) {
    throw new CortexClientError("config", "尚未登录，请运行 cortex-org-wiki login。", "login_required");
  }
  return { token, source: "login" };
}
