# @objectstack/service-storage

Storage Service for ObjectStack — implements `IStorageService` with local filesystem and S3-compatible adapters, REST routes for front-end uploads, and presigned URL support.

## Features

- **Multiple Adapters**: Local filesystem (development) and S3-compatible storage (production)
- **Presigned Uploads**: Browser-direct upload via presigned URLs (S3 native, local HMAC-signed tokens)
- **Chunked / Multipart Upload**: Resumable large file uploads with progress tracking
- **File Metadata Store**: `sys_file` object tracks fileId → key mapping and lifecycle status
- **REST Routes**: Auto-mounted `/api/v1/storage/*` endpoints consumed by `@objectstack/client`
- **Type-Safe**: Full TypeScript support with Zod-validated API contracts

## Installation

```bash
pnpm add @objectstack/service-storage
```

For S3 adapter (optional peer dependencies):
```bash
pnpm add @aws-sdk/client-s3 @aws-sdk/s3-request-presigner
```

## Basic Usage

```typescript
import { ObjectKernel } from '@objectstack/core';
import { StorageServicePlugin } from '@objectstack/service-storage';

const kernel = new ObjectKernel();
kernel.use(new StorageServicePlugin({
  adapter: 'local',
  local: { rootDir: './uploads' },
}));
await kernel.bootstrap();

// Programmatic access
const storage = kernel.getService('file-storage');
await storage.upload('files/hello.txt', Buffer.from('hello'));
```

## Configuration

### Local Filesystem Adapter (Development)

```typescript
new StorageServicePlugin({
  adapter: 'local',
  local: {
    rootDir: './uploads',
    baseUrl: 'http://localhost:3000',  // for presigned URLs
    signingSecret: 'dev-secret',       // auto-generated if omitted
  },
  presignedTtl: 3600,   // 1 hour
  sessionTtl: 86400,    // 24 hours for chunked uploads
});
```

### S3 Adapter (Production)

```typescript
new StorageServicePlugin({
  adapter: 's3',
  s3: {
    bucket: 'my-bucket',
    region: 'us-east-1',
    // Optional for S3-compatible services (R2, MinIO, Spaces):
    // endpoint: 'https://r2.cloudflarestorage.com/account-id',
    // forcePathStyle: true,
  },
});
```

## REST API Endpoints

All routes are mounted at `/api/v1/storage` (configurable via `basePath`).

| Method | Path | Description |
|--------|------|-------------|
| POST | `/upload/presigned` | Get presigned upload URL |
| POST | `/upload/complete` | Mark upload as committed |
| POST | `/upload/chunked` | Initiate chunked upload |
| PUT | `/upload/chunked/:uploadId/chunk/:chunkIndex` | Upload a chunk |
| POST | `/upload/chunked/:uploadId/complete` | Complete chunked upload |
| GET | `/upload/chunked/:uploadId/progress` | Get upload progress |
| GET | `/files/:fileId/url` | Get download URL |
| PUT | `/_local/raw/:token` | Local raw upload (presigned) |
| GET | `/_local/raw/:token` | Local raw download (presigned) |

## Client SDK Usage

```typescript
import { ObjectStackClient } from '@objectstack/client';

const client = new ObjectStackClient({ baseUrl: 'http://localhost:3000' });

// Simple upload (presigned URL flow)
const result = await client.storage.upload(file, 'user');

// Chunked upload for large files
const session = await client.storage.initChunkedUpload({
  filename: 'large-video.mp4',
  mimeType: 'video/mp4',
  totalSize: file.size,
});

// Resume interrupted upload
const completed = await client.storage.resumeUpload(
  session.data.uploadId,
  file,
  session.data.chunkSize,
  session.data.resumeToken,
);
```

## Architecture

```
┌──────────────┐     ┌─────────────────────┐     ┌──────────────────┐
│ Client SDK   │────▶│ REST Routes         │────▶│ IStorageService  │
│ (browser)    │     │ /api/v1/storage/*   │     │ (adapter)        │
└──────────────┘     └─────────────────────┘     └──────────────────┘
                              │                         │
                              ▼                         ▼
                     ┌─────────────────┐      ┌─────────────────┐
                     │ MetadataStore   │      │ Filesystem / S3  │
                     │ (sys_file)      │      │ (actual bytes)   │
                     └─────────────────┘      └─────────────────┘
```

## System Objects

The plugin registers two system objects via the manifest service:

- **`sys_file`** — File metadata (fileId, key, name, mimeType, size, scope, status)
- **`sys_upload_session`** — Chunked upload state (progress, parts, resumeToken)

## License

Apache-2.0

## UI-driven configuration

`StorageServicePlugin` registers a `storage` Settings namespace (mail-style)
so administrators can switch adapter, configure S3 credentials, and tune
TTL / max-upload limits from the Settings hub instead of restarting the
process.

- Service key in the kernel: `file-storage` — registered as a
  `SwappableStorageService` proxy at `init` time. The inner adapter
  (local FS or S3) is rebuilt and swapped in on every `settings:changed`
  event for `namespace=storage`.
- The S3 secret key is stored encrypted in `sys_secret` via the
  CryptoAdapter / KMS chain set up by `service-settings`.
- A `storage/test` action handler uploads → downloads → deletes a small
  probe blob to validate the configuration end-to-end. The handler is
  registered on `kernel:ready`; the `service-settings` package ships a
  validation-only fallback for kernels that mount Settings but not
  Storage.

### ⚠ Switching adapters does not migrate files

Files uploaded under the previous adapter remain on that backend and
become unreachable through the new one. The plugin logs a warning on
every swap. Migrate data out-of-band (e.g. `aws s3 sync` from the local
root to the new bucket) before flipping the toggle in production.

### Disabling the live-wire

Pass `bindToSettings: false` to keep the constructor-supplied adapter
frozen — useful in tests and in deployments where storage config must
come from env vars only.
