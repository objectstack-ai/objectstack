// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * MongoDB Schema Sync
 *
 * Manages collection creation, index management, and optional
 * JSON Schema validation for ObjectStack object definitions.
 */

import type { Db, CreateIndexesOptions, IndexSpecification } from 'mongodb';

/**
 * ObjectStack field definition (subset needed for schema sync).
 */
interface FieldDef {
  type?: string;
  /**
   * `true` | `'global'` — see `UniqueScopeSchema` in @objectstack/spec.
   *
   * Both spellings materialize the SAME single-field unique index here, and
   * that is currently correct for this driver: unlike the SQL driver it
   * implements NO row-level tenancy at all (no tenant predicate on read, no
   * tenant stamp on write), so there is no tenant column to compose with. A
   * `(tenant, field)` index would advertise an isolation this driver does not
   * deliver — worse than the single-field index, because it would read as
   * fixed.
   *
   * Settled by #3724: the driver is now explicitly single-tenant and refuses to
   * boot into a multi-tenant deployment (see `mongodb-tenancy-guard.ts`), so a
   * single-field unique index is exactly right — there is no second tenant for
   * it to over-constrain. Should row-level tenancy ever land here (option A of
   * that issue), this must adopt the same scoping rule as
   * `SqlDriver.uniqueIndexesFromFields`.
   */
  unique?: boolean | 'global';
  indexed?: boolean;
  required?: boolean;
  reference_to?: string;
  multiple?: boolean;
}

/**
 * ObjectStack object definition (subset needed for schema sync).
 */
interface ObjectDef {
  name: string;
  fields?: Record<string, FieldDef>;
}

/**
 * Synchronize a MongoDB collection to match an ObjectStack object definition.
 *
 * - Creates the collection if it doesn't exist
 * - Creates a unique index on `id`
 * - Creates indexes on `created_at` and `updated_at`
 * - Creates indexes for fields marked `unique` or `indexed`
 * - Creates indexes on lookup (reference) fields
 */
export async function syncCollectionSchema(
  db: Db,
  collectionName: string,
  schema: ObjectDef,
): Promise<void> {
  // Ensure collection exists
  const collections = await db.listCollections({ name: collectionName }).toArray();
  if (collections.length === 0) {
    await db.createCollection(collectionName);
  }

  const collection = db.collection(collectionName);

  // Core indexes — always present
  const indexOps: Array<{ spec: IndexSpecification; options: CreateIndexesOptions }> = [
    { spec: { id: 1 }, options: { unique: true, name: 'idx_id_unique' } },
    { spec: { created_at: 1 }, options: { name: 'idx_created_at' } },
    { spec: { updated_at: 1 }, options: { name: 'idx_updated_at' } },
  ];

  // Field-level indexes
  if (schema.fields) {
    for (const [fieldName, field] of Object.entries(schema.fields)) {
      if (field.unique) {
        indexOps.push({
          spec: { [fieldName]: 1 },
          options: { unique: true, sparse: true, name: `idx_${fieldName}_unique` },
        });
      } else if (field.indexed) {
        indexOps.push({
          spec: { [fieldName]: 1 },
          options: { name: `idx_${fieldName}` },
        });
      }

      // Lookup + user (a lookup specialized to sys_user) fields get an index for
      // join performance. A `user` field always references sys_user, so it is
      // indexed even when reference_to is not explicitly set.
      if (
        (field.type === 'lookup' && field.reference_to) ||
        field.type === 'user'
      ) {
        indexOps.push({
          spec: { [fieldName]: 1 },
          options: { name: `idx_${fieldName}_lookup` },
        });
      }
    }
  }

  // Create indexes (idempotent — MongoDB ignores duplicates)
  for (const { spec, options } of indexOps) {
    try {
      await collection.createIndex(spec, options);
    } catch (error: any) {
      // Index already exists with different options — skip silently
      if (error.codeName === 'IndexOptionsConflict' || error.code === 85) {
        continue;
      }
      throw error;
    }
  }
}

/**
 * Drop a collection (destructive).
 */
export async function dropCollection(db: Db, collectionName: string): Promise<void> {
  const collections = await db.listCollections({ name: collectionName }).toArray();
  if (collections.length > 0) {
    await db.dropCollection(collectionName);
  }
}
