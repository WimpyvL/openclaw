import {
  readConfigFileSnapshot,
  writeConfigFile,
  type OpenClawConfig,
} from "../src/config/config.js";

const ENV_KEY = "SANI_VAULT_SEALING_ENABLED";

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

async function main() {
  const enabled = parseEnabledFlag(process.argv.slice(2));
  const snapshot = await readConfigFileSnapshot();
  const nextConfig = updateConfig(snapshot.config, enabled);
  await writeConfigFile(nextConfig);
  console.log(`Updated ${ENV_KEY}=${enabled ? "true" : "false"} in ${snapshot.path}`);
}

main().catch((err) => {
  console.error(String(err));
  process.exitCode = 1;
});
