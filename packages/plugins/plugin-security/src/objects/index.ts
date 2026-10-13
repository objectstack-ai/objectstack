// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * RBAC objects owned by `@objectstack/plugin-security` (ADR-0029 K2).
 *
 * Moved here from the `@objectstack/platform-objects` monolith so the plugin
 * owns its data model, behavior (bootstrap-platform-admin), and admin menu as
 * one unit. The sharing objects (record-share / sharing-rule / share-link)
 * live in `@objectstack/plugin-sharing`.
 */

export { SysUserPermissionSet } from './sys-user-permission-set.object.js';
export { SysUserPosition } from './sys-user-position.object.js';
export { SysAudienceBindingSuggestion } from './sys-audience-binding-suggestion.object.js';
export { defaultPermissionSets } from './default-permission-sets.js';
