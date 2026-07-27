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
     * List files in a directory/prefix
     * @param prefix - Key prefix to list
     * @returns Array of file info objects
     */
    list?(prefix: string): Promise<StorageFileInfo[]>;

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
