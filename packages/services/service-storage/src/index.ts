// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

export { StorageServicePlugin } from './storage-service-plugin.js';
export type { StorageServicePluginOptions } from './storage-service-plugin.js';
export { SwappableStorageService } from './swappable-storage-service.js';
export { LocalStorageAdapter } from './local-storage-adapter.js';
export type { LocalStorageAdapterOptions } from './local-storage-adapter.js';
export { S3StorageAdapter } from './s3-storage-adapter.js';
export type { S3StorageAdapterOptions } from './s3-storage-adapter.js';
export { StorageMetadataStore } from './metadata-store.js';
export type { FileRecord, UploadSessionRecord } from './metadata-store.js';
export { registerStorageRoutes } from './storage-routes.js';
export type { StorageRoutesOptions, FileReadVerdict } from './storage-routes.js';
export { SystemFile, SystemUploadSession } from './objects/index.js';
export { installAttachmentLifecycleHooks, createSysFileReapGuard, createUploadSessionReapGuard } from './attachment-lifecycle.js';
export type { AttachmentLifecycleEngine, AttachmentLifecycleLogger } from './attachment-lifecycle.js';
export { installAttachmentAccessHooks, installAttachmentReadVisibility } from './attachment-access-hooks.js';
export type { AttachmentSharingLike } from './attachment-access-hooks.js';
