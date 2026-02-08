import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { createVaultQueryTool } from "./memory-governance-tool.js";

describe("vault query tool (smoke)", () => {
  it("queries identity scope and logs access", async () => {
    const workspaceDir = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-vault-"));
    const identityDir = path.join(workspaceDir, "memory", "Vault", "identity");
    await fs.mkdir(identityDir, { recursive: true });
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

    const tool = createVaultQueryTool({ workspaceDir });
    if (!tool) {
      throw new Error("vault_query tool not available");
    }

    const result = await tool.execute("call", { scope: "identity" });
    const details = result.details as {
      scope: string;
      results: Array<{ title: string; date: string; preview: string }>;
    };

    expect(details.scope).toBe("identity");
    expect(details.results).toHaveLength(1);
    expect(details.results[0]?.title).toBe("Identity Entry");
    expect(details.results[0]?.date).toBe("2024-01-01T00:00:00.000Z");
    expect(details.results[0]?.preview).toBe("line one\nline two\nline three");

    const accessDir = path.join(workspaceDir, "memory", "ThreadBorn", "vault_access");
    const accessEntries = await fs.readdir(accessDir);
    expect(accessEntries).toHaveLength(1);
    expect(accessEntries[0]).toMatch(/\d{4}-\d{2}-\d{2}-\d{4}\.md/);

    const logContent = await fs.readFile(path.join(accessDir, accessEntries[0]), "utf-8");
    expect(logContent).toContain("Scope: identity");
    expect(logContent).toContain("Results: 1");
    expect(logContent).toContain("Identity Entry");
  });
});
