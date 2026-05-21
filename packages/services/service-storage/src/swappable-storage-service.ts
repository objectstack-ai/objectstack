// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import type {
  IStorageService,
  StorageFileInfo,
  StorageUploadOptions,
  PresignedUploadDescriptor,
  PresignedDownloadDescriptor,
} from '@objectstack/spec/contracts';

/**
 * SwappableStorageService — IStorageService proxy with a swappable
 * inner adapter.
 *
 * Used by `StorageServicePlugin` so the kernel can register a stable
 * `file-storage` reference at init time, while the underlying adapter
 * (local FS / S3) is rebuilt on every `settings:changed` event for
 * the `storage` namespace.
 *
 * ⚠ Adapter swaps do NOT migrate previously uploaded files. Files
 * stored under the previous adapter become unreachable through the
 * new one. Callers are responsible for migrating data out-of-band.
 *
 * All `IStorageService` methods delegate to the current inner adapter.
 * Optional methods (list / presigned / chunked) probe the inner
 * adapter and surface a clear error when the active adapter does not
 * implement them.
 */
export class SwappableStorageService implements IStorageService {
  private inner: IStorageService;
  private readonly onSwap?: (previous: IStorageService, next: IStorageService) => void;

  constructor(
    initial: IStorageService,
    onSwap?: (previous: IStorageService, next: IStorageService) => void,
  ) {
    this.inner = initial;
    this.onSwap = onSwap;
  }

  /** Replace the inner adapter. */
  swap(next: IStorageService): void {
    const previous = this.inner;
    this.inner = next;
    this.onSwap?.(previous, next);
  }

  /** Expose the active inner adapter — primarily for tests. */
  getInner(): IStorageService {
    return this.inner;
  }

  upload(key: string, data: Buffer | ReadableStream, options?: StorageUploadOptions): Promise<void> {
    return this.inner.upload(key, data, options);
  }

  download(key: string): Promise<Buffer> {
    return this.inner.download(key);
  }

  delete(key: string): Promise<void> {
    return this.inner.delete(key);
  }

  exists(key: string): Promise<boolean> {
    return this.inner.exists(key);
  }

  getInfo(key: string): Promise<StorageFileInfo> {
    return this.inner.getInfo(key);
  }

  list(prefix: string): Promise<StorageFileInfo[]> {
    if (typeof this.inner.list !== 'function') {
      return Promise.reject(new Error('Active storage adapter does not support list()'));
    }
    return this.inner.list(prefix);
  }

  getSignedUrl(key: string, expiresIn: number): Promise<string> {
    if (typeof this.inner.getSignedUrl !== 'function') {
      return Promise.reject(new Error('Active storage adapter does not support getSignedUrl()'));
    }
    return this.inner.getSignedUrl(key, expiresIn);
  }

  getPresignedUpload(
    key: string,
    expiresIn: number,
    options?: StorageUploadOptions,
  ): Promise<PresignedUploadDescriptor> {
    if (typeof this.inner.getPresignedUpload !== 'function') {
      return Promise.reject(new Error('Active storage adapter does not support getPresignedUpload()'));
    }
    return this.inner.getPresignedUpload(key, expiresIn, options);
  }

  getPresignedDownload(key: string, expiresIn: number): Promise<PresignedDownloadDescriptor> {
    if (typeof this.inner.getPresignedDownload !== 'function') {
      return Promise.reject(new Error('Active storage adapter does not support getPresignedDownload()'));
    }
    return this.inner.getPresignedDownload(key, expiresIn);
  }

  initiateChunkedUpload(key: string, options?: StorageUploadOptions): Promise<string> {
    if (typeof this.inner.initiateChunkedUpload !== 'function') {
      return Promise.reject(new Error('Active storage adapter does not support initiateChunkedUpload()'));
    }
    return this.inner.initiateChunkedUpload(key, options);
  }

  uploadChunk(uploadId: string, partNumber: number, data: Buffer): Promise<string> {
    if (typeof this.inner.uploadChunk !== 'function') {
      return Promise.reject(new Error('Active storage adapter does not support uploadChunk()'));
    }
    return this.inner.uploadChunk(uploadId, partNumber, data);
  }

  completeChunkedUpload(
    uploadId: string,
    parts: Array<{ partNumber: number; eTag: string }>,
  ): Promise<string> {
    if (typeof this.inner.completeChunkedUpload !== 'function') {
      return Promise.reject(new Error('Active storage adapter does not support completeChunkedUpload()'));
    }
    return this.inner.completeChunkedUpload(uploadId, parts);
  }

  abortChunkedUpload(uploadId: string): Promise<void> {
    if (typeof this.inner.abortChunkedUpload !== 'function') {
      return Promise.reject(new Error('Active storage adapter does not support abortChunkedUpload()'));
    }
    return this.inner.abortChunkedUpload(uploadId);
  }

  /**
   * Verify a presigned HMAC token (LocalStorageAdapter-specific).
   *
   * `IStorageService` does not declare this method, but `storage-routes`
   * type-narrows the active storage to `LocalStorageAdapter` to handle the
   * `/_local/raw/:token` PUT and GET endpoints. Without a passthrough on
   * the swappable wrapper, the route sees `verifyToken === undefined` and
   * returns 501 even though the underlying local adapter supports it.
   */
  verifyToken(token: string, expectedOp?: 'put' | 'get'): { k: string; ct?: string; op: string; exp: number } {
    const inner = this.inner as unknown as {
      verifyToken?: (token: string, expectedOp?: 'put' | 'get') => { k: string; ct?: string; op: string; exp: number };
    };
    if (typeof inner.verifyToken !== 'function') {
      throw new Error('Active storage adapter does not support verifyToken()');
    }
    return inner.verifyToken(token, expectedOp);
  }
}
