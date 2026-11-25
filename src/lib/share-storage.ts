import { randomUUID } from "node:crypto";

export type SharedFileMetadata = {
  id: string;
  filename: string;
  size: number;
  mimeType: string;
  uploadedAt: string;
  expiresAt: string;
  downloadCount: number;
};

export type SharedFileRecord = SharedFileMetadata & {
  data: Buffer;
  lastAccessedAt: number;
};

type ShareRegistry = typeof globalThis & {
  __clearpdfSharedFiles?: Map<string, SharedFileRecord>;
  __clearpdfSharedCleanupTimer?: ReturnType<typeof setInterval>;
};

const registry = globalThis as ShareRegistry;
const sharedFiles = (registry.__clearpdfSharedFiles ??= new Map<string, SharedFileRecord>());

const SHARE_TTL_MS = 48 * 60 * 60 * 1000; // 48 hours

export function pruneExpiredSharedFiles(now = Date.now()) {
  for (const [id, record] of sharedFiles) {
    if (now >= new Date(record.expiresAt).getTime()) {
      sharedFiles.delete(id);
    }
  }
}

if (!registry.__clearpdfSharedCleanupTimer) {
  registry.__clearpdfSharedCleanupTimer = setInterval(() => {
    pruneExpiredSharedFiles();
  }, 10 * 60 * 1000);
}

export function createSharedFile({
  filename,
  mimeType,
  data,
}: {
  filename: string;
  mimeType: string;
  data: Buffer;
}): SharedFileMetadata {
  pruneExpiredSharedFiles();

  // Generate a clean, 10-character unique share ID
  const id = randomUUID().replace(/-/g, "").slice(0, 10);
  const now = new Date();
  const expires = new Date(now.getTime() + SHARE_TTL_MS);

  const cleanFilename = filename.replace(/[\u0000-\u001f\u007f]/g, "").slice(0, 200) || "shared-file";

  const record: SharedFileRecord = {
    id,
    filename: cleanFilename,
    size: data.byteLength,
    mimeType: mimeType || "application/octet-stream",
    data,
    uploadedAt: now.toISOString(),
    expiresAt: expires.toISOString(),
    downloadCount: 0,
    lastAccessedAt: Date.now(),
  };

  sharedFiles.set(id, record);

  return {
    id: record.id,
    filename: record.filename,
    size: record.size,
    mimeType: record.mimeType,
    uploadedAt: record.uploadedAt,
    expiresAt: record.expiresAt,
    downloadCount: record.downloadCount,
  };
}

export function getSharedFile(id: string): SharedFileRecord | null {
  const record = sharedFiles.get(id);
  if (!record) return null;

  if (Date.now() >= new Date(record.expiresAt).getTime()) {
    sharedFiles.delete(id);
    return null;
  }

  record.lastAccessedAt = Date.now();
  return record;
}

export function getSharedMetadata(id: string): SharedFileMetadata | null {
  const record = getSharedFile(id);
  if (!record) return null;

  return {
    id: record.id,
    filename: record.filename,
    size: record.size,
    mimeType: record.mimeType,
    uploadedAt: record.uploadedAt,
    expiresAt: record.expiresAt,
    downloadCount: record.downloadCount,
  };
}

export function incrementDownloadCount(id: string): number {
  const record = sharedFiles.get(id);
  if (!record) return 0;
  record.downloadCount += 1;
  record.lastAccessedAt = Date.now();
  return record.downloadCount;
}
