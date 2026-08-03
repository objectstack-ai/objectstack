// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * @objectstack/plugin-audit
 *
 * Audit Plugin for ObjectStack
 * Provides the sys_audit_log system object definition for immutable audit trails.
 */

export { AuditPlugin } from './audit-plugin.js';
export { installAuditWriters } from './audit-writers.js';
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
