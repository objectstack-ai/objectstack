// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import {
  NoopMetricsRegistry,
  SEMCONV,
  type MetricsRegistry,
} from '@objectstack/observability';
import type {
  IStorageService,
  StorageUploadOptions,
  StorageFileInfo,
  StorageListOptions,
  StorageListPage,
  PresignedUploadDescriptor,
  PresignedDownloadDescriptor,
  PresignedDownloadOptions,
} from '@objectstack/spec/contracts';
import {
  decodeStorageListCursor,
  encodeStorageListCursor,
  resolveStorageListLimit,
} from '@objectstack/spec/contracts';
import { contentDispositionValue } from './content-disposition.js';

/**
 * Hard ceiling `ListObjectsV2` applies to `MaxKeys`, regardless of what the
 * caller asks for. It is the number that silently truncated the retired
 * `list(prefix)` (#5266); here it only ever bounds ONE round-trip, and `list()`
 * loops until the caller's page is full.
 */
const S3_LIST_MAX_KEYS = 1000;

/**
 * Configuration for the S3 storage adapter.
 */
export interface S3StorageAdapterOptions {
  /** S3 bucket name */
  bucket: string;
  /** AWS region (e.g. 'us-east-1') */
  region: string;
  /** Optional endpoint URL for S3-compatible services (MinIO, R2, etc.) */
  endpoint?: string;
  /** AWS access key ID (falls back to env/SDK chain) */
  accessKeyId?: string;
  /** AWS secret access key (falls back to env/SDK chain) */
  secretAccessKey?: string;
  /** Force path-style URLs (needed for MinIO / self-hosted) */
  forcePathStyle?: boolean;
  /** Optional MetricsRegistry for instrumentation. Defaults to NoopMetricsRegistry. */
  metrics?: MetricsRegistry;
}

/**
 * S3 storage adapter implementing IStorageService.
 *
 * Uses `@aws-sdk/client-s3` and `@aws-sdk/s3-request-presigner` as
 * peer dependencies. These must be installed separately when using the S3
 * adapter in production.
 *
 * @example
 * ```ts
 * const storage = new S3StorageAdapter({
 *   bucket: 'my-bucket',
 *   region: 'us-east-1',
 * });
 * await storage.upload('path/to/file.txt', buffer);
 * ```
 */
export class S3StorageAdapter implements IStorageService {
  private readonly bucket: string;
  private readonly region: string;
  private readonly endpoint?: string;
  private readonly forcePathStyle: boolean;
  private readonly metrics: MetricsRegistry;
  private clientPromise: Promise<any> | null = null;

  constructor(private readonly options: S3StorageAdapterOptions) {
    this.bucket = options.bucket;
    this.region = options.region;
    this.endpoint = options.endpoint;
    this.forcePathStyle = options.forcePathStyle ?? false;
    this.metrics = options.metrics ?? new NoopMetricsRegistry();
  }

  /**
   * Wrap a storage operation with metrics instrumentation.
   * Records ok/error counters, a duration histogram, and an error counter
   * keyed by error class on failure. Never swallows the underlying error.
   */
  private async track<T>(op: 'put' | 'get' | 'delete' | 'head' | 'list', fn: () => Promise<T>): Promise<T> {
    const started = Date.now();
    const baseLabels = { adapter: 's3', op } as const;
    try {
      const out = await fn();
      try {
        this.metrics.counter(SEMCONV.storageOperationsTotal, { ...baseLabels, result: 'ok' });
        this.metrics.histogram(SEMCONV.storageOperationDurationMs, Date.now() - started, baseLabels);
      } catch { /* never throw from instrumentation */ }
      return out;
    } catch (err: any) {
      try {
        this.metrics.counter(SEMCONV.storageOperationsTotal, { ...baseLabels, result: 'error' });
        this.metrics.histogram(SEMCONV.storageOperationDurationMs, Date.now() - started, baseLabels);
        const errorClass = err?.name || err?.constructor?.name || 'Error';
        this.metrics.counter(SEMCONV.storageErrorsTotal, { ...baseLabels, errorClass });
      } catch { /* never throw from instrumentation */ }
      throw err;
    }
  }

  /**
   * Lazily resolve the AWS S3 client to avoid crashing at import time when
   * `@aws-sdk/client-s3` isn't installed.
   */
  private async getClient(): Promise<any> {
    if (!this.clientPromise) {
      this.clientPromise = (async () => {
        let s3Mod: any;
        try {
          s3Mod = await import('@aws-sdk/client-s3');
        } catch {
          throw new Error(
            'S3StorageAdapter requires @aws-sdk/client-s3. Install it with: pnpm add @aws-sdk/client-s3 @aws-sdk/s3-request-presigner',
          );
        }
        const { S3Client } = s3Mod;
        const clientOpts: any = { region: this.region };
        if (this.endpoint) clientOpts.endpoint = this.endpoint;
        if (this.forcePathStyle) clientOpts.forcePathStyle = true;
        if (this.options.accessKeyId && this.options.secretAccessKey) {
          clientOpts.credentials = {
            accessKeyId: this.options.accessKeyId,
            secretAccessKey: this.options.secretAccessKey,
          };
        }
        return new S3Client(clientOpts);
      })();
    }
    return this.clientPromise;
  }

  private async s3Mod(): Promise<any> {
    try {
      return await import('@aws-sdk/client-s3');
    } catch {
      throw new Error('S3StorageAdapter requires @aws-sdk/client-s3');
    }
  }

  private async presignerMod(): Promise<any> {
    try {
      return await import('@aws-sdk/s3-request-presigner');
    } catch {
      throw new Error('S3StorageAdapter requires @aws-sdk/s3-request-presigner');
    }
  }

  // ---------------------------------------------------------------------------
  // Basic operations
  // ---------------------------------------------------------------------------

  async upload(key: string, data: Buffer | ReadableStream, options?: StorageUploadOptions): Promise<void> {
    return this.track('put', async () => {
      const client = await this.getClient();
      const s3 = await this.s3Mod();
      const body = data instanceof Buffer ? data : await streamToBuffer(data);
      const cmd = new s3.PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: body,
        ContentType: options?.contentType,
        Metadata: options?.metadata,
        ACL: options?.acl === 'public-read' ? 'public-read' : undefined,
      });
      await client.send(cmd);
    });
  }

  async download(key: string): Promise<Buffer> {
    return this.track('get', async () => {
      const client = await this.getClient();
      const s3 = await this.s3Mod();
      const cmd = new s3.GetObjectCommand({ Bucket: this.bucket, Key: key });
      const res = await client.send(cmd);
      return streamToBuffer(res.Body);
    });
  }

  async delete(key: string): Promise<void> {
    return this.track('delete', async () => {
      const client = await this.getClient();
      const s3 = await this.s3Mod();
      const cmd = new s3.DeleteObjectCommand({ Bucket: this.bucket, Key: key });
      await client.send(cmd);
    });
  }

  async exists(key: string): Promise<boolean> {
    return this.track('head', async () => {
      const client = await this.getClient();
      const s3 = await this.s3Mod();
      try {
        const cmd = new s3.HeadObjectCommand({ Bucket: this.bucket, Key: key });
        await client.send(cmd);
        return true;
      } catch (err: any) {
        if (err.name === 'NotFound' || err.$metadata?.httpStatusCode === 404) return false;
        throw err;
      }
    });
  }

  async getInfo(key: string): Promise<StorageFileInfo> {
    return this.track('head', async () => {
      const client = await this.getClient();
      const s3 = await this.s3Mod();
      const cmd = new s3.HeadObjectCommand({ Bucket: this.bucket, Key: key });
      const res = await client.send(cmd);
      return {
        key,
        size: res.ContentLength ?? 0,
        contentType: res.ContentType,
        lastModified: res.LastModified ?? new Date(),
        metadata: res.Metadata,
      };
    });
  }

  // ---------------------------------------------------------------------------
  // Prefix enumeration (#6781)
  // ---------------------------------------------------------------------------

  /**
   * Cursor-shaped prefix enumeration — see `IStorageService.list` for the
   * contract every adapter shares.
   *
   * Two paging mechanisms, one per layer, and confusing them is the defect this
   * method exists to make impossible:
   *
   * - **Inside one call**, `ContinuationToken` loops over `ListObjectsV2`'s own
   *   pages until the CALLER's page is full. The retired implementation issued
   *   exactly one request and read neither `IsTruncated` nor
   *   `ContinuationToken`, so past `MaxKeys` it returned a partial answer that
   *   looked complete (#5266).
   * - **Between calls**, the caller-facing cursor is the last key returned,
   *   resumed with `StartAfter`. It is deliberately NOT the S3 continuation
   *   token: a key-based cursor means the SAME thing on every backend, so the
   *   local adapter issues and accepts byte-identical cursors, a token is
   *   refused identically by both, and a `SwappableStorageService` adapter swap
   *   mid-sweep resumes instead of restarting. An opaque S3 token would have
   *   made the cursor a second, per-backend dialect — the exact shape of the
   *   original defect, moved onto the continuation.
   *
   * Shape and behaviour are pinned in `storage-adapter-list-contract.test.ts`
   * and `storage-adapter-list.conformance.test.ts`, the latter driving this
   * adapter against a fake bucket that enforces the real 1000-key `MaxKeys`
   * ceiling — so an implementation that issued one request per call could not
   * pass it.
   */
  async list(prefix: string, options?: StorageListOptions): Promise<StorageListPage> {
    // Refusals come from the contract's shared helpers, outside `track()`: a
    // refused call never reached S3, so it is not a failed storage operation.
    const limit = resolveStorageListLimit(options?.limit);
    const startAfter = options?.cursor === undefined ? undefined : decodeStorageListCursor(options.cursor);

    return this.track('list', async () => {
      const client = await this.getClient();
      const s3 = await this.s3Mod();

      const items: StorageFileInfo[] = [];
      let continuationToken: string | undefined;
      let more = false;
      // The last key EXAMINED, which is not always the last key emitted: a page
      // whose trailing entries are all directory markers still advanced the
      // scan past them, and resuming from the last emitted key instead would
      // re-read them forever.
      let lastKeySeen: string | undefined;

      while (items.length < limit) {
        const res = await client.send(
          new s3.ListObjectsV2Command({
            Bucket: this.bucket,
            Prefix: prefix,
            MaxKeys: Math.min(limit - items.length, S3_LIST_MAX_KEYS),
            // `StartAfter` is honoured only on the first request of a run; S3
            // ignores it once `ContinuationToken` is present, which is correct
            // — the token already encodes a position past it.
            ...(continuationToken
              ? { ContinuationToken: continuationToken }
              : startAfter !== undefined
                ? { StartAfter: startAfter }
                : {}),
          }),
        );

        for (const object of res.Contents ?? []) {
          const key: string | undefined = object?.Key;
          if (!key) continue;
          lastKeySeen = key;
          // A zero-byte key ending in `/` is a console-created directory
          // marker, not a file. The local backend cannot represent one at all,
          // so emitting it here would be a per-backend dialect.
          if (key.endsWith('/')) continue;
          items.push({
            key,
            size: object.Size ?? 0,
            lastModified: object.LastModified ?? new Date(),
          });
        }

        if (!res.IsTruncated || !res.NextContinuationToken) {
          more = false;
          break;
        }
        continuationToken = res.NextContinuationToken;
        more = true;
      }

      return more && lastKeySeen !== undefined
        ? { items, nextCursor: encodeStorageListCursor(lastKeySeen) }
        : { items };
    });
  }

  // ---------------------------------------------------------------------------
  // Presigned URLs
  // ---------------------------------------------------------------------------

  async getSignedUrl(key: string, expiresIn: number, options?: PresignedDownloadOptions): Promise<string> {
    const desc = await this.getPresignedDownload(key, expiresIn, options);
    return desc.downloadUrl;
  }

  async getPresignedUpload(
    key: string,
    expiresIn: number,
    options?: StorageUploadOptions,
  ): Promise<PresignedUploadDescriptor> {
    const client = await this.getClient();
    const s3 = await this.s3Mod();
    const { getSignedUrl } = await this.presignerMod();
    const cmd = new s3.PutObjectCommand({
      Bucket: this.bucket,
      Key: key,
      ContentType: options?.contentType,
      Metadata: options?.metadata,
      ACL: options?.acl === 'public-read' ? 'public-read' : undefined,
    });
    const url = await getSignedUrl(client, cmd, { expiresIn });
    return {
      uploadUrl: url,
      method: 'PUT',
      headers: options?.contentType ? { 'content-type': options.contentType } : undefined,
      expiresIn,
    };
  }

  async getPresignedDownload(
    key: string,
    expiresIn: number,
    options?: PresignedDownloadOptions,
  ): Promise<PresignedDownloadDescriptor> {
    const client = await this.getClient();
    const s3 = await this.s3Mod();
    const { getSignedUrl } = await this.presignerMod();
    // S3 bakes these response overrides into the signed URL, so the download
    // carries the real filename + type instead of the object key + octet-stream.
    const cmd = new s3.GetObjectCommand({
      Bucket: this.bucket,
      Key: key,
      ...(options?.contentType ? { ResponseContentType: options.contentType } : {}),
      ...(options?.filename
        ? { ResponseContentDisposition: contentDispositionValue(options.filename, options.disposition ?? 'inline') }
        : {}),
    });
    const url = await getSignedUrl(client, cmd, { expiresIn });
    return { downloadUrl: url, expiresIn };
  }

  // ---------------------------------------------------------------------------
  // Chunked / multipart upload
  // ---------------------------------------------------------------------------

  async initiateChunkedUpload(key: string, options?: StorageUploadOptions): Promise<string> {
    const client = await this.getClient();
    const s3 = await this.s3Mod();
    const cmd = new s3.CreateMultipartUploadCommand({
      Bucket: this.bucket,
      Key: key,
      ContentType: options?.contentType,
      Metadata: options?.metadata,
    });
    const res = await client.send(cmd);
    return res.UploadId!;
  }

  async uploadChunk(uploadId: string, partNumber: number, data: Buffer): Promise<string> {
    const client = await this.getClient();
    const s3 = await this.s3Mod();
    // We need the key — store the relationship elsewhere or pass via metadata.
    // For the S3 adapter, `uploadId` is the S3-native UploadId. The key is
    // tracked in the StorageMetadataStore (sys_upload_session.key).
    // Here we retrieve it from session state; the plugin ensures the correct
    // key is passed. However, the IStorageService contract doesn't include key
    // in uploadChunk — so we work around by storing the mapping in a WeakMap
    // keyed by uploadId. For a robust implementation we'll add a lookup:
    const key = this._uploadKeys?.get(uploadId);
    if (!key) {
      throw new Error('S3StorageAdapter: key not found for uploadId. Call setUploadKey() before uploadChunk().');
    }
    const cmd = new s3.UploadPartCommand({
      Bucket: this.bucket,
      Key: key,
      UploadId: uploadId,
      PartNumber: partNumber,
      Body: data,
    });
    const res = await client.send(cmd);
    return res.ETag!;
  }

  async completeChunkedUpload(
    uploadId: string,
    parts: Array<{ partNumber: number; eTag: string }>,
  ): Promise<string> {
    const client = await this.getClient();
    const s3 = await this.s3Mod();
    const key = this._uploadKeys?.get(uploadId);
    if (!key) {
      throw new Error('S3StorageAdapter: key not found for uploadId.');
    }
    const cmd = new s3.CompleteMultipartUploadCommand({
      Bucket: this.bucket,
      Key: key,
      UploadId: uploadId,
      MultipartUpload: {
        Parts: parts.map(p => ({ PartNumber: p.partNumber, ETag: p.eTag })),
      },
    });
    await client.send(cmd);
    this._uploadKeys?.delete(uploadId);
    return key;
  }

  async abortChunkedUpload(uploadId: string): Promise<void> {
    const client = await this.getClient();
    const s3 = await this.s3Mod();
    const key = this._uploadKeys?.get(uploadId);
    if (!key) return;
    const cmd = new s3.AbortMultipartUploadCommand({
      Bucket: this.bucket,
      Key: key,
      UploadId: uploadId,
    });
    await client.send(cmd);
    this._uploadKeys?.delete(uploadId);
  }

  // ---------------------------------------------------------------------------
  // Internal upload key tracking
  // ---------------------------------------------------------------------------
  private _uploadKeys: Map<string, string> = new Map();

  /**
   * Register the storage key for a multipart upload session. Must be called
   * by the StorageServicePlugin after `initiateChunkedUpload()` returns so
   * that subsequent `uploadChunk` / `completeChunkedUpload` calls can resolve
   * the S3 key without it being part of the IStorageService contract signature.
   */
  setUploadKey(uploadId: string, key: string): void {
    this._uploadKeys.set(uploadId, key);
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function streamToBuffer(stream: any): Promise<Buffer> {
  if (Buffer.isBuffer(stream)) return stream;
  if (stream instanceof Uint8Array) return Buffer.from(stream);
  const chunks: Uint8Array[] = [];
  if (typeof stream[Symbol.asyncIterator] === 'function') {
    for await (const chunk of stream) {
      chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
    }
  } else if (stream.getReader) {
    const reader = stream.getReader();
    let done = false;
    while (!done) {
      const result = await reader.read();
      done = result.done;
      if (result.value) chunks.push(result.value);
    }
  } else {
    throw new Error('Cannot convert stream to buffer');
  }
  return Buffer.concat(chunks);
}

