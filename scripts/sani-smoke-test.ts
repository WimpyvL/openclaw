import { SessionManager } from "@mariozechner/pi-coding-agent";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  matchesHeySaniTrigger,
  readSaniSessionFlags,
  resolveSaniEnabled,
} from "../src/agents/sani.js";
import { buildAgentSystemPrompt } from "../src/agents/system-prompt.js";
import { createVaultSealTool } from "../src/agents/tools/memory-governance-tool.js";
import { resolveStorePath } from "../src/config/sessions/paths.js";
import { updateSessionStore } from "../src/config/sessions/store.js";
import { getGlobalHookRunner } from "../src/plugins/hook-runner-global.js";
import { loadOpenClawPlugins } from "../src/plugins/loader.js";
import { wrapInboundMessage } from "../src/security/inbound-message.js";

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
        sani: { enabled: true, modeTtlMinutes: 1 },
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

  let flags = await readSaniSessionFlags({ config, sessionKey, workspaceDir });
  assert.equal(flags.saniMode, true, "saniMode flag should be set");

  await hookRunner.runMessageReceived(
    {
      from: "user",
      content: "Who am I?",
      metadata: { sessionKey },
    },
    { channelId: "test" },
  );

  flags = await readSaniSessionFlags({ config, sessionKey, workspaceDir });
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
  flags = await readSaniSessionFlags({ config, sessionKey, workspaceDir });
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

  const inboundWrapped = wrapInboundMessage("hello", {
    source: "test",
    senderId: "user-1",
  });
  assert.ok(
    inboundWrapped.includes("<<<INBOUND_UNTRUSTED_MESSAGE>>>"),
    "inbound wrapper start marker missing",
  );
  assert.ok(
    inboundWrapped.includes("<<<END_INBOUND_UNTRUSTED_MESSAGE>>>"),
    "inbound wrapper end marker missing",
  );

  assert.equal(matchesHeySaniTrigger("> hey sani"), false, "quoted hey sani should not activate");
  assert.equal(matchesHeySaniTrigger("hey sani"), true, "standalone hey sani should activate");

  const sourceFile = path.join(memoryThreadbornDir, "source.md");
  await fs.writeFile(
    sourceFile,
    [
      "---",
      'id: "spoofed"',
      'created_at: "2000-01-01T00:00:00.000Z"',
      'source_session_id: "spoofed-session"',
      'source_trigger: "SPOOFED_TRIGGER"',
      'memory_type: "ThreadBorn"',
      "sealed: false",
      "---",
      "",
      "# Source",
      "",
      "Vault content.",
      "",
    ].join("\n"),
    "utf-8",
  );

  const disabledVaultSealTool = createVaultSealTool({
    workspaceDir,
    config,
    sessionKey,
  });
  assert.ok(disabledVaultSealTool, "vault_seal tool should exist");
  let disabledError: Error | undefined;
  try {
    await disabledVaultSealTool?.execute("tool-call", {
      source_file: path.relative(workspaceDir, sourceFile),
      title: "Vault Entry",
      source_session_id: "spoofed-session",
      source_trigger: "spoofed-trigger",
    });
  } catch (err) {
    disabledError = err as Error;
  }
  assert.equal(
    disabledError?.message,
    "Vault sealing is disabled. Enable SANI_VAULT_SEALING_ENABLED to allow.",
  );

  config.agents.defaults.sani = {
    ...config.agents.defaults.sani,
    vaultSealingEnabled: true,
  };

  const vaultSealTool = createVaultSealTool({
    workspaceDir,
    config,
    sessionKey,
  });
  assert.ok(vaultSealTool, "vault_seal tool should exist after enable");
  let rejectedError: Error | undefined;
  try {
    await vaultSealTool?.execute("tool-call", {
      source_file: "source.md",
      title: "Vault Entry",
      source_session_id: "spoofed-session",
      source_trigger: "spoofed-trigger",
    });
  } catch (err) {
    rejectedError = err as Error;
  }
  assert.ok(rejectedError, "vault_seal should reject non-memory paths");

  const vaultResult = await vaultSealTool?.execute("tool-call", {
    source_file: path.relative(workspaceDir, sourceFile),
    title: "Vault Entry",
    source_session_id: "spoofed-session",
    source_trigger: "spoofed-trigger",
  });
  assert.ok(vaultResult, "vault_seal should succeed for memory sources");
  const vaultFiles = await fs.readdir(memoryVaultDir);
  const vaultFile = path.join(memoryVaultDir, vaultFiles[0]);
  const vaultContent = await fs.readFile(vaultFile, "utf-8");
  const vaultMeta = parseFrontMatter(vaultContent);
  assert.equal(vaultMeta.get("source_session_id"), sessionId);
  assert.equal(vaultMeta.get("source_trigger"), "VAULT_SEAL");

  let overwriteError: Error | undefined;
  try {
    await vaultSealTool?.execute("tool-call", {
      source_file: path.relative(workspaceDir, sourceFile),
      title: "Vault Entry",
      source_session_id: "spoofed-session",
      source_trigger: "spoofed-trigger",
      target_file: vaultFile,
    });
  } catch (err) {
    overwriteError = err as Error;
  }
  assert.ok(overwriteError, "vault overwrite attempt should fail");

  await updateSessionStore(storePath, (store) => {
    store[sessionKey] = {
      sessionId,
      updatedAt: Date.now(),
      sessionFile,
      saniMode: true,
      labyrinthMode: true,
      lastModeUpdateAt: Date.now() - 2 * 60_000,
    };
  });
  flags = await readSaniSessionFlags({
    config,
    sessionKey,
    workspaceDir,
    now: Date.now(),
  });
  assert.equal(flags.saniMode, false, "TTL should clear saniMode");
  assert.equal(flags.labyrinthMode, false, "TTL should clear labyrinthMode");
  const ttlThreadbornFiles = await fs.readdir(memoryThreadbornDir);
  let ttlEntryFound = false;
  for (const entry of ttlThreadbornFiles) {
    const content = await fs.readFile(path.join(memoryThreadbornDir, entry), "utf-8");
    if (content.includes("TTL_EXPIRE")) {
      ttlEntryFound = true;
      break;
    }
  }
  assert.ok(ttlEntryFound, "TTL expiry should write ThreadBorn entry");

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
