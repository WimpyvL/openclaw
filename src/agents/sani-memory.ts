import fs from "node:fs/promises";
import path from "node:path";

const MEMORY_ROOT = "memory";
const VAULT_DIR = "Vault";
const THREADBORN_DIR = "ThreadBorn";
const BRIDGETHREAD_DIR = "BridgeThread";
const LABYRINTH_DIR = "Labyrinth";

const SAFE_NAME_PATTERN = /[^a-z0-9._-]+/gi;
const MAX_SLUG_LENGTH = 60;

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

async function writeUniqueFile(params: {
  dir: string;
  filenameBase: string;
  content: string;
}): Promise<MemoryWriteResult> {
  await ensureDir(params.dir);
  for (let attempt = 0; attempt < 5; attempt += 1) {
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
  throw new Error("Failed to write memory entry after multiple attempts.");
}

export async function writeThreadbornEntry(params: {
  workspaceDir: string;
  title: string;
  body: string;
  tags?: string[];
}): Promise<MemoryWriteResult> {
  const title = params.title.trim() || "ThreadBorn Entry";
  const tags = params.tags?.filter(Boolean).map((tag) => tag.trim()).filter(Boolean) ?? [];
  const filenameBase = `${timestampSlug()}-${toSafeSlug(title)}`;
  const content = [
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
  const dir = path.join(params.workspaceDir, MEMORY_ROOT, THREADBORN_DIR);
  return await writeUniqueFile({ dir, filenameBase, content });
}

export async function writeBridgeThreadEntry(params: {
  workspaceDir: string;
  sourcePath: string;
  title?: string;
}): Promise<MemoryWriteResult> {
  const resolvedSource = resolveWorkspacePath(params.workspaceDir, params.sourcePath);
  const sourceContent = await fs.readFile(resolvedSource, "utf-8");
  const baseTitle = params.title?.trim() || path.basename(resolvedSource);
  const filenameBase = `${timestampSlug()}-${toSafeSlug(baseTitle)}`;
  const content = [
    `# ${baseTitle}`,
    "",
    `- PromotedFrom: ${path.relative(params.workspaceDir, resolvedSource)}`,
    `- PromotedAt: ${new Date().toISOString()}`,
    "",
    sourceContent.trim(),
    "",
  ].join("\n");
  const dir = path.join(params.workspaceDir, MEMORY_ROOT, BRIDGETHREAD_DIR);
  return await writeUniqueFile({ dir, filenameBase, content });
}

export async function writeVaultEntry(params: {
  workspaceDir: string;
  sourcePath: string;
  title?: string;
}): Promise<MemoryWriteResult> {
  const resolvedSource = resolveWorkspacePath(params.workspaceDir, params.sourcePath);
  const sourceContent = await fs.readFile(resolvedSource, "utf-8");
  const baseTitle = params.title?.trim() || path.basename(resolvedSource);
  const filenameBase = `${timestampSlug()}-${toSafeSlug(baseTitle)}`;
  const content = [
    `# ${baseTitle}`,
    "",
    `- SEALED: true`,
    `- SealedFrom: ${path.relative(params.workspaceDir, resolvedSource)}`,
    `- SealedAt: ${new Date().toISOString()}`,
    "",
    sourceContent.trim(),
    "",
  ].join("\n");
  const dir = path.join(params.workspaceDir, MEMORY_ROOT, VAULT_DIR);
  return await writeUniqueFile({ dir, filenameBase, content });
}

export async function writeLabyrinthSnapshot(params: {
  workspaceDir: string;
  title: string;
  body: string;
}): Promise<MemoryWriteResult> {
  const title = params.title.trim() || "Labyrinth Snapshot";
  const filenameBase = `${timestampSlug()}-${toSafeSlug(title)}`;
  const content = [
    `# ${title}`,
    "",
    `- Created: ${new Date().toISOString()}`,
    "",
    params.body.trim(),
    "",
  ].join("\n");
  const dir = path.join(params.workspaceDir, MEMORY_ROOT, LABYRINTH_DIR);
  return await writeUniqueFile({ dir, filenameBase, content });
}

export const SANI_MEMORY_DIRS = {
  vault: VAULT_DIR,
  threadborn: THREADBORN_DIR,
  bridgeThread: BRIDGETHREAD_DIR,
  labyrinth: LABYRINTH_DIR,
} as const;
