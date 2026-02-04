import { Type } from "@sinclair/typebox";
import path from "node:path";
import type { AnyAgentTool } from "./common.js";
import {
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
  threadborn_file: Type.String(),
  title: Type.Optional(Type.String()),
  source_session_id: Type.String(),
  source_trigger: Type.String(),
});

const VaultSealSchema = Type.Object({
  source_file: Type.String(),
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

export function createBridgePromoteTool(options: { workspaceDir?: string }): AnyAgentTool | null {
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
      const sourceSessionId = readStringParam(params, "source_session_id", { required: true });
      const sourceTrigger = readStringParam(params, "source_trigger", { required: true });
      const result = await writeBridgeThreadEntry({
        workspaceDir,
        sourcePath: source,
        title: title || undefined,
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

export function createVaultSealTool(options: { workspaceDir?: string }): AnyAgentTool | null {
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
      const result = await writeVaultEntry({
        workspaceDir,
        sourcePath: source,
        title: title || undefined,
        sourceSessionId,
        sourceTrigger,
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
