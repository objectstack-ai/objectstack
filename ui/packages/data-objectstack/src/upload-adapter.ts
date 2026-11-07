/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * The browser-side upload adapter for `@objectstack/service-storage`.
 *
 * It implements the `UploadAdapter` contract `@object-ui/types` declares, and
 * `UploadProvider` from `@object-ui/fields` makes it ambient for the file,
 * image and avatar widgets. It lives in this package because it is fetch
 * logic against an ObjectStack server, and every such fetch belongs to the
 * data adapter.
 */
import type { API, UploadAdapter, UploadOptions } from '@object-ui/types';

export interface ObjectStackUploadAdapterOptions {
  /**
   * Server base URL (e.g. `https://api.example.com`). Defaults to the
   * current origin so apps mounted on the same host as the ObjectStack
   * server don't need any configuration.
   */
  baseUrl?: string;
  /**
   * Mount path of the storage service. Matches the framework default
   * (`/api/v1/storage`). Override when the server runs the storage routes
   * under a custom prefix.
   * @default '/api/v1/storage'
   */
  basePath?: string;
  /**
   * The storage scope the server files every upload from this adapter
   * under, sent as the presigned upload request's `scope`. It is not a key
   * prefix or folder. Its values are the spec's upload-scope vocabulary,
   * `UploadScope` from `@objectstack/spec/api` (reached here as
   * `API.UploadScope` from `@object-ui/types`): the one list the upload
   * request, the `scope` select on `sys_file` and the upload doors share.
   * A value outside it does not compile, and the server refuses it with
   * `400`. `attachments`, for example, is the scope of files joined to
   * records through `sys_attachment`. Omit it and the request carries no
   * scope, so the server applies the default the spec's upload request
   * declares (objectui#12055).
   */
  scope?: API.UploadScope;
  /**
   * Attach every upload from this adapter to this record, in the call that
   * completes it: the completion request carries `attachTo`, and the server
   * commits the file and writes its `sys_attachment` row as one unit, as the
   * signed-in caller (the record attachments surface's attach verb). The
   * result's `meta.attachmentId` names the new attachment. The server attaches
   * only the caller's own pending upload in the `attachments` scope, so set
   * `scope: 'attachments'` with it. A refused attach fails the upload with the
   * server's refusal and leaves the file pending, never committed and
   * unattached.
   */
  attachTo?: { parentObject: string; parentId: string };
  /** Override `fetch` (tests, ServiceWorker queues). */
  fetchImpl?: typeof fetch;
  /**
   * Cookie/credentials mode for cross-origin auth. Defaults to
   * `'include'` so session cookies from `@object-ui/auth` are sent
   * automatically.
   * @default 'include'
   */
  credentials?: RequestCredentials;
}

/**
 * ObjectStack presigned-upload adapter — the canonical browser-side
 * client for `@objectstack/service-storage`.
 *
 * Implements the three-step protocol exposed by the server:
 *   1. POST `/upload/presigned`   → `{ uploadUrl, fileId, downloadUrl }`
 *   2. PUT  `uploadUrl`           → uploads the raw bytes (HMAC token)
 *   3. POST `/upload/complete`    → marks the file ready and registers
 *                                   the `sys_file` record — and, with
 *                                   `attachTo`, attaches it to that record
 *
 * Falls back to a canonical (non-signed) download URL so the returned
 * `UploadResult.url` is stable across signed-URL expiry — components
 * that need a fresh signed URL can call the server's
 * `GET /files/:fileId/url` endpoint themselves.
 */
export function createObjectStackUploadAdapter(
  opts: ObjectStackUploadAdapterOptions = {},
): UploadAdapter {
  const fetchFn = opts.fetchImpl ?? fetch;
  const base = (opts.baseUrl ?? '').replace(/\/$/, '');
  const path = opts.basePath ?? '/api/v1/storage';
  const credentials = opts.credentials ?? 'include';

  const apiUrl = (segment: string) =>
    /^https?:/i.test(segment) ? segment : `${base}${segment}`;

  return {
    name: 'objectstack-presigned',
    async upload(file, options = {}) {
      const f = file as File;
      const name = ('name' in f && f.name) || 'upload';
      const mimeType = file.type || 'application/octet-stream';

      // 1) Request a presigned PUT URL
      const presignRes = await fetchFn(apiUrl(`${path}/upload/presigned`), {
        method: 'POST',
        credentials,
        headers: { 'Content-Type': 'application/json' },
        signal: options.signal,
        body: JSON.stringify({
          filename: name,
          mimeType,
          size: file.size,
          // The adapter's own scope, or none. `options.path` is never sent
          // as the scope: it is a key prefix for adapters that key objects
          // by path, and this server refuses any scope outside its
          // vocabulary (objectui#12055).
          scope: opts.scope,
        }),
      });
      if (!presignRes.ok) {
        const text = await presignRes.text().catch(() => '');
        throw new Error(
          `Presigned upload request failed (${presignRes.status}): ${text || presignRes.statusText}`,
        );
      }
      const presignBody = await presignRes.json();
      const descriptor = presignBody?.data ?? presignBody;
      const { uploadUrl, fileId, headers: putHeaders } = descriptor as {
        uploadUrl: string;
        fileId: string;
        headers?: Record<string, string>;
      };
      if (!uploadUrl || !fileId) {
        throw new Error('Presigned upload response missing uploadUrl/fileId');
      }

      // 2) Upload the raw bytes (with progress + retry)
      await uploadWithProgress(fetchFn, apiUrl(uploadUrl), file, {
        method: 'PUT',
        headers: { 'Content-Type': mimeType, ...(putHeaders ?? {}) },
        ...options,
      });

      // 3) Mark the upload complete so the server registers sys_file
      const completeRes = await fetchFn(apiUrl(`${path}/upload/complete`), {
        method: 'POST',
        credentials,
        headers: { 'Content-Type': 'application/json' },
        signal: options.signal,
        body: JSON.stringify(opts.attachTo ? { fileId, attachTo: opts.attachTo } : { fileId }),
      });
      if (!completeRes.ok) {
        const text = await completeRes.text().catch(() => '');
        // The server's refusal code and status ride on the error, so a caller
        // maps a refused attach (`ATTACHMENT_PARENT_ACCESS`, `FILES_DISABLED`,
        // `PERMISSION_DENIED`…) without parsing the message.
        let code: string | undefined;
        try {
          const parsed = JSON.parse(text);
          if (typeof parsed?.error?.code === 'string') code = parsed.error.code;
        } catch {
          // Not the declared envelope — the message keeps the raw text.
        }
        throw Object.assign(
          new Error(`Upload completion failed (${completeRes.status}): ${text || completeRes.statusText}`),
          { status: completeRes.status, ...(code ? { code } : {}) },
        );
      }
      const completeBody = opts.attachTo ? await completeRes.json().catch(() => null) : null;
      const attachmentId = (completeBody?.data ?? completeBody)?.attachmentId as string | undefined;

      // Use the canonical (stable) download endpoint as the field value
      // so a saved record keeps working past signed-URL expiry. This
      // endpoint 302-redirects to a freshly-signed short-lived URL on
      // every request, so it can be used directly as `<img src>`.
      const stableUrl = apiUrl(`${path}/files/${encodeURIComponent(fileId)}`);

      return {
        url: stableUrl,
        name,
        size: file.size,
        mimeType,
        meta: { fileId, scope: opts.scope, ...(attachmentId ? { attachmentId } : {}) },
      };
    },
  };
}

interface UploadFetchOptions extends UploadOptions {
  method: string;
  headers?: Record<string, string>;
}

/**
 * Internal helper — performs a single PUT/POST with progress reporting,
 * exponential-backoff retry, and abort propagation.
 */
async function uploadWithProgress(
  fetchFn: typeof fetch,
  url: string,
  body: Blob,
  options: UploadFetchOptions,
): Promise<void> {
  const maxRetries = options.maxRetries ?? 3;
  const baseDelay = options.retryDelayMs ?? 500;
  let attempt = 0;
  while (true) {
    if (options.signal?.aborted) throw new DOMException('aborted', 'AbortError');
    try {
      // Fetch's standard progress reporting is limited; use XHR when we need
      // per-byte progress. Falls back to fetch for environments without XHR
      // (e.g. Cloudflare Workers used by Service Workers).
      if (typeof XMLHttpRequest !== 'undefined' && options.onProgress) {
        await xhrUpload(url, body, options);
      } else {
        const res = await fetchFn(url, {
          method: options.method,
          body,
          headers: options.headers,
          signal: options.signal,
        });
        if (!res.ok) throw new Error(`Upload failed with status ${res.status}`);
        options.onProgress?.(1);
      }
      return;
    } catch (err) {
      if ((err as DOMException)?.name === 'AbortError') throw err;
      if (attempt >= maxRetries) throw err;
      const delay = baseDelay * Math.pow(2, attempt);
      attempt++;
      await new Promise((r) => setTimeout(r, delay));
    }
  }
}

function xhrUpload(url: string, body: Blob, options: UploadFetchOptions): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open(options.method, url);
    if (options.headers) {
      for (const [k, v] of Object.entries(options.headers)) xhr.setRequestHeader(k, v);
    }
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable && options.onProgress) options.onProgress(e.loaded / e.total);
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        options.onProgress?.(1);
        resolve();
      } else {
        reject(new Error(`Upload failed with status ${xhr.status}`));
      }
    };
    xhr.onerror = () => reject(new Error('Network error during upload'));
    xhr.onabort = () => reject(new DOMException('aborted', 'AbortError'));
    if (options.signal) {
      const abortHandler = () => xhr.abort();
      if (options.signal.aborted) {
        xhr.abort();
      } else {
        options.signal.addEventListener('abort', abortHandler, { once: true });
      }
    }
    xhr.send(body);
  });
}
