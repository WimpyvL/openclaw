import { Type } from "@sinclair/typebox";
import path from "node:path";
import type { AnyAgentTool } from "./common.js";
import { writeSessionLogEntry } from "../sani-memory.js";
import { jsonResult, readStringArrayParam, readStringParam } from "./common.js";

const SessionLogEntrySchema = Type.Object({
  input: Type.String(),
  tool_name: Type.Optional(Type.String()),
  result: Type.String(),
  recommend: Type.Optional(Type.Boolean()),
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
