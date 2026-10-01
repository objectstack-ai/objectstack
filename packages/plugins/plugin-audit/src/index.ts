// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * @objectstack/plugin-audit
 *
 * Audit Plugin for ObjectStack
 * Provides the sys_audit_log system object definition for immutable audit trails.
 */

export { AuditPlugin } from './audit-plugin.js';
export { createFieldPresenceProbe, installAuditWriters } from './audit-writers.js';
export { createAuthEventAuditSink } from './auth-event-audit.js';
export {
  createReadAuditBatcher,
  extractDetailReadId,
  installReadAuditWriter,
  READ_AUDIT_ACTION,
} from './read-audit.js';
export type {
  ReadAuditBatcher,
  ReadAuditBatcherOptions,
  ReadAuditEvent,
  ReadAuditLogger,
  ReadAuditTimers,
  ReadAuditWriterHandle,
  ReadAuditWriterOptions,
} from './read-audit.js';
export type {
  AuthEventAuditLogger,
  AuthEventAuditSink,
  AuthEventAuditSinkOptions,
  AuthSessionAuditAction,
  AuthSessionAuditEvent,
} from './auth-event-audit.js';
export {
  installCommentAccessHooks,
  installCommentReadVisibility,
  parseCommentThreadId,
} from './comment-access-hooks.js';
// [#21120] The one-off rewrite of at-rest cleartext metadata-body copies this
// writer left in `sys_audit_log` / `sys_activity`, and the pure planners the
// CLI command (`os migrate audit-metadata-bodies`) drives.
export {
  migrateStoredMetadataBodyCopies,
  planAuditRowPatch,
  planActivityRowPatch,
  redactLedgerSnapshotBody,
  STORED_METADATA_BODY_AUDIT_OBJECTS,
} from './stored-metadata-body-migration.js';
export type {
  MigrationLogger,
  StoredMetadataBodyMigrationEngine,
  StoredMetadataBodyMigrationReport,
} from './stored-metadata-body-migration.js';
export type {
  CommentAccessEngine,
  CommentAccessLogger,
  CommentReadMiddlewareCtx,
  CommentSharingLike,
  CommentThreadTarget,
} from './comment-access-hooks.js';
