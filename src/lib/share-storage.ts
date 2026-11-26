import { createReadStream, createWriteStream } from "node:fs";
import { access, mkdir, readdir, rename, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
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
  filePath: string;
  lastAccessedAt: number;
};

type ShareRegistry = typeof globalThis & {
  __clearpdfSharedFiles?: Map<string, SharedFileRecord>;
  __clearpdfSharedDiskBytes?: number;
  __clearpdfSharedReservedBytes?: number;
  __clearpdfShareStorageInit?: Promise<void>;
  __clearpdfSharedCleanupTimer?: ReturnType<typeof setInterval>;
};

const registry = globalThis as ShareRegistry;
const sharedFiles = (registry.__clearpdfSharedFiles ??= new Map<string, SharedFileRecord>());
const SHARE_DATA_DIR = join(tmpdir(), "clearpdf-shared-files");
const SHARE_TTL_MS = 48 * 60 * 60 * 1000;
const MAX_SHARED_BYTES = 512 * 1024 * 1024;

export class SharedStorageFullError extends Error {
  constructor() {
    super("Temporary file sharing storage is full. Please try again later.");
    this.name = "SharedStorageFullError";
  }
}

async function ensureShareDirectory() {
  if (!registry.__clearpdfShareStorageInit) {
    registry.__clearpdfShareStorageInit = (async () => {
      // Shared files were previously held only in process memory and vanished on restart.
      // Clear stale disk files at startup while retaining links during hot reloads.
      await rm(SHARE_DATA_DIR, { recursive: true, force: true });
      await mkdir(SHARE_DATA_DIR, { recursive: true });
      registry.__clearpdfSharedDiskBytes = 0;
    })();
  }
  try {
    await registry.__clearpdfShareStorageInit;
  } catch (error) {
    registry.__clearpdfShareStorageInit = undefined;
    throw error;
  }
}

function storedBytes() {
  let total = 0;
  for (const file of sharedFiles.values()) total += file.size;
  return total;
}

function removeSharedFileRecord(id: string) {
  const record = sharedFiles.get(id);
  if (!record) return;
  sharedFiles.delete(id);
  registry.__clearpdfSharedDiskBytes = Math.max(0, (registry.__clearpdfSharedDiskBytes ?? 0) - record.size);
  void rm(record.filePath, { force: true }).catch(() => undefined);
}

export function pruneExpiredSharedFiles(now = Date.now()) {
  for (const [id, record] of sharedFiles) {
    if (now >= new Date(record.expiresAt).getTime()) removeSharedFileRecord(id);
  }
}

async function pruneOrphanedSharedFiles(now = Date.now()) {
  try {
    await ensureShareDirectory();
    const files = await readdir(SHARE_DATA_DIR, { withFileTypes: true });
    let total = 0;
    for (const file of files) {
      const path = join(SHARE_DATA_DIR, file.name);
      if (!file.isFile()) {
        await rm(path, { recursive: true, force: true });
        continue;
      }
      if (file.name.endsWith(".blob.tmp")) {
        const temporaryFile = await stat(path);
        if (now - temporaryFile.mtimeMs >= 60 * 60 * 1000) await rm(path, { force: true });
        continue;
      }
      const match = /^(\d+)-([a-f0-9]{10})\.blob$/.exec(file.name);
      if (!match) {
        await rm(path, { force: true });
        continue;
      }
      if (now - Number(match[1]) >= SHARE_TTL_MS) {
        await rm(path, { force: true });
        continue;
      }
      total += (await stat(path)).size;
    }
    // Avoid overwriting in-flight reservations when a periodic cleanup overlaps an upload.
    if ((registry.__clearpdfSharedReservedBytes ?? 0) === 0) registry.__clearpdfSharedDiskBytes = total;
  } catch {
    // A later cleanup or upload can retry directory initialization.
  }
}

if (!registry.__clearpdfSharedCleanupTimer) {
  registry.__clearpdfSharedCleanupTimer = setInterval(() => {
    pruneExpiredSharedFiles();
    void pruneOrphanedSharedFiles();
  }, 10 * 60 * 1000);
  registry.__clearpdfSharedCleanupTimer.unref?.();
}

export async function createSharedFile({
  filename,
  mimeType,
  stream,
  size,
}: {
  filename: string;
  mimeType: string;
  stream: ReadableStream<Uint8Array>;
  size: number;
}): Promise<SharedFileMetadata> {
  await ensureShareDirectory();
  pruneExpiredSharedFiles();

  const currentBytes = Math.max(registry.__clearpdfSharedDiskBytes ?? storedBytes(), storedBytes());
  const reservedBytes = registry.__clearpdfSharedReservedBytes ?? 0;
  if (size <= 0 || size > MAX_SHARED_BYTES || currentBytes + reservedBytes + size > MAX_SHARED_BYTES) {
    throw new SharedStorageFullError();
  }
  registry.__clearpdfSharedReservedBytes = reservedBytes + size;

  const id = randomUUID().replace(/-/g, "").slice(0, 10);
  const now = new Date();
  const uploadedAt = now.toISOString();
  const expiresAt = new Date(now.getTime() + SHARE_TTL_MS).toISOString();
  const filePath = join(SHARE_DATA_DIR, `${now.getTime()}-${id}.blob`);
  const temporaryPath = `${filePath}.tmp`;

  try {
    const nodeStream = Readable.fromWeb(stream as import("node:stream/web").ReadableStream<Uint8Array>);
    await pipeline(nodeStream, createWriteStream(temporaryPath, { flags: "wx" }));
    const writtenSize = (await stat(temporaryPath)).size;
    if (writtenSize !== size) throw new Error("The uploaded file was incomplete. Please retry.");
    await rename(temporaryPath, filePath);

    const cleanFilename = filename.replace(/[\u0000-\u001f\u007f]/g, "").slice(0, 200) || "shared-file";
    const record: SharedFileRecord = {
      id,
      filename: cleanFilename,
      size: writtenSize,
      mimeType: mimeType || "application/octet-stream",
      filePath,
      uploadedAt,
      expiresAt,
      downloadCount: 0,
      lastAccessedAt: Date.now(),
    };
    sharedFiles.set(id, record);
    registry.__clearpdfSharedDiskBytes = (registry.__clearpdfSharedDiskBytes ?? 0) + writtenSize;

    return {
      id: record.id,
      filename: record.filename,
      size: record.size,
      mimeType: record.mimeType,
      uploadedAt: record.uploadedAt,
      expiresAt: record.expiresAt,
      downloadCount: record.downloadCount,
    };
  } catch (error) {
    await rm(temporaryPath, { force: true }).catch(() => undefined);
    await rm(filePath, { force: true }).catch(() => undefined);
    throw error;
  } finally {
    registry.__clearpdfSharedReservedBytes = Math.max(0, (registry.__clearpdfSharedReservedBytes ?? 0) - size);
  }
}

export function getSharedFile(id: string): SharedFileRecord | null {
  pruneExpiredSharedFiles();
  const record = sharedFiles.get(id);
  if (!record) return null;
  record.lastAccessedAt = Date.now();
  return record;
}

export function deleteSharedFile(id: string) {
  removeSharedFileRecord(id);
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

export async function sharedFileExists(filePath: string) {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

export function openSharedFile(filePath: string) {
  return Readable.toWeb(createReadStream(filePath)) as ReadableStream<Uint8Array>;
}
