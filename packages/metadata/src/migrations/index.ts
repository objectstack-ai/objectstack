// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * @objectstack/metadata/migrations
 *
 * One-off database migrations for the metadata storage layer.
 */

export { migrateEnvIdToProjectId, type MigrationResult } from './migrate-env-id-to-project-id.js';
export {
    migrateProjectIdToEnvironmentId,
    type ProjectIdToEnvironmentIdResult,
} from './migrate-project-id-to-environment-id.js';
export { dropProjectionTables, type DropProjectionResult } from './drop-projection-tables.js';

/**
 * ⚰️ TOMBSTONE — `addSysMetadataOverlayIndex` / `add-sys-metadata-overlay-index.ts`
 * was REMOVED in #6771. Do not reintroduce a producer for
 * `idx_sys_metadata_overlay_active` in this package.
 *
 * It was the second producer of that ONE index name, and it still spelled the
 * PRE-ADR-0048 key `(type, name, organization_id, environment_id, scope)` —
 * `environment_id` is retired (always NULL on new rows, and SQL UNIQUE treats
 * NULLs as DISTINCT, so the index constrained nothing) and `scope` is not in
 * the current discriminator. Because both producers used `IF NOT EXISTS`,
 * whichever ran first claimed the name and the other silently no-opped.
 *
 * Measured on real SQLite before removal (#6771):
 *  - on a normal boot the DECLARED index (metadata-core's
 *    `sys-metadata.object.ts`, materialized by `SqlDriver.syncDeclaredIndexes`)
 *    already holds the name with the CURRENT key
 *    `(type, name, organization_id, package_id)`, so this function was a no-op
 *    that nevertheless reported `status: 'created'`;
 *  - in the only window where it was NOT a no-op (table present, declared
 *    indexes not yet materialized) it installed the RETIRED key, and
 *    `syncDeclaredIndexes` — which skips by name — then never repaired it.
 * So it could only ever do nothing or do harm.
 *
 * The two producers that remain are both correctly keyed and deliberate:
 *  - `metadata-protocol`'s `ensureMetadataOverlayIndexes` (runtime, raw SQL):
 *    the partial, NULL-safe form `(type, name, organization_id,
 *    COALESCE(package_id, '')) WHERE state = 'active'`;
 *  - the declaration in `metadata-core`'s `sys-metadata.object.ts`: the
 *    coarser unrestricted UNIQUE that a driver without that runtime migration
 *    gets, as that file's own comment states.
 */


export {
    migrateSysNotificationToEvent,
    type SysNotificationMigrationResult,
    type SysNotificationMigrationOptions,
} from './migrate-sys-notification-to-event.js';
