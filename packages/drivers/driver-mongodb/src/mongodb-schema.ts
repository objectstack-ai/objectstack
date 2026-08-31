// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * MongoDB Schema Sync
 *
 * Manages collection creation, index management, and optional
 * JSON Schema validation for ObjectStack object definitions.
 */

import type { Db, CreateIndexesOptions, IndexSpecification } from 'mongodb';

import { StandardErrorCode } from '@objectstack/spec/api';

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
  /**
   * [#13222] ⛔ A REJECTED ALIAS of `reference`, declared here so the door in
   * {@link syncCollectionSchema} can READ it — never so this driver can honour
   * it. `reference` is the only relationship spelling `@objectstack/spec`
   * declares, and `FieldSchema` answers `unrecognized_keys` for this key.
   * See {@link refuseRejectedReferenceAlias}.
   *
   * Typed `unknown` rather than `string`: only the key's PRESENCE is ever read
   * here, and the metadata reaching this seam went around Zod — `MongoDBDriver.
   * syncSchema(object, schema: unknown)` casts and forwards verbatim — so
   * `string` would be a claim about untrusted input nothing on this path
   * checked. Measured on `FieldSchema`: `'company'`, `null` and `''` all draw
   * the one identical `unrecognized_keys` verdict, so the value's shape carries
   * no information the door needs.
   */
  reference_to?: unknown;
  /**
   * The CANONICAL relationship key — the only spelling `@objectstack/spec`
   * declares (`FieldSchema.reference`), and the one the join-index arm in
   * {@link syncCollectionSchema} gates on.
   *
   * Typed `unknown` for the same reason its rejected sibling above is: the
   * metadata reaching this seam went around Zod — `MongoDBDriver.syncSchema(
   * object, schema: unknown)` casts and forwards it verbatim — so `string`
   * would be a claim about untrusted input nothing on this path checked. The
   * arm reads TRUTHINESS and nothing else; the value is never dereferenced.
   *
   * ⚠️ Truthiness rather than `!== undefined`, and that difference is load
   * bearing rather than inherited. Measured on `FieldSchema` built from this
   * tree: `{ type: 'lookup' }` with NO `reference`, and `{ type: 'lookup',
   * reference: '' }`, both parse SUCCESSFULLY — the "required for these types"
   * in the spec's own prose is not enforced by the schema. So a lookup that
   * points nowhere is a shape an author can really publish, and it must not
   * get `idx_FIELD_lookup`: an index for a join whose target is undeclared
   * costs writes and buys no read. Truthiness declines exactly that shape.
   */
  reference?: unknown;
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
 * [#13222] A field reached schema sync carrying `reference_to` — a key
 * `FieldSchema` REFUSES — so this face refuses it too, in the spec's own words.
 *
 * ## Why the DDL seam needs a door the schema already has
 *
 * `reference` is the only relationship spelling the spec declares;
 * `reference_to` is a REJECTED ALIAS, not a normalised one. Measured against
 * `@objectstack/spec` built from this tree:
 *
 * ```
 * FieldSchema.safeParse({ name:'company_id', type:'lookup', reference_to:'company' })
 *   => success:false, issue.code = `unrecognized_keys`
 *      "Unrecognized key(s) on this field: `reference_to`.
 *       Did you mean `reference_to` -> `reference`? Until this shape was closed
 *       these were dropped silently ..."
 * ```
 *
 * Until this door, the driver read `reference_to` and ONLY `reference_to`, as
 * the gate on the field-level join index below. So one key had TWO doors with
 * opposite answers: the authoring door refused it, while this one silently
 * honoured it and built an index off it. The silent one was the one that
 * touched the database.
 *
 * ⚠️ Unlike the SQL counterpart (`sql-driver.ts`, #11567), whose `patch` grade
 * rested on "no authored deployment could reach the branch", the affected
 * population HERE is non-zero by construction: this package's own published
 * README taught `reference_to` in a sample calling `driver.syncSchema` directly
 * — shipped at `@objectstack/driver-mongodb` 17.2.0 and earlier — and
 * `syncSchema(object, schema: unknown)` casts and forwards verbatim with no Zod
 * (`mongodb-driver.ts`). A deployment that copied that sample boots today and
 * is refused here after this. That is why the change is graded `minor`. The
 * README no longer teaches the key: its remaining mention is prose recording
 * that the spelling is refused.
 *
 * ## Where the door sits, and why
 *
 * Stated BEFORE the collection is created and before every per-field branch,
 * because the spec's refusal is gated on neither type nor value. Measured:
 * `{ type:'text', reference_to:'company' }` draws the SAME `unrecognized_keys`
 * verdict as the `lookup` fixture, and `'company'`, `null` and `''` are refused
 * alike. `sql-driver.ts` states its copy before the `multiple` short-circuit and
 * before the type switch for that same reason; this file has no type switch, so
 * the equivalent placement is ahead of the whole field loop — which also puts it
 * ahead of `db.createCollection`, so a refused sync leaves nothing behind.
 * One key, one answer, wherever it appears.
 *
 * `!== undefined` rather than `'reference_to' in field`, matching the SQL door
 * exactly: it refuses every value the key can actually carry — including the
 * `null` and `''` the old truthy gate ignored — while staying immune to a
 * producer that spreads an explicit `{ reference_to: undefined }`. Measured:
 * `FieldSchema`'s own canonical output does NOT carry `reference_to` as an own
 * key, so key presence would have been correct too; this is the narrower of two
 * correct predicates, and both doors take the same one.
 *
 * ## Why refuse rather than ignore
 *
 * Ignoring the key would be a THIRD answer to one question. An author who wrote
 * `reference_to` meant to point the field somewhere; a driver that drops it on
 * the floor creates a collection pointing nowhere and says nothing. The refusal
 * is stated at this seam because it is the last place the mistake is still
 * cheap: before the collection exists, not after documents are in it.
 *
 * `VALIDATION_ERROR`/400 rather than a 500 (ADR-0112): the metadata is the
 * caller's, the condition is decided entirely by what the caller wrote, and the
 * fix is a one-word rename — the same envelope every other refusal in this
 * package speaks.
 *
 * ## ⛔ What this door does NOT decide
 *
 * Whether a canonically-spelled `reference` lookup GETS `idx_FIELD_lookup` is a
 * separate question from whether the rejected alias is refused, and it was
 * ruled separately. This door refuses; the arm below indexes. Part (2) of the
 * ruling repointed that arm's predicate from `field.reference_to` to
 * `field.reference` and touched nothing here — the refusal's predicate,
 * envelope, placement and instruction are unchanged by it.
 *
 * What part (2) DID change in this comment is the tail of the runtime message
 * below, which until then told the reader that renaming the key would not, by
 * itself, get the field an index. That was true when it was written and is
 * false now: `reference` is exactly what the arm reads. A refusal that hands
 * the caller a stale claim about what the fix achieves is a worse refusal, so
 * the sentence moved with the behaviour it described.
 */
function refuseRejectedReferenceAlias(collectionName: string, fieldName: string): never {
  const err = new Error(
    `[driver-mongodb] field '${fieldName}' on '${collectionName}' declares \`reference_to\`, a ` +
    `rejected alias of \`reference\`. Did you mean \`reference_to\` -> \`reference\`? ` +
    `\`reference\` is the only relationship spelling @objectstack/spec declares, and ` +
    `\`FieldSchema\` refuses this key with that same verdict (\`unrecognized_keys\`) on ANY field ` +
    `type — so a field still carrying it at schema-sync time went around the schema ` +
    `(\`syncSchema(object, schema: unknown)\` casts and forwards it verbatim, with no Zod). ` +
    `Rename the key. \`reference\` is also the spelling this driver's join-index arm reads, so a ` +
    `\`lookup\` field declaring it gets \`idx_FIELD_lookup\` on the next schema sync — the rename ` +
    `fixes the refusal and gets the join index in one step.`,
  ) as Error & { code?: string; status?: number };
  err.code = StandardErrorCode.enum.VALIDATION_ERROR;
  err.status = 400;
  throw err;
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
  // [#13222] The door — see {@link refuseRejectedReferenceAlias}. Ahead of
  // `createCollection` and of every per-field branch, because the spec's
  // refusal is gated on neither the field's type nor the key's value.
  for (const [fieldName, field] of Object.entries(schema.fields ?? {})) {
    if (field.reference_to !== undefined) refuseRejectedReferenceAlias(collectionName, fieldName);
  }

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
      // join performance, gated on the CANONICAL relationship key `reference`.
      // A `user` field always references sys_user, so it needs no relationship
      // key at all and is indexed unconditionally.
      //
      // This arm read `field.reference_to` until part (2) of the ruling below.
      // That key is a REJECTED ALIAS the door above refuses outright, so the
      // conjunct was unreachable and NO authored lookup was ever indexed here —
      // measured as a complete case split over the key's value domain, not a
      // sample: every value except `undefined` is refused at the door, and
      // `undefined` is falsy, so the conjunct could not be satisfied by any
      // input. `reference` is the only relationship spelling `FieldSchema`
      // declares, so this is the predicate that reaches authored metadata.
      if (
        (field.type === 'lookup' && field.reference) ||
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
