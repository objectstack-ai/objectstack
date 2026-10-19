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
  planCommentParentPair,
  COMMENT_PARENT_OBJECT_COLUMN,
  COMMENT_PARENT_RECORD_COLUMN,
} from './comment-access-hooks.js';
// [ADR-0139 E7] The stored-row backfill of `sys_comment`'s writer-stamped
// parent pair, which the comment-thread read gate leafs over. The CLI command
// (`os migrate comment-parent-pair`) drives it.
export {
  backfillCommentParentPair,
  COMMENT_PARENT_PAIR_BACKFILL_PAGE_SIZE,
} from './comment-parent-pair-backfill.js';
export type {
  CommentParentPairBackfillEngine,
  CommentParentPairBackfillReport,
} from './comment-parent-pair-backfill.js';
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
// [ADR-0139 E6] The stored-row backfill of `sys_activity`'s two writer-stamped
// read-rule columns, and the one planner it, the CRUD mirror and the
// before-insert hook stamp by. The CLI command
// (`os migrate activity-changed-fields`) drives it.
export { backfillActivityChangedFields, ACTIVITY_BACKFILL_PAGE_SIZE } from './activity-changed-fields-backfill.js';
export type {
  ActivityChangedFieldsBackfillEngine,
  ActivityChangedFieldsBackfillReport,
} from './activity-changed-fields-backfill.js';
export {
  ACTIVITY_CHANGED_FIELDS_COLUMN,
  ACTIVITY_MILESTONE_KEY_COLUMN,
  planActivityStamp,
} from './activity-changed-fields.js';
export type { ActivityStamp } from './activity-changed-fields.js';
export type {
  CommentAccessEngine,
  CommentAccessLogger,
  CommentParentPair,
  CommentReadMiddlewareCtx,
  CommentSecurityLike,
  CommentSharingLike,
  CommentThreadTarget,
} from './comment-access-hooks.js';
