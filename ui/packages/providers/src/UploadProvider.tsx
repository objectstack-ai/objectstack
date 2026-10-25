/**
 * UploadProvider — pluggable file upload context for ObjectUI.
 *
 * Why: `FileField` and `ImageField` historically used `URL.createObjectURL(file)`
 * which only works for the lifetime of the browser tab and never persists the
 * file anywhere. Production deployments need to push the bytes to S3, Azure
 * Blob, or another object store and replace the temporary blob URL with a
 * canonical one.
 *
 * Design:
 * - `UploadProvider` exposes an `upload(file, opts)` function via context.
 * - Apps inject an adapter (`createS3Adapter`, `createAzureBlobAdapter`, or any
 *   custom one implementing `UploadAdapter`).
 * - The default adapter (`createObjectUrlAdapter`) mints a tab-local `blob:`
 *   URL and no `sys_file` id; it keeps the field widgets from crashing when no
 *   provider is mounted, and they refuse every pick through it (objectui#7699).
 * - Upload progress and resumable retries are first-class concerns: each
 *   adapter implementation can chunk + resume; the public API surfaces
 *   `onProgress` and an `abortSignal`.
 */
import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  type ReactNode,
} from 'react';
import type { API } from '@object-ui/types';

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

export interface UploadOptions {
  /**
   * Logical folder / key prefix (e.g. "avatars/"), handed to the presign
   * callback of `createS3Adapter` and `createAzureBlobAdapter`.
   * `createObjectStackUploadAdapter` never sends it: that server derives the
   * object key itself, and a path is not a storage scope (objectui#12055).
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

export interface UploadAdapter {
  readonly name: string;
  upload(file: File | Blob, opts?: UploadOptions): Promise<UploadResult>;
}

interface UploadContextValue {
  upload: (file: File | Blob, opts?: UploadOptions) => Promise<UploadResult>;
  adapter: UploadAdapter;
}

const UploadContext = createContext<UploadContextValue | null>(null);

/**
 * Default adapter — wraps the file in an object URL. It persists nothing and
 * returns no `meta.fileId`, so the `@object-ui/fields` file and image widgets
 * refuse its result (`UploadIncompleteError`); it is a no-crash default, not
 * an upload destination.
 */
export function createObjectUrlAdapter(): UploadAdapter {
  return {
    name: 'object-url',
    async upload(file) {
      const f = file as File;
      const name = ('name' in f && f.name) || 'upload';
      return {
        url: URL.createObjectURL(file),
        name,
        size: file.size,
        mimeType: file.type || 'application/octet-stream',
      };
    },
  };
}

export interface S3AdapterOptions {
  /**
   * URL of an endpoint that returns `{ uploadUrl, publicUrl, headers? }`
   * for a given `{ name, type, size }`. Implementations typically presign an
   * S3 PUT URL server-side.
   */
  getPresignedUrl: (input: { name: string; type: string; size: number; path?: string }) => Promise<{
    uploadUrl: string;
    publicUrl: string;
    headers?: Record<string, string>;
  }>;
  /** Override fetch (useful for tests and ServiceWorker offline queues). */
  fetchImpl?: typeof fetch;
}

/**
 * S3-style adapter — relies on the app to provide a presign endpoint so that
 * AWS credentials never leak to the browser. Works with any S3-compatible
 * object store (AWS S3, Cloudflare R2, MinIO, …).
 */
export function createS3Adapter(opts: S3AdapterOptions): UploadAdapter {
  const fetchFn = opts.fetchImpl ?? fetch;
  return {
    name: 's3',
    async upload(file, options = {}) {
      const f = file as File;
      const name = ('name' in f && f.name) || 'upload';
      const presigned = await opts.getPresignedUrl({
        name,
        type: file.type || 'application/octet-stream',
        size: file.size,
        path: options.path,
      });
      await uploadWithProgress(fetchFn, presigned.uploadUrl, file, {
        method: 'PUT',
        headers: presigned.headers,
        ...options,
      });
      return {
        url: presigned.publicUrl,
        name,
        size: file.size,
        mimeType: file.type || 'application/octet-stream',
      };
    },
  };
}

export interface AzureBlobAdapterOptions {
  /**
   * URL of an endpoint that returns `{ uploadUrl, publicUrl }` — typically a
   * short-lived SAS URL minted server-side.
   */
  getSasUrl: (input: { name: string; type: string; size: number; path?: string }) => Promise<{
    uploadUrl: string;
    publicUrl: string;
  }>;
  fetchImpl?: typeof fetch;
}

/**
 * Azure Blob Storage adapter using SAS tokens. Single PUT — for files larger
 * than ~256 MiB, callers should issue chunked SAS URLs (block list + commit)
 * via their backend.
 */
export function createAzureBlobAdapter(opts: AzureBlobAdapterOptions): UploadAdapter {
  const fetchFn = opts.fetchImpl ?? fetch;
  return {
    name: 'azure-blob',
    async upload(file, options = {}) {
      const f = file as File;
      const name = ('name' in f && f.name) || 'upload';
      const sas = await opts.getSasUrl({
        name,
        type: file.type || 'application/octet-stream',
        size: file.size,
        path: options.path,
      });
      await uploadWithProgress(fetchFn, sas.uploadUrl, file, {
        method: 'PUT',
        headers: {
          'x-ms-blob-type': 'BlockBlob',
          'Content-Type': file.type || 'application/octet-stream',
        },
        ...options,
      });
      return {
        url: sas.publicUrl,
        name,
        size: file.size,
        mimeType: file.type || 'application/octet-stream',
      };
    },
  };
}

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
 *                                   the `sys_file` record
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
          // as the scope: it is a key prefix for the S3/Azure presign
          // callbacks, and this server refuses any scope outside its
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
        body: JSON.stringify({ fileId }),
      });
      if (!completeRes.ok) {
        const text = await completeRes.text().catch(() => '');
        throw new Error(
          `Upload completion failed (${completeRes.status}): ${text || completeRes.statusText}`,
        );
      }

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
        meta: { fileId, scope: opts.scope },
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

export interface UploadProviderProps {
  adapter?: UploadAdapter;
  children: ReactNode;
}

export const UploadProvider: React.FC<UploadProviderProps> = ({ adapter, children }) => {
  const adapterRef = useRef<UploadAdapter>(adapter ?? createObjectUrlAdapter());
  useEffect(() => {
    if (adapter) adapterRef.current = adapter;
  }, [adapter]);

  const upload = useCallback(
    (file: File | Blob, opts?: UploadOptions) => adapterRef.current.upload(file, opts),
    [],
  );

  const value = useMemo<UploadContextValue>(
    () => ({ upload, adapter: adapterRef.current }),
    [upload],
  );
  return <UploadContext.Provider value={value}>{children}</UploadContext.Provider>;
};

/**
 * Hook returning the configured upload function. Falls back to a fresh
 * object-URL adapter so widgets never crash when used outside a provider.
 */
export function useUpload(): UploadContextValue {
  const ctx = useContext(UploadContext);
  // Always call useMemo to honour the rules of hooks; cheap when ctx is set.
  const fallback = useMemo<UploadContextValue>(() => {
    const a = createObjectUrlAdapter();
    return { upload: (f: File | Blob, o?: UploadOptions) => a.upload(f, o), adapter: a };
  }, []);
  return ctx ?? fallback;
}
