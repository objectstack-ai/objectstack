// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

export { StorageServicePlugin } from './storage-service-plugin.js';
export type { StorageServicePluginOptions } from './storage-service-plugin.js';
export { SwappableStorageService } from './swappable-storage-service.js';
export { LocalStorageAdapter } from './local-storage-adapter.js';
export type { LocalStorageAdapterOptions } from './local-storage-adapter.js';
export { S3StorageAdapter } from './s3-storage-adapter.js';
export type { S3StorageAdapterOptions } from './s3-storage-adapter.js';
export { StorageMetadataStore, StorageMetadataStoreError } from './metadata-store.js';
export type { FileRecord, UploadSessionRecord, StorageMetadataOperation } from './metadata-store.js';
export { registerStorageRoutes } from './storage-routes.js';
export type { StorageRoutesOptions, FileReadVerdict } from './storage-routes.js';
export { SystemFile, SystemUploadSession } from './objects/index.js';
export {
  installAttachmentLifecycleHooks,
  createSysFileReapGuard,
  createUploadSessionReapGuard,
} from './attachment-lifecycle.js';
export type { AttachmentLifecycleEngine, AttachmentLifecycleLogger } from './attachment-lifecycle.js';
// `findFileHolder` / `hasFieldReferenceOwner` / `FileHolder` stay INTERNAL: the
// reap guard and the inventory both reach them by relative import, and nothing
// outside this package pulls on them. Publishing an unpulled seam is surface
// this project does not owe (implementation-first) — and the narrower the
// ownership predicate's blast radius, the fewer places can drift weaker than
// the guard. Export them the day a consumer exists.
export {
  inventoryStrandedFileOrphans,
  formatStrandedOrphanInventory,
} from './stranded-orphan-inventory.js';
export type {
  StrandedOrphanInventory,
  StrandedOrphanInventoryEngine,
  StrandedOrphanInventoryOptions,
  StrandedOrphanSample,
} from './stranded-orphan-inventory.js';
export {
  installFileReferenceHooks,
  FileReferenceCopyError,
  FileConstraintError,
} from './file-reference-lifecycle.js';
export type { FileReferenceEngine, FileReferenceLogger } from './file-reference-lifecycle.js';
export {
  verifyFileReferences,
  formatFileReferenceReport,
  BLOCKING_ISSUE_KINDS,
} from './verify-file-references.js';
export type {
  FileReferenceIssue,
  FileReferenceIssueKind,
  FileReferenceReport,
  VerifyReferencesEngine,
  VerifyReferencesOptions,
} from './verify-file-references.js';
export { backfillFileReferences, formatBackfillReport } from './backfill-file-references.js';
export type {
  BackfillAction,
  BackfillActionKind,
  BackfillEngine,
  BackfillLogger,
  BackfillOptions,
  BackfillReport,
} from './backfill-file-references.js';
export { installAttachmentAccessHooks, installAttachmentReadVisibility } from './attachment-access-hooks.js';
export type { AttachmentSharingLike } from './attachment-access-hooks.js';
export { runFilesToReferencesMigration } from './files-to-references-migration.js';
export type {
  FilesToReferencesEngine,
  FilesToReferencesOptions,
  FilesToReferencesResult,
} from './files-to-references-migration.js';
