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
//
// That same reasoning is why the second suite below lives here: #12252's pin on
// the field-level lookup arm was written against the opt-in real-server suite,
// where it can go red in neither direction.

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

describe('the field-level lookup arm, on a lane that actually runs', () => {
  it('gives a canonically-spelled `lookup` its join index, alongside the `user` field', async () => {
    // ⚠️ DIVERGENCE RETIRED — this line was inverted, and is now inverted back.
    //
    // The history is the reason this case is worth its length. The arm used to
    // gate on `field.reference_to`, and `reference` — the CANONICAL and only
    // spelling `FieldSchema` declares — was read nowhere in the driver. So a
    // lookup any author could actually publish reached the arm and fell
    // straight through it: `idx_company_id_lookup` was never created, for any
    // authored object, on any deployment. #12252 pinned that as a divergence
    // with the disposition open, and #13222 carried the disposition. Part (2)
    // of its ruling repointed the predicate at `reference`, which is what this
    // assertion now records.
    //
    // TWIN PIN — edit either, edit both. The same fact is pinned against a real
    // server in `mongodb-driver.test.ts` (`describe('syncSchema')` -> 'should
    // create collection and indexes'). That suite is
    // `describe.skipIf(!sharedMongod)`, opt-in behind
    // `OS_TEST_MONGODB_MEMORY_SERVER_ENABLED=1` because of #5517's ~123 MB
    // binary download, so it runs on no ordinary CI lane — which is why the
    // fact is asserted here too. THIS copy is the one that runs.
    //
    // ⚠️ The `user` half stays the LOAD-BEARING control, not decoration.
    // `field.type === 'user'` is the arm's unconditional disjunct: it fired
    // before this change and after it, so it is the fixed point that tells a
    // real flip apart from the arm having been broken in some new way. If the
    // predicate were repointed at a key nothing supplies, the `user` index
    // would still appear and only the `company_id` one would vanish.

    const { db, created } = fakeDb();
    await syncCollectionSchema(db, 'lead', {
      name: 'lead',
      fields: {
        company_id: { type: 'lookup', reference: 'company' },
        owner_id: { type: 'user' },
      },
    });

    // The control: the unconditional disjunct fired, under the name the
    // assertion below is spelled with.
    const owner = byName(created, 'idx_owner_id_lookup');
    expect(owner).toBeDefined();
    expect(owner!.spec).toEqual({ owner_id: 1 });

    // The fact this case owns: the canonical lookup is indexed, on its own
    // field, ascending — the spec is asserted, not just the name.
    const company = byName(created, 'idx_company_id_lookup');
    expect(company).toBeDefined();
    expect(company!.spec).toEqual({ company_id: 1 });
    // A join index, never a constraint: `unique`/`sparse` belong to the unique
    // arm, and a lookup silently acquiring them would forbid two records
    // pointing at the same parent.
    expect(company!.options).toEqual({ name: 'idx_company_id_lookup' });

    // Exact set — closes the remaining vacuity routes in one line: an extra
    // index nobody declared, the two lookup indexes swapping fields, or the
    // core set drifting.
    expect(names(created)).toEqual([
      'idx_id_unique',
      'idx_created_at',
      'idx_updated_at',
      'idx_company_id_lookup',
      'idx_owner_id_lookup',
    ]);
  });
});

/**
 * A recorder that also keeps the collection's index set the way `mongod` does,
 * so a sequence of syncs can be read as "what got BUILT", not only "what was
 * asked for". Only the three rules the create loop meets are modelled:
 *
 * - the same name with the same key and options is a no-op (`createIndex` is
 *   idempotent);
 * - the same name with a different key or options is refused
 *   `IndexKeySpecsConflict` (86);
 * - another name over the same key with the same partial filter is refused
 *   `IndexOptionsConflict` (85), which the create loop skips.
 *
 * `preexisting` seeds the collection as an earlier release left it.
 */
function indexKeepingDb(preexisting: Array<{ name: string; key: Record<string, unknown> }> = []) {
  const asked: CreatedIndex[] = [];
  const built: string[] = [];
  const live = new Map<string, { key: Record<string, unknown>; options: Record<string, unknown> }>();
  for (const p of preexisting) live.set(p.name, { key: p.key, options: { name: p.name } });
  const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
  const conflict = (code: number, codeName: string) => Object.assign(new Error(codeName), { code, codeName });
  const db = {
    listCollections: () => ({ toArray: async () => [{ name: 'existing' }] }),
    createCollection: async () => undefined,
    collection: () => ({
      createIndex: async (key: Record<string, unknown>, options: Record<string, unknown>) => {
        asked.push({ spec: key, options });
        const name = options.name as string;
        const existing = live.get(name);
        if (existing) {
          if (same(existing.key, key) && same(existing.options, options)) return name;
          throw conflict(86, 'IndexKeySpecsConflict');
        }
        for (const other of live.values()) {
          if (same(other.key, key) && same(other.options.partialFilterExpression, options.partialFilterExpression)) {
            throw conflict(85, 'IndexOptionsConflict');
          }
        }
        live.set(name, { key, options });
        built.push(name);
        return name;
      },
      indexes: async () => [...live.entries()].map(([name, i]) => ({ name, key: i.key, ...i.options })),
      dropIndex: async (name: string) => {
        live.delete(name);
      },
    }),
  } as unknown as Db;
  /** Every live index whose key is exactly `key`. */
  const onKey = (key: Record<string, unknown>) =>
    [...live.entries()].filter(([, i]) => same(i.key, key)).map(([name]) => name);
  return { db, asked, built, live, onKey };
}

/**
 * A detail object read by its parent: `project` is the `master_detail` the
 * read filters on, beside a `lookup` and a `user` field that main already
 * indexes (the CONTROL fields).
 */
const timeEntry = (extra: { indexes?: Array<{ name?: string; fields?: string[]; unique?: boolean | 'global' | 'organization' }> } = {}) => ({
  name: 'time_entry',
  fields: {
    project: { type: 'master_detail', reference: 'project' },
    task: { type: 'lookup', reference: 'task' },
    member: { type: 'user' },
    work_date: { type: 'date' },
    seq: { type: 'number' },
  },
  ...extra,
});

/** What main's sync builds for {@link timeEntry} with no declared indexes. */
const MAIN_BUILT = [
  { name: 'idx_id_unique', key: { id: 1 } },
  { name: 'idx_created_at', key: { created_at: 1 } },
  { name: 'idx_updated_at', key: { updated_at: 1 } },
  { name: 'idx_task_lookup', key: { task: 1 } },
  { name: 'idx_member_lookup', key: { member: 1 } },
];

describe('a master_detail field gets the index its by-parent read needs', () => {
  it('builds one plain index on a single-valued master_detail, and leaves the lookup and user indexes as they were', async () => {
    const { db, asked } = indexKeepingDb();
    await syncCollectionSchema(db, 'time_entry', timeEntry());

    const project = byName(asked, 'idx_project');
    expect(project).toBeDefined();
    expect(project!.spec).toEqual({ project: 1 });
    // A read index, never a constraint: many details share one parent.
    expect(project!.options).toEqual({ name: 'idx_project' });

    // CONTROL: the lookup and user arm is byte-identical to main.
    expect(byName(asked, 'idx_task_lookup')).toEqual({ spec: { task: 1 }, options: { name: 'idx_task_lookup' } });
    expect(byName(asked, 'idx_member_lookup')).toEqual({ spec: { member: 1 }, options: { name: 'idx_member_lookup' } });

    expect(names(asked)).toEqual([
      'idx_id_unique',
      'idx_created_at',
      'idx_updated_at',
      'idx_project',
      'idx_task_lookup',
      'idx_member_lookup',
    ]);
  });

  it('skips a multi-valued master_detail and one that names no parent', async () => {
    // Both shapes are refused by `FieldSchema`, but `syncSchema(object, schema:
    // unknown)` forwards metadata without Zod, so they can still arrive here.
    const { db, asked } = indexKeepingDb();
    await syncCollectionSchema(db, 'time_entry', {
      name: 'time_entry',
      fields: {
        projects: { type: 'master_detail', reference: 'project', multiple: true },
        orphan: { type: 'master_detail' },
        blank: { type: 'master_detail', reference: '' },
      },
    });

    expect(names(asked)).toEqual(['idx_id_unique', 'idx_created_at', 'idx_updated_at']);
  });

  it('adds nothing when a declared index already leads with the field, and keeps every declared index as declared', async () => {
    const cases: Array<{ label: string; indexes: Array<{ name?: string; fields: string[]; unique?: boolean }> }> = [
      { label: 'single-column', indexes: [{ fields: ['project'] }] },
      { label: 'compound', indexes: [{ fields: ['project', 'work_date'] }] },
      { label: 'author-named', indexes: [{ name: 'by_parent', fields: ['project', 'work_date'] }] },
      { label: 'unique compound', indexes: [{ fields: ['project', 'seq'], unique: true }] },
    ];
    for (const { label, indexes } of cases) {
      const withDetail = indexKeepingDb();
      await syncCollectionSchema(withDetail.db, 'time_entry', timeEntry({ indexes }));

      // Exactly one live index answers the parent read's leading key; no
      // second single-key index is built beside a declaration that covers it.
      const leading = [...withDetail.live.entries()]
        .filter(([, i]) => !i.options.unique && Object.keys(i.key)[0] === 'project')
        .map(([name]) => name);
      expect(leading, label).toHaveLength(1);
      if (indexes[0].fields.length > 1) expect(withDetail.onKey({ project: 1 }), label).toEqual([]);

      // CONTROL: the declared ops are the ones the same declaration asks for
      // when `project` is not a master_detail at all.
      const plain = indexKeepingDb();
      const asText = timeEntry({ indexes });
      await syncCollectionSchema(plain.db, 'time_entry', {
        ...asText,
        fields: { ...asText.fields, project: { type: 'text' } },
      });
      expect(withDetail.asked, label).toEqual(plain.asked);
    }
  });

  it('still builds the index when the declared index has the field in a later position', async () => {
    const { db, asked } = indexKeepingDb();
    await syncCollectionSchema(db, 'time_entry', timeEntry({ indexes: [{ fields: ['work_date', 'project'] }] }));

    expect(byName(asked, 'idx_project')).toEqual({ spec: { project: 1 }, options: { name: 'idx_project' } });
    expect(byName(asked, 'idx_work_date_project')).toEqual({
      spec: { work_date: 1, project: 1 },
      options: { name: 'idx_work_date_project' },
    });
  });

  it('a master_detail that is also field-level unique keeps the one read index the unique arm already builds', async () => {
    const { db, asked } = indexKeepingDb();
    await syncCollectionSchema(db, 'profile_detail', {
      name: 'profile_detail',
      fields: { account: { type: 'master_detail', reference: 'account', unique: true } },
    });

    expect(names(asked).filter((n) => n === 'idx_account')).toHaveLength(1);
    expect(byName(asked, 'idx_account_unique')!.options.unique).toBe(true);
  });

  it('an existing deployment gains the index on its next sync, and the sync after that builds nothing', async () => {
    const { db, built, onKey } = indexKeepingDb(MAIN_BUILT);

    await syncCollectionSchema(db, 'time_entry', timeEntry());
    expect(built).toEqual(['idx_project']);

    await syncCollectionSchema(db, 'time_entry', timeEntry());
    expect(built).toEqual(['idx_project']);

    // CONTROL: the lookup and user indexes main built are still the only ones
    // on their keys.
    expect(onKey({ task: 1 })).toEqual(['idx_task_lookup']);
    expect(onKey({ member: 1 })).toEqual(['idx_member_lookup']);
  });

  it('an author who later declares the same index gets no second one', async () => {
    const { db, built, onKey } = indexKeepingDb(MAIN_BUILT);

    await syncCollectionSchema(db, 'time_entry', timeEntry());
    await syncCollectionSchema(db, 'time_entry', timeEntry({ indexes: [{ fields: ['project'] }] }));

    expect(built).toEqual(['idx_project']);
    expect(onKey({ project: 1 })).toEqual(['idx_project']);
  });
});
