/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * @object-ui/types - Upload adapter contract
 *
 * The contract between the upload context that the file, image and avatar
 * widgets read (`UploadProvider` / `useUpload` in `@object-ui/fields`) and an
 * upload destination (`createObjectStackUploadAdapter` in
 * `@object-ui/data-objectstack`, or a host's own adapter). It lives here, as
 * the `DataSource` interface does, because those two packages do not depend on
 * each other and both read it from this one.
 *
 * @module upload
 * @packageDocumentation
 */

/** What an {@link UploadAdapter} answers for one stored file. */
export interface UploadResult {
  /** Canonical, shareable URL (e.g. https://my-bucket.s3.amazonaws.com/avatars/abc.png). */
  url: string;
  /** Stored object name / key. */
  name: string;
  size: number;
  mimeType: string;
  /** Adapter-specific metadata (etag, version, etc.). */
  meta?: Record<string, unknown>;
}

/** Per-upload options an {@link UploadAdapter} receives. */
export interface UploadOptions {
  /**
   * Logical folder / key prefix (e.g. "avatars/") for an adapter that keys
   * objects by path. `createObjectStackUploadAdapter` never sends it: that
   * server derives the object key itself, and a path is not a storage scope
   * (objectui#12055).
   */
  path?: string;
  /** Progress callback in 0–1. */
  onProgress?: (ratio: number) => void;
  /** External abort signal — cancels the upload (and any retry attempts). */
  signal?: AbortSignal;
  /** Number of retry attempts on network failure. @default 3 */
  maxRetries?: number;
  /** Initial backoff in ms; exponential. @default 500 */
  retryDelayMs?: number;
}

/**
 * A file upload destination: any object with a `name` and an `upload` method.
 * `UploadProvider` (`@object-ui/fields`) makes one ambient for the widgets;
 * `createObjectStackUploadAdapter` (`@object-ui/data-objectstack`) builds the
 * one for an ObjectStack server's storage service.
 */
export interface UploadAdapter {
  readonly name: string;
  upload(file: File | Blob, opts?: UploadOptions): Promise<UploadResult>;
}
