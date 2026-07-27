// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { promises as fs, createReadStream, createWriteStream } from 'node:fs';
import { join, dirname } from 'node:path';
import { createHmac, randomUUID } from 'node:crypto';
import {
  NoopMetricsRegistry,
  SEMCONV,
  type MetricsRegistry,
} from '@objectstack/observability';
import type {
  IStorageService,
  StorageUploadOptions,
  StorageFileInfo,
  PresignedUploadDescriptor,
  PresignedDownloadDescriptor,
  PresignedDownloadOptions,
} from '@objectstack/spec/contracts';

/**
 * Configuration options for LocalStorageAdapter.
 */
export interface LocalStorageAdapterOptions {
  /** Root directory for committed files */
  rootDir: string;
  /**
   * Public base URL the adapter prepends to presigned upload / download URLs.
   * Defaults to a relative path so the same-origin REST server handles the
   * request. Override (e.g. `https://api.example.com`) when the storage
   * routes are exposed on a different host.
   * @default ''
   */
  baseUrl?: string;
  /**
   * Base path of the local storage REST routes mounted by
   * `StorageServicePlugin`. Used to construct presigned URLs.
   * @default '/api/v1/storage'
   */
  basePath?: string;
  /**
   * HMAC secret used to sign presigned-upload tokens.
   * Auto-generated if omitted (suitable for single-process dev usage).
   */
  signingSecret?: string;
  /** Optional MetricsRegistry for instrumentation. Defaults to NoopMetricsRegistry. */
  metrics?: MetricsRegistry;
}

interface PresignTokenPayload {
  k: string;       // storage key
  ct?: string;     // content-type
  n?: string;      // download filename (Content-Disposition)
  d?: 'inline' | 'attachment'; // disposition type (default 'inline')
  exp: number;     // expiry epoch seconds
  op: 'put' | 'get';
}

/**
 * Local filesystem storage adapter implementing IStorageService.
 *
 * Stores committed files under `rootDir/`, in-flight multipart parts under
 * `rootDir/.parts/<uploadId>/<chunkIndex>`. Presigned URLs are HMAC-signed
 * tokens redeemed against the local REST routes mounted by
 * `StorageServicePlugin` — letting the browser PUT bytes directly without
 * proxying through the application logic.
 *
 * Suitable for development, testing, and single-server deployments.
 */
export class LocalStorageAdapter implements IStorageService {
  private readonly rootDir: string;
  private readonly partsDir: string;
  private readonly baseUrl: string;
  private readonly basePath: string;
  private readonly signingSecret: string;
  private readonly metrics: MetricsRegistry;

  constructor(options: LocalStorageAdapterOptions) {
    this.rootDir = options.rootDir;
    this.partsDir = join(this.rootDir, '.parts');
    this.baseUrl = options.baseUrl ?? '';
    this.basePath = options.basePath ?? '/api/v1/storage';
    this.signingSecret = options.signingSecret ?? randomUUID();
    this.metrics = options.metrics ?? new NoopMetricsRegistry();
  }

  /**
   * Wrap a storage operation with metrics instrumentation. Never swallows
   * the underlying error; instrumentation failures are silently ignored.
   */
  private async track<T>(op: 'put' | 'get' | 'delete' | 'head' | 'list', fn: () => Promise<T>): Promise<T> {
    const started = Date.now();
    const baseLabels = { adapter: 'local', op } as const;
    try {
      const out = await fn();
      try {
        this.metrics.counter(SEMCONV.storageOperationsTotal, { ...baseLabels, result: 'ok' });
        this.metrics.histogram(SEMCONV.storageOperationDurationMs, Date.now() - started, baseLabels);
      } catch { /* never throw */ }
      return out;
    } catch (err: any) {
      try {
        this.metrics.counter(SEMCONV.storageOperationsTotal, { ...baseLabels, result: 'error' });
        this.metrics.histogram(SEMCONV.storageOperationDurationMs, Date.now() - started, baseLabels);
        const errorClass = err?.name || err?.constructor?.name || 'Error';
        this.metrics.counter(SEMCONV.storageErrorsTotal, { ...baseLabels, errorClass });
      } catch { /* never throw */ }
      throw err;
    }
  }

  // ---------------------------------------------------------------------------
  // Path helpers
  // ---------------------------------------------------------------------------

  private resolvePath(key: string): string {
    if (key.includes('..')) {
      throw new Error(`LocalStorageAdapter: path traversal not allowed (key="${key}")`);
    }
    return join(this.rootDir, key);
  }

  private resolvePartPath(uploadId: string, partNumber: number): string {
    if (!/^[A-Za-z0-9_-]+$/.test(uploadId)) {
      throw new Error(`LocalStorageAdapter: invalid uploadId "${uploadId}"`);
    }
    return join(this.partsDir, uploadId, String(partNumber).padStart(8, '0'));
  }

  // ---------------------------------------------------------------------------
  // Basic file operations
  // ---------------------------------------------------------------------------

  async upload(
    key: string,
    data: Buffer | ReadableStream,
    _options?: StorageUploadOptions,
  ): Promise<void> {
    return this.track('put', async () => {
      const filePath = this.resolvePath(key);
      await fs.mkdir(dirname(filePath), { recursive: true });

      if (data instanceof Buffer) {
        await fs.writeFile(filePath, data);
        return;
      }

      // Convert ReadableStream to Buffer
      const chunks: Uint8Array[] = [];
      const reader = (data as ReadableStream).getReader();
      let done = false;
      while (!done) {
        const result = await reader.read();
        done = result.done;
        if (result.value) chunks.push(result.value);
      }
      await fs.writeFile(filePath, Buffer.concat(chunks));
    });
  }

  async download(key: string): Promise<Buffer> {
    return this.track('get', async () => fs.readFile(this.resolvePath(key)));
  }

  async delete(key: string): Promise<void> {
    return this.track('delete', async () => {
      await fs.unlink(this.resolvePath(key)).catch((err) => {
        if (err && err.code === 'ENOENT') return;
        throw err;
      });
    });
  }

  async exists(key: string): Promise<boolean> {
    return this.track('head', async () => {
      try {
        await fs.access(this.resolvePath(key));
        return true;
      } catch {
        return false;
      }
    });
  }

  async getInfo(key: string): Promise<StorageFileInfo> {
    return this.track('head', async () => {
      const filePath = this.resolvePath(key);
      const stat = await fs.stat(filePath);
      return { key, size: stat.size, lastModified: stat.mtime };
    });
  }

  async list(prefix: string): Promise<StorageFileInfo[]> {
    return this.track('list', async () => {
      const dirPath = this.resolvePath(prefix);
      try {
        const entries = await fs.readdir(dirPath);
        const results: StorageFileInfo[] = [];
        for (const entry of entries) {
          if (entry.startsWith('.')) continue;
          const fullKey = prefix ? `${prefix}/${entry}` : entry;
          try {
            // Inline stat to avoid double-counting `head` operations.
            const stat = await fs.stat(this.resolvePath(fullKey));
            results.push({ key: fullKey, size: stat.size, lastModified: stat.mtime });
          } catch {
            /* skip */
          }
        }
        return results;
      } catch {
        return [];
      }
    });
  }

  // ---------------------------------------------------------------------------
  // Presigned URL helpers
  // ---------------------------------------------------------------------------

  /**
   * Sign an opaque token for the given payload.
   * Format: base64url(JSON.stringify(payload)) + '.' + base64url(HMAC)
   */
  private signToken(payload: PresignTokenPayload): string {
    const b64 = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
    const sig = createHmac('sha256', this.signingSecret).update(b64).digest('base64url');
    return `${b64}.${sig}`;
  }

  /**
   * Verify and decode a presigned token. Throws on invalid signature or
   * expiration.
   */
  verifyToken(token: string, expectedOp: 'put' | 'get'): PresignTokenPayload {
    const [b64, sig] = token.split('.');
    if (!b64 || !sig) throw new Error('Invalid storage token format');

    const expected = createHmac('sha256', this.signingSecret).update(b64).digest('base64url');
    if (expected !== sig) throw new Error('Invalid storage token signature');

    let payload: PresignTokenPayload;
    try {
      payload = JSON.parse(Buffer.from(b64, 'base64url').toString('utf8'));
    } catch {
      throw new Error('Malformed storage token payload');
    }

    if (payload.op !== expectedOp) {
      throw new Error(`Storage token op mismatch (expected="${expectedOp}", actual="${payload.op}")`);
    }
    if (Date.now() / 1000 > payload.exp) {
      throw new Error('Storage token expired');
    }
    return payload;
  }

  async getPresignedUpload(
    key: string,
    expiresIn: number,
    options?: StorageUploadOptions,
  ): Promise<PresignedUploadDescriptor> {
    const exp = Math.floor(Date.now() / 1000) + Math.max(1, expiresIn);
    const token = this.signToken({ k: key, ct: options?.contentType, exp, op: 'put' });

    return {
      uploadUrl: `${this.baseUrl}${this.basePath}/_local/raw/${token}`,
      method: 'PUT',
      headers: options?.contentType ? { 'content-type': options.contentType } : { 'content-type': 'application/octet-stream' },
      expiresIn,
      downloadUrl: `${this.baseUrl}${this.basePath}/_local/file/${encodeURIComponent(key)}`,
    };
  }

  async getPresignedDownload(
    key: string,
    expiresIn: number,
    options?: PresignedDownloadOptions,
  ): Promise<PresignedDownloadDescriptor> {
    const exp = Math.floor(Date.now() / 1000) + Math.max(1, expiresIn);
    // Carry filename + content-type in the token so the `_local/raw` route can
    // emit a real Content-Disposition / Content-Type (else the browser saves
    // the file under the opaque token, as `application/octet-stream`).
    const token = this.signToken({
      k: key,
      exp,
      op: 'get',
      ct: options?.contentType,
      n: options?.filename,
      d: options?.disposition,
    });
    return {
      downloadUrl: `${this.baseUrl}${this.basePath}/_local/raw/${token}`,
      expiresIn,
    };
  }

  async getSignedUrl(key: string, expiresIn: number, options?: PresignedDownloadOptions): Promise<string> {
    const desc = await this.getPresignedDownload(key, expiresIn, options);
    return desc.downloadUrl;
  }

  // ---------------------------------------------------------------------------
  // Chunked / multipart upload
  // ---------------------------------------------------------------------------

  async initiateChunkedUpload(key: string, options?: StorageUploadOptions): Promise<string> {
    const uploadId = randomUUID().replace(/-/g, '');
    const dir = join(this.partsDir, uploadId);
    await fs.mkdir(dir, { recursive: true });
    const meta = {
      key,
      contentType: options?.contentType,
      metadata: options?.metadata,
      createdAt: new Date().toISOString(),
    };
    await fs.writeFile(join(dir, '_meta.json'), JSON.stringify(meta), 'utf8');
    return uploadId;
  }

  async uploadChunk(uploadId: string, partNumber: number, data: Buffer): Promise<string> {
    if (!Number.isInteger(partNumber) || partNumber < 1) {
      throw new Error(`uploadChunk: partNumber must be a positive integer (got ${partNumber})`);
    }
    const partPath = this.resolvePartPath(uploadId, partNumber);
    await fs.mkdir(dirname(partPath), { recursive: true });
    await fs.writeFile(partPath, data);
    // ETag for local mode = hex md5 of part bytes (matches S3 single-part ETag format)
    const { createHash } = await import('node:crypto');
    return createHash('md5').update(data).digest('hex');
  }

  async completeChunkedUpload(
    uploadId: string,
    parts: Array<{ partNumber: number; eTag: string }>,
  ): Promise<string> {
    const dir = join(this.partsDir, uploadId);
    let meta: { key?: string } = {};
    try {
      meta = JSON.parse(await fs.readFile(join(dir, '_meta.json'), 'utf8'));
    } catch {
      throw new Error(`Upload session "${uploadId}" not found`);
    }
    const targetKey = meta.key;
    if (!targetKey) {
      throw new Error(`Upload session "${uploadId}" missing target key`);
    }

    const sortedParts = [...parts].sort((a, b) => a.partNumber - b.partNumber);
    const finalPath = this.resolvePath(targetKey);
    await fs.mkdir(dirname(finalPath), { recursive: true });

    // Stream-concat parts into the final file
    const out = createWriteStream(finalPath);
    try {
      for (const p of sortedParts) {
        const partPath = this.resolvePartPath(uploadId, p.partNumber);
        await new Promise<void>((resolve, reject) => {
          const inp = createReadStream(partPath);
          inp.on('error', reject);
          inp.on('end', () => resolve());
          inp.pipe(out, { end: false });
        });
      }
    } finally {
      await new Promise<void>((resolve) => out.end(() => resolve()));
    }

    // Cleanup part directory
    await fs.rm(dir, { recursive: true, force: true });
    return targetKey;
  }

  async abortChunkedUpload(uploadId: string): Promise<void> {
    await fs.rm(join(this.partsDir, uploadId), { recursive: true, force: true });
  }
}
