// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// #13222 part (1) — `syncCollectionSchema` REFUSES `reference_to` at the door.
//
// `reference` is the only relationship spelling `@objectstack/spec` declares.
// `reference_to` is a REJECTED ALIAS: `FieldSchema` answers `unrecognized_keys`
// for it on any field type, carrying any value. Until this door, this driver
// read `reference_to` and only `reference_to` as the gate on its field-level
// join index — so one key had two doors with opposite answers, and the silent
// one was the one that touched the database.
//
// Driven against a fake `Db`, deliberately: this package's real-server suite is
// OPT-IN (`describe.skipIf(!sharedMongod)`, `OS_TEST_MONGODB_MEMORY_SERVER_ENABLED=1`,
// #5517's ~123 MB download), so an assertion parked there runs on no ordinary CI
// lane — which is exactly the lane that has to notice if this regresses. The
// recorder below is the same narrow slice of `Db` that
// `mongodb-schema-declared-indexes.test.ts` records against; it is duplicated
// rather than imported because neither file exports it, and a shared fixture
// module between two suites that pin OPPOSITE halves of one arm would couple
// them for no gain.
//
// Part (2) of #13222 has since been ruled and taken: the join-index arm now
// gates on the canonical `reference`, so a lookup an author can really publish
// GETS `idx_FIELD_lookup`. The last case below was this file's NO-CHANGE
// control for that question and has flipped accordingly, in the same stroke as
// `mongodb-schema-declared-indexes.test.ts`'s #12252 pin and the real-server
// pin in `mongodb-driver.test.ts`. It still belongs here: it is what proves the
// door and the arm read DIFFERENT keys and disagree about them on purpose —
// `reference_to` refused, `reference` indexed, from one call.

import { describe, it, expect } from 'vitest';
import type { Db } from 'mongodb';
import { syncCollectionSchema } from './mongodb-schema.js';

interface CreatedIndex {
  spec: Record<string, unknown>;
  options: Record<string, unknown>;
}

/**
 * The narrow slice of `Db` `syncCollectionSchema` touches, recording every
 * `createCollection` and `createIndex` call in order. Nothing is stubbed beyond
 * that slice — the function under test runs verbatim.
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

/** The ADR-0112 envelope this refusal is required to speak. */
interface CodedError {
  code?: string;
  status?: number;
  message: string;
}

/** Run the sync and hand back the rejection, or fail loudly if there wasn't one. */
async function refusalFrom(fields: Record<string, unknown>) {
  const { db, created, collectionsCreated } = fakeDb();
  let caught: CodedError | undefined;
  try {
    await syncCollectionSchema(db, 'lead', {
      name: 'lead',
      fields: fields as Parameters<typeof syncCollectionSchema>[2]['fields'],
    });
  } catch (error) {
    caught = error as CodedError;
  }
  expect(caught, 'syncCollectionSchema was expected to refuse and did not').toBeDefined();
  return { err: caught as CodedError, created, collectionsCreated };
}

describe('#13222 part (1) — driver-mongodb refuses `reference_to` at the schema door', () => {
  it('refuses with the ADR-0112 envelope, not a bare throw', async () => {
    // ⚠️ `code` + `status` are the assertion, not `.toThrow()`. A bare
    // `toThrow()` would stay green against an unrelated `Error` from anywhere
    // else in the sync — including the very silence this door replaces, had it
    // failed for some other reason.
    const { err } = await refusalFrom({
      company_id: { type: 'lookup', reference_to: 'company' },
    });

    expect(err.code).toBe('VALIDATION_ERROR');
    expect(err.status).toBe(400);
  });

  it("states the refusal in `FieldSchema`'s own words, and names the field", async () => {
    // The wording IS the contract here: the ruling is "one key, one answer, on
    // both doors", so this door has to hand back the same verdict and the same
    // one-word remedy the authoring door does — not a driver-flavoured paraphrase.
    const { err } = await refusalFrom({
      company_id: { type: 'lookup', reference_to: 'company' },
    });

    expect(err.message).toContain('[driver-mongodb]');
    expect(err.message).toContain("field 'company_id' on 'lead'");
    expect(err.message).toContain('rejected alias');
    expect(err.message).toContain('reference_to` -> `reference');
    // The spec's own verdict word, so a reader can match this against the
    // `FieldSchema` failure they may already be holding.
    expect(err.message).toContain('unrecognized_keys');
  });

  it('refuses on ANY field type — the door is gated on the key, not the type', async () => {
    // Measured on `@objectstack/spec`: `{ type:'text', reference_to:'company' }`
    // draws the SAME `unrecognized_keys` verdict as the `lookup` fixture, so a
    // door gated on `type === 'lookup'` would answer differently from the schema
    // for every other type. `sql-driver.ts` states its copy before the type
    // switch for exactly this reason; this file has no type switch, so the
    // equivalent placement is ahead of the whole field loop.
    for (const type of ['text', 'string', 'user', 'number', undefined]) {
      const { err } = await refusalFrom({ company_id: { type, reference_to: 'company' } });
      expect(err.code, String(type)).toBe('VALIDATION_ERROR');
      expect(err.status, String(type)).toBe(400);
    }
  });

  it('refuses a `multiple` field too — no short-circuit gets past the door', async () => {
    // The SQL door's stated hazard, transplanted: a multi-value lookup returned
    // from `createColumn` immediately and used to carry the key straight past
    // that seam. Nothing here may acquire the same shape.
    const { err } = await refusalFrom({
      company_ids: { type: 'lookup', multiple: true, reference_to: 'company' },
    });

    expect(err.code).toBe('VALIDATION_ERROR');
    expect(err.status).toBe(400);
  });

  it('refuses every value the key can carry, including `null` and the empty string', async () => {
    // The predicate is `!== undefined`, not truthiness. Measured on
    // `FieldSchema`: `'company'`, `null` and `''` all draw one identical
    // `unrecognized_keys` verdict — so a truthy gate would have let two of the
    // three shapes the schema refuses walk through this door.
    for (const value of ['company', null, '', 0, false]) {
      const { err } = await refusalFrom({ company_id: { type: 'lookup', reference_to: value } });
      expect(err.code, JSON.stringify(value)).toBe('VALIDATION_ERROR');
      expect(err.status, JSON.stringify(value)).toBe(400);
    }
  });

  it('touches NOTHING on the database when it refuses', async () => {
    // The refusal is stated ahead of `createCollection`, so a refused sync does
    // not leave a collection (or a partial index set) behind for the next boot
    // to find. "Before the collection exists, not after documents are in it."
    const { created, collectionsCreated } = await refusalFrom({
      name: { type: 'string', unique: true },
      company_id: { type: 'lookup', reference_to: 'company' },
      owner_id: { type: 'user' },
    });

    expect(collectionsCreated).toEqual([]);
    expect(names(created)).toEqual([]);
  });

  it('lets an explicit `{ reference_to: undefined }` through, exactly as the SQL door does', async () => {
    // `!== undefined` rather than `'reference_to' in field` — the narrower of
    // two correct predicates, and BOTH doors take the same one. Measured:
    // `FieldSchema`'s own canonical output does not carry `reference_to` as an
    // own key, so a producer spreading canonical output can never trip this;
    // a producer spreading an explicit `undefined` is not writing a
    // relationship, and refusing it would be the two doors disagreeing again,
    // in the other direction.
    const { db, created, collectionsCreated } = fakeDb();
    await syncCollectionSchema(db, 'lead', {
      name: 'lead',
      fields: { company_id: { type: 'lookup', reference_to: undefined } },
    });

    expect(collectionsCreated).toEqual(['lead']);
    expect(names(created)).toEqual(['idx_id_unique', 'idx_created_at', 'idx_updated_at']);
  });

  it('refuses `reference_to` and INDEXES `reference` — two keys, two answers, one call', async () => {
    // ⚠️ THE PAIRED CONTROL for the door, and load-bearing in both directions.
    //
    // The door refuses one relationship spelling; the arm indexes the other. A
    // suite that only ever proves the refusal cannot tell "the door works" from
    // "syncCollectionSchema throws on everything", so the two answers are taken
    // from ONE call here on purpose.
    //
    // `user` half: still `idx_owner_id_lookup`, and still the unconditional
    // disjunct — it proves the arm executed and names the shape the assertion
    // below is spelled in, so neither half can pass vacuously.
    //
    // `reference` half: FLIPPED by part (2) of #13222. This case used to assert
    // the canonical lookup got NO index — the divergence #12252 pinned, which
    // held because the arm gated on `reference_to`, a key this very door
    // refuses, making the conjunct unreachable for every input. The arm now
    // gates on `reference`, so the lookup is indexed.
    const { db, created } = fakeDb();
    await syncCollectionSchema(db, 'lead', {
      name: 'lead',
      fields: {
        company_id: { type: 'lookup', reference: 'company' },
        owner_id: { type: 'user' },
      },
    });

    // Exact set, in creation order — closes the vacuity routes a `toContain`
    // pair leaves open: an index appearing under another name, the two lookup
    // indexes swapping fields, or a stray fourth index nobody declared.
    expect(names(created)).toEqual([
      'idx_id_unique',
      'idx_created_at',
      'idx_updated_at',
      'idx_company_id_lookup',
      'idx_owner_id_lookup',
    ]);
  });

  it('does not index a `lookup` that declares no target — `reference` is read for truth, not presence', async () => {
    // Measured on `FieldSchema` built from this tree: `{ type: 'lookup' }` with
    // no `reference`, and `{ type: 'lookup', reference: '' }`, BOTH parse
    // successfully — the spec's prose calls `reference` required for these
    // types, but the schema does not enforce it. So this is a shape an author
    // can really publish, not a hypothetical, and the arm has to answer for it.
    //
    // It answers by declining: `idx_FIELD_lookup` exists to serve a join, and a
    // lookup with no declared target has no join to serve — the index would
    // cost every write and buy no read. This is why the arm gates on
    // truthiness and not on `!== undefined` like the door above does; the two
    // predicates differ deliberately, because they are answering different
    // questions about different keys.
    for (const target of [undefined, '']) {
      const { db, created } = fakeDb();
      await syncCollectionSchema(db, 'lead', {
        name: 'lead',
        fields: { company_id: { type: 'lookup', reference: target }, owner_id: { type: 'user' } },
      });

      // The `user` control fires, so the arm ran and the zero below is a real
      // zero rather than a harness that called nothing.
      expect(names(created)).toEqual([
        'idx_id_unique',
        'idx_created_at',
        'idx_updated_at',
        'idx_owner_id_lookup',
      ]);
    }
  });
});
