import { Type } from "@sinclair/typebox";
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
  writeThreadbornEntry,
  writeVaultEntry,
} from "../sani-memory.js";
import { jsonResult, readStringParam } from "./common.js";

const ThreadbornWriteSchema = Type.Object({
  title: Type.String(),
  body: Type.String(),
  tags: Type.Optional(Type.Array(Type.String())),
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

function requireWorkspaceDir(workspaceDir?: string): string {
  if (!workspaceDir?.trim()) {
    throw new Error("workspaceDir required");
  }
  return workspaceDir;
}

function formatPathOutput(workspaceDir: string, filePath: string) {
  return path.relative(workspaceDir, filePath).replace(/\\/g, "/");
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
      "Write a new ThreadBorn working memory note (timestamped) under memory/ThreadBorn/.",
    parameters: ThreadbornWriteSchema,
    execute: async (_toolCallId, params) => {
      const workspaceDir = requireWorkspaceDir(options.workspaceDir);
      const title = readStringParam(params, "title", { required: true });
      const body = readStringParam(params, "body", { required: true });
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
      readStringParam(params, "source_session_id", { required: true });
      readStringParam(params, "source_trigger", { required: true });
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
      const append =
        typeof (params as { append?: unknown }).append === "boolean"
          ? (params as { append?: boolean }).append
          : undefined;
      const targetPath = readStringParam(params, "target_file");
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
