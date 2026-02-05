import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

const MEMORY_ROOT = "memory";
const VAULT_DIR = "Vault";
const THREADBORN_DIR = "ThreadBorn";
const BRIDGETHREAD_DIR = "BridgeThread";
const LABYRINTH_DIR = "Labyrinth";
const MEMORY_SOURCE_DIRS = [THREADBORN_DIR, BRIDGETHREAD_DIR, LABYRINTH_DIR] as const;

const SAFE_NAME_PATTERN = /[^a-z0-9._-]+/gi;
const MAX_SLUG_LENGTH = 60;
const FRONT_MATTER_DELIMITER = "---";

type MemoryType = "ThreadBorn" | "BridgeThread" | "Vault" | "Labyrinth";

type MemoryMetadata = {
  id: string;
  created_at: string;
  source_session_id: string;
  source_trigger: string;
  memory_type: MemoryType;
  sealed: boolean;
  promoted_from_id?: string;
  promoted_from_source_session_id?: string;
  promoted_from_source_trigger?: string;
  promoted_from_memory_type?: string;
  sealed_from_id?: string;
  sealed_from_source_session_id?: string;
  sealed_from_source_trigger?: string;
  sealed_from_memory_type?: string;
};

type ParsedFrontMatter = {
  metadata: Partial<MemoryMetadata>;
  body: string;
};

export type MemoryWriteResult = {
  path: string;
  filename: string;
};

function toSafeSlug(raw: string): string {
  const normalized = raw
    .trim()
    .replace(/\s+/g, "-")
    .replace(SAFE_NAME_PATTERN, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase();
  return normalized.slice(0, MAX_SLUG_LENGTH) || "entry";
}

function timestampSlug(date: Date = new Date()): string {
  return date.toISOString().replace(/[:.]/g, "-");
}

async function ensureDir(dir: string): Promise<void> {
  await fs.mkdir(dir, { recursive: true });
}

function resolveWorkspacePath(workspaceDir: string, relPath: string): string {
  const resolved = path.resolve(workspaceDir, relPath);
  const relative = path.relative(workspaceDir, resolved);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(`Path escapes workspace: ${relPath}`);
  }
  return resolved;
}

function resolveMemoryDir(workspaceDir: string, dirName: string): string {
  return path.join(workspaceDir, MEMORY_ROOT, dirName);
}

export function resolveAllowedMemorySourcePath(workspaceDir: string, relPath: string): string {
  const resolved = resolveWorkspacePath(workspaceDir, relPath);
  const allowed = MEMORY_SOURCE_DIRS.some((dir) =>
    isPathWithin(resolveMemoryDir(workspaceDir, dir), resolved),
  );
  if (!allowed) {
    throw new Error(
      "Memory source must be inside memory/ThreadBorn, memory/BridgeThread, or memory/Labyrinth.",
    );
  }
  return resolved;
}

function isPathWithin(parent: string, candidate: string): boolean {
  const relative = path.relative(parent, candidate);
  return !!relative && !relative.startsWith("..") && !path.isAbsolute(relative);
}

function formatYamlValue(value: string | boolean): string {
  if (typeof value === "boolean") {
    return value ? "true" : "false";
  }
  return JSON.stringify(value);
}

function buildFrontMatter(metadata: MemoryMetadata): string {
  const lines = [
    FRONT_MATTER_DELIMITER,
    `id: ${formatYamlValue(metadata.id)}`,
    `created_at: ${formatYamlValue(metadata.created_at)}`,
    `source_session_id: ${formatYamlValue(metadata.source_session_id)}`,
    `source_trigger: ${formatYamlValue(metadata.source_trigger)}`,
    `memory_type: ${formatYamlValue(metadata.memory_type)}`,
    `sealed: ${formatYamlValue(metadata.sealed)}`,
  ];
  const optionalKeys: Array<keyof MemoryMetadata> = [
    "promoted_from_id",
    "promoted_from_source_session_id",
    "promoted_from_source_trigger",
    "promoted_from_memory_type",
    "sealed_from_id",
    "sealed_from_source_session_id",
    "sealed_from_source_trigger",
    "sealed_from_memory_type",
  ];
  for (const key of optionalKeys) {
    const value = metadata[key];
    if (typeof value === "string" && value) {
      lines.push(`${key}: ${formatYamlValue(value)}`);
    }
  }
  lines.push(FRONT_MATTER_DELIMITER, "");
  return lines.join("\n");
}

function parseYamlValue(value: string): string | boolean {
  const trimmed = value.trim();
  if (trimmed === "true") {
    return true;
  }
  if (trimmed === "false") {
    return false;
  }
  if (trimmed.startsWith('"') && trimmed.endsWith('"')) {
    try {
      return JSON.parse(trimmed);
    } catch {
      return trimmed.slice(1, -1);
    }
  }
  if (trimmed.startsWith("'") && trimmed.endsWith("'")) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function parseFrontMatter(content: string): ParsedFrontMatter {
  const lines = content.split(/\r?\n/);
  if (lines[0] !== FRONT_MATTER_DELIMITER) {
    return { metadata: {}, body: content };
  }
  let endIndex = -1;
  for (let i = 1; i < lines.length; i += 1) {
    if (lines[i].trim() === FRONT_MATTER_DELIMITER) {
      endIndex = i;
      break;
    }
  }
  if (endIndex === -1) {
    return { metadata: {}, body: content };
  }
  const metadata: Partial<MemoryMetadata> = {};
  const allowedKeys: Array<keyof MemoryMetadata> = [
    "id",
    "created_at",
    "source_session_id",
    "source_trigger",
    "memory_type",
    "sealed",
    "promoted_from_id",
    "promoted_from_source_session_id",
    "promoted_from_source_trigger",
    "promoted_from_memory_type",
    "sealed_from_id",
    "sealed_from_source_session_id",
    "sealed_from_source_trigger",
    "sealed_from_memory_type",
  ];
  for (const line of lines.slice(1, endIndex)) {
    if (!line.trim()) {
      continue;
    }
    const match = line.match(/^([a-zA-Z0-9_]+):\s*(.*)$/);
    if (!match) {
      continue;
    }
    const key = match[1] as keyof MemoryMetadata;
    if (!allowedKeys.includes(key)) {
      continue;
    }
    metadata[key] = parseYamlValue(match[2]) as never;
  }
  const body = lines.slice(endIndex + 1).join("\n");
  return { metadata, body };
}

function createMetadata(params: {
  sourceSessionId: string;
  sourceTrigger: string;
  memoryType: MemoryType;
  sealed: boolean;
  promotedFrom?: Partial<MemoryMetadata>;
  sealedFrom?: Partial<MemoryMetadata>;
}): MemoryMetadata {
  const now = new Date().toISOString();
  return {
    id: randomUUID(),
    created_at: now,
    source_session_id: params.sourceSessionId,
    source_trigger: params.sourceTrigger,
    memory_type: params.memoryType,
    sealed: params.sealed,
    promoted_from_id:
      typeof params.promotedFrom?.id === "string" ? params.promotedFrom.id : undefined,
    promoted_from_source_session_id:
      typeof params.promotedFrom?.source_session_id === "string"
        ? params.promotedFrom.source_session_id
        : undefined,
    promoted_from_source_trigger:
      typeof params.promotedFrom?.source_trigger === "string"
        ? params.promotedFrom.source_trigger
        : undefined,
    promoted_from_memory_type:
      typeof params.promotedFrom?.memory_type === "string"
        ? params.promotedFrom.memory_type
        : undefined,
    sealed_from_id: typeof params.sealedFrom?.id === "string" ? params.sealedFrom.id : undefined,
    sealed_from_source_session_id:
      typeof params.sealedFrom?.source_session_id === "string"
        ? params.sealedFrom.source_session_id
        : undefined,
    sealed_from_source_trigger:
      typeof params.sealedFrom?.source_trigger === "string"
        ? params.sealedFrom.source_trigger
        : undefined,
    sealed_from_memory_type:
      typeof params.sealedFrom?.memory_type === "string"
        ? params.sealedFrom.memory_type
        : undefined,
  };
}

function resolveVaultDir(workspaceDir: string): string {
  return resolveMemoryDir(workspaceDir, VAULT_DIR);
}

async function writeUniqueFile(params: {
  dir: string;
  filenameBase: string;
  content: string;
  allowSuffix?: boolean;
}): Promise<MemoryWriteResult> {
  await ensureDir(params.dir);
  const allowSuffix = params.allowSuffix ?? true;
  const maxAttempts = allowSuffix ? 5 : 1;
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const suffix = attempt === 0 ? "" : `-${attempt + 1}`;
    const filename = `${params.filenameBase}${suffix}.md`;
    const filePath = path.join(params.dir, filename);
    try {
      await fs.writeFile(filePath, params.content, { encoding: "utf-8", flag: "wx" });
      return { path: filePath, filename };
    } catch (err) {
      const anyErr = err as { code?: string };
      if (anyErr.code !== "EEXIST") {
        throw err;
      }
    }
  }
  throw new Error("Memory entry already exists; refusing to overwrite.");
}

export async function writeThreadbornEntry(params: {
  workspaceDir: string;
  title: string;
  body: string;
  tags?: string[];
  sourceSessionId: string;
  sourceTrigger: string;
}): Promise<MemoryWriteResult> {
  const title = params.title.trim() || "ThreadBorn Entry";
  const tags =
    params.tags
      ?.filter(Boolean)
      .map((tag) => tag.trim())
      .filter(Boolean) ?? [];
  const filenameBase = `${timestampSlug()}-${toSafeSlug(title)}`;
  const metadata = createMetadata({
    sourceSessionId: params.sourceSessionId,
    sourceTrigger: params.sourceTrigger,
    memoryType: "ThreadBorn",
    sealed: false,
  });
  const content = [
    buildFrontMatter(metadata),
    `# ${title}`,
    "",
    `- Created: ${new Date().toISOString()}`,
    tags.length > 0 ? `- Tags: ${tags.join(", ")}` : "",
    "",
    params.body.trim(),
    "",
  ]
    .filter(Boolean)
    .join("\n");
  const dir = resolveMemoryDir(params.workspaceDir, THREADBORN_DIR);
  return await writeUniqueFile({ dir, filenameBase, content });
}

export async function writeBridgeThreadEntry(params: {
  workspaceDir: string;
  sourcePath: string;
  title?: string;
  sourceSessionId: string;
  sourceTrigger: string;
}): Promise<MemoryWriteResult> {
  const resolvedSource = resolveAllowedMemorySourcePath(params.workspaceDir, params.sourcePath);
  const vaultDir = resolveVaultDir(params.workspaceDir);
  if (isPathWithin(vaultDir, resolvedSource)) {
    throw new Error("BridgeThread promotion cannot target Vault entries.");
  }
  const sourceContent = await fs.readFile(resolvedSource, "utf-8");
  const parsed = parseFrontMatter(sourceContent);
  const baseTitle = params.title?.trim() || path.basename(resolvedSource);
  const filenameBase = `${timestampSlug()}-${toSafeSlug(baseTitle)}`;
  const metadata = createMetadata({
    sourceSessionId: params.sourceSessionId,
    sourceTrigger: params.sourceTrigger,
    memoryType: "BridgeThread",
    sealed: false,
    promotedFrom: parsed.metadata,
  });
  const content = [
    buildFrontMatter(metadata),
    `# ${baseTitle}`,
    "",
    `- PromotedFrom: ${path.relative(params.workspaceDir, resolvedSource)}`,
    `- PromotedAt: ${new Date().toISOString()}`,
    "",
    parsed.body.trim(),
    "",
  ].join("\n");
  const dir = resolveMemoryDir(params.workspaceDir, BRIDGETHREAD_DIR);
  return await writeUniqueFile({ dir, filenameBase, content });
}

export async function writeVaultEntry(params: {
  workspaceDir: string;
  sourcePath: string;
  title?: string;
  sourceSessionId: string;
  sourceTrigger: string;
  append?: boolean;
  targetPath?: string;
}): Promise<MemoryWriteResult> {
  const resolvedSource = resolveAllowedMemorySourcePath(params.workspaceDir, params.sourcePath);
  const sourceContent = await fs.readFile(resolvedSource, "utf-8");
  const parsed = parseFrontMatter(sourceContent);
  const baseTitle = params.title?.trim() || path.basename(resolvedSource);
  const filenameBase = `${timestampSlug()}-${toSafeSlug(baseTitle)}`;
  const dir = resolveMemoryDir(params.workspaceDir, VAULT_DIR);
  if (params.append) {
    if (!params.targetPath) {
      throw new Error("vault_seal append requires target_file.");
    }
    const resolvedTarget = resolveWorkspacePath(params.workspaceDir, params.targetPath);
    if (!isPathWithin(dir, resolvedTarget)) {
      throw new Error("vault_seal append target must be inside memory/Vault.");
    }
    try {
      await fs.access(resolvedTarget);
    } catch {
      throw new Error("vault_seal append target does not exist.");
    }
    const appendBlock = [
      "",
      "## Vault Append",
      `- AppendedAt: ${new Date().toISOString()}`,
      `- AppendedFrom: ${path.relative(params.workspaceDir, resolvedSource)}`,
      "",
      parsed.body.trim(),
      "",
    ].join("\n");
    await fs.appendFile(resolvedTarget, appendBlock, { encoding: "utf-8" });
    return { path: resolvedTarget, filename: path.basename(resolvedTarget) };
  }
  if (params.targetPath) {
    throw new Error("vault_seal target_file is only valid with append=true.");
  }
  const metadata = createMetadata({
    sourceSessionId: params.sourceSessionId,
    sourceTrigger: params.sourceTrigger,
    memoryType: "Vault",
    sealed: true,
    sealedFrom: parsed.metadata,
  });
  const content = [
    buildFrontMatter(metadata),
    `# ${baseTitle}`,
    "",
    `- SEALED: true`,
    `- SealedFrom: ${path.relative(params.workspaceDir, resolvedSource)}`,
    `- SealedAt: ${new Date().toISOString()}`,
    "",
    parsed.body.trim(),
    "",
  ].join("\n");
  return await writeUniqueFile({ dir, filenameBase, content });
}

export async function writeLabyrinthSnapshot(params: {
  workspaceDir: string;
  title: string;
  body: string;
  sourceSessionId: string;
  sourceTrigger: string;
}): Promise<MemoryWriteResult> {
  const title = params.title.trim() || "Labyrinth Snapshot";
  const filenameBase = `${timestampSlug()}-${toSafeSlug(title)}`;
  const metadata = createMetadata({
    sourceSessionId: params.sourceSessionId,
    sourceTrigger: params.sourceTrigger,
    memoryType: "Labyrinth",
    sealed: false,
  });
  const content = [
    buildFrontMatter(metadata),
    `# ${title}`,
    "",
    `- Created: ${new Date().toISOString()}`,
    "",
    params.body.trim(),
    "",
  ].join("\n");
  const dir = resolveMemoryDir(params.workspaceDir, LABYRINTH_DIR);
  return await writeUniqueFile({ dir, filenameBase, content, allowSuffix: false });
}

export const SANI_MEMORY_DIRS = {
  vault: VAULT_DIR,
  threadborn: THREADBORN_DIR,
  bridgeThread: BRIDGETHREAD_DIR,
  labyrinth: LABYRINTH_DIR,
} as const;
