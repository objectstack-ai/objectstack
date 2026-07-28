import { describe, it, expect } from 'vitest';
import {
  GetPresignedUrlRequestSchema,
  CompleteUploadRequestSchema,
  PresignedUrlResponseSchema,
  FileUploadResponseSchema,
  FileTypeValidationSchema,
  InitiateChunkedUploadRequestSchema,
  InitiateChunkedUploadResponseSchema,
  UploadChunkRequestSchema,
  UploadChunkResponseSchema,
  CompleteChunkedUploadRequestSchema,
  CompleteChunkedUploadResponseSchema,
  UploadProgressSchema,
  FileDownloadUrlResponseSchema,
  RawUploadResponseSchema,
  StorageApiContracts,
} from './storage.zod';

describe('GetPresignedUrlRequestSchema', () => {
  it('should accept valid request with defaults', () => {
    const req = GetPresignedUrlRequestSchema.parse({
      filename: 'report.pdf',
      mimeType: 'application/pdf',
      size: 1048576,
    });
    expect(req.filename).toBe('report.pdf');
    expect(req.scope).toBe('user');
    expect(req.bucket).toBeUndefined();
  });

  it('should accept request with all fields', () => {
    const req = GetPresignedUrlRequestSchema.parse({
      filename: 'image.png',
      mimeType: 'image/png',
      size: 2048,
      scope: 'public',
      bucket: 'media-bucket',
    });
    expect(req.scope).toBe('public');
    expect(req.bucket).toBe('media-bucket');
  });

  it('should reject missing filename', () => {
    expect(() =>
      GetPresignedUrlRequestSchema.parse({
        mimeType: 'text/plain',
        size: 100,
      })
    ).toThrow();
  });

  it('should reject missing mimeType', () => {
    expect(() =>
      GetPresignedUrlRequestSchema.parse({
        filename: 'test.txt',
        size: 100,
      })
    ).toThrow();
  });

  it('should reject missing size', () => {
    expect(() =>
      GetPresignedUrlRequestSchema.parse({
        filename: 'test.txt',
        mimeType: 'text/plain',
      })
    ).toThrow();
  });

  it('should reject non-number size', () => {
    expect(() =>
      GetPresignedUrlRequestSchema.parse({
        filename: 'test.txt',
        mimeType: 'text/plain',
        size: 'big',
      })
    ).toThrow();
  });
});

describe('CompleteUploadRequestSchema', () => {
  it('should accept valid complete upload request', () => {
    const req = CompleteUploadRequestSchema.parse({
      fileId: 'file_abc123',
    });
    expect(req.fileId).toBe('file_abc123');
    expect(req.eTag).toBeUndefined();
  });

  it('should accept request with eTag', () => {
    const req = CompleteUploadRequestSchema.parse({
      fileId: 'file_xyz',
      eTag: '"abc123def456"',
    });
    expect(req.eTag).toBe('"abc123def456"');
  });

  it('should reject missing fileId', () => {
    expect(() => CompleteUploadRequestSchema.parse({})).toThrow();
  });
});

describe('PresignedUrlResponseSchema', () => {
  it('should accept valid presigned URL response', () => {
    const resp = PresignedUrlResponseSchema.parse({
      success: true,
      data: {
        uploadUrl: 'https://s3.amazonaws.com/bucket/key?presigned=true',
        fileId: 'file_tmp_123',
        method: 'PUT',
        expiresIn: 3600,
      },
    });
    expect(resp.data.uploadUrl).toContain('s3.amazonaws.com');
    expect(resp.data.method).toBe('PUT');
    expect(resp.data.expiresIn).toBe(3600);
    expect(resp.data.downloadUrl).toBeUndefined();
    expect(resp.data.headers).toBeUndefined();
  });

  it('should accept response with all optional fields', () => {
    const resp = PresignedUrlResponseSchema.parse({
      success: true,
      data: {
        uploadUrl: 'https://storage.example.com/upload',
        downloadUrl: 'https://cdn.example.com/files/abc',
        fileId: 'file_456',
        method: 'POST',
        headers: { 'Content-Type': 'image/jpeg', 'x-amz-acl': 'private' },
        expiresIn: 900,
      },
    });
    expect(resp.data.downloadUrl).toBeDefined();
    expect(resp.data.headers?.['Content-Type']).toBe('image/jpeg');
    expect(resp.data.method).toBe('POST');
  });

  it('should reject invalid method', () => {
    expect(() =>
      PresignedUrlResponseSchema.parse({
        success: true,
        data: {
          uploadUrl: 'https://example.com',
          fileId: 'f1',
          method: 'GET',
          expiresIn: 60,
        },
      })
    ).toThrow();
  });

  it('should reject missing required data fields', () => {
    expect(() =>
      PresignedUrlResponseSchema.parse({
        success: true,
        data: {
          uploadUrl: 'https://example.com',
          method: 'PUT',
          expiresIn: 60,
        },
      })
    ).toThrow();
  });
});

describe('FileUploadResponseSchema', () => {
  it('should accept valid file upload response', () => {
    const resp = FileUploadResponseSchema.parse({
      success: true,
      data: {
        path: '/uploads/report.pdf',
        name: 'report.pdf',
        size: 1048576,
        mimeType: 'application/pdf',
        lastModified: '2025-06-15T10:30:00Z',
        created: '2025-06-15T10:30:00Z',
      },
    });
    expect(resp.data.path).toBe('/uploads/report.pdf');
    expect(resp.data.name).toBe('report.pdf');
    expect(resp.data.size).toBe(1048576);
  });

  it('should accept response with optional etag', () => {
    const resp = FileUploadResponseSchema.parse({
      success: true,
      data: {
        path: '/files/img.png',
        name: 'img.png',
        size: 2048,
        mimeType: 'image/png',
        lastModified: '2025-01-01T00:00:00Z',
        created: '2025-01-01T00:00:00Z',
        etag: '"etag123"',
      },
    });
    expect(resp.data.etag).toBe('"etag123"');
  });

  it('should reject missing required file metadata fields', () => {
    expect(() =>
      FileUploadResponseSchema.parse({
        success: true,
        data: {
          path: '/files/x.txt',
          name: 'x.txt',
        },
      })
    ).toThrow();
  });

  it('should reject invalid datetime in file metadata', () => {
    expect(() =>
      FileUploadResponseSchema.parse({
        success: true,
        data: {
          path: '/files/x.txt',
          name: 'x.txt',
          size: 100,
          mimeType: 'text/plain',
          lastModified: 'not-a-date',
          created: '2025-01-01T00:00:00Z',
        },
      })
    ).toThrow();
  });
});

// ==========================================
// File Type Validation
// ==========================================

describe('FileTypeValidationSchema', () => {
  it('should accept a whitelist config', () => {
    const config = FileTypeValidationSchema.parse({
      mode: 'whitelist',
      mimeTypes: ['image/jpeg', 'image/png', 'image/webp'],
      maxFileSize: 10485760,
    });
    expect(config.mode).toBe('whitelist');
    expect(config.mimeTypes).toHaveLength(3);
    expect(config.maxFileSize).toBe(10485760);
  });

  it('should accept a blacklist config', () => {
    const config = FileTypeValidationSchema.parse({
      mode: 'blacklist',
      mimeTypes: ['application/x-executable'],
      extensions: ['.exe', '.bat', '.sh'],
    });
    expect(config.mode).toBe('blacklist');
    expect(config.extensions).toHaveLength(3);
  });

  it('should reject invalid mode', () => {
    expect(() =>
      FileTypeValidationSchema.parse({
        mode: 'graylist',
        mimeTypes: ['image/png'],
      })
    ).toThrow();
  });

  it('should reject empty mimeTypes', () => {
    expect(() =>
      FileTypeValidationSchema.parse({
        mode: 'whitelist',
        mimeTypes: [],
      })
    ).toThrow();
  });

  it('should reject missing mimeTypes', () => {
    expect(() =>
      FileTypeValidationSchema.parse({ mode: 'whitelist' })
    ).toThrow();
  });
});

// ==========================================
// Chunked Upload — Initiate
// ==========================================

describe('InitiateChunkedUploadRequestSchema', () => {
  it('should accept a valid request', () => {
    const req = InitiateChunkedUploadRequestSchema.parse({
      filename: 'large-video.mp4',
      mimeType: 'video/mp4',
      totalSize: 1073741824,
      chunkSize: 10485760,
    });
    expect(req.filename).toBe('large-video.mp4');
    expect(req.totalSize).toBe(1073741824);
    expect(req.chunkSize).toBe(10485760);
  });

  it('should apply defaults', () => {
    const req = InitiateChunkedUploadRequestSchema.parse({
      filename: 'data.bin',
      mimeType: 'application/octet-stream',
      totalSize: 52428800,
    });
    expect(req.chunkSize).toBe(5242880);
    expect(req.scope).toBe('user');
    expect(req.bucket).toBeUndefined();
    expect(req.metadata).toBeUndefined();
  });

  it('should reject chunkSize below minimum (5MB)', () => {
    expect(() =>
      InitiateChunkedUploadRequestSchema.parse({
        filename: 'test.bin',
        mimeType: 'application/octet-stream',
        totalSize: 10000000,
        chunkSize: 1000000,
      })
    ).toThrow();
  });

  it('should reject totalSize less than 1', () => {
    expect(() =>
      InitiateChunkedUploadRequestSchema.parse({
        filename: 'empty.bin',
        mimeType: 'application/octet-stream',
        totalSize: 0,
      })
    ).toThrow();
  });

  it('should accept request with metadata', () => {
    const req = InitiateChunkedUploadRequestSchema.parse({
      filename: 'report.pdf',
      mimeType: 'application/pdf',
      totalSize: 20000000,
      metadata: { source: 'upload-form', project: 'proj_123' },
    });
    expect(req.metadata?.source).toBe('upload-form');
  });
});

describe('InitiateChunkedUploadResponseSchema', () => {
  it('should accept a valid response', () => {
    const resp = InitiateChunkedUploadResponseSchema.parse({
      success: true,
      data: {
        uploadId: 'upload_001',
        resumeToken: 'tok_abc123',
        fileId: 'file_001',
        totalChunks: 20,
        chunkSize: 5242880,
        expiresAt: '2026-02-02T10:00:00Z',
      },
    });
    expect(resp.data.uploadId).toBe('upload_001');
    expect(resp.data.totalChunks).toBe(20);
    expect(resp.data.resumeToken).toBe('tok_abc123');
  });

  it('should reject missing required fields', () => {
    expect(() =>
      InitiateChunkedUploadResponseSchema.parse({
        success: true,
        data: {
          uploadId: 'upload_001',
          fileId: 'file_001',
        },
      })
    ).toThrow();
  });
});

// ==========================================
// Chunked Upload — Chunk
// ==========================================

describe('UploadChunkRequestSchema', () => {
  it('should accept a valid chunk request', () => {
    const req = UploadChunkRequestSchema.parse({
      uploadId: 'upload_001',
      chunkIndex: 0,
      resumeToken: 'tok_abc123',
    });
    expect(req.uploadId).toBe('upload_001');
    expect(req.chunkIndex).toBe(0);
  });

  it('should reject negative chunkIndex', () => {
    expect(() =>
      UploadChunkRequestSchema.parse({
        uploadId: 'upload_001',
        chunkIndex: -1,
        resumeToken: 'tok_abc123',
      })
    ).toThrow();
  });
});

describe('UploadChunkResponseSchema', () => {
  it('should accept a valid chunk response', () => {
    const resp = UploadChunkResponseSchema.parse({
      success: true,
      data: {
        chunkIndex: 3,
        eTag: '"abc123def456"',
        bytesReceived: 5242880,
      },
    });
    expect(resp.data.chunkIndex).toBe(3);
    expect(resp.data.eTag).toBe('"abc123def456"');
    expect(resp.data.bytesReceived).toBe(5242880);
  });
});

// ==========================================
// Chunked Upload — Complete
// ==========================================

describe('CompleteChunkedUploadRequestSchema', () => {
  it('should accept a valid complete request', () => {
    const req = CompleteChunkedUploadRequestSchema.parse({
      uploadId: 'upload_001',
      parts: [
        { chunkIndex: 0, eTag: '"etag0"' },
        { chunkIndex: 1, eTag: '"etag1"' },
        { chunkIndex: 2, eTag: '"etag2"' },
      ],
    });
    expect(req.parts).toHaveLength(3);
  });

  it('should reject empty parts array', () => {
    expect(() =>
      CompleteChunkedUploadRequestSchema.parse({
        uploadId: 'upload_001',
        parts: [],
      })
    ).toThrow();
  });

  it('should reject missing uploadId', () => {
    expect(() =>
      CompleteChunkedUploadRequestSchema.parse({
        parts: [{ chunkIndex: 0, eTag: '"etag0"' }],
      })
    ).toThrow();
  });
});

// ==========================================
// Upload Progress
// ==========================================

describe('UploadProgressSchema', () => {
  it('should accept a valid in-progress upload', () => {
    const progress = UploadProgressSchema.parse({
      success: true,
      data: {
        uploadId: 'upload_001',
        fileId: 'file_001',
        filename: 'large-video.mp4',
        totalSize: 1073741824,
        uploadedSize: 52428800,
        totalChunks: 205,
        uploadedChunks: 10,
        percentComplete: 4.88,
        status: 'in_progress',
        startedAt: '2026-02-01T10:00:00Z',
        expiresAt: '2026-02-02T10:00:00Z',
      },
    });
    expect(progress.data.status).toBe('in_progress');
    expect(progress.data.uploadedChunks).toBe(10);
    expect(progress.data.percentComplete).toBeCloseTo(4.88);
  });

  it('should accept a completed upload', () => {
    const progress = UploadProgressSchema.parse({
      success: true,
      data: {
        uploadId: 'upload_001',
        fileId: 'file_001',
        filename: 'report.pdf',
        totalSize: 20000000,
        uploadedSize: 20000000,
        totalChunks: 4,
        uploadedChunks: 4,
        percentComplete: 100,
        status: 'completed',
        startedAt: '2026-02-01T10:00:00Z',
        expiresAt: '2026-02-02T10:00:00Z',
      },
    });
    expect(progress.data.status).toBe('completed');
    expect(progress.data.percentComplete).toBe(100);
  });

  it('should accept all valid statuses', () => {
    const statuses = ['in_progress', 'completing', 'completed', 'failed', 'expired'];
    statuses.forEach((s) => {
      expect(() =>
        UploadProgressSchema.parse({
          success: true,
          data: {
            uploadId: 'u1',
            fileId: 'f1',
            filename: 'test.bin',
            totalSize: 100,
            uploadedSize: 0,
            totalChunks: 1,
            uploadedChunks: 0,
            percentComplete: 0,
            status: s,
            startedAt: '2026-02-01T10:00:00Z',
            expiresAt: '2026-02-02T10:00:00Z',
          },
        })
      ).not.toThrow();
    });
  });

  it('should reject invalid status', () => {
    expect(() =>
      UploadProgressSchema.parse({
        success: true,
        data: {
          uploadId: 'u1',
          fileId: 'f1',
          filename: 'test.bin',
          totalSize: 100,
          uploadedSize: 0,
          totalChunks: 1,
          uploadedChunks: 0,
          percentComplete: 0,
          status: 'paused',
          startedAt: '2026-02-01T10:00:00Z',
          expiresAt: '2026-02-02T10:00:00Z',
        },
      })
    ).toThrow();
  });
});

// ==========================================
// Complete Chunked Upload Response
// ==========================================

describe('CompleteChunkedUploadResponseSchema', () => {
  it('should accept a valid complete chunked upload response', () => {
    const resp = CompleteChunkedUploadResponseSchema.parse({
      success: true,
      data: {
        fileId: 'file_final_001',
        key: 'uploads/user/large-video.mp4',
        size: 1073741824,
        mimeType: 'video/mp4',
      },
    });
    expect(resp.data.fileId).toBe('file_final_001');
    expect(resp.data.key).toBe('uploads/user/large-video.mp4');
    expect(resp.data.size).toBe(1073741824);
    expect(resp.data.mimeType).toBe('video/mp4');
    expect(resp.data.eTag).toBeUndefined();
    expect(resp.data.url).toBeUndefined();
  });

  it('should accept response with optional eTag and url', () => {
    const resp = CompleteChunkedUploadResponseSchema.parse({
      success: true,
      data: {
        fileId: 'file_final_002',
        key: 'uploads/user/report.pdf',
        size: 20000000,
        mimeType: 'application/pdf',
        eTag: '"final-etag-abc"',
        url: 'https://cdn.example.com/uploads/report.pdf',
      },
    });
    expect(resp.data.eTag).toBe('"final-etag-abc"');
    expect(resp.data.url).toBe('https://cdn.example.com/uploads/report.pdf');
  });

  it('should reject missing required fields', () => {
    expect(() =>
      CompleteChunkedUploadResponseSchema.parse({
        success: true,
        data: {
          fileId: 'file_001',
          key: 'uploads/test.bin',
        },
      })
    ).toThrow();
  });

  it('should reject missing fileId', () => {
    expect(() =>
      CompleteChunkedUploadResponseSchema.parse({
        success: true,
        data: {
          key: 'uploads/test.bin',
          size: 100,
          mimeType: 'application/octet-stream',
        },
      })
    ).toThrow();
  });
});

// ==========================================
// Download / raw-loopback responses (#3689)
//
// Both routes existed long before they were declared, and both answered
// outside the shared envelope while undeclared — `{ url }` and
// `{ ok: true, key }`. The schemas below are the contract they now answer to;
// `service-storage`'s success-envelope conformance suite parses the real
// bodies against these exact objects.
// ==========================================

describe('FileDownloadUrlResponseSchema', () => {
  it('should accept an absolute signed URL', () => {
    const resp = FileDownloadUrlResponseSchema.parse({
      success: true,
      data: { url: 'https://bucket.s3.amazonaws.com/user/f1.png?X-Amz-Signature=abc' },
    });
    expect(resp.success).toBe(true);
    expect(resp.data.url).toContain('X-Amz-Signature');
  });

  it('should accept the local adapter’s server-relative loopback URL', () => {
    const resp = FileDownloadUrlResponseSchema.parse({
      success: true,
      data: { url: '/api/v1/storage/_local/raw/eyJrIjoi.c2ln' },
    });
    expect(resp.data.url).toBe('/api/v1/storage/_local/raw/eyJrIjoi.c2ln');
  });

  it('should reject the bare pre-#3689 shape', () => {
    expect(() =>
      FileDownloadUrlResponseSchema.parse({ url: 'https://cdn.example.com/f1.png' })
    ).toThrow();
  });

  it('should reject a missing url', () => {
    expect(() => FileDownloadUrlResponseSchema.parse({ success: true, data: {} })).toThrow();
  });
});

describe('RawUploadResponseSchema', () => {
  it('should accept the written key', () => {
    const resp = RawUploadResponseSchema.parse({
      success: true,
      data: { key: 'user/f1.png' },
    });
    expect(resp.success).toBe(true);
    expect(resp.data.key).toBe('user/f1.png');
  });

  it('should reject the pre-#3689 `{ ok, key }` shape', () => {
    expect(() => RawUploadResponseSchema.parse({ ok: true, key: 'user/f1.png' })).toThrow();
  });

  it('should reject a missing key', () => {
    expect(() => RawUploadResponseSchema.parse({ success: true, data: {} })).toThrow();
  });
});

// ==========================================
// Storage API Contracts
// ==========================================

describe('StorageApiContracts', () => {
  it('should define all required storage endpoints', () => {
    expect(StorageApiContracts.getPresignedUrl).toBeDefined();
    expect(StorageApiContracts.completeUpload).toBeDefined();
    expect(StorageApiContracts.initiateChunkedUpload).toBeDefined();
    expect(StorageApiContracts.uploadChunk).toBeDefined();
    expect(StorageApiContracts.completeChunkedUpload).toBeDefined();
    expect(StorageApiContracts.getUploadProgress).toBeDefined();
    // #3689: the download resolve is an SDK-addressed route
    // (`storage.getDownloadUrl`) that had been missing from the registry.
    expect(StorageApiContracts.getDownloadUrl).toBeDefined();
  });

  it('should have correct HTTP methods', () => {
    expect(StorageApiContracts.getPresignedUrl.method).toBe('POST');
    expect(StorageApiContracts.completeUpload.method).toBe('POST');
    expect(StorageApiContracts.initiateChunkedUpload.method).toBe('POST');
    expect(StorageApiContracts.uploadChunk.method).toBe('PUT');
    expect(StorageApiContracts.completeChunkedUpload.method).toBe('POST');
    expect(StorageApiContracts.getUploadProgress.method).toBe('GET');
    expect(StorageApiContracts.getDownloadUrl.method).toBe('GET');
  });

  it('should have valid paths', () => {
    expect(StorageApiContracts.getPresignedUrl.path).toContain('/storage/upload/presigned');
    expect(StorageApiContracts.initiateChunkedUpload.path).toContain('/storage/upload/chunked');
    expect(StorageApiContracts.uploadChunk.path).toContain('/chunk/:chunkIndex');
    expect(StorageApiContracts.completeChunkedUpload.path).toContain('/complete');
    expect(StorageApiContracts.getUploadProgress.path).toContain('/progress');
    expect(StorageApiContracts.getDownloadUrl.path).toContain('/storage/files/:fileId/url');
  });

  it('should have input and output schemas for each endpoint', () => {
    expect(StorageApiContracts.getPresignedUrl.input).toBeDefined();
    expect(StorageApiContracts.getPresignedUrl.output).toBeDefined();
    expect(StorageApiContracts.initiateChunkedUpload.input).toBeDefined();
    expect(StorageApiContracts.initiateChunkedUpload.output).toBeDefined();
    expect(StorageApiContracts.uploadChunk.input).toBeDefined();
    expect(StorageApiContracts.uploadChunk.output).toBeDefined();
    expect(StorageApiContracts.completeChunkedUpload.input).toBeDefined();
    expect(StorageApiContracts.completeChunkedUpload.output).toBeDefined();
    expect(StorageApiContracts.getUploadProgress.output).toBeDefined();
    expect(StorageApiContracts.getDownloadUrl.output).toBeDefined();
  });
});
