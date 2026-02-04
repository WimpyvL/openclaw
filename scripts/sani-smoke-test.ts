import { SessionManager } from "@mariozechner/pi-coding-agent";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { buildAgentSystemPrompt } from "../src/agents/system-prompt.js";
import { readSaniSessionFlags, resolveSaniEnabled } from "../src/agents/sani.js";
import { loadOpenClawPlugins } from "../src/plugins/loader.js";
import { getGlobalHookRunner } from "../src/plugins/hook-runner-global.js";
import { resolveStorePath } from "../src/config/sessions/paths.js";
import { updateSessionStore } from "../src/config/sessions/store.js";

async function main() {
  const workspaceDir = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-sani-"));
  const memoryLabyrinthDir = path.join(workspaceDir, "memory", "Labyrinth");
  await fs.mkdir(memoryLabyrinthDir, { recursive: true });

  const sessionKey = "main:direct:test";
  const sessionId = "sani-session";
  const sessionFile = path.join(workspaceDir, "sessions.jsonl");
  await fs.mkdir(path.dirname(sessionFile), { recursive: true });
  await fs.writeFile(
    sessionFile,
    `${JSON.stringify({
      type: "session",
      version: 2,
      id: sessionId,
      timestamp: new Date().toISOString(),
      cwd: workspaceDir,
    })}\n`,
    "utf-8",
  );
  const manager = SessionManager.open(sessionFile);
  manager.appendMessage({
    role: "user",
    content: [{ type: "text", text: "Earlier context." }],
    api: "openai-responses",
    provider: "openclaw",
    model: "test",
    usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0 },
    stopReason: "stop",
    timestamp: Date.now(),
  });

  const config = {
    agents: {
      defaults: {
        workspace: workspaceDir,
        sani: { enabled: true },
      },
    },
    session: {
      store: path.join(workspaceDir, "sessions.json"),
    },
  };

  const storePath = resolveStorePath(config.session?.store, { agentId: "main" });
  await updateSessionStore(storePath, (store) => {
    store[sessionKey] = {
      sessionId,
      updatedAt: Date.now(),
      sessionFile,
    };
  });

  loadOpenClawPlugins({ config, workspaceDir, cache: false });
  const hookRunner = getGlobalHookRunner();
  assert.ok(hookRunner, "hook runner should be initialized");

  await hookRunner.runMessageReceived(
    {
      from: "user",
      content: "Hey Sani",
      metadata: { sessionKey },
    },
    { channelId: "test" },
  );

  let flags = readSaniSessionFlags({ config, sessionKey });
  assert.equal(flags.saniMode, true, "saniMode flag should be set");

  await hookRunner.runMessageReceived(
    {
      from: "user",
      content: "Who am I?",
      metadata: { sessionKey },
    },
    { channelId: "test" },
  );

  flags = readSaniSessionFlags({ config, sessionKey });
  assert.equal(flags.labyrinthMode, true, "labyrinthMode flag should be set");

  const labyrinthFiles = await fs.readdir(memoryLabyrinthDir);
  const hasSnapshot = labyrinthFiles.some((entry) => entry.endsWith(".md"));
  assert.equal(hasSnapshot, true, "labyrinth snapshot should be created");

  const systemPrompt = buildAgentSystemPrompt({
    workspaceDir,
    toolNames: [],
    userTimezone: "UTC",
    runtimeInfo: {
      host: "test",
      os: "test",
      arch: "test",
      node: process.version,
      model: "test/test",
    },
    saniEnabled: resolveSaniEnabled(config),
    saniMode: flags.saniMode,
    labyrinthMode: flags.labyrinthMode,
  });
  assert.ok(systemPrompt.includes("## SANI Core Rules"), "SANI rules block missing");
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
