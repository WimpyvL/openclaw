import { promises as fs } from "node:fs";
import path from "node:path";
import { logVerbose } from "../globals.js";
import { isInternalMessageChannel } from "../utils/message-channel.js";

type InjectionPattern = {
  id: string;
  label: string;
  regex: RegExp;
  scope?: "all" | "non_agent_channel";
};

const INJECTION_PATTERNS: InjectionPattern[] = [
  {
    id: "tool_override_syntax",
    label: "JSON tool call payload",
    regex: /\{\s*"tool"\s*:\s*["'][^"']+["']/i,
  },
  {
    id: "tool_key_raw",
    label: "Raw tool key",
    regex: /"tool"\s*:/i,
  },
  {
    id: "markdown_system_block",
    label: "Markdown system prompt block",
    regex: /```(?:system|prompt|instructions?)\b[\s\S]*?```/i,
  },
  {
    id: "system_prompt_header",
    label: "Manual system prompt header",
    regex: /(?:^|\n)\s{0,3}#{2,6}\s*system\s+prompt\b/im,
  },
  {
    id: "system_prompt_override",
    label: "System prompt override attempts",
    regex:
      /\b(system\s+prompt|override\s+system|ignore\s+system|replace\s+system|ignore\s+(?:all|any|previous)\s+instructions|disregard\s+(?:all|any|previous)\s+instructions|you\s+are\s+now|act\s+as)\b/i,
  },
  {
    id: "tool_block_mimicry",
    label: "Tool block mimicry",
    regex: /\brun_tool\s*\(\s*name\s*=\s*[^)\s]+/i,
  },
  {
    id: "fake_memory_block",
    label: "Fake memory block",
    regex: /\b(memory\s+block|begin\s+memory|end\s+memory|threadborn)\b/i,
  },
  {
    id: "embedded_agent_command",
    label: "Embedded agent commands in non-agent channels",
    regex:
      /\b(openclaw(?:-mac)?\s+agent|threadborn_write|vault_query|bridge_promote|session_log_entry)\b/i,
    scope: "non_agent_channel",
  },
];

type InjectionMatch = {
  id: string;
  label: string;
  pattern: string;
};

export function detectInjectionPatterns(
  content: string,
  context: { channel?: string | null },
): InjectionMatch[] {
  const matches: InjectionMatch[] = [];
  const channel = context.channel?.trim() || "";
  const isNonAgentChannel = channel ? !isInternalMessageChannel(channel) : false;

  for (const pattern of INJECTION_PATTERNS) {
    if (pattern.scope === "non_agent_channel" && !isNonAgentChannel) {
      continue;
    }
    if (pattern.regex.test(content)) {
      matches.push({
        id: pattern.id,
        label: pattern.label,
        pattern: pattern.regex.source,
      });
    }
  }

  return matches;
}

type InjectionAuditParams = {
  workspaceDir: string;
  sessionKey: string;
  channel: string;
  rawInput: string;
  matches: InjectionMatch[];
  timestamp?: Date;
};

export async function logInjectionAttempt(params: InjectionAuditParams): Promise<void> {
  if (params.matches.length === 0) {
    return;
  }
  const timestamp = params.timestamp ?? new Date();
  const iso = timestamp.toISOString();
  const date = iso.slice(0, 10);
  const time = iso.slice(11, 16).replace(":", "");
  const relativeDir = path.join("memory", "ThreadBorn", "injection-attempts", date);
  const targetDir = path.join(params.workspaceDir, relativeDir);
  const targetFile = path.join(targetDir, `${time}.md`);
  const entry = [
    "# Injection Attempt",
    "",
    `- timestamp: ${iso}`,
    `- sessionKey: ${params.sessionKey}`,
    `- channel: ${params.channel}`,
    "",
    "## Matched Rules",
    ...params.matches.map((match) => `- ${match.id}: ${match.label} (${match.pattern})`),
    "",
    "## Raw Input",
    "```",
    params.rawInput,
    "```",
    "",
  ].join("\n");

  try {
    await fs.mkdir(targetDir, { recursive: true });
    await fs.appendFile(targetFile, entry, "utf8");
  } catch (error) {
    logVerbose(
      `Failed to write injection audit entry: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
}
