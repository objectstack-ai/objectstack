// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { randomUUID } from 'node:crypto';
import type { IHttpServer, IHttpRequest, IHttpResponse, IStorageService } from '@objectstack/spec/contracts';
import type { StorageMetadataStore } from './metadata-store.js';
import type { LocalStorageAdapter } from './local-storage-adapter.js';

/**
 * Options for the storage route registration helper.
 */
export interface StorageRoutesOptions {
  basePath?: string;
  /** Default presigned URL TTL in seconds */
  presignedTtl?: number;
  /** Default chunked upload session TTL in seconds */
  sessionTtl?: number;
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

  // ---------------------------------------------------------------------------
  // POST /storage/upload/presigned
  // ---------------------------------------------------------------------------
  httpServer.post(`${basePath}/upload/presigned`, async (req: IHttpRequest, res: IHttpResponse) => {
    try {
      const { filename, mimeType, size, scope, bucket } = req.body ?? {};
      if (!filename || !mimeType || size == null) {
        res.status(400).json({ error: 'filename, mimeType, and size are required' });
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

      res.json({
        data: {
          uploadUrl,
          method,
          headers,
          fileId,
          expiresIn,
          downloadUrl: `${basePath}/files/${fileId}/url`,
        },
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message ?? 'Internal error' });
    }
  });

  // ---------------------------------------------------------------------------
  // POST /storage/upload/complete
  // ---------------------------------------------------------------------------
  httpServer.post(`${basePath}/upload/complete`, async (req: IHttpRequest, res: IHttpResponse) => {
    try {
      const { fileId, eTag } = req.body ?? {};
      if (!fileId) {
        res.status(400).json({ error: 'fileId is required' });
        return;
      }

      const file = await store.getFile(fileId);
      if (!file) {
        res.status(404).json({ error: 'File not found' });
        return;
      }

      const updated = await store.updateFile(fileId, {
        status: 'committed',
        etag: eTag ?? undefined,
      });

      res.json({
        data: {
          path: updated!.key,
          name: updated!.name,
          size: updated!.size ?? 0,
          mimeType: updated!.mime_type ?? 'application/octet-stream',
          lastModified: updated!.updated_at ?? new Date().toISOString(),
          created: updated!.created_at ?? new Date().toISOString(),
          etag: updated!.etag,
        },
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message ?? 'Internal error' });
    }
  });

  // ---------------------------------------------------------------------------
  // POST /storage/upload/chunked
  // ---------------------------------------------------------------------------
  httpServer.post(`${basePath}/upload/chunked`, async (req: IHttpRequest, res: IHttpResponse) => {
    try {
      const { filename, mimeType, totalSize, chunkSize: reqChunkSize, scope, bucket, metadata } = req.body ?? {};
      if (!filename || !mimeType || !totalSize) {
        res.status(400).json({ error: 'filename, mimeType, and totalSize are required' });
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

      res.json({
        data: {
          uploadId,
          resumeToken,
          fileId,
          totalChunks,
          chunkSize,
          expiresAt,
        },
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message ?? 'Internal error' });
    }
  });

  // ---------------------------------------------------------------------------
  // PUT /storage/upload/chunked/:uploadId/chunk/:chunkIndex
  // ---------------------------------------------------------------------------
  httpServer.put(`${basePath}/upload/chunked/:uploadId/chunk/:chunkIndex`, async (req: IHttpRequest, res: IHttpResponse) => {
    try {
      const { uploadId, chunkIndex: chunkIndexStr } = req.params;
      const chunkIndex = parseInt(chunkIndexStr, 10);
      if (!uploadId || isNaN(chunkIndex)) {
        res.status(400).json({ error: 'uploadId and chunkIndex are required' });
        return;
      }

      const session = await store.getSession(uploadId);
      if (!session) {
        res.status(404).json({ error: 'Upload session not found' });
        return;
      }

      // Verify resume token
      const token = (req.headers['x-resume-token'] ?? '') as string;
      if (session.resume_token && token !== session.resume_token) {
        res.status(403).json({ error: 'Invalid resume token' });
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
        res.status(400).json({ error: 'Binary body required' });
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

      res.json({
        data: {
          chunkIndex,
          eTag,
          bytesReceived: data.byteLength,
        },
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message ?? 'Internal error' });
    }
  });

  // ---------------------------------------------------------------------------
  // POST /storage/upload/chunked/:uploadId/complete
  // ---------------------------------------------------------------------------
  httpServer.post(`${basePath}/upload/chunked/:uploadId/complete`, async (req: IHttpRequest, res: IHttpResponse) => {
    try {
      const { uploadId } = req.params;
      const session = await store.getSession(uploadId);
      if (!session) {
        res.status(404).json({ error: 'Upload session not found' });
        return;
      }

      await store.updateSession(uploadId, { status: 'completing' });

      const partsFromBody = (req.body?.parts ?? []) as Array<{ chunkIndex: number; eTag: string }>;
      const partsForBackend = partsFromBody.map(p => ({
        partNumber: p.chunkIndex + 1,
        eTag: p.eTag,
      }));

      let finalKey = session.key;
      if (storage.completeChunkedUpload) {
        finalKey = await storage.completeChunkedUpload(uploadId, partsForBackend);
      }

      // Update file + session
      await store.updateFile(session.file_id, { status: 'committed', key: finalKey });
      await store.updateSession(uploadId, { status: 'completed' });

      res.json({
        data: {
          fileId: session.file_id,
          key: finalKey,
          size: session.total_size,
          mimeType: session.mime_type ?? 'application/octet-stream',
          url: `${basePath}/files/${session.file_id}/url`,
        },
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message ?? 'Internal error' });
    }
  });

  // ---------------------------------------------------------------------------
  // GET /storage/upload/chunked/:uploadId/progress
  // ---------------------------------------------------------------------------
  httpServer.get(`${basePath}/upload/chunked/:uploadId/progress`, async (req: IHttpRequest, res: IHttpResponse) => {
    try {
      const { uploadId } = req.params;
      const session = await store.getSession(uploadId);
      if (!session) {
        res.status(404).json({ error: 'Upload session not found' });
        return;
      }

      const uploadedChunks = session.uploaded_chunks ?? 0;
      const uploadedSize = session.uploaded_size ?? 0;
      const percentComplete = session.total_size > 0
        ? Math.min(100, Math.round((uploadedSize / session.total_size) * 100))
        : 0;

      res.json({
        data: {
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
        },
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message ?? 'Internal error' });
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
        res.status(404).json({ error: 'File not found or not committed' });
        return;
      }

      let url: string;
      if (storage.getPresignedDownload) {
        const desc = await storage.getPresignedDownload(file.key, presignedTtl);
        url = desc.downloadUrl;
      } else if (storage.getSignedUrl) {
        url = await storage.getSignedUrl(file.key, presignedTtl);
      } else {
        url = `${basePath}/_local/file/${encodeURIComponent(file.key)}`;
      }

      res.json({ url });
    } catch (err: any) {
      res.status(500).json({ error: err.message ?? 'Internal error' });
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
        res.status(404).json({ error: 'File not found or not committed' });
        return;
      }

      let url: string;
      if (storage.getPresignedDownload) {
        const desc = await storage.getPresignedDownload(file.key, presignedTtl);
        url = desc.downloadUrl;
      } else if (storage.getSignedUrl) {
        url = await storage.getSignedUrl(file.key, presignedTtl);
      } else {
        url = `${basePath}/_local/file/${encodeURIComponent(file.key)}`;
      }

      res.status(302).header('Location', url).send('');
    } catch (err: any) {
      res.status(500).json({ error: err.message ?? 'Internal error' });
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
        res.status(501).json({ error: 'Presigned raw upload not supported by this adapter' });
        return;
      }

      const payload = localAdapter.verifyToken(token, 'put');
      let data: Buffer;
      if (req.rawBody) {
        data = await req.rawBody();
      } else if (Buffer.isBuffer(req.body)) {
        data = req.body;
      } else {
        res.status(400).json({ error: 'Binary body required' });
        return;
      }

      await storage.upload(payload.k, data, { contentType: payload.ct });
      res.json({ ok: true, key: payload.k });
    } catch (err: any) {
      const statusCode = err.message?.includes('expired') || err.message?.includes('signature') ? 403 : 500;
      res.status(statusCode).json({ error: err.message ?? 'Upload failed' });
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
        res.status(501).json({ error: 'Presigned download not supported by this adapter' });
        return;
      }

      const payload = localAdapter.verifyToken(token, 'get');
      const data = await storage.download(payload.k);

      res.header('content-type', payload.ct ?? 'application/octet-stream');
      res.header('content-length', String(data.byteLength));
      // IHttpResponse only has json/send — use send with binary encoding
      // This works for Hono adapter since send passes through
      (res as any).send(data);
    } catch (err: any) {
      const statusCode = err.message?.includes('expired') || err.message?.includes('signature') ? 403 : 500;
      res.status(statusCode).json({ error: err.message ?? 'Download failed' });
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
