// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * platform-objects/metadata — BACK-COMPAT RE-EXPORT.
 *
 * The metadata-storage object definitions (`sys_metadata`,
 * `sys_metadata_history`, `sys_metadata_audit`) have
 * MOVED to `@objectstack/metadata-core` — the lowest package shared by their
 * actual consumers (the ObjectQL protocol that reads/writes them, and the
 * metadata layer's `DatabaseLoader`). They no longer live in platform-objects.
 *
 * This module re-exports them so the legacy `@objectstack/platform-objects/metadata`
 * import path keeps working during the migration. Prefer importing from
 * `@objectstack/metadata-core` directly.
 */

export {
  SysMetadataObject,
  SysMetadata,
  SysMetadataHistoryObject,
  SysMetadataAuditObject,
} from '@objectstack/metadata-core';
