import { SessionManager } from "@mariozechner/pi-coding-agent";

type SessionSnippet = {
  role: string;
  text: string;
};

function collectText(value: unknown): string {
  if (!value) {
    return "";
  }
  if (typeof value === "string") {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((entry) => collectText(entry)).join("");
  }
  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    if (typeof record.text === "string") {
      return record.text;
    }
    if (typeof record.content === "string") {
      return record.content;
    }
    if (Array.isArray(record.content)) {
      return record.content.map((entry) => collectText(entry)).join("");
    }
    if (record.message && typeof record.message === "object") {
      return collectText(record.message);
    }
  }
  return "";
}

export function readRecentSessionSnippets(params: {
  sessionFile: string;
  limit?: number;
  maxChars?: number;
}): SessionSnippet[] {
  const limit = Math.max(1, params.limit ?? 6);
  const maxChars = Math.max(120, params.maxChars ?? 320);
  let messages: unknown[] = [];
  try {
    const sessionManager = SessionManager.open(params.sessionFile);
    const context = sessionManager.buildSessionContext();
    messages = context.messages ?? [];
  } catch {
    return [];
  }
  const snippets: SessionSnippet[] = [];
  for (let i = messages.length - 1; i >= 0 && snippets.length < limit; i -= 1) {
    const message = messages[i] as { role?: unknown; content?: unknown } | undefined;
    const role = typeof message?.role === "string" ? message.role : "unknown";
    const text = collectText(message?.content).trim();
    if (!text) {
      continue;
    }
    const clipped = text.length > maxChars ? `${text.slice(0, maxChars)}…` : text;
    snippets.push({ role, text: clipped });
  }
  return snippets.reverse();
}
