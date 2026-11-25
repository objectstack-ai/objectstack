// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * @objectstack/platform-objects
 *
 * Core platform object schemas for ObjectStack.
 * All sys_* objects that every kernel service depends on are defined here.
 *
 * Subpath imports available:
 *   @objectstack/platform-objects/identity     — user, session, org, team, api-key, ...
 *   @objectstack/platform-objects/security     — (empty; RBAC moved to @objectstack/plugin-security, sharing to @objectstack/plugin-sharing per ADR-0029)
 *   @objectstack/platform-objects/audit        — audit-log, presence
 *   @objectstack/platform-objects/integration  — (empty; sys_webhook moved to @objectstack/plugin-webhooks per ADR-0029)
 *   @objectstack/platform-objects/metadata     — sys_metadata, sys_metadata_history
 *   @objectstack/platform-objects/apps         — built-in platform Apps (Setup, ...)
 *   (root only)                                — sys_task, sys_note: built-in tasks and notes
 *
 * Note: control-plane / cloud-only objects (sys_environment*, sys_package*, sys_app)
 * live in @objectstack/service-tenant per ADR-0003.
 */

export * from './identity/index.js';
export * from './security/index.js';
export * from './audit/index.js';
export * from './integration/index.js';
export * from './metadata/index.js';
export * from './system/index.js';
export * from './apps/index.js';
export * from './pages/index.js';
export * from './work/index.js';

/** Runtime plugin contributing platform-default translation bundles. */
export { PlatformObjectsPlugin, createPlatformObjectsPlugin } from './plugin.js';
/** Default i18n bundle for metadata-type configuration forms. */
export { MetadataFormsTranslations } from './metadata-translations/index.js';
