// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { z } from 'zod';
import { BaseResponseSchema } from './contract.zod';
import { FileMetadataSchema } from '../system/object-storage.zod';

/**
 * Storage Service Protocol
 * 
 * Defines the API contract for client-side file operations.
 * Focuses on secure, direct-to-cloud uploads (Presigned URLs)
 * rather than proxying bytes through the API server.
 */

// ==========================================
// Requests
// ==========================================

import { lazySchema } from '../shared/lazy-schema';
export const GetPresignedUrlRequestSchema = lazySchema(() => z.object({
  filename: z.string().describe('Original filename'),
  mimeType: z.string().describe('File MIME type'),
  size: z.number().describe('File size in bytes'),
  scope: z.string().default('user').describe('Target storage scope (e.g. user, private, public)'),
  bucket: z.string().optional().describe('Specific bucket override (admin only)'),
}));

export const CompleteUploadRequestSchema = lazySchema(() => z.object({
  fileId: z.string().describe('File ID returned from presigned request'),
  eTag: z.string().optional().describe('S3 ETag verification'),
}));

// ==========================================
// Responses
// ==========================================

export const PresignedUrlResponseSchema = lazySchema(() => BaseResponseSchema.extend({
  data: z.object({
    uploadUrl: z.string().describe('PUT/POST URL for direct upload'),
    downloadUrl: z.string().optional().describe('Public/Private preview URL'),
    fileId: z.string().describe('Temporary File ID'),
    method: z.enum(['PUT', 'POST']).describe('HTTP Method to use'),
    headers: z.record(z.string(), z.string()).optional().describe('Required headers for upload'),
    expiresIn: z.number().describe('URL expiry in seconds'),
  }),
}));

export const FileUploadResponseSchema = lazySchema(() => BaseResponseSchema.extend({
  data: FileMetadataSchema.describe('Uploaded file metadata'),
}));

/**
 * Download URL Response
 *
 * `GET /api/v1/storage/files/:fileId/url` — resolves a committed file to a
 * short-lived signed URL (absolute for S3/GCS, server-relative for the local
 * adapter's `_local/raw` loopback).
 *
 * Declared here as of #3689. The route always existed and was always ledgered
 * `disposition: 'sdk'` (`storage.getDownloadUrl`), but it had no schema — so
 * it answered a bare `{ url }` with nothing to answer to, the only success
 * body on this surface outside the envelope. Both are now fixed together:
 * the shape is declared, and the route emits it.
 */
export const FileDownloadUrlResponseSchema = lazySchema(() => BaseResponseSchema.extend({
  data: z.object({
    url: z.string().describe('Short-lived signed download URL; may be server-relative'),
  }),
}));

/**
 * Raw Upload Response
 *
 * `PUT /api/v1/storage/_local/raw/:token` — the loopback target
 * `LocalStorageAdapter` mints for its own presign tokens, standing in for the
 * S3 presigned PUT a cloud adapter would hand out. Callers PUT to it opaquely
 * and read only the status, so the body exists for conformance and for curl.
 *
 * Declared as of #3689, which also retired the `{ ok: true, key }` shape it
 * used to answer: `ok` was a second word for the `success` the envelope
 * already carries.
 */
export const RawUploadResponseSchema = lazySchema(() => BaseResponseSchema.extend({
  data: z.object({
    key: z.string().describe('Storage key the bytes were written to'),
  }),
}));

export type GetPresignedUrlRequest = z.infer<typeof GetPresignedUrlRequestSchema>;
export type CompleteUploadRequest = z.infer<typeof CompleteUploadRequestSchema>;
export type PresignedUrlResponse = z.infer<typeof PresignedUrlResponseSchema>;
export type FileUploadResponse = z.infer<typeof FileUploadResponseSchema>;
export type FileDownloadUrlResponse = z.infer<typeof FileDownloadUrlResponseSchema>;
export type RawUploadResponse = z.infer<typeof RawUploadResponseSchema>;

// ==========================================
// Chunked / Resumable Upload Protocol
// ==========================================

/**
 * File Type Validation Schema
 * Configures allowed and blocked file types for upload endpoints.
 *
 * @example Allow images only
 * { mode: 'whitelist', mimeTypes: ['image/jpeg', 'image/png', 'image/webp'], maxFileSize: 10485760 }
 */
export const FileTypeValidationSchema = lazySchema(() => z.object({
  mode: z.enum(['whitelist', 'blacklist'])
    .describe('whitelist = only allow listed types, blacklist = block listed types'),
  mimeTypes: z.array(z.string()).min(1)
    .describe('List of MIME types to allow or block (e.g., "image/jpeg", "application/pdf")'),
  extensions: z.array(z.string()).optional()
    .describe('List of file extensions to allow or block (e.g., ".jpg", ".pdf")'),
  maxFileSize: z.number().int().min(1).optional()
    .describe('Maximum file size in bytes'),
  minFileSize: z.number().int().min(0).optional()
    .describe('Minimum file size in bytes (e.g., reject empty files)'),
}));
export type FileTypeValidation = z.infer<typeof FileTypeValidationSchema>;

/**
 * Initiate Chunked Upload Request
 * Starts a resumable multipart upload session.
 *
 * @example POST /api/v1/storage/upload/chunked
 * { filename: 'large-video.mp4', mimeType: 'video/mp4', totalSize: 1073741824, chunkSize: 5242880 }
 */
export const InitiateChunkedUploadRequestSchema = lazySchema(() => z.object({
  filename: z.string().describe('Original filename'),
  mimeType: z.string().describe('File MIME type'),
  totalSize: z.number().int().min(1).describe('Total file size in bytes'),
  chunkSize: z.number().int().min(5242880).default(5242880)
    .describe('Size of each chunk in bytes (minimum 5MB per S3 spec)'),
  scope: z.string().default('user').describe('Target storage scope'),
  bucket: z.string().optional().describe('Specific bucket override (admin only)'),
  metadata: z.record(z.string(), z.string()).optional().describe('Custom metadata key-value pairs'),
}));
export type InitiateChunkedUploadRequest = z.infer<typeof InitiateChunkedUploadRequestSchema>;

/**
 * Initiate Chunked Upload Response
 * Returns a resume token and upload session details.
 */
export const InitiateChunkedUploadResponseSchema = lazySchema(() => BaseResponseSchema.extend({
  data: z.object({
    uploadId: z.string().describe('Multipart upload session ID'),
    resumeToken: z.string().describe('Opaque token for resuming interrupted uploads'),
    fileId: z.string().describe('Assigned file ID'),
    totalChunks: z.number().int().min(1).describe('Expected number of chunks'),
    chunkSize: z.number().int().describe('Chunk size in bytes'),
    expiresAt: z.string().datetime().describe('Upload session expiration timestamp'),
  }),
}));
export type InitiateChunkedUploadResponse = z.infer<typeof InitiateChunkedUploadResponseSchema>;

/**
 * Upload Chunk Request
 * Uploads a single chunk of a multipart upload.
 *
 * @example PUT /api/v1/storage/upload/chunked/:uploadId/chunk/:chunkIndex
 */
export const UploadChunkRequestSchema = lazySchema(() => z.object({
  uploadId: z.string().describe('Multipart upload session ID'),
  chunkIndex: z.number().int().min(0).describe('Zero-based chunk index'),
  resumeToken: z.string().describe('Resume token from initiate response'),
}));
export type UploadChunkRequest = z.infer<typeof UploadChunkRequestSchema>;

/**
 * Upload Chunk Response
 * Confirms a single chunk upload with ETag for assembly.
 */
export const UploadChunkResponseSchema = lazySchema(() => BaseResponseSchema.extend({
  data: z.object({
    chunkIndex: z.number().int().describe('Chunk index that was uploaded'),
    eTag: z.string().describe('Chunk ETag for multipart completion'),
    bytesReceived: z.number().int().describe('Bytes received for this chunk'),
  }),
}));
export type UploadChunkResponse = z.infer<typeof UploadChunkResponseSchema>;

/**
 * Complete Chunked Upload Request
 * Assembles all uploaded chunks into a final file.
 *
 * @example POST /api/v1/storage/upload/chunked/:uploadId/complete
 */
export const CompleteChunkedUploadRequestSchema = lazySchema(() => z.object({
  uploadId: z.string().describe('Multipart upload session ID'),
  parts: z.array(z.object({
    chunkIndex: z.number().int().describe('Chunk index'),
    eTag: z.string().describe('ETag returned from chunk upload'),
  })).min(1).describe('Ordered list of uploaded parts for assembly'),
}));
export type CompleteChunkedUploadRequest = z.infer<typeof CompleteChunkedUploadRequestSchema>;

/**
 * Complete Chunked Upload Response
 * Confirms that all chunks have been assembled into the final file.
 */
export const CompleteChunkedUploadResponseSchema = lazySchema(() => BaseResponseSchema.extend({
  data: z.object({
    fileId: z.string().describe('Final file ID'),
    key: z.string().describe('Storage key/path of the assembled file'),
    size: z.number().int().describe('Total file size in bytes'),
    mimeType: z.string().describe('File MIME type'),
    eTag: z.string().optional().describe('Final ETag of the assembled file'),
    url: z.string().optional().describe('Download URL for the assembled file'),
  }),
}));
export type CompleteChunkedUploadResponse = z.infer<typeof CompleteChunkedUploadResponseSchema>;

/**
 * Upload Progress Schema
 * Represents the current progress of an active upload session.
 *
 * @example GET /api/v1/storage/upload/chunked/:uploadId/progress
 */
export const UploadProgressSchema = lazySchema(() => BaseResponseSchema.extend({
  data: z.object({
    uploadId: z.string().describe('Multipart upload session ID'),
    fileId: z.string().describe('Assigned file ID'),
    filename: z.string().describe('Original filename'),
    totalSize: z.number().int().describe('Total file size in bytes'),
    uploadedSize: z.number().int().describe('Bytes uploaded so far'),
    totalChunks: z.number().int().describe('Total expected chunks'),
    uploadedChunks: z.number().int().describe('Number of chunks uploaded'),
    percentComplete: z.number().min(0).max(100).describe('Upload progress percentage'),
    status: z.enum(['in_progress', 'completing', 'completed', 'failed', 'expired'])
      .describe('Current upload session status'),
    startedAt: z.string().datetime().describe('Upload session start timestamp'),
    expiresAt: z.string().datetime().describe('Session expiration timestamp'),
  }),
}));
export type UploadProgress = z.infer<typeof UploadProgressSchema>;

// ==========================================
// Storage API Contract Registry
// ==========================================

/**
 * Standard Storage API contracts map.
 * Used for generating SDKs, documentation, and route registration.
 */
export const StorageApiContracts = {
  getPresignedUrl: {
    method: 'POST' as const,
    path: '/api/v1/storage/upload/presigned',
    input: GetPresignedUrlRequestSchema,
    output: PresignedUrlResponseSchema,
  },
  completeUpload: {
    method: 'POST' as const,
    path: '/api/v1/storage/upload/complete',
    input: CompleteUploadRequestSchema,
    output: FileUploadResponseSchema,
  },
  initiateChunkedUpload: {
    method: 'POST' as const,
    path: '/api/v1/storage/upload/chunked',
    input: InitiateChunkedUploadRequestSchema,
    output: InitiateChunkedUploadResponseSchema,
  },
  uploadChunk: {
    method: 'PUT' as const,
    path: '/api/v1/storage/upload/chunked/:uploadId/chunk/:chunkIndex',
    input: UploadChunkRequestSchema,
    output: UploadChunkResponseSchema,
  },
  completeChunkedUpload: {
    method: 'POST' as const,
    path: '/api/v1/storage/upload/chunked/:uploadId/complete',
    input: CompleteChunkedUploadRequestSchema,
    output: CompleteChunkedUploadResponseSchema,
  },
  getUploadProgress: {
    method: 'GET' as const,
    path: '/api/v1/storage/upload/chunked/:uploadId/progress',
    output: UploadProgressSchema,
  },
  // The download resolve. An SDK-addressed route (`storage.getDownloadUrl`)
  // that had been missing from this registry, which is how its response shape
  // went undeclared long enough to drift outside the envelope (#3689).
  //
  // The two `_local/raw/:token` routes stay out on purpose: they are the local
  // adapter's own presign loopback, ledgered `server-only`, addressed as an
  // opaque signed URL rather than as an API. `RawUploadResponseSchema` above
  // declares what the PUT answers without promoting it to a client contract.
  getDownloadUrl: {
    method: 'GET' as const,
    path: '/api/v1/storage/files/:fileId/url',
    output: FileDownloadUrlResponseSchema,
  },
};
