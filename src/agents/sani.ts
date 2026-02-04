import { isTruthyEnvValue } from "../infra/env.js";
import type { OpenClawConfig } from "../config/config.js";
import { resolveStorePath } from "../config/sessions/paths.js";
import { loadSessionStore } from "../config/sessions/store.js";
import { resolveSessionAgentId } from "./agent-scope.js";

export type SaniSessionFlags = {
  saniMode: boolean;
  labyrinthMode: boolean;
};

export function resolveSaniEnabled(
  cfg?: OpenClawConfig,
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  if (typeof env.OPENCLAW_SANI === "string") {
    return isTruthyEnvValue(env.OPENCLAW_SANI);
  }
  return cfg?.agents?.defaults?.sani?.enabled === true;
}

export function readSaniSessionFlags(params: {
  config?: OpenClawConfig;
  sessionKey?: string;
}): SaniSessionFlags {
  const sessionKey = params.sessionKey?.trim();
  if (!sessionKey || !params.config) {
    return { saniMode: false, labyrinthMode: false };
  }
  const agentId = resolveSessionAgentId({
    sessionKey,
    config: params.config,
  });
  const storePath = resolveStorePath(params.config.session?.store, { agentId });
  const store = loadSessionStore(storePath);
  const entry = store[sessionKey];
  return {
    saniMode: entry?.saniMode === true,
    labyrinthMode: entry?.labyrinthMode === true,
  };
}

const HEY_SANI_PATTERN = /^\s*hey[\s,]+sani\b/i;
const WHO_AM_I_PATTERN = /^\s*who\s+am\s+i\s*[.!?]*\s*$/i;

export function matchesHeySaniTrigger(text: string): boolean {
  return HEY_SANI_PATTERN.test(text);
}

export function matchesWhoAmITrigger(text: string): boolean {
  return WHO_AM_I_PATTERN.test(text);
}
