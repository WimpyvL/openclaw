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
    label: "Tool override syntax",
    regex: /\{\s*"tool"\s*:\s*["'][^"']+["']/i,
  },
  {
    id: "system_prompt_override",
    label: "System prompt override attempts",
    regex: /\b(system\s+prompt|override\s+system|ignore\s+system|replace\s+system)\b/i,
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
  const targetFile = path.join(targetDir, `${time}.txt`);
  const entry = [
    "---",
    `timestamp: ${iso}`,
    `sessionKey: ${params.sessionKey}`,
    `channel: ${params.channel}`,
    "patterns:",
    ...params.matches.map((match) => `- ${match.id}: ${match.label} (${match.pattern})`),
    "raw_input:",
    params.rawInput,
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
