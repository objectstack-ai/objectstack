// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Sharing objects owned by `@objectstack/plugin-sharing` (ADR-0029 K2).
 *
 * Moved here from the `@objectstack/platform-objects` monolith so the plugin
 * owns its data model, behavior, and admin menu as one unit. The RBAC objects
 * (role / permission-set / *-permission-set) live in
 * `@objectstack/plugin-security`.
 */

export { SysRecordShare } from './sys-record-share.object.js';
export { SysSharingRule } from './sys-sharing-rule.object.js';
export { SysShareLink } from './sys-share-link.object.js';
export { SysQueue } from './sys-queue.object.js';
export { SysQueueMember } from './sys-queue-member.object.js';
export { SysAssignmentCursor } from './sys-assignment-cursor.object.js';
