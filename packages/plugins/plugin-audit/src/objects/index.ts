// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Audit & collaboration objects owned by `@objectstack/plugin-audit`
 * (ADR-0029 K2). Moved here from the `@objectstack/platform-objects` monolith
 * so the plugin owns its data model + behavior — exactly the objects the audit
 * writers produce/observe (sys_audit_log + sys_activity rows; sys_comment
 * @mention hook).
 *
 * Intentionally NOT moved here:
 *   - `sys_notification` — reworked by ADR-0030 messaging.
 *   - `sys_attachment` — a file↔record link belonging with service-storage's
 *     sys_file; stays in platform-objects pending the storage-domain move.
 */

export { SysAuditLog } from './sys-audit-log.object.js';
export { SysActivity } from './sys-activity.object.js';
export { SysComment } from './sys-comment.object.js';
