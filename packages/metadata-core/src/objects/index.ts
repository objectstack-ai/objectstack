// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * metadata-core/objects — Metadata Storage Object Definitions
 *
 * `sys_metadata` + `sys_metadata_history` + `sys_metadata_audit` are the
 * canonical single-source-of-truth storage substrate for ALL metadata
 * customisations (ADR-0005). `sys_view_definition` backs runtime-authored
 * shared/personal views (ADR-0017).
 *
 * These definitions live HERE (the metadata core package) — not in
 * `@objectstack/platform-objects` — because the packages that actually read
 * and write these tables depend on metadata-core: the ObjectQL protocol
 * (`loadMetaFromDb` / `getMetaItems` / `saveMetaItem`) and the metadata
 * layer's `DatabaseLoader`. Keeping them in the lowest shared package lets
 * both register/sync the tables without a cross-package dependency.
 */

export { SysMetadataObject, SysMetadataObject as SysMetadata } from './sys-metadata.object.js';
export { SysMetadataHistoryObject } from './sys-metadata-history.object.js';
export { SysMetadataCommitObject } from './sys-metadata-commit.object.js';
export { SysMetadataAuditObject } from './sys-metadata-audit.object.js';
export { SysViewDefinitionObject } from './sys-view-definition.object.js';
