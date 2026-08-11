// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { randomUUID } from 'node:crypto';
import type { IHttpServer, IHttpRequest, IHttpResponse, IStorageService } from '@objectstack/spec/contracts';
// The declared envelope is written in ONE place for the whole platform (#3973).
import { sendOk, sendError } from '@objectstack/types';
import type { StorageMetadataStore, FileRecord, UploadSessionRecord } from './metadata-store.js';
import type { LocalStorageAdapter } from './local-storage-adapter.js';
import { contentDispositionValue } from './content-disposition.js';

/** Authorization verdict for an attachments-scope download (#2970 item 2). */
export type FileReadVerdict = 'allow' | 'deny' | 'unauthenticated';

/**
 * Options for the storage route registration helper.
 */
export interface StorageRoutesOptions {
  basePath?: string;
  /** Default presigned URL TTL in seconds */
  presignedTtl?: number;
  /** Default chunked upload session TTL in seconds */
  sessionTtl?: number;
  /**
   * Session resolver for the UPLOAD entry points (#2755). When wired, the
   * presigned/complete/chunked upload routes reject anonymous requests with
   * 401 `AUTH_REQUIRED`, and new sys_file rows are stamped with
   * `owner_id = session.userId`. When absent (bare kernels, tests), the
   * routes stay open — back-compat, logged once. Download routes are NOT
   * gated here (capability URLs embedded in <img src>/<a href>; gating them
   * is a tracked follow-up needing cookie sessions or signed links).
   */
  resolveSession?: (req: IHttpRequest) => Promise<{ userId?: string } | null | undefined>;
   /**
   * Authorize a DOWNLOAD of a parent-governed file (#2970 item 2, extended by
   * ADR-0104 D3 wave 2). When wired, the download endpoints
   * (`/files/:fileId` and `/files/:fileId/url`) consult this for
   * `scope==='attachments'` files AND for field-owned files (`ref_object` set),
   * excluding `public_read` ones:
   *   - `unauthenticated` → 401 (no session)
   *   - `deny` → 403 (session, but cannot read the parent record the file
   *     belongs to / is attached to, and is not the owner)
   *   - `allow` → a short-lived signed URL is issued
   * A file with neither an attachments scope nor a field owner — an unclaimed
   * upload, an org logo — keeps the stable anonymous capability URL, as does
   * any file explicitly marked `acl: 'public_read'` (the opt-in for genuinely
   * public embedding, since `<img src>` cannot carry a bearer token).
   * When absent (bare kernels, tests), all downloads stay open (back-compat).
   */
  authorizeFileRead?: (file: FileRecord, req: IHttpRequest) => Promise<FileReadVerdict>;
  /**
   * TTL (seconds) for the signed URL minted on a GATED attachments download.
   * Short by design — the link is followed immediately after an explicit
   * click. Default 300 (5 min). Non-gated downloads keep `presignedTtl`.
   */
  downloadTtl?: number;
  /** Optional logger for the one-time open-mode notice. */
  logger?: { info(msg: string): void; warn(msg: string): void };
}

/**
 * Register `/api/v1/storage/*` REST routes with the HTTP server.
 *
 * Implements the contract defined in `packages/spec/src/api/storage.zod.ts`
 * (`StorageApiContracts`). This function follows the "autonomous plugin route
 * registration" pattern used by `I18nServicePlugin`, `AuthPlugin`, etc.
 *
 * Routes:
 * - POST   /storage/upload/presigned               → get presigned upload URL
 * - POST   /storage/upload/complete                → mark upload as committed
 * - POST   /storage/upload/chunked                 → initiate chunked upload
 * - PUT    /storage/upload/chunked/:uploadId/chunk/:chunkIndex → upload a chunk
 * - POST   /storage/upload/chunked/:uploadId/complete          → complete chunked
 * - GET    /storage/upload/chunked/:uploadId/progress          → get upload progress
 * - GET    /storage/files/:fileId/url              → get download URL
 * - PUT    /storage/_local/raw/:token              → local adapter raw upload
 * - GET    /storage/_local/raw/:token              → local adapter raw download
 */
export function registerStorageRoutes(
  httpServer: IHttpServer,
  storage: IStorageService,
  store: StorageMetadataStore,
  opts: StorageRoutesOptions = {},
): void {
  const basePath = opts.basePath ?? '/api/v1/storage';
  const presignedTtl = opts.presignedTtl ?? 3600;
  const sessionTtl = opts.sessionTtl ?? 86400;
  const downloadTtl = opts.downloadTtl ?? 300;

  // ── Download authorization gate (#2970 item 2, ADR-0104 D3 wave 2) ───
  // Two kinds of file are gated, both deriving access from a PARENT record:
  //   - `attachments`-scope files, via their sys_attachment join rows;
  //   - field-owned files, via the single record whose field owns them
  //     (`ref_object`/`ref_id`, ADR-0104 D3 wave 2).
  // `acl: 'public_read'` opts a file back out to the stable anonymous
  // capability URL — needed for genuinely public embedding (`<img src>`
  // cannot carry a bearer token), and now an explicit declaration rather
  // than the silent default it used to be for every field file.
  //
  // Dual-mode safe: a legacy field holds an inline blob or an external URL,
  // never a `sys_file` id, so no legacy file has `ref_object` set and none of
  // them start being gated by this change.
  //
  // Returns the signed-URL TTL to use, or `false` if a response was already
  // sent (401/403) and the handler must stop.
  const authorizeDownload = async (
    file: FileRecord,
    req: IHttpRequest,
    res: IHttpResponse,
  ): Promise<number | false> => {
    const fieldOwned = !!file.ref_object && file.ref_id != null && file.ref_id !== '';
    const gated = file.scope === 'attachments' || fieldOwned;
    if (!gated || file.acl === 'public_read' || !opts.authorizeFileRead) {
      return presignedTtl;
    }
    let verdict: FileReadVerdict;
    try {
      verdict = await opts.authorizeFileRead(file, req);
    } catch {
      verdict = 'deny'; // a failed authz check must never fall open
    }
    if (verdict === 'unauthenticated') {
      sendError(res, 401, 'AUTH_REQUIRED', 'Authentication required to download this file');
      return false;
    }
    if (verdict === 'deny') {
      if (fieldOwned) {
        sendError(res, 403, 'FILE_DOWNLOAD_DENIED', 'You do not have access to the record this file belongs to');
      } else {
        sendError(res, 403, 'ATTACHMENT_DOWNLOAD_DENIED', 'You do not have access to a record this file is attached to');
      }
      return false;
    }
    return downloadTtl;
  };

  // ── Upload auth gate (#2755) ─────────────────────────────────────────
  // `false` ⇒ the 401 was already sent and the handler must stop.
  // `null` ⇒ open mode (no resolver wired) — proceed unauthenticated.
  let warnedOpenUploads = false;
  const requireUploadSession = async (
    req: IHttpRequest,
    res: IHttpResponse,
  ): Promise<{ userId?: string } | null | false> => {
    if (!opts.resolveSession) {
      if (!warnedOpenUploads) {
        warnedOpenUploads = true;
        opts.logger?.info(
          '[storage] no session resolver wired — upload routes accept anonymous requests (bare-kernel mode)',
        );
      }
      return null;
    }
    let session: { userId?: string } | null | undefined;
    try {
      session = await opts.resolveSession(req);
    } catch {
      session = null;
    }
    if (!session?.userId) {
      sendError(res, 401, 'AUTH_REQUIRED', 'Authentication required to upload files');
      return false;
    }
    return session;
  };

  // ── Terminal upload-session statuses (#7667) ─────────────────────────────
  // `sys_upload_session.status` declares `failed` and `expired`, the retention
  // backstop reaps on them (`onlyWhen: { status: { $in: ['completed',
  // 'failed', 'expired'] } }`), and `UploadProgressSchema`
  // (packages/spec/src/api/storage.zod.ts) publishes both to every client that
  // reads the contract. Until #7667 NOTHING wrote either one — a declaration
  // with no producer, which ADR-0049 treats as enforce-or-remove. Both are
  // enforced here rather than removed, because the two failure states are real
  // and were previously invisible:
  //
  //  - `failed`: a completion whose backend `completeChunkedUpload` threw left
  //    the row at `completing` FOREVER. That is a non-terminal status, so the
  //    retention backstop never reaped it, and a progress poller read "still
  //    assembling" for a session that had already given up.
  //  - `expired`: a session past its own `expires_at` kept answering
  //    `in_progress` and kept accepting chunks, until the TTL sweep deleted the
  //    row out from under the caller — so the deadline the init response
  //    already announced (`expiresAt`) was advisory on the way in and abrupt on
  //    the way out.
  //
  // The reap guard (`createUploadSessionReapGuard`) already handled both — it
  // aborts the backend multipart for any non-`completed` row with a
  // `backend_upload_id` — so this closes the loop rather than opening one.

  /** Statuses no longer in flight — never re-statused by the expiry guard. */
  const TERMINAL_SESSION_STATUSES = new Set(['completed', 'failed', 'expired']);

  /**
   * Status an in-flight session `expired` once it is past its own `expires_at`,
   * and hand back the row as it now stands.
   *
   * A row with no `expires_at` (or an unparseable one) has no declared deadline
   * and is left alone: this enforces the deadline the session itself carries,
   * it does not invent one. Terminal rows are returned untouched — a
   * `completed` upload does not become `expired` by sitting around.
   */
  const expireIfPastDeadline = async (session: UploadSessionRecord): Promise<UploadSessionRecord> => {
    if (TERMINAL_SESSION_STATUSES.has(session.status)) return session;
    const deadline = session.expires_at ? Date.parse(session.expires_at) : NaN;
    if (!Number.isFinite(deadline) || deadline > Date.now()) return session;
    const updated = await store.updateSession(session.id, { status: 'expired' });
    // `updateSession` answers null only when the row went away under us (the
    // TTL sweep, most likely) — the caller is refused either way.
    return updated ?? { ...session, status: 'expired' };
  };

  /**
   * Best-effort `failed` stamp for a completion that threw.
   *
   * Deliberately swallowing-but-loud: the caller is already on its way to a
   * 500 carrying the REAL cause, and letting the status write replace that
   * cause would trade a diagnosable backend error for a metadata-store one.
   * The row staying at `completing` is the pre-#7667 behaviour, so the warn
   * names the consequence rather than pretending nothing happened.
   */
  const markSessionFailed = async (uploadId: string): Promise<void> => {
    try {
      await store.updateSession(uploadId, { status: 'failed' });
    } catch (statusErr: any) {
      opts.logger?.warn(
        `[storage] upload session ${uploadId} failed to complete, and the 'failed' status could not be ` +
          `persisted (${statusErr?.message ?? statusErr}) — the row stays at 'completing', so the 7d ` +
          'retention backstop will not reap it and progress reads will overstate it. Restore the data ' +
          'engine; the reap guard still aborts the backend multipart when the TTL sweep reaches the row.',
      );
    }
  };

  // ---------------------------------------------------------------------------
  // POST /storage/upload/presigned
  // ---------------------------------------------------------------------------
  httpServer.post(`${basePath}/upload/presigned`, async (req: IHttpRequest, res: IHttpResponse) => {
    try {
      const session = await requireUploadSession(req, res);
      if (session === false) return;
      const { filename, mimeType, size, scope, bucket } = req.body ?? {};
      if (!filename || !mimeType || size == null) {
        sendError(res, 400, 'INVALID_REQUEST', 'filename, mimeType, and size are required');
        return;
      }

      const fileId = randomUUID();
      const key = buildKey(scope ?? 'user', fileId, filename);

      // Persist pending file record
      await store.createFile({
        id: fileId,
        key,
        name: filename,
        mime_type: mimeType,
        size,
        scope: scope ?? 'user',
        bucket,
        acl: 'private',
        status: 'pending',
        owner_id: session?.userId,
      });

      // If adapter supports presigned upload, use it; otherwise build a local stub URL
      let uploadUrl: string;
      let method: 'PUT' | 'POST' = 'PUT';
      let headers: Record<string, string> = { 'content-type': mimeType };
      let expiresIn = presignedTtl;

      if (storage.getPresignedUpload) {
        const desc = await storage.getPresignedUpload(key, presignedTtl, { contentType: mimeType });
        uploadUrl = desc.uploadUrl;
        method = desc.method;
        if (desc.headers) headers = desc.headers;
        expiresIn = desc.expiresIn;
      } else {
        // Fallback — caller should PUT to the standard raw endpoint
        uploadUrl = `${basePath}/_local/raw/${fileId}`;
      }

      sendOk(res, {
        uploadUrl,
        method,
        headers,
        fileId,
        expiresIn,
        downloadUrl: `${basePath}/files/${fileId}/url`,
      });
    } catch (err: any) {
      sendError(res, 500, 'INTERNAL', err?.message ?? 'Internal error');
    }
  });

  // ---------------------------------------------------------------------------
  // POST /storage/upload/complete
  // ---------------------------------------------------------------------------
  httpServer.post(`${basePath}/upload/complete`, async (req: IHttpRequest, res: IHttpResponse) => {
    try {
      if ((await requireUploadSession(req, res)) === false) return;
      const { fileId, eTag } = req.body ?? {};
      if (!fileId) {
        sendError(res, 400, 'INVALID_REQUEST', 'fileId is required');
        return;
      }

      const file = await store.getFile(fileId);
      if (!file) {
        sendError(res, 404, 'FILE_NOT_FOUND', 'File not found');
        return;
      }

      const updated = await store.updateFile(fileId, {
        status: 'committed',
        etag: eTag ?? undefined,
      });

      sendOk(res, {
        // The opaque sys_file id — the value a file field stores as a
        // reference (ADR-0104 D3). Previously omitted, so a caller could not
        // learn the id to persist after committing an upload.
        fileId: updated!.id ?? fileId,
        path: updated!.key,
        name: updated!.name,
        size: updated!.size ?? 0,
        mimeType: updated!.mime_type ?? 'application/octet-stream',
        lastModified: updated!.updated_at ?? new Date().toISOString(),
        created: updated!.created_at ?? new Date().toISOString(),
        etag: updated!.etag,
      });
    } catch (err: any) {
      sendError(res, 500, 'INTERNAL', err?.message ?? 'Internal error');
    }
  });

  // ---------------------------------------------------------------------------
  // POST /storage/upload/chunked
  // ---------------------------------------------------------------------------
  httpServer.post(`${basePath}/upload/chunked`, async (req: IHttpRequest, res: IHttpResponse) => {
    try {
      const session = await requireUploadSession(req, res);
      if (session === false) return;
      const { filename, mimeType, totalSize, chunkSize: reqChunkSize, scope, bucket, metadata } = req.body ?? {};
      if (!filename || !mimeType || !totalSize) {
        sendError(res, 400, 'INVALID_REQUEST', 'filename, mimeType, and totalSize are required');
        return;
      }

      const chunkSize = Math.max(reqChunkSize ?? 5242880, 5242880);
      const totalChunks = Math.ceil(totalSize / chunkSize);

      const fileId = randomUUID();
      const key = buildKey(scope ?? 'user', fileId, filename);

      // Create pending file
      await store.createFile({
        id: fileId,
        key,
        name: filename,
        mime_type: mimeType,
        size: totalSize,
        scope: scope ?? 'user',
        bucket,
        acl: 'private',
        status: 'pending',
        metadata: metadata ? JSON.stringify(metadata) : undefined,
        owner_id: session?.userId,
      });

      // Initiate chunked upload in backend
      let backendUploadId: string | undefined;
      if (storage.initiateChunkedUpload) {
        backendUploadId = await storage.initiateChunkedUpload(key, { contentType: mimeType, metadata });
        // S3 adapter needs to know the key for subsequent chunk/complete calls
        if ('setUploadKey' in storage && typeof (storage as any).setUploadKey === 'function') {
          (storage as any).setUploadKey(backendUploadId, key);
        }
      }

      const uploadId = backendUploadId ?? randomUUID().replace(/-/g, '');
      const resumeToken = randomUUID();
      const expiresAt = new Date(Date.now() + sessionTtl * 1000).toISOString();

      await store.createSession({
        id: uploadId,
        file_id: fileId,
        key,
        filename,
        mime_type: mimeType,
        total_size: totalSize,
        chunk_size: chunkSize,
        total_chunks: totalChunks,
        resume_token: resumeToken,
        backend_upload_id: backendUploadId,
        scope: scope ?? 'user',
        bucket,
        metadata: metadata ? JSON.stringify(metadata) : undefined,
        status: 'in_progress',
        expires_at: expiresAt,
      });

      sendOk(res, {
        uploadId,
        resumeToken,
        fileId,
        totalChunks,
        chunkSize,
        expiresAt,
      });
    } catch (err: any) {
      sendError(res, 500, 'INTERNAL', err?.message ?? 'Internal error');
    }
  });

  // ---------------------------------------------------------------------------
  // PUT /storage/upload/chunked/:uploadId/chunk/:chunkIndex
  // ---------------------------------------------------------------------------
  httpServer.put(`${basePath}/upload/chunked/:uploadId/chunk/:chunkIndex`, async (req: IHttpRequest, res: IHttpResponse) => {
    try {
      if ((await requireUploadSession(req, res)) === false) return;
      const { uploadId, chunkIndex: chunkIndexStr } = req.params;
      const chunkIndex = parseInt(chunkIndexStr, 10);
      if (!uploadId || isNaN(chunkIndex)) {
        sendError(res, 400, 'INVALID_REQUEST', 'uploadId and chunkIndex are required');
        return;
      }

      const session = await store.getSession(uploadId);
      if (!session) {
        sendError(res, 404, 'UPLOAD_SESSION_NOT_FOUND', 'Upload session not found');
        return;
      }

      // Verify resume token
      const token = (req.headers['x-resume-token'] ?? '') as string;
      if (session.resume_token && token !== session.resume_token) {
        sendError(res, 403, 'INVALID_RESUME_TOKEN', 'Invalid resume token');
        return;
      }

      // Expiry is checked AFTER the resume token: a caller who cannot prove it
      // owns the session learns nothing about its state (#7667).
      const live = await expireIfPastDeadline(session);
      if (live.status === 'expired') {
        sendError(
          res,
          410,
          'UPLOAD_SESSION_EXPIRED',
          `Upload session expired at ${live.expires_at}; start a new chunked upload`,
        );
        return;
      }

      // Get raw body (binary data)
      let data: Buffer;
      if (req.rawBody) {
        data = await req.rawBody();
      } else if (Buffer.isBuffer(req.body)) {
        data = req.body;
      } else if (req.body instanceof ArrayBuffer) {
        data = Buffer.from(req.body);
      } else {
        sendError(res, 400, 'INVALID_REQUEST', 'Binary body required');
        return;
      }

      // Upload the chunk (S3 uses 1-based part numbers)
      let eTag = '';
      if (storage.uploadChunk) {
        eTag = await storage.uploadChunk(uploadId, chunkIndex + 1, data);
      }

      // Update session progress
      const currentParts: Array<{ chunkIndex: number; eTag: string }> = JSON.parse(session.parts ?? '[]');
      currentParts.push({ chunkIndex, eTag });
      const uploadedChunks = (session.uploaded_chunks ?? 0) + 1;
      const uploadedSize = (session.uploaded_size ?? 0) + data.byteLength;
      await store.updateSession(uploadId, {
        uploaded_chunks: uploadedChunks,
        uploaded_size: uploadedSize,
        parts: JSON.stringify(currentParts),
      });

      sendOk(res, {
        chunkIndex,
        eTag,
        bytesReceived: data.byteLength,
      });
    } catch (err: any) {
      sendError(res, 500, 'INTERNAL', err?.message ?? 'Internal error');
    }
  });

  // ---------------------------------------------------------------------------
  // POST /storage/upload/chunked/:uploadId/complete
  // ---------------------------------------------------------------------------
  httpServer.post(`${basePath}/upload/chunked/:uploadId/complete`, async (req: IHttpRequest, res: IHttpResponse) => {
    try {
      if ((await requireUploadSession(req, res)) === false) return;
      const { uploadId } = req.params;
      const session = await store.getSession(uploadId);
      if (!session) {
        sendError(res, 404, 'UPLOAD_SESSION_NOT_FOUND', 'Upload session not found');
        return;
      }

      const live = await expireIfPastDeadline(session);
      if (live.status === 'expired') {
        sendError(
          res,
          410,
          'UPLOAD_SESSION_EXPIRED',
          `Upload session expired at ${live.expires_at}; start a new chunked upload`,
        );
        return;
      }

      await store.updateSession(uploadId, { status: 'completing' });

      const partsFromBody = (req.body?.parts ?? []) as Array<{ chunkIndex: number; eTag: string }>;
      const partsForBackend = partsFromBody.map(p => ({
        partNumber: p.chunkIndex + 1,
        eTag: p.eTag,
      }));

      let finalKey = session.key;
      try {
        if (storage.completeChunkedUpload) {
          finalKey = await storage.completeChunkedUpload(uploadId, partsForBackend);
        }

        // Update file + session
        await store.updateFile(session.file_id, { status: 'committed', key: finalKey });
        await store.updateSession(uploadId, { status: 'completed' });
      } catch (completionErr) {
        // Terminal for THIS attempt, not a lock: nothing here reads `failed` as
        // a refusal, so a client that retries the same uploadId after a
        // transient backend blip runs the happy path again and overwrites it
        // with `completed`. What the stamp buys is that an attempt which is
        // NOT retried stops claiming to be in flight (#7667).
        await markSessionFailed(uploadId);
        throw completionErr;
      }

      sendOk(res, {
        fileId: session.file_id,
        key: finalKey,
        size: session.total_size,
        mimeType: session.mime_type ?? 'application/octet-stream',
        url: `${basePath}/files/${session.file_id}/url`,
      });
    } catch (err: any) {
      sendError(res, 500, 'INTERNAL', err?.message ?? 'Internal error');
    }
  });

  // ---------------------------------------------------------------------------
  // GET /storage/upload/chunked/:uploadId/progress
  // ---------------------------------------------------------------------------
  httpServer.get(`${basePath}/upload/chunked/:uploadId/progress`, async (req: IHttpRequest, res: IHttpResponse) => {
    try {
      if ((await requireUploadSession(req, res)) === false) return;
      const { uploadId } = req.params;
      const stored = await store.getSession(uploadId);
      if (!stored) {
        sendError(res, 404, 'UPLOAD_SESSION_NOT_FOUND', 'Upload session not found');
        return;
      }

      // Progress REPORTS the expiry rather than refusing it: `expired` is a
      // declared member of `UploadProgressSchema.status`, and a resuming client
      // (the SDK's `resumeUpload` polls this first) needs to be told the
      // session is gone, not handed a 410 it has to interpret (#7667).
      const session = await expireIfPastDeadline(stored);

      const uploadedChunks = session.uploaded_chunks ?? 0;
      const uploadedSize = session.uploaded_size ?? 0;
      const percentComplete = session.total_size > 0
        ? Math.min(100, Math.round((uploadedSize / session.total_size) * 100))
        : 0;

      sendOk(res, {
        uploadId: session.id,
        fileId: session.file_id,
        filename: session.filename,
        totalSize: session.total_size,
        uploadedSize,
        totalChunks: session.total_chunks,
        uploadedChunks,
        percentComplete,
        status: session.status,
        startedAt: session.started_at,
        expiresAt: session.expires_at,
      });
    } catch (err: any) {
      sendError(res, 500, 'INTERNAL', err?.message ?? 'Internal error');
    }
  });

  // ---------------------------------------------------------------------------
  // GET /storage/files/:fileId/url
  // ---------------------------------------------------------------------------
  httpServer.get(`${basePath}/files/:fileId/url`, async (req: IHttpRequest, res: IHttpResponse) => {
    try {
      const { fileId } = req.params;
      const file = await store.getFile(fileId);
      if (!file || file.status !== 'committed') {
        sendError(res, 404, 'FILE_NOT_FOUND', 'File not found or not committed');
        return;
      }

      const ttl = await authorizeDownload(file, req, res);
      if (ttl === false) return;

      const downloadOpts = { filename: file.name, contentType: file.mime_type };
      let url: string;
      if (storage.getPresignedDownload) {
        const desc = await storage.getPresignedDownload(file.key, ttl, downloadOpts);
        url = desc.downloadUrl;
      } else if (storage.getSignedUrl) {
        url = await storage.getSignedUrl(file.key, ttl, downloadOpts);
      } else {
        // See the sibling branch on `GET /files/:fileId`: no adapter capability
        // means no download URL, and handing back an unmounted one is worse
        // than admitting it (#3641).
        sendError(res, 501, 'NOT_IMPLEMENTED', 'This storage adapter cannot issue download URLs');
        return;
      }

      // `{ success: true, data: { url } }` since #3689 — this route used to
      // answer a bare `{ url }`, the one success body on the surface that
      // carried no envelope at all.
      sendOk(res, { url });
    } catch (err: any) {
      sendError(res, 500, 'INTERNAL', err?.message ?? 'Internal error');
    }
  });

  // ---------------------------------------------------------------------------
  // GET /storage/files/:fileId — stable redirect to the actual bytes.
  //
  // Frontend widgets (`ImageField`, `<img src>`, user avatars, org logos)
  // need a URL that:
  //   - is stable (won't expire — records may live for years)
  //   - serves the bytes directly when followed
  // The `/url` endpoint above returns JSON. This sibling endpoint resolves
  // to the same short-lived signed URL and 302-redirects so it can be used
  // verbatim in any browser context.
  // ---------------------------------------------------------------------------
  httpServer.get(`${basePath}/files/:fileId`, async (req: IHttpRequest, res: IHttpResponse) => {
    try {
      const { fileId } = req.params;
      const file = await store.getFile(fileId);
      if (!file || file.status !== 'committed') {
        sendError(res, 404, 'FILE_NOT_FOUND', 'File not found or not committed');
        return;
      }

      const ttl = await authorizeDownload(file, req, res);
      if (ttl === false) return;

      const downloadOpts = { filename: file.name, contentType: file.mime_type };
      let url: string;
      if (storage.getPresignedDownload) {
        const desc = await storage.getPresignedDownload(file.key, ttl, downloadOpts);
        url = desc.downloadUrl;
      } else if (storage.getSignedUrl) {
        url = await storage.getSignedUrl(file.key, ttl, downloadOpts);
      } else {
        // An adapter with neither `getPresignedDownload` nor `getSignedUrl`
        // cannot produce a download URL. This used to redirect to
        // `${basePath}/_local/file/<key>`, which no registrar mounts — a 302
        // straight into a 404 (#3641). Say so instead: the caller learns the
        // adapter is the limitation, rather than chasing a broken link.
        sendError(res, 501, 'NOT_IMPLEMENTED', 'This storage adapter cannot issue download URLs');
        return;
      }

      res.status(302).header('Location', url).send('');
    } catch (err: any) {
      sendError(res, 500, 'INTERNAL', err?.message ?? 'Internal error');
    }
  });

  // ---------------------------------------------------------------------------
  // PUT /storage/_local/raw/:token — presigned raw upload (LocalStorageAdapter)
  // ---------------------------------------------------------------------------
  httpServer.put(`${basePath}/_local/raw/:token`, async (req: IHttpRequest, res: IHttpResponse) => {
    try {
      const { token } = req.params;
      const localAdapter = storage as LocalStorageAdapter;
      if (!localAdapter.verifyToken) {
        sendError(res, 501, 'NOT_IMPLEMENTED', 'Presigned raw upload not supported by this adapter');
        return;
      }

      const payload = localAdapter.verifyToken(token, 'put');
      let data: Buffer;
      if (req.rawBody) {
        data = await req.rawBody();
      } else if (Buffer.isBuffer(req.body)) {
        data = req.body;
      } else {
        sendError(res, 400, 'INVALID_REQUEST', 'Binary body required');
        return;
      }

      await storage.upload(payload.k, data, { contentType: payload.ct });
      // `{ ok: true, key }` until #3689. `ok` was a second, private word for
      // `success` on a route that is mounted under `/api/v1/storage` like any
      // other; the envelope now says it once. Nothing reads this body — the
      // SDK and the console both PUT here opaquely, exactly as they would an
      // S3 presigned URL, and check only the status — so the move is
      // observable to conformance tests and to curl, not to a caller.
      sendOk(res, { key: payload.k });
    } catch (err: any) {
      const invalidToken = err?.message?.includes('expired') || err?.message?.includes('signature');
      sendError(
        res,
        invalidToken ? 403 : 500,
        invalidToken ? 'INVALID_TOKEN' : 'INTERNAL',
        err?.message ?? 'Upload failed',
      );
    }
  });

  // ---------------------------------------------------------------------------
  // GET /storage/_local/raw/:token — presigned raw download (LocalStorageAdapter)
  // ---------------------------------------------------------------------------
  httpServer.get(`${basePath}/_local/raw/:token`, async (req: IHttpRequest, res: IHttpResponse) => {
    try {
      const { token } = req.params;
      const localAdapter = storage as LocalStorageAdapter;
      if (!localAdapter.verifyToken) {
        sendError(res, 501, 'NOT_IMPLEMENTED', 'Presigned download not supported by this adapter');
        return;
      }

      const payload = localAdapter.verifyToken(token, 'get');
      const data = await storage.download(payload.k);

      res.header('content-type', payload.ct ?? 'application/octet-stream');
      res.header('content-length', String(data.byteLength));
      // When the token carries the original filename, advertise it so the
      // browser saves the file under its real name (not the opaque URL token).
      if (payload.n) {
        res.header('content-disposition', contentDispositionValue(payload.n, payload.d ?? 'inline'));
      }
      res.send(data);
    } catch (err: any) {
      const invalidToken = err?.message?.includes('expired') || err?.message?.includes('signature');
      sendError(
        res,
        invalidToken ? 403 : 500,
        invalidToken ? 'INVALID_TOKEN' : 'INTERNAL',
        err?.message ?? 'Download failed',
      );
    }
  });
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function buildKey(scope: string, fileId: string, filename: string): string {
  const ext = filename.includes('.') ? '.' + filename.split('.').pop() : '';
  return `${scope}/${fileId}${ext}`;
}
