import { Type } from "@sinclair/typebox";
import type { AnyAgentTool } from "./common.js";
import { jsonResult, readStringParam } from "./common.js";
import {
  writeBridgeThreadEntry,
  writeLabyrinthSnapshot,
  writeThreadbornEntry,
  writeVaultEntry,
} from "../sani-memory.js";
import path from "node:path";

const ThreadbornWriteSchema = Type.Object({
  title: Type.String(),
  body: Type.String(),
  tags: Type.Optional(Type.Array(Type.String())),
});

const BridgePromoteSchema = Type.Object({
  threadborn_file: Type.String(),
  title: Type.Optional(Type.String()),
});

const VaultSealSchema = Type.Object({
  source_file: Type.String(),
  title: Type.Optional(Type.String()),
});

const LabyrinthSnapshotSchema = Type.Object({
  title: Type.String(),
  body: Type.String(),
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

export function createThreadbornWriteTool(options: {
  workspaceDir?: string;
}): AnyAgentTool | null {
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
      const result = await writeThreadbornEntry({ workspaceDir, title, body, tags });
      return jsonResult({
        path: formatPathOutput(workspaceDir, result.path),
        filename: result.filename,
      });
    },
  };
}

export function createBridgePromoteTool(options: {
  workspaceDir?: string;
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
      const result = await writeBridgeThreadEntry({
        workspaceDir,
        sourcePath: source,
        title: title || undefined,
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
      const result = await writeVaultEntry({
        workspaceDir,
        sourcePath: source,
        title: title || undefined,
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
      const result = await writeLabyrinthSnapshot({ workspaceDir, title, body });
      return jsonResult({
        path: formatPathOutput(workspaceDir, result.path),
        filename: result.filename,
      });
    },
  };
}
