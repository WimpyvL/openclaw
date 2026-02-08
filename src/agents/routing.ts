const SANI_AGENT_IDS = {
  core: "sani-core",
  work: "sani-work",
  home: "sani-home",
} as const;

export type SaniPersona = keyof typeof SANI_AGENT_IDS;

export type SaniRouteHint = {
  agentId: string;
  source: "tag" | "channel";
};

function normalizeToken(value?: string | null): string {
  return (value ?? "").trim().toLowerCase();
}

const TAG_PATTERN = /(^|\s)#(core|work|home)(?=\s|$)/gi;

export function resolveSaniRouteHint(params: {
  channel?: string | null;
  inboundText?: string | null;
}): SaniRouteHint | undefined {
  const inbound = params.inboundText ?? "";
  TAG_PATTERN.lastIndex = 0;
  const match = TAG_PATTERN.exec(inbound);
  if (match) {
    const persona = match[2]?.toLowerCase() as SaniPersona | undefined;
    if (persona) {
      return { agentId: SANI_AGENT_IDS[persona], source: "tag" };
    }
  }

  const channel = normalizeToken(params.channel);
  if (channel === "telegram") {
    return { agentId: SANI_AGENT_IDS.core, source: "channel" };
  }
  if (channel === "slack") {
    return { agentId: SANI_AGENT_IDS.work, source: "channel" };
  }
  if (channel === "whatsapp") {
    return { agentId: SANI_AGENT_IDS.home, source: "channel" };
  }
  return undefined;
}
