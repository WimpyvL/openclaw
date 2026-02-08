import type { Dirent } from "node:fs";
import { Type } from "@sinclair/typebox";
import fs from "node:fs/promises";
import path from "node:path";
import type { OpenClawConfig } from "../../config/config.js";
import type { AnyAgentTool } from "./common.js";
import { resolveStorePath } from "../../config/sessions/paths.js";
import { loadSessionStore } from "../../config/sessions/store.js";
import { resolveSessionAgentId } from "../agent-scope.js";
import {
  resolveAllowedMemorySourcePath,
  writeBridgeThreadEntry,
  writeLabyrinthSnapshot,
  writeSessionLogEntry,
  writeThreadbornEntry,
  writeVaultEntry,
} from "../sani-memory.js";
import { resolveSaniVaultSealingEnabled } from "../sani.js";
import { stringEnum } from "../schema/typebox.js";
import { jsonResult, readStringArrayParam, readStringParam } from "./common.js";

const ThreadbornWriteSchema = Type.Object({
  title: Type.String(),
  body: Type.String(),
  tags: Type.Optional(Type.Array(Type.String())),
  folder: Type.Optional(Type.String()),
  source_session_id: Type.String(),
  source_trigger: Type.String(),
});

const BridgePromoteSchema = Type.Object({
  threadborn_file: Type.String({
    description: "Relative path under memory/ThreadBorn, memory/BridgeThread, or memory/Labyrinth.",
  }),
  title: Type.Optional(Type.String()),
  source_session_id: Type.String(),
  source_trigger: Type.String(),
});

const VaultSealSchema = Type.Object({
  source_file: Type.String({
    description: "Relative path under memory/ThreadBorn, memory/BridgeThread, or memory/Labyrinth.",
  }),
  title: Type.Optional(Type.String()),
  source_session_id: Type.String(),
  source_trigger: Type.String(),
  append: Type.Optional(Type.Boolean()),
  target_file: Type.Optional(Type.String()),
});

const LabyrinthSnapshotSchema = Type.Object({
  title: Type.String(),
  body: Type.String(),
  source_session_id: Type.String(),
  source_trigger: Type.String(),
});

const SessionLogEntrySchema = Type.Object({
  input: Type.String(),
  tool_name: Type.Optional(Type.String()),
  result: Type.String(),
  recommend: Type.Optional(Type.Boolean()),
  tags: Type.Optional(Type.Array(Type.String())),
});

const VAULT_QUERY_SCOPES = ["identity", "decisions", "history"] as const;

const VaultQuerySchema = Type.Object({
  scope: stringEnum(VAULT_QUERY_SCOPES),
  tags: Type.Optional(Type.Array(Type.String())),
});

function requireWorkspaceDir(workspaceDir?: string): string {
  if (!workspaceDir?.trim()) {
    throw new Error("workspaceDir required");
  }
  return workspaceDir;
}

function formatPathOutput(workspaceDir: string, filePath: string) {
  return path.relative(workspaceDir, filePath).replace(/\\/g, "/");
}

async function logVaultSealDenied(params: {
  workspaceDir: string;
  source: string;
  title?: string;
  append?: boolean;
  targetPath?: string;
  sourceSessionId: string;
  sourceTrigger: string;
}): Promise<void> {
  const appendState = params.append === true ? "true" : params.append === false ? "false" : "unset";
  const body = [
    `- Timestamp: ${new Date().toISOString()}`,
    `- SourceFile: ${params.source}`,
    params.title ? `- Title: ${params.title}` : "",
    `- Append: ${appendState}`,
    params.targetPath ? `- TargetFile: ${params.targetPath}` : "",
    `- SourceSessionId: ${params.sourceSessionId}`,
    `- SourceTrigger: ${params.sourceTrigger}`,
    "",
    "Vault sealing request denied (SANI_VAULT_SEALING_ENABLED is disabled).",
    "",
  ]
    .filter(Boolean)
    .join("\n");
  await writeThreadbornEntry({
    workspaceDir: params.workspaceDir,
    title: "Vault Seal Denied",
    body,
    tags: ["vault:denied", "admin-denied"],
    folder: "admin-denied",
    sourceSessionId: params.sourceSessionId,
    sourceTrigger: params.sourceTrigger,
  });
}

const VAULT_PREVIEW_LINES = 4;

async function resolveVaultScopeDir(workspaceDir: string, scope: string): Promise<string> {
  const vaultDir = path.join(workspaceDir, "memory", "Vault");
  const scopedDir = path.join(vaultDir, scope);
  if (await isDirectory(scopedDir)) {
    return scopedDir;
  }
  return vaultDir;
}

async function isDirectory(dirPath: string): Promise<boolean> {
  try {
    const stats = await fs.stat(dirPath);
    return stats.isDirectory();
  } catch {
    return false;
  }
}

async function listMarkdownFiles(dirPath: string): Promise<string[]> {
  let entries: Dirent[];
  try {
    entries = await fs.readdir(dirPath, { withFileTypes: true });
  } catch {
    return [];
  }
  const files: string[] = [];
  for (const entry of entries) {
    const resolved = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await listMarkdownFiles(resolved)));
      continue;
    }
    if (entry.isFile() && entry.name.toLowerCase().endsWith(".md")) {
      files.push(resolved);
    }
  }
  return files;
}

function stripFrontMatter(lines: string[]): string[] {
  if (lines[0] !== "---") {
    return lines;
  }
  for (let i = 1; i < lines.length; i += 1) {
    if (lines[i].trim() === "---") {
      return lines.slice(i + 1);
    }
  }
  return lines;
}

function extractTitleAndPreview(content: string): { title: string; preview: string } {
  const rawLines = content.split(/\r?\n/);
  const lines = stripFrontMatter(rawLines);
  let title = "";
  let startIndex = 0;
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i]?.trim();
    if (!line) {
      continue;
    }
    if (line.startsWith("#")) {
      title = line.replace(/^#+\s*/, "").trim();
      startIndex = i + 1;
    } else if (!title) {
      title = line;
      startIndex = i + 1;
    }
    if (title) {
      break;
    }
  }
  const previewLines: string[] = [];
  for (let i = startIndex; i < lines.length; i += 1) {
    const line = lines[i]?.trimEnd() ?? "";
    if (!line && previewLines.length === 0) {
      continue;
    }
    previewLines.push(line);
    if (previewLines.length >= VAULT_PREVIEW_LINES) {
      break;
    }
  }
  return {
    title: title || "Vault Entry",
    preview: previewLines.join("\n").trim(),
  };
}

function matchesTags(content: string, tags?: string[]): boolean {
  if (!tags || tags.length === 0) {
    return true;
  }
  const lower = content.toLowerCase();
  return tags.every((tag) => lower.includes(tag.toLowerCase()));
}

function resolveToolProvenance(params: {
  config?: OpenClawConfig;
  sessionKey?: string;
  toolName: string;
}): { sourceSessionId: string; sourceTrigger: string } {
  const sessionKey = params.sessionKey?.trim();
  if (!params.config || !sessionKey) {
    throw new Error(`${params.toolName} requires active session context for provenance.`);
  }
  const agentId = resolveSessionAgentId({ sessionKey, config: params.config });
  const storePath = resolveStorePath(params.config.session?.store, { agentId });
  const store = loadSessionStore(storePath);
  const entry = store[sessionKey];
  if (!entry?.sessionId) {
    throw new Error(`${params.toolName} could not resolve session provenance.`);
  }
  return {
    sourceSessionId: entry.sessionId,
    sourceTrigger: params.toolName.toUpperCase(),
  };
}

export function createThreadbornWriteTool(options: { workspaceDir?: string }): AnyAgentTool | null {
  if (!options.workspaceDir) {
    return null;
  }
  return {
    label: "ThreadBorn Write",
    name: "threadborn_write",
    description:
      "Write a new ThreadBorn working memory note (timestamped) under memory/ThreadBorn/ (optionally a subfolder).",
    parameters: ThreadbornWriteSchema,
    execute: async (_toolCallId, params) => {
      const workspaceDir = requireWorkspaceDir(options.workspaceDir);
      const title = readStringParam(params, "title", { required: true });
      const body = readStringParam(params, "body", { required: true });
      const folder = readStringParam(params, "folder");
      const tags = Array.isArray((params as { tags?: unknown }).tags)
        ? (params as { tags?: string[] }).tags
        : undefined;
      const sourceSessionId = readStringParam(params, "source_session_id", { required: true });
      const sourceTrigger = readStringParam(params, "source_trigger", { required: true });
      const result = await writeThreadbornEntry({
        workspaceDir,
        title,
        body,
        tags,
        folder: folder || undefined,
        sourceSessionId,
        sourceTrigger,
      });
      return jsonResult({
        path: formatPathOutput(workspaceDir, result.path),
        filename: result.filename,
      });
    },
  };
}

export function createBridgePromoteTool(options: {
  workspaceDir?: string;
  config?: OpenClawConfig;
  sessionKey?: string;
}): AnyAgentTool | null {
  if (!options.workspaceDir) {
    return null;
  }
  return {
    label: "BridgeThread Promote",
    name: "bridge_promote",
    description:
      "Promote a ThreadBorn file into BridgeThread with provenance header (explicit only).",
    parameters: BridgePromoteSchema,
    execute: async (_toolCallId, params) => {
      const workspaceDir = requireWorkspaceDir(options.workspaceDir);
      const source = readStringParam(params, "threadborn_file", { required: true });
      const title = readStringParam(params, "title");
      readStringParam(params, "source_session_id", { required: true });
      readStringParam(params, "source_trigger", { required: true });
      try {
        resolveAllowedMemorySourcePath(workspaceDir, source);
      } catch {
        throw new Error(
          "bridge_promote source must be inside memory/ThreadBorn, memory/BridgeThread, or memory/Labyrinth.",
        );
      }
      const provenance = resolveToolProvenance({
        config: options.config,
        sessionKey: options.sessionKey,
        toolName: "bridge_promote",
      });
      const result = await writeBridgeThreadEntry({
        workspaceDir,
        sourcePath: source,
        title: title || undefined,
        sourceSessionId: provenance.sourceSessionId,
        sourceTrigger: provenance.sourceTrigger,
      });
      return jsonResult({
        path: formatPathOutput(workspaceDir, result.path),
        filename: result.filename,
      });
    },
  };
}

export function createVaultSealTool(options: {
  workspaceDir?: string;
  config?: OpenClawConfig;
  sessionKey?: string;
}): AnyAgentTool | null {
  if (!options.workspaceDir) {
    return null;
  }
  return {
    label: "Vault Seal",
    name: "vault_seal",
    description:
      "Seal a source file into Vault with provenance header (append-only, explicit only).",
    parameters: VaultSealSchema,
    execute: async (_toolCallId, params) => {
      const workspaceDir = requireWorkspaceDir(options.workspaceDir);
      const source = readStringParam(params, "source_file", { required: true });
      const title = readStringParam(params, "title");
      const sourceSessionId = readStringParam(params, "source_session_id", { required: true });
      const sourceTrigger = readStringParam(params, "source_trigger", { required: true });
      const append =
        typeof (params as { append?: unknown }).append === "boolean"
          ? (params as { append?: boolean }).append
          : undefined;
      const targetPath = readStringParam(params, "target_file");
      if (!resolveSaniVaultSealingEnabled(options.config)) {
        try {
          await logVaultSealDenied({
            workspaceDir,
            source,
            title: title || undefined,
            append,
            targetPath: targetPath || undefined,
            sourceSessionId,
            sourceTrigger,
          });
        } catch {
          // Best-effort logging; denial should still be explicit.
        }
        throw new Error(
          "Vault sealing is disabled. Enable it via config (agents.defaults.sani.vaultSealingEnabled) or the SANI_VAULT_SEALING_ENABLED environment variable.",
        );
      }
      try {
        resolveAllowedMemorySourcePath(workspaceDir, source);
      } catch {
        throw new Error(
          "vault_seal source must be inside memory/ThreadBorn, memory/BridgeThread, or memory/Labyrinth.",
        );
      }
      const provenance = resolveToolProvenance({
        config: options.config,
        sessionKey: options.sessionKey,
        toolName: "vault_seal",
      });
      const result = await writeVaultEntry({
        workspaceDir,
        sourcePath: source,
        title: title || undefined,
        sourceSessionId: provenance.sourceSessionId,
        sourceTrigger: provenance.sourceTrigger,
        append,
        targetPath: targetPath || undefined,
      });
      return jsonResult({
        path: formatPathOutput(workspaceDir, result.path),
        filename: result.filename,
      });
    },
  };
}

export function createLabyrinthSnapshotTool(options: {
  workspaceDir?: string;
}): AnyAgentTool | null {
  if (!options.workspaceDir) {
    return null;
  }
  return {
    label: "Labyrinth Snapshot",
    name: "labyrinth_snapshot",
    description: "Write a Labyrinth identity snapshot (explicit only).",
    parameters: LabyrinthSnapshotSchema,
    execute: async (_toolCallId, params) => {
      const workspaceDir = requireWorkspaceDir(options.workspaceDir);
      const title = readStringParam(params, "title", { required: true });
      const body = readStringParam(params, "body", { required: true });
      const sourceSessionId = readStringParam(params, "source_session_id", { required: true });
      const sourceTrigger = readStringParam(params, "source_trigger", { required: true });
      const result = await writeLabyrinthSnapshot({
        workspaceDir,
        title,
        body,
        sourceSessionId,
        sourceTrigger,
      });
      return jsonResult({
        path: formatPathOutput(workspaceDir, result.path),
        filename: result.filename,
      });
    },
  };
}

export function createVaultQueryTool(options: { workspaceDir?: string }): AnyAgentTool | null {
  if (!options.workspaceDir) {
    return null;
  }
  return {
    label: "Vault Query",
    name: "vault_query",
    description: "Read-only query of Vault entries with title + preview lines.",
    parameters: VaultQuerySchema,
    execute: async (_toolCallId, params) => {
      const workspaceDir = requireWorkspaceDir(options.workspaceDir);
      const scope = readStringParam(params, "scope", { required: true });
      const tags = Array.isArray((params as { tags?: unknown }).tags)
        ? (params as { tags?: string[] }).tags
        : undefined;
      const vaultDir = await resolveVaultScopeDir(workspaceDir, scope);
      const files = await listMarkdownFiles(vaultDir);
      const results = [];
      for (const filePath of files) {
        const content = await fs.readFile(filePath, "utf-8");
        if (!matchesTags(content, tags)) {
          continue;
        }
        const { title, preview } = extractTitleAndPreview(content);
        results.push({
          path: formatPathOutput(workspaceDir, filePath),
          title,
          preview,
        });
      }
      return jsonResult({ scope, results });
    },
  };
}

export function createSessionLogEntryTool(options: { workspaceDir?: string }): AnyAgentTool | null {
  if (!options.workspaceDir) {
    return null;
  }
  return {
    label: "Session Log Entry",
    name: "session_log_entry",
    description:
      "Write a session journaling entry with intent/result into memory/ThreadBorn/sessions/YYYY-MM-DD/.",
    parameters: SessionLogEntrySchema,
    execute: async (_toolCallId, params) => {
      const workspaceDir = requireWorkspaceDir(options.workspaceDir);
      const input = readStringParam(params, "input", { required: true });
      const toolName = readStringParam(params, "tool_name");
      const result = readStringParam(params, "result", { required: true });
      const recommend =
        typeof (params as { recommend?: unknown }).recommend === "boolean"
          ? (params as { recommend?: boolean }).recommend
          : undefined;
      const tags = readStringArrayParam(params, "tags");
      const entry = await writeSessionLogEntry({
        workspaceDir,
        userCommand: input,
        toolInvoked: toolName,
        result,
        recommend,
        tags,
      });
      return jsonResult({
        path: formatPathOutput(workspaceDir, entry.path),
        filename: entry.filename,
      });
    },
  };
}
