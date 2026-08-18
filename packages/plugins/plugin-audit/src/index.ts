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
export type {
  CommentAccessEngine,
  CommentAccessLogger,
  CommentReadMiddlewareCtx,
  CommentSharingLike,
  CommentThreadTarget,
} from './comment-access-hooks.js';
