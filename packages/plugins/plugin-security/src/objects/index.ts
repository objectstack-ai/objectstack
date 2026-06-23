// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * RBAC objects owned by `@objectstack/plugin-security` (ADR-0029 K2).
 *
 * Moved here from the `@objectstack/platform-objects` monolith so the plugin
 * owns its data model, behavior (bootstrap-platform-admin), and admin menu as
 * one unit. The sharing objects (record-share / sharing-rule / share-link)
 * live in `@objectstack/plugin-sharing`.
 */

export { SysRole } from './sys-role.object.js';
export { SysCapability } from './sys-capability.object.js';
export { SysPermissionSet } from './sys-permission-set.object.js';
export { SysUserPermissionSet } from './sys-user-permission-set.object.js';
export { SysRolePermissionSet } from './sys-role-permission-set.object.js';
export { SysUserRole } from './sys-user-role.object.js';
export { defaultPermissionSets } from './default-permission-sets.js';
