// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * IStorageService - File Storage Service Contract
 * 
 * Defines the interface for file/object storage in ObjectStack.
 * Concrete implementations (S3, Azure Blob, Local FS, etc.)
 * should implement this interface.
 * 
 * Follows Dependency Inversion Principle - plugins depend on this interface,
 * not on concrete storage implementations.
 * 
 * Aligned with CoreServiceName 'file-storage' in core-services.zod.ts.
 */

import type { StandardErrorCode } from '../api/errors.zod';

/**
 * Options for uploading a file
 */
export interface StorageUploadOptions {
    /** MIME content type */
    contentType?: string;
    /** Custom metadata key-value pairs */
    metadata?: Record<string, string>;
    /** Access control level */
    acl?: 'private' | 'public-read';
}

/**
 * Metadata about a stored file
 */
export interface StorageFileInfo {
    /** File key/path */
    key: string;
    /** File size in bytes */
    size: number;
    /** MIME content type */
    contentType?: string;
    /** Last modified timestamp */
    lastModified: Date;
    /** Custom metadata */
    metadata?: Record<string, string>;
}

/**
 * Options for one page of `IStorageService.list()`.
 *
 * The whole point of this shape is that a truncated answer is IMPOSSIBLE to
 * mistake for a complete one — the defect that retired the old `list(prefix)`
 * (#5266 / #5540): the S3 adapter stopped at 1000 objects and returned an
 * array indistinguishable from "that is all of them".
 */
export interface StorageListOptions {
    /**
     * Continuation token taken verbatim from a previous page's `nextCursor`.
     * Omit for the first page.
     *
     * OPAQUE: never construct, parse, compare or persist-and-reinterpret one.
     * It encodes a position in the backend's key order, and an adapter refuses
     * a token it cannot decode (`VALIDATION_ERROR` / 400) rather than silently
     * restarting from the beginning — a silent restart is how a paging sweep
     * loops forever.
     */
    cursor?: string;
    /**
     * Maximum number of items in the returned page. Must be a positive
     * integer; anything else is refused (`VALIDATION_ERROR` / 400) rather than
     * clamped. Defaults to {@link DEFAULT_STORAGE_LIST_LIMIT}.
     *
     * Adapters resolve it through {@link resolveStorageListLimit} so every
     * backend answers an invalid `limit` the same way.
     */
    limit?: number;
}

/**
 * One page of `IStorageService.list()`.
 */
export interface StorageListPage {
    /**
     * The page's files, in ascending key order.
     *
     * A page is FULL (`items.length === limit`) unless it is the last one, so
     * an adapter that has to make several backend round-trips to fill a page
     * makes them — a caller never sees a short page that merely reflects the
     * backend's own page size.
     */
    items: StorageFileInfo[];
    /**
     * Continuation token for the next page — present **if and only if** more
     * items remain.
     *
     * ⚠️ Page until `nextCursor` is absent. Never infer completeness from
     * `items.length < limit`: under concurrent deletion a final `stat` can drop
     * an item from a page that still has a successor.
     */
    nextCursor?: string;
}

/**
 * Page size used when `StorageListOptions.limit` is omitted.
 *
 * 1000 is deliberately the same number as S3's `ListObjectsV2` `MaxKeys` cap —
 * the cap that used to truncate `list(prefix)` in silence. Here it truncates
 * nothing: the page comes back with a `nextCursor`, so the caller is told there
 * is more instead of having to guess.
 */
export const DEFAULT_STORAGE_LIST_LIMIT = 1000;

/**
 * Error code every adapter uses to refuse a malformed `list()` argument.
 *
 * Typed as `StandardErrorCode` so a misspelling fails `tsc` rather than
 * shipping a code `ApiErrorSchema` rejects (ADR-0112).
 */
const STORAGE_LIST_INVALID_ARGUMENT: StandardErrorCode = 'VALIDATION_ERROR';

/** An ADR-0112-enveloped refusal: `VALIDATION_ERROR` / 400. */
function storageListRefusal(message: string): Error {
    const err = new Error(message) as Error & { code?: string; status?: number };
    err.code = STORAGE_LIST_INVALID_ARGUMENT;
    err.status = 400;
    return err;
}

/**
 * Resolve `StorageListOptions.limit` into the page size an adapter must honour.
 *
 * Lives on the CONTRACT, not in each adapter, for the reason `list` was retired
 * in the first place: two adapters validating independently is two dialects
 * waiting to happen. Every backend — including third-party ones — gets the
 * default and the refusal from here.
 *
 * @throws `VALIDATION_ERROR` / 400 when `limit` is present and is not a
 * positive integer. Refused, never clamped: a clamped `limit: 0` would answer
 * an empty page that reads exactly like "this prefix is empty".
 */
export function resolveStorageListLimit(limit: number | undefined): number {
    if (limit === undefined) return DEFAULT_STORAGE_LIST_LIMIT;
    if (!Number.isInteger(limit) || limit < 1) {
        throw storageListRefusal(
            `storage list: 'limit' must be a positive integer (received ${String(limit)}).`,
        );
    }
    return limit;
}

/**
 * Encode a resume position (the last key of a page) as a `nextCursor`.
 *
 * Shared by every adapter so a cursor means ONE thing across backends: "resume
 * strictly after this key, in ascending key order". base64url is not security —
 * it exists so the token cannot be confused with a storage key and hand-built
 * by a caller who then depends on the encoding.
 */
export function encodeStorageListCursor(key: string): string {
    return Buffer.from(key, 'utf8').toString('base64url');
}

/**
 * Decode a `StorageListOptions.cursor` back into a resume key.
 *
 * @throws `VALIDATION_ERROR` / 400 when the token is not one this contract
 * issued. Node's base64url decoder is lenient — it drops characters it does not
 * recognise — so the decode is verified by re-encoding: without that check a
 * corrupted token silently decodes to a DIFFERENT key and the sweep resumes in
 * the wrong place, which is worse than refusing.
 */
export function decodeStorageListCursor(cursor: string): string {
    const decoded = Buffer.from(cursor, 'base64url').toString('utf8');
    if (decoded === '' || Buffer.from(decoded, 'utf8').toString('base64url') !== cursor) {
        throw storageListRefusal(
            `storage list: 'cursor' is not a continuation token issued by this contract.`,
        );
    }
    return decoded;
}

/**
 * Descriptor returned by `IStorageService.getPresignedUpload()`.
 *
 * Consumed by the client SDK to perform a direct browser-to-storage upload.
 * Maps 1:1 onto `PresignedUrlResponse.data` defined in
 * `packages/spec/src/api/storage.zod.ts`.
 */
export interface PresignedUploadDescriptor {
    /** Absolute URL the client should send the bytes to */
    uploadUrl: string;
    /** HTTP method to use (most adapters use PUT) */
    method: 'PUT' | 'POST';
    /** Headers the client must include in the upload request */
    headers?: Record<string, string>;
    /** Time-to-live in seconds */
    expiresIn: number;
    /** Optional preview / download URL once the file is committed */
    downloadUrl?: string;
}

/**
 * Descriptor returned by `IStorageService.getPresignedDownload()`.
 */
export interface PresignedDownloadDescriptor {
    /** Absolute URL the client can GET to retrieve the bytes */
    downloadUrl: string;
    /** Time-to-live in seconds */
    expiresIn: number;
}

/**
 * Presentation hints for a presigned download. Without these the served bytes
 * default to `application/octet-stream` with no filename, so a browser saves
 * the file under the opaque URL token instead of its real name. Callers that
 * know the file's metadata (e.g. the REST download routes, which have the
 * `sys_file` record) should pass it so the download carries a real name + type.
 */
export interface PresignedDownloadOptions {
    /** Original filename → `Content-Disposition` (the browser's save-as name). */
    filename?: string;
    /** Content type → `Content-Type` (defaults to `application/octet-stream`). */
    contentType?: string;
    /** `inline` previews in the browser (default); `attachment` forces a download. */
    disposition?: 'inline' | 'attachment';
}

export interface IStorageService {
    /**
     * Upload a file to storage
     * @param key - Storage key/path for the file
     * @param data - File content as Buffer or readable stream
     * @param options - Upload options (content type, metadata, ACL)
     */
    upload(key: string, data: Buffer | ReadableStream, options?: StorageUploadOptions): Promise<void>;

    /**
     * Download a file from storage
     * @param key - Storage key/path
     * @returns File content as Buffer
     */
    download(key: string): Promise<Buffer>;

    /**
     * Delete a file from storage
     * @param key - Storage key/path
     */
    delete(key: string): Promise<void>;

    /**
     * Check if a file exists in storage
     * @param key - Storage key/path
     * @returns True if the file exists
     */
    exists(key: string): Promise<boolean>;

    /**
     * Get metadata about a stored file
     * @param key - Storage key/path
     * @returns File info including size, content type, and last modified date
     */
    getInfo(key: string): Promise<StorageFileInfo>;

    /**
     * Enumerate the stored files whose key begins with `prefix`, one page at a
     * time.
     *
     * ## Lineage — read this before changing the signature
     *
     * The single-argument `list?(prefix): Promise< StorageFileInfo[] >` was
     * retired in #5540 / #5541 (ADR-0049 enforce-or-remove; the two-dialect
     * measurement is #5266): the local adapter listed ONE level deep and pushed
     * directories into the result as files, while the S3 adapter recursed and
     * stopped at 1000 objects without reading `IsTruncated` — one method, two
     * silently-incomplete answers. Both retirement notes reserved exactly one
     * route back, and this is it (#6781, cloud#1203 maintainer ruling option B):
     * cursor-shaped, with adapter-conformance cases proving both backends agree.
     *
     * ## The semantics an adapter must implement
     *
     * 1. **`prefix` is a raw key-string prefix, matched recursively** — S3
     *    `ListObjectsV2` semantics, which the local adapter emulates rather than
     *    the other way round. `list('a')` returns `a/b/c` AND `ab.txt`. ⚠️ To
     *    scope to a folder, pass the trailing slash: `list('a/')`. `list('t/1')`
     *    also matches `t/10/...`, which for a DELETING sweep is the difference
     *    between reclaiming one tenant and reclaiming eleven.
     * 2. **Only files come back.** Filesystem directories are never stat'd into
     *    results, and an S3 zero-byte directory marker (a key ending in `/`) is
     *    skipped — neither is downloadable, and returning one on one backend
     *    only is precisely the old dialect split.
     * 3. **Ascending key order**, stable across pages.
     * 4. **Pages are full** (`items.length === limit`) except the last: an
     *    adapter loops over its backend's own paging to fill one page.
     * 5. **`nextCursor` is present iff more items remain** (see
     *    {@link StorageListPage}).
     * 6. **No duplicates and no gaps** across a pagination run over an unchanged
     *    key set. Keys written or deleted mid-run may or may not appear.
     * 7. **`limit` and `cursor` are validated, not coerced** — see
     *    {@link resolveStorageListLimit} and {@link decodeStorageListCursor},
     *    which every adapter shares so the refusals cannot diverge.
     *
     * Optional, like every other capability on this contract: an adapter that
     * cannot enumerate simply omits it, and `SwappableStorageService` answers a
     * clear "does not support list()" for it. It is NOT a required member on
     * purpose — requiring it would break every third-party adapter, which is a
     * major-version act, and enumeration is genuinely optional for a backend.
     *
     * ⚠️ Prefer enumerating the RECORDS you wrote (`sys_file` / file-reference
     * rows, paginated through ObjectQL) when they exist. Bucket enumeration is
     * for the cases where they do not: reclaiming storage a deleted tenant left
     * behind, or GC-ing blobs whose index is the thing that went away.
     *
     * @param prefix - Raw key prefix; `''` enumerates everything.
     * @param options - Page size and continuation token.
     */
    list?(prefix: string, options?: StorageListOptions): Promise<StorageListPage>;

    /**
     * Generate a pre-signed URL for temporary access
     * @param key - Storage key/path
     * @param expiresIn - URL expiration time in seconds
     * @returns Pre-signed URL string
     */
    getSignedUrl?(key: string, expiresIn: number, options?: PresignedDownloadOptions): Promise<string>;

    // ==========================================
    // Presigned Upload / Download (browser-direct)
    // ==========================================

    /**
     * Generate a presigned upload descriptor that allows the browser to
     * upload bytes directly to the storage backend without proxying through
     * the API server.
     *
     * For S3-compatible backends this returns the actual signed PUT URL.
     * For local-filesystem backends this returns a server-mounted endpoint
     * (e.g. `/api/v1/storage/_local/raw/<token>`) that accepts the bytes
     * and writes them to the configured root directory.
     *
     * @param key - Storage key/path for the final file
     * @param expiresIn - Upload URL expiration time in seconds
     * @param options - Upload options (content type, metadata, ACL)
     * @returns Descriptor consumed by the client SDK
     */
    getPresignedUpload?(
        key: string,
        expiresIn: number,
        options?: StorageUploadOptions,
    ): Promise<PresignedUploadDescriptor>;

    /**
     * Generate a presigned download URL for the given key.
     * For local-filesystem backends this returns a server-mounted endpoint
     * that streams the file when accessed within the expiration window.
     *
     * @param key - Storage key/path
     * @param expiresIn - URL expiration time in seconds
     */
    getPresignedDownload?(key: string, expiresIn: number, options?: PresignedDownloadOptions): Promise<PresignedDownloadDescriptor>;

    // ==========================================
    // Chunked / Multipart Upload Methods
    // ==========================================

    /**
     * Initiate a chunked (multipart) upload session
     * @param key - Storage key/path for the final file
     * @param options - Upload options (content type, metadata, ACL)
     * @returns Upload session ID for use in subsequent chunk uploads
     */
    initiateChunkedUpload?(key: string, options?: StorageUploadOptions): Promise<string>;

    /**
     * Upload a single chunk of a multipart upload
     * @param uploadId - Multipart upload session ID
     * @param partNumber - Part number (1-based, per S3 convention)
     * @param data - Chunk content as Buffer
     * @returns ETag of the uploaded chunk for assembly
     */
    uploadChunk?(uploadId: string, partNumber: number, data: Buffer): Promise<string>;

    /**
     * Complete a chunked upload by assembling all parts
     * @param uploadId - Multipart upload session ID
     * @param parts - Ordered list of part numbers and their ETags
     * @returns Storage key/path of the assembled file
     */
    completeChunkedUpload?(uploadId: string, parts: Array<{ partNumber: number; eTag: string }>): Promise<string>;

    /**
     * Abort a chunked upload session and clean up uploaded parts
     * @param uploadId - Multipart upload session ID
     */
    abortChunkedUpload?(uploadId: string): Promise<void>;
}

/**
 * A kernel service that answers file-read authorization on behalf of an object
 * (ADR-0104 D3 wave 2). Named by that object's `fileAccessDelegate`.
 *
 * Exists because "can the caller READ the owning row?" — the storage service's
 * default question — is the wrong question for an object whose access is
 * mediated by a service rather than by row permissions. `sys_approval_action`
 * is the motivating case: it is deliberately unreadable to ordinary approver
 * positions, yet an approver must still be able to open a decision attachment.
 * The approvals service already knows who may see a request's history, so it
 * answers instead.
 *
 * Implementations should apply the SAME rule that governs reading the record
 * through their own API — not a looser one. The delegate widens who can reach
 * the bytes, so a permissive implementation is a data leak.
 */
export interface IFileAccessDelegate {
    /**
     * May this caller download a file owned by `recordId` on the delegating
     * object? Return `false` (never throw) to deny; a throw is treated as a
     * denial too, since authorization must fail closed.
     */
    authorizeFileRead(recordId: string, context: unknown): Promise<boolean>;
}
