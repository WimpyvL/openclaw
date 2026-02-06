import fs from "node:fs/promises";
import path from "node:path";
import { resolveUserPath } from "../utils.js";

export const DEFAULT_SYSTEM_PROMPT_FRAGMENT_FILENAME = "system-prompt.fragment.md";

export async function loadSystemPromptFragment(params: {
  agentDir?: string;
  filename?: string;
}): Promise<string | undefined> {
  const rawAgentDir = params.agentDir?.trim();
  if (!rawAgentDir) {
    return undefined;
  }
  const agentDir = resolveUserPath(rawAgentDir);
  const filename = params.filename?.trim() || DEFAULT_SYSTEM_PROMPT_FRAGMENT_FILENAME;
  const filePath = path.join(agentDir, filename);
  try {
    const content = await fs.readFile(filePath, "utf-8");
    const trimmed = content.trim();
    return trimmed ? trimmed : undefined;
  } catch {
    return undefined;
  }
}

export function mergeSystemPromptFragments(
  ...parts: Array<string | undefined | null>
): string | undefined {
  const merged = parts.map((part) => part?.trim()).filter(Boolean) as string[];
  if (merged.length === 0) {
    return undefined;
  }
  return merged.join("\n\n");
}
