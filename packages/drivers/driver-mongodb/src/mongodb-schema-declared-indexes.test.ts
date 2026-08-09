// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// #6810 — `syncCollectionSchema` materializes the object's DECLARED `indexes[]`.
//
// This driver used to read a field-level `indexed` flag instead. That flag was
// never a `FieldSchema` key (#2377 / ADR-0049 removed it, and `FieldSchema` is a
// `strictObject` that rejects it by name), so its one remaining producer — the
// kernel's `organization_id` injection — was stamping every registry-backed
// object with a document the platform's own schema refused. The declaration
// moved to `indexes[]`; this pins that the DDL outcome came with it, rather than
// the fix quietly deleting an index the flag used to build.
//
// Driven against a fake `Db` on purpose: the `mongodb-memory-server` suite in
// this package is OPT-IN (it downloads a real server binary, #5517), so a DDL
// assertion parked there would not run on any ordinary CI lane — which is
// exactly the lane that has to notice if this regresses.

import { describe, it, expect } from 'vitest';
import type { Db } from 'mongodb';
import { syncCollectionSchema } from './mongodb-schema.js';

interface CreatedIndex {
  spec: Record<string, unknown>;
  options: Record<string, unknown>;
}

/**
 * The narrow slice of `Db` `syncCollectionSchema` touches, recording every
 * `createIndex` call in order. Nothing is stubbed beyond that slice — the
 * function under test runs verbatim.
 */
function fakeDb(existingCollections: string[] = []) {
  const created: CreatedIndex[] = [];
  const collectionsCreated: string[] = [];
  const db = {
    listCollections: ({ name }: { name: string }) => ({
      toArray: async () => (existingCollections.includes(name) ? [{ name }] : []),
    }),
    createCollection: async (name: string) => {
      collectionsCreated.push(name);
    },
    collection: () => ({
      createIndex: async (spec: Record<string, unknown>, options: Record<string, unknown>) => {
        created.push({ spec, options });
      },
    }),
  } as unknown as Db;
  return { db, created, collectionsCreated };
}

/** Every index name the sync asked MongoDB to create, core indexes included. */
const names = (created: CreatedIndex[]) => created.map((c) => c.options.name);

/** The one recorded creation for `name`, or `undefined`. */
const byName = (created: CreatedIndex[], name: string) =>
  created.find((c) => c.options.name === name);

describe('#6810 — syncCollectionSchema materializes declared indexes[]', () => {
  it('creates the kernel-declared tenant index, byte-identical to what the retired flag built', async () => {
    // THE regression pin. Before #6810 this DDL came from
    // `organization_id: { …, indexed: true }`; it now comes from the object's
    // `indexes[]`. Same collection, same key spec, same index NAME — a
    // re-synced deployment finds its index already present rather than
    // building a second one under a new name.
    const { db, created } = fakeDb();
    await syncCollectionSchema(db, 'lead', {
      name: 'lead',
      fields: {
        first_name: { type: 'text' },
        organization_id: { type: 'lookup' },
      },
      indexes: [{ fields: ['organization_id'] }],
    });

    const tenant = byName(created, 'idx_organization_id');
    expect(tenant).toBeDefined();
    expect(tenant!.spec).toEqual({ organization_id: 1 });
    // A plain lookup index, never a constraint.
    expect(tenant!.options.unique).toBeUndefined();
  });

  it('declares no tenant index when the object declares none', async () => {
    // The single-tenant half: `multiTenant: false` now declares NOTHING rather
    // than a `false` flag, so absence has to stay absence here.
    const { db, created } = fakeDb();
    await syncCollectionSchema(db, 'lead', {
      name: 'lead',
      fields: { first_name: { type: 'text' }, organization_id: { type: 'lookup' } },
    });

    expect(names(created)).not.toContain('idx_organization_id');
    // The core set is untouched by any of this.
    expect(names(created)).toEqual(['idx_id_unique', 'idx_created_at', 'idx_updated_at']);
  });

  it('honours an explicit index name and a multi-column declaration', async () => {
    const { db, created } = fakeDb();
    await syncCollectionSchema(db, 'lead', {
      name: 'lead',
      fields: { organization_id: { type: 'lookup' }, code: { type: 'text' } },
      indexes: [{ name: 'lead_scope_idx', fields: ['organization_id', 'code'] }],
    });

    const idx = byName(created, 'lead_scope_idx');
    expect(idx).toBeDefined();
    // Key order follows the declaration — a compound index is order-sensitive.
    expect(Object.keys(idx!.spec)).toEqual(['organization_id', 'code']);
  });

  it('materializes a declared unique index, at every scope, over the columns VERBATIM', async () => {
    // `'organization'` is NOT scoped up with a tenant key part here, and that is
    // deliberate — the same call `FieldDef.unique` documents in the source.
    // This driver implements no row-level tenancy and refuses to boot into a
    // multi-tenant deployment (#3724), so a `(tenant, field)` index would
    // advertise an isolation it does not deliver.
    for (const scope of [true, 'global', 'organization'] as const) {
      const { db, created } = fakeDb();
      await syncCollectionSchema(db, 'lead', {
        name: 'lead',
        fields: { organization_id: { type: 'lookup' }, code: { type: 'text' } },
        indexes: [{ fields: ['code'], unique: scope }],
      });

      const idx = byName(created, 'idx_code_unique');
      expect(idx, String(scope)).toBeDefined();
      expect(idx!.spec).toEqual({ code: 1 });
      expect(idx!.options.unique).toBe(true);
      expect(names(created)).not.toContain('idx_organization_id_code_unique');
    }
  });

  it('a declared index and a field-level `unique` on the same column converge on ONE index', async () => {
    // Why the generated name mirrors the field-level convention: two routes
    // asking for the same constraint must land on the same name, or MongoDB
    // sees two indexes over one key spec.
    const { db, created } = fakeDb();
    await syncCollectionSchema(db, 'lead', {
      name: 'lead',
      fields: { email: { type: 'email', unique: true } },
      indexes: [{ fields: ['email'], unique: true }],
    });

    expect(names(created).filter((n) => n === 'idx_email_unique')).toHaveLength(2);
    const [a, b] = created.filter((c) => c.options.name === 'idx_email_unique');
    expect(a.spec).toEqual(b.spec);
    expect(a.options).toEqual(b.options);
  });

  it('skips a declaration with no usable fields rather than emitting empty DDL', async () => {
    const { db, created } = fakeDb();
    await syncCollectionSchema(db, 'lead', {
      name: 'lead',
      fields: { code: { type: 'text' } },
      indexes: [{ fields: [] }, { name: 'ghost' } as { name: string }],
    });

    expect(names(created)).toEqual(['idx_id_unique', 'idx_created_at', 'idx_updated_at']);
  });
});
