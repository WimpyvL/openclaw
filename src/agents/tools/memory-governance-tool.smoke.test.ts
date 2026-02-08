import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { createVaultQueryTool } from "./memory-governance-tool.js";
import { createSessionLogEntryTool } from "./session-log-entry.js";

describe("vault query tool (smoke)", () => {
  it("queries identity scope and logs access", async () => {
    const workspaceDir = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-vault-"));
    const sessionKey = "session:test";
    const sessionId = "session-identity-1";
    const sessionStorePath = path.join(workspaceDir, "sessions.json");
    const identityDir = path.join(workspaceDir, "memory", "Vault", "identity");
    await fs.mkdir(identityDir, { recursive: true });
    await fs.writeFile(
      sessionStorePath,
      JSON.stringify({ [sessionKey]: { sessionId } }, null, 2),
      "utf-8",
    );
    await fs.writeFile(
      path.join(identityDir, "entry.md"),
      [
        "---",
        'created_at: "2024-01-01T00:00:00.000Z"',
        "---",
        "# Identity Entry",
        "line one",
        "line two",
        "line three",
        "line four",
        "",
      ].join("\n"),
      "utf-8",
    );

    const tool = createVaultQueryTool({
      workspaceDir,
      config: { session: { store: sessionStorePath } },
      sessionKey,
    });
    if (!tool) {
      throw new Error("vault_query tool not available");
    }

    const result = await tool.execute("call", { scope: "identity" });
    const details = result.details as {
      scope: string;
      results: Array<{ title: string; created_at: string; preview: string }>;
    };

    expect(details.scope).toBe("identity");
    expect(details.results).toHaveLength(1);
    expect(details.results[0]?.title).toBe("Identity Entry");
    expect(details.results[0]?.created_at).toBe("2024-01-01T00:00:00.000Z");
    expect(details.results[0]?.preview).toBe("line one\nline two\nline three");

    const accessDir = path.join(workspaceDir, "memory", "ThreadBorn", "vault_access");
    const accessEntries = await fs.readdir(accessDir);
    expect(accessEntries).toHaveLength(1);
    expect(accessEntries[0]).toMatch(/\d{4}-\d{2}-\d{2}-\d{4}\.md/);

    const logContent = await fs.readFile(path.join(accessDir, accessEntries[0]), "utf-8");
    expect(logContent).toContain(`SessionId: ${sessionId}`);
    expect(logContent).toContain("Scope: identity");
    expect(logContent).toContain("Results: 1");
    expect(logContent).toContain("Identity Entry");
  });
});

describe("session log entry tool (smoke)", () => {
  it("writes a session log entry with complete metadata", async () => {
    const workspaceDir = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-session-log-"));
    const tool = createSessionLogEntryTool({ workspaceDir });
    if (!tool) {
      throw new Error("session_log_entry tool not available");
    }

    const result = await tool.execute("call", {
      input: "Summarize my recent build output.",
      tool_name: "web_search",
      result: "Build completed successfully with 2 warnings.",
      recommend: true,
      tags: ["build", "warnings"],
    });

    const details = result.details as { path: string };
    const entryPath = path.join(workspaceDir, details.path);
    const entryDir = path.dirname(entryPath);
    const sessionDay = new Date().toISOString().slice(0, 10);

    expect(entryDir).toBe(path.join(workspaceDir, "memory", "ThreadBorn", "sessions", sessionDay));

    const content = await fs.readFile(entryPath, "utf-8");
    expect(content).toContain("timestamp:");
    expect(content).toContain("user_command:");
    expect(content).toContain("tool_invoked:");
    expect(content).toContain("result_summary:");
    expect(content).toContain("promotion_recommendation:");
    expect(content).toContain("tags:");
    expect(content).toContain("Summarize my recent build output.");
    expect(content).toContain("Build completed successfully with 2 warnings.");
  });
});
