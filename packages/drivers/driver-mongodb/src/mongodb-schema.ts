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
  required?: boolean;
  reference_to?: string;
  multiple?: boolean;
}

/**
 * A declared object-level index — `IndexSchema` in @objectstack/spec, narrowed
 * to what this driver materializes.
 *
 * [#6810] This is the ONE surface an index is declared on. The field-level
 * `indexed` flag this driver used to read alongside it was never a
 * `FieldSchema` key: #2377 / ADR-0049 removed it because a field-level index
 * flag built no index, and `FieldSchema` — a `strictObject` — rejects it by
 * name. The single producer still emitting it was the kernel's
 * `organization_id` injection, which therefore stamped every registry-backed
 * object with a document its own schema refused. That declaration moved to
 * `indexes[]`; nothing else in the repo ever read the flag, so it is gone.
 */
interface IndexDef {
  name?: string;
  fields?: string[];
  unique?: boolean | 'global' | 'organization';
}

/**
 * ObjectStack object definition (subset needed for schema sync).
 */
interface ObjectDef {
  name: string;
  fields?: Record<string, FieldDef>;
  indexes?: IndexDef[];
}

/**
 * Synchronize a MongoDB collection to match an ObjectStack object definition.
 *
 * - Creates the collection if it doesn't exist
 * - Creates a unique index on `id`
 * - Creates indexes on `created_at` and `updated_at`
 * - Creates indexes for fields marked `unique`
 * - Creates indexes on lookup (reference) fields
 * - Creates the object's DECLARED `indexes[]` (#6810)
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

  // Declared object-level indexes (#6810) — the surface `indexes[]`, which is
  // where every other index in this system is declared and where the kernel now
  // declares the tenant index on `organization_id`.
  //
  // The generated name is `idx_<fields>` / `idx_<fields>_unique`, matching the
  // field-level convention above so the two routes converge on ONE index rather
  // than racing to create two with different options on the same column set
  // (Mongo index names are per-collection, so no table qualifier is needed —
  // unlike `SqlDriver`'s `buildIndexName`, which is why neither driver takes a
  // name from the declaration when the author left it out).
  //
  // Every `unique` scope materializes the columns VERBATIM, `'organization'`
  // included. That is the same call `FieldDef.unique` documents above and for
  // the same reason: this driver implements no row-level tenancy at all and
  // refuses to boot into a multi-tenant deployment (#3724), so prepending a
  // tenant key part would advertise an isolation it does not deliver.
  for (const idx of schema.indexes ?? []) {
    const fields = (idx.fields ?? []).filter((f) => typeof f === 'string' && f.length > 0);
    if (fields.length === 0) continue;
    const unique = Boolean(idx.unique);
    const spec: Record<string, 1> = {};
    for (const f of fields) spec[f] = 1;
    indexOps.push({
      spec: spec as IndexSpecification,
      options: {
        ...(unique ? { unique: true, sparse: true } : {}),
        name: idx.name ?? `idx_${fields.join('_')}${unique ? '_unique' : ''}`,
      },
    });
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
