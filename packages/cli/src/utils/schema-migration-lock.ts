// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The schema-migration lock `bootSchemaStack` (`./schema-migrate.ts`) takes on
 * a boot that can apply (#31598). [#31715] The module moved to
 * `@objectstack/objectql`, whose `ObjectQLPlugin.start()` takes the same lock
 * around every other boot's schema sync: re-exported here, never re-declared,
 * so `os migrate apply` and a server boot lock on one name and one key.
 */
export {
  acquireSchemaMigrationLock,
  SCHEMA_MIGRATION_LOCK_NAME,
  SCHEMA_MIGRATION_LOCK_WAIT_MS,
  SCHEMA_MIGRATION_PG_LOCK_KEY,
} from '@objectstack/objectql';
export type { SchemaMigrationLock } from '@objectstack/objectql';
