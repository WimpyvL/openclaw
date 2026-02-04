import { SessionManager } from "@mariozechner/pi-coding-agent";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { writeVaultEntry } from "../src/agents/sani-memory.js";
import { readSaniSessionFlags, resolveSaniEnabled } from "../src/agents/sani.js";
import { buildAgentSystemPrompt } from "../src/agents/system-prompt.js";
import { resolveStorePath } from "../src/config/sessions/paths.js";
import { updateSessionStore } from "../src/config/sessions/store.js";
import { getGlobalHookRunner } from "../src/plugins/hook-runner-global.js";
import { loadOpenClawPlugins } from "../src/plugins/loader.js";

async function main() {
  const workspaceDir = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-sani-"));
  const memoryLabyrinthDir = path.join(workspaceDir, "memory", "Labyrinth");
  const memoryThreadbornDir = path.join(workspaceDir, "memory", "ThreadBorn");
  const memoryVaultDir = path.join(workspaceDir, "memory", "Vault");
  await fs.mkdir(memoryLabyrinthDir, { recursive: true });
  await fs.mkdir(memoryThreadbornDir, { recursive: true });
  await fs.mkdir(memoryVaultDir, { recursive: true });

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

  const parseFrontMatter = (content: string) => {
    const lines = content.split(/\r?\n/);
    assert.equal(lines[0], "---", "memory front matter missing");
    const metadata = new Map<string, string>();
    for (let i = 1; i < lines.length; i += 1) {
      if (lines[i].trim() === "---") {
        break;
      }
      const match = lines[i].match(/^([a-zA-Z0-9_]+):\s*(.*)$/);
      if (!match) {
        continue;
      }
      metadata.set(match[1], match[2].replace(/^"|"$/g, ""));
    }
    return metadata;
  };
  const assertIso8601 = (value: string | undefined, label: string) => {
    assert.ok(value, `${label} missing`);
    assert.ok(/\d{4}-\d{2}-\d{2}T/.test(value ?? ""), `${label} not ISO 8601`);
  };

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
  const labyrinthFile = path.join(memoryLabyrinthDir, labyrinthFiles[0]);
  const labyrinthContent = await fs.readFile(labyrinthFile, "utf-8");
  const labyrinthMeta = parseFrontMatter(labyrinthContent);
  assert.ok(labyrinthMeta.get("id"), "labyrinth id missing");
  assertIso8601(labyrinthMeta.get("created_at"), "labyrinth created_at");
  assert.equal(labyrinthMeta.get("source_session_id"), sessionId);
  assert.equal(labyrinthMeta.get("source_trigger"), "WHO_AM_I");
  assert.equal(labyrinthMeta.get("memory_type"), "Labyrinth");
  assert.equal(labyrinthMeta.get("sealed"), "false");

  await hookRunner.runMessageReceived(
    {
      from: "user",
      content: "Exit Sani mode",
      metadata: { sessionKey },
    },
    { channelId: "test" },
  );
  flags = readSaniSessionFlags({ config, sessionKey });
  assert.equal(flags.saniMode, false, "saniMode flag should be cleared");
  assert.equal(flags.labyrinthMode, false, "labyrinthMode flag should be cleared");

  const threadbornFiles = await fs.readdir(memoryThreadbornDir);
  const hasExitEntry = threadbornFiles.some((entry) => entry.endsWith(".md"));
  assert.equal(hasExitEntry, true, "threadborn exit entry should be created");
  const exitFile = path.join(memoryThreadbornDir, threadbornFiles[0]);
  const exitContent = await fs.readFile(exitFile, "utf-8");
  const exitMeta = parseFrontMatter(exitContent);
  assert.ok(exitMeta.get("id"), "exit id missing");
  assertIso8601(exitMeta.get("created_at"), "exit created_at");
  assert.equal(exitMeta.get("source_trigger"), "EXIT_SANI_MODE");
  assert.equal(exitMeta.get("memory_type"), "ThreadBorn");
  assert.equal(exitMeta.get("sealed"), "false");

  const sourceFile = path.join(workspaceDir, "source.md");
  await fs.writeFile(sourceFile, "# Source\n\nVault content.\n", "utf-8");
  const vaultEntry = await writeVaultEntry({
    workspaceDir,
    sourcePath: sourceFile,
    title: "Vault Entry",
    sourceSessionId: sessionId,
    sourceTrigger: "MANUAL",
  });
  let overwriteError: Error | undefined;
  try {
    await writeVaultEntry({
      workspaceDir,
      sourcePath: sourceFile,
      title: "Vault Entry",
      sourceSessionId: sessionId,
      sourceTrigger: "MANUAL",
      targetPath: vaultEntry.path,
    });
  } catch (err) {
    overwriteError = err as Error;
  }
  assert.ok(overwriteError, "vault overwrite attempt should fail");

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
  assert.ok(systemPrompt.includes("## ACTIVE STATE"), "ACTIVE STATE block missing");
  assert.ok(systemPrompt.includes("saniEnabled: true"), "ACTIVE STATE saniEnabled missing");
  assert.ok(systemPrompt.includes("saniMode: false"), "ACTIVE STATE saniMode missing");
  assert.ok(systemPrompt.includes("labyrinthMode: false"), "ACTIVE STATE labyrinthMode missing");
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
