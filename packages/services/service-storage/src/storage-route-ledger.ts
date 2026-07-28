// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Storage route ledger — the audited disposition of every HTTP route
 * `registerStorageRoutes` mounts, against what `@objectstack/client` can
 * express (#3636, tranche 3 of the #3563 audit).
 *
 * WHY THIS EXISTS. Tranches 1 and 2 ledgered the dispatcher
 * (`packages/runtime/src/route-ledger.ts`) and the REST server
 * (`packages/rest/src/rest-route-ledger.ts`). Both stop at their own package
 * boundary, and this surface is outside both: `StorageServicePlugin` reaches
 * for the `http-server` service and registers straight on `IHttpServer`, so
 * neither `RouteManager` nor `RestServer.getRoutes()` has ever seen these
 * routes. That left the SDK's ENTIRE storage surface — upload, chunked
 * upload, download-URL resolution — in the exact pre-#3563 posture: expressed,
 * working, and guarded by nothing.
 *
 * `storage-route-ledger.conformance.test.ts` fails when a storage route
 * appears with no ledger entry, and when an entry names a route the registrar
 * no longer mounts. The client half — every `sdk` row resolving to a real
 * method — lives in `packages/client/src/service-route-ledger-coverage.test.ts`,
 * next to the SDK it introspects, for the tranche-1 build-cycle reason: a
 * service→client package edge would be backwards.
 *
 * SCOPE & SHAPE. Rows carry full wire paths at the DEFAULT base
 * (`/api/v1/storage`); `StorageRoutesOptions.basePath` can move the whole
 * family, and the conformance test enumerates at the same default so the two
 * stay comparable. `GET {base}/_local/file/:key` is ABSENT because nothing
 * mounts it — and since #3641 nothing BUILDS it either. The three call sites
 * that used to are gone: the local adapter's upload descriptor simply omits
 * the optional `downloadUrl` (it cannot construct the real capability URL,
 * which is keyed by `sys_file.id` rather than the storage key), and the two
 * download routes now answer 501 when the adapter can produce no URL at all,
 * instead of handing back one that 404s.
 *
 * This module is package-internal (not exported from the index): it is the
 * guard's data, not public API. It must stay import-free — the client-side
 * guard imports it as a relative SOURCE file.
 */

/** Disposition of a single storage route. Same vocabulary as the REST ledger. */
export type StorageRouteDisposition =
  /** Expressed by the SDK — `client` names the method (dotted path). */
  | 'sdk'
  /** Should be in the SDK and is not — an open, acknowledged gap. */
  | 'gap'
  /** Deliberately not SDK surface (driver loopbacks, browser capability URLs). */
  | 'server-only'
  /** Public, unauthenticated browser-facing route. */
  | 'public'
  /** Server and client disagree on the shape — needs reconciliation. */
  | 'mismatch';

export interface StorageRouteLedgerEntry {
  /** `VERB /api/v1/storage/...` — full wire path at the default base. */
  route: string;
  /** Registrar family, for grouping and diff messages. */
  family: string;
  disposition: StorageRouteDisposition;
  /** Dotted method path on `ObjectStackClient` — required when disposition is `sdk`. */
  client?: string;
  /** One-line rationale. Required for every non-`sdk` disposition. */
  note?: string;
}

export const STORAGE_ROUTE_LEDGER: readonly StorageRouteLedgerEntry[] = [
  // ── presigned upload (the SDK's default upload path) ──────────────────────
  { route: 'POST /api/v1/storage/upload/presigned', family: 'upload-presigned', disposition: 'sdk', client: 'storage.getPresignedUrl',
    note: 'also step 1 of the composite storage.upload' },
  { route: 'POST /api/v1/storage/upload/complete', family: 'upload-presigned', disposition: 'sdk', client: 'storage.upload',
    note: 'step 3 of the composite upload; no standalone client method mints the commit on its own' },

  // ── chunked / resumable upload ────────────────────────────────────────────
  { route: 'POST /api/v1/storage/upload/chunked', family: 'upload-chunked', disposition: 'sdk', client: 'storage.initChunkedUpload' },
  { route: 'PUT /api/v1/storage/upload/chunked/:uploadId/chunk/:chunkIndex', family: 'upload-chunked', disposition: 'sdk', client: 'storage.uploadPart' },
  { route: 'POST /api/v1/storage/upload/chunked/:uploadId/complete', family: 'upload-chunked', disposition: 'sdk', client: 'storage.completeChunkedUpload' },
  { route: 'GET /api/v1/storage/upload/chunked/:uploadId/progress', family: 'upload-chunked', disposition: 'sdk', client: 'storage.resumeUpload',
    note: 'progress is read as the first step of resumeUpload; the SDK exposes no bare progress poll' },

  // ── download ──────────────────────────────────────────────────────────────
  { route: 'GET /api/v1/storage/files/:fileId/url', family: 'download', disposition: 'sdk', client: 'storage.getDownloadUrl',
    note: 'JSON { url } — the authorization-gated signed-URL resolve the dispatcher ledger points at (#3584)' },
  { route: 'GET /api/v1/storage/files/:fileId', family: 'download', disposition: 'server-only',
    note: 'stable 302 to the same signed URL. This is the value objectql stamps into file/image field payloads (engine.ts buildFileValue), followed verbatim by <img src>/<a href> — a browser URL, not an SDK call. The SDK resolves via the /url sibling above.' },

  // ── local-driver loopback (LocalStorageAdapter presign targets) ───────────
  { route: 'PUT /api/v1/storage/_local/raw/:token', family: 'local-driver', disposition: 'server-only',
    note: 'the uploadUrl LocalStorageAdapter mints for its own presign tokens. storage.upload does PUT it, but opaquely — via fetchImpl on whatever uploadUrl came back, exactly as it would an S3 presigned URL. HMAC-token-authorized, adapter-internal, never a named SDK method.' },
  { route: 'GET /api/v1/storage/_local/raw/:token', family: 'local-driver', disposition: 'server-only',
    note: 'ditto for download: the target of getPresignedDownload/getSignedUrl on the local adapter, handed to the browser as an opaque signed link.' },
];
