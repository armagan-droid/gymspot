import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";

// Encrypted object storage for calibration recordings — specs/07 "Kalibrasyon modu".

export interface BlobStore {
  put(key: string, data: Uint8Array): Promise<void>;
  get(key: string): Promise<Uint8Array | null>;
  delete(key: string): Promise<void>;
}

const VERSION = 1;

/** AES-256-GCM: [version | iv(12) | tag(16) | ciphertext]; `aad` binds the blob to its owner. */
export function encryptBlob(plain: Uint8Array, key: Uint8Array, aad: string): Uint8Array {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(Buffer.from(aad));
  const body = Buffer.concat([cipher.update(plain), cipher.final()]);
  return Buffer.concat([Buffer.from([VERSION]), iv, cipher.getAuthTag(), body]);
}

export function decryptBlob(blob: Uint8Array, key: Uint8Array, aad: string): Buffer {
  const b = Buffer.from(blob);
  if (b[0] !== VERSION) throw new Error("unknown blob version");
  const decipher = createDecipheriv("aes-256-gcm", key, b.subarray(1, 13));
  decipher.setAAD(Buffer.from(aad));
  decipher.setAuthTag(b.subarray(13, 29));
  return Buffer.concat([decipher.update(b.subarray(29)), decipher.final()]);
}

export class MemoryBlobStore implements BlobStore {
  readonly blobs = new Map<string, Uint8Array>();
  async put(key: string, data: Uint8Array) {
    this.blobs.set(key, data);
  }
  async get(key: string) {
    return this.blobs.get(key) ?? null;
  }
  async delete(key: string) {
    this.blobs.delete(key);
  }
}

/** Local directory store for development; production uses an object store (T5.4). */
export class FileBlobStore implements BlobStore {
  private readonly root: string;
  constructor(root: string) {
    this.root = resolve(root);
  }
  private path(key: string) {
    const p = resolve(join(this.root, key));
    if (!p.startsWith(this.root)) throw new Error("invalid key");
    return p;
  }
  async put(key: string, data: Uint8Array) {
    const p = this.path(key);
    await mkdir(dirname(p), { recursive: true });
    await writeFile(p, data);
  }
  async get(key: string) {
    return readFile(this.path(key)).catch(() => null);
  }
  async delete(key: string) {
    await rm(this.path(key), { force: true });
  }
}
