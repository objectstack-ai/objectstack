// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * @objectstack/metadata/migrations
 *
 * One-off database migrations for the metadata storage layer.
 */

export { migrateEnvIdToProjectId, type MigrationResult } from './migrate-env-id-to-project-id.js';
export { dropProjectionTables, type DropProjectionResult } from './drop-projection-tables.js';
