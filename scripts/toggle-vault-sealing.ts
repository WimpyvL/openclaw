import fs from "node:fs/promises";
import path from "node:path";
import {
  readConfigFileSnapshot,
  writeConfigFile,
  type OpenClawConfig,
} from "../src/config/config.js";

const ENV_KEY = "SANI_VAULT_SEALING_ENABLED";
const LOG_FOLDER = "admin-override";

function parseEnabledFlag(args: string[]): boolean {
  const on = args.includes("--on");
  const off = args.includes("--off");
  if (on === off) {
    throw new Error("Usage: scripts/toggle-vault-sealing.ts --on | --off");
  }
  return on;
}

function updateConfig(config: OpenClawConfig, enabled: boolean): OpenClawConfig {
  const value = enabled ? "true" : "false";
  const next: OpenClawConfig = { ...config };
  const env = { ...(next.env ?? {}) } as OpenClawConfig["env"] & Record<string, unknown>;

  if (typeof env[ENV_KEY] === "string") {
    env[ENV_KEY] = value;
  } else {
    const vars = { ...(env.vars ?? {}) };
    vars[ENV_KEY] = value;
    env.vars = vars;
  }

  next.env = env;
  return next;
}

async function resolveEnvFilePath(): Promise<string | null> {
  const candidate = path.join(process.cwd(), ".env");
  try {
    const stats = await fs.stat(candidate);
    if (stats.isFile()) {
      return candidate;
    }
  } catch {
    return null;
  }
  return null;
}

function upsertEnvVar(raw: string, enabled: boolean): string {
  const value = enabled ? "true" : "false";
  const lines = raw.split(/\r?\n/);
  const pattern = new RegExp(`^\\s*(?:export\\s+)?${ENV_KEY}\\s*=`);
  let updated = false;
  const nextLines = lines.map((line) => {
    if (pattern.test(line)) {
      updated = true;
      return `${ENV_KEY}=${value}`;
    }
    return line;
  });
  if (!updated) {
    if (nextLines.length && nextLines[nextLines.length - 1].trim() !== "") {
      nextLines.push("");
    }
    nextLines.push(`${ENV_KEY}=${value}`);
  }
  return `${nextLines.join("\n")}\n`;
}

async function logAdminOverride(params: {
  workspaceDir: string;
  enabled: boolean;
  target: string;
}): Promise<void> {
  const now = new Date();
  const timestamp = now.toISOString();
  const dateStamp = timestamp.slice(0, 10);
  const timeStamp = timestamp.slice(11, 16).replace(":", "");
  const logDir = path.join(params.workspaceDir, "memory", "ThreadBorn", LOG_FOLDER, dateStamp);
  await fs.mkdir(logDir, { recursive: true });

  const user = process.env.USER ?? process.env.USERNAME ?? "unknown";
  const body = [
    "# Vault Sealing Override",
    "",
    `- action: ${params.enabled ? "enabled" : "disabled"}`,
    `- timestamp: ${timestamp}`,
    `- user: ${user}`,
    "- tags: vault:override, admin-override",
    "",
    `- target: ${params.target}`,
    "",
  ].join("\n");

  const logPath = path.join(logDir, `sealing-toggle-${timeStamp}.md`);
  await fs.writeFile(logPath, body, "utf-8");
}

async function main() {
  const enabled = parseEnabledFlag(process.argv.slice(2));
  const envFilePath = await resolveEnvFilePath();
  let targetLabel = "";
  if (envFilePath) {
    const raw = await fs.readFile(envFilePath, "utf-8");
    const updated = upsertEnvVar(raw, enabled);
    await fs.writeFile(envFilePath, updated, "utf-8");
    targetLabel = envFilePath;
  } else {
    const snapshot = await readConfigFileSnapshot();
    const nextConfig = updateConfig(snapshot.config, enabled);
    await writeConfigFile(nextConfig);
    targetLabel = snapshot.path;
  }
  await logAdminOverride({ workspaceDir: process.cwd(), enabled, target: targetLabel });
  console.log(`Updated ${ENV_KEY}=${enabled ? "true" : "false"} in ${targetLabel}`);
}

main().catch((err) => {
  console.error(String(err));
  process.exitCode = 1;
});
