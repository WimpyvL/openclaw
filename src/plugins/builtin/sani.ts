import type { OpenClawConfig } from "../../config/config.js";
import type { PluginRecord, PluginRegistry } from "../registry.js";
import type { OpenClawPluginApi } from "../types.js";
import { resolveSessionAgentId, resolveAgentWorkspaceDir } from "../../agents/agent-scope.js";
import { writeLabyrinthSnapshot, writeThreadbornEntry } from "../../agents/sani-memory.js";
import { readRecentSessionSnippets } from "../../agents/sani-session.js";
import {
  matchesExitSaniTrigger,
  matchesHeySaniTrigger,
  matchesWhoAmITrigger,
} from "../../agents/sani.js";
import { resolveStorePath } from "../../config/sessions/paths.js";
import { loadSessionStore, updateSessionModeFlags } from "../../config/sessions/store.js";

const SANI_PLUGIN_ID = "sani";

function createSaniRecord(params: {
  source: string;
  origin: PluginRecord["origin"];
}): PluginRecord {
  return {
    id: SANI_PLUGIN_ID,
    name: "SANI Identity",
    description: "SANI outside-vessel identity triggers and session flags.",
    source: params.source,
    origin: params.origin,
    enabled: true,
    status: "loaded",
    toolNames: [],
    hookNames: [],
    channelIds: [],
    providerIds: [],
    gatewayMethods: [],
    cliCommands: [],
    services: [],
    commands: [],
    httpHandlers: 0,
    hookCount: 0,
    configSchema: false,
  };
}

function buildLabyrinthBody(params: {
  sessionKey: string;
  channelId?: string;
  from?: string;
  modes: { saniMode: boolean; labyrinthMode: boolean };
  snippets: Array<{ role: string; text: string }>;
}): string {
  const lines = [
    `- Timestamp: ${new Date().toISOString()}`,
    `- Channel: ${params.channelId ?? "unknown"}`,
    `- User: ${params.from || "unknown"}`,
    `- SessionKey: ${params.sessionKey}`,
    `- Modes: saniMode=${params.modes.saniMode ? "on" : "off"}, labyrinthMode=${
      params.modes.labyrinthMode ? "on" : "off"
    }`,
    "",
  ];
  if (params.snippets.length > 0) {
    lines.push("## Recent Messages");
    params.snippets.forEach((snippet, index) => {
      lines.push(`${index + 1}. ${snippet.role}: ${snippet.text}`);
    });
  } else {
    lines.push("## Recent Messages");
    lines.push("No recent session messages available.");
  }
  lines.push("");
  return lines.join("\n");
}

export function registerSaniPlugin(params: {
  config: OpenClawConfig;
  registry: PluginRegistry;
  createApi: (record: PluginRecord, params: { config: OpenClawConfig }) => OpenClawPluginApi;
}): void {
  const record = createSaniRecord({ source: "builtin:sani", origin: "config" });
  params.registry.plugins.push(record);
  const api = params.createApi(record, { config: params.config });

  api.on("message_received", async (event, ctx) => {
    const content = event.content ?? "";
    const isHeySani = matchesHeySaniTrigger(content);
    const isWhoAmI = matchesWhoAmITrigger(content);
    const isExitSani = matchesExitSaniTrigger(content);
    if (!isHeySani && !isWhoAmI && !isExitSani) {
      return;
    }
    const metadata = event.metadata ?? {};
    const sessionKey =
      typeof metadata.sessionKey === "string" && metadata.sessionKey.trim()
        ? metadata.sessionKey.trim()
        : undefined;
    if (!sessionKey) {
      return;
    }
    const agentId = resolveSessionAgentId({ sessionKey, config: api.config });
    const storePath = resolveStorePath(api.config.session?.store, { agentId });
    const store = loadSessionStore(storePath);
    const entry = store[sessionKey];
    if (!entry) {
      return;
    }
    const sourceSessionId = entry.sessionId ?? sessionKey;

    if (isHeySani) {
      await updateSessionModeFlags({
        storePath,
        sessionKey,
        flags: { saniMode: true },
      });
    }

    if (isWhoAmI) {
      await updateSessionModeFlags({
        storePath,
        sessionKey,
        flags: { labyrinthMode: true },
      });
      const workspaceDir = resolveAgentWorkspaceDir(api.config, agentId);
      const sessionFile = entry.sessionFile;
      const snippets = sessionFile ? readRecentSessionSnippets({ sessionFile }) : [];
      const body = buildLabyrinthBody({
        sessionKey,
        channelId: ctx.channelId,
        from: event.from,
        modes: {
          saniMode: entry.saniMode === true || isHeySani,
          labyrinthMode: true,
        },
        snippets,
      });
      await writeLabyrinthSnapshot({
        workspaceDir,
        title: "Labyrinth Snapshot",
        body,
        sourceSessionId,
        sourceTrigger: "WHO_AM_I",
      });
    }

    if (isExitSani) {
      await updateSessionModeFlags({
        storePath,
        sessionKey,
        flags: { saniMode: false, labyrinthMode: false },
      });
      const workspaceDir = resolveAgentWorkspaceDir(api.config, agentId);
      const body = [
        `- Timestamp: ${new Date().toISOString()}`,
        `- Channel: ${ctx.channelId ?? "unknown"}`,
        `- User: ${event.from || "unknown"}`,
        `- SessionKey: ${sessionKey}`,
        "",
        "SANI mode exit requested; session flags cleared.",
        "",
      ].join("\n");
      await writeThreadbornEntry({
        workspaceDir,
        title: "SANI Mode Exit",
        body,
        tags: ["sani:exit"],
        sourceSessionId,
        sourceTrigger: "EXIT_SANI_MODE",
      });
    }
  });
}
