// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#14938] `SysMetadataRepository.listDrafts` declares `updatedAt: string |
 * null` and used to emit the raw `updated_at` column, so on Postgres and MySQL
 * it handed a JS `Date` through a field its own signature calls a string.
 *
 * ## The defect
 *
 * `listDrafts`' return type is an INLINE TypeScript object type on the method
 * itself — not a Zod schema — and the projection reached the field through
 * `row.updated_at ?? row.created_at ?? null`. `??` fires only on nullish, so a
 * `Date` walks straight past it into the declared field.
 *
 * Two independent reasons nothing reported it, and both are why the site
 * survived the #13973 census twice: a schema search finds no schema (the
 * declaration is an inline return type), and `rows` is cast `as any[]` one line
 * above the map, so tsc sees a `string` assignment that never happened.
 *
 * ## Why the value is a `Date` on the live dialects
 *
 * `updated_at` / `created_at` are the BUILTIN audit columns on `sys_metadata`
 * (`Field.datetime`, `packages/metadata-core/src/objects/sys-metadata.object.ts`).
 * `SqlDriver#formatOutput` repairs the audit columns
 * (`repairNaiveUtcAuditTimestamp`) and folds the declared datetime columns
 * (`normalizeSqliteDatetimeOutput`) ONLY inside its `if (this.isSqlite)` arm,
 * and `withPostgresCalendarDayAsText` leaves `timestamptz` / `timestamp`
 * deliberately untouched because those are instants. That dialect fact is
 * pinned live in
 * `packages/drivers/driver-sql/src/sql-driver-13567-audit-stamp-materialisation.test.ts`;
 * this file does not re-derive it and takes on no driver dependency
 * (`@objectstack/metadata-protocol` has none, and the layering runs the other
 * way) — the `Date` is hand-made here for exactly that reason.
 *
 * ## What is asserted, and why it is not a hand-copied shape
 *
 * The conformance table below is keyed by `keyof DraftHeader`, where
 * `DraftHeader` is extracted from the method's own signature with
 * `Awaited<ReturnType<...>>[number]`. So the assertion reads the DECLARATION
 * under test rather than a second copy of it: a field added to or removed from
 * that inline type reddens this file at type-check time instead of silently
 * going unchecked.
 *
 * ⚠️ Every case drives a hand-made `Date` — the one shape the live dialects
 * produce and no existing fixture ever did — and each case guards
 * non-vacuity (`toBeInstanceOf(Date)`) on the seeded row BEFORE reading the
 * output. Without that guard a fixture that degraded to a string would keep
 * this file green while measuring nothing, because the input and the assertion
 * would share an identity.
 */

import { describe, it, expect } from 'vitest';
// The engine-double contract gate: a fake looser than ObjectQL's own verb
// dispatch is how #4434 shipped a dead route with its suite green.
import {
  assertEngineDeleteDispatch,
  assertEngineUpdateDispatch,
  assertEngineFindOnePredicate,
} from '@objectstack/metadata-core';
import { SysMetadataRepository } from './sys-metadata-repository.js';

interface Row {
  [k: string]: unknown;
}

/**
 * The declared row shape, read off the method signature itself rather than
 * restated. `CONFORMS` below is a mapped type over its keys, so this file
 * cannot drift out of step with the declaration it pins.
 */
type DraftHeader = Awaited<ReturnType<SysMetadataRepository['listDrafts']>>[number];

/** Canonical instant text — exactly what `Date.prototype.toISOString` emits. */
const ISO_Z = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

/**
 * The instant every case drives, as the live dialects hand it out: a JS
 * `Date`. Carries non-zero milliseconds on purpose — `String(date)` and
 * `date.toString()` both drop them, so a truncating regression stays
 * observable rather than coinciding with the canonical text.
 */
const PG_INSTANT = new Date('2026-03-04T05:06:07.089Z');
const PG_CREATED = new Date('2026-01-02T03:04:05.006Z');

/**
 * Reachable on BOTH live dialects (#14409): mysql2 3.23.1 answers a module
 * constant literally named `INVALID_DATE` for a zero `DATETIME`, and
 * postgres-date 1.0.7 builds `new Date(NaN)` for every year in 275760..294276
 * — years Postgres itself stores.
 */
const INVALID_INSTANT = new Date(NaN);

/**
 * Runtime conformance for the declared projection, keyed by the declaration's
 * OWN keys. A `Date` reaching `updatedAt` satisfies neither arm of its union,
 * which is precisely the defect.
 */
const CONFORMS: { [K in keyof DraftHeader]: (value: DraftHeader[K]) => boolean } = {
  type: (v) => typeof v === 'string',
  name: (v) => typeof v === 'string',
  organizationId: (v) => v === null || typeof v === 'string',
  packageId: (v) => v === null || typeof v === 'string',
  updatedAt: (v) => v === null || typeof v === 'string',
  updatedBy: (v) => v === null || typeof v === 'string',
};

/**
 * Assert every field of every row against the declared union, naming the field
 * in the assertion payload so a failure says WHICH one broke rather than
 * `false !== true`.
 */
function expectConformsToDeclaration(rows: DraftHeader[]): void {
  expect(rows.length).toBeGreaterThan(0);
  for (const row of rows) {
    for (const key of Object.keys(CONFORMS) as Array<keyof DraftHeader>) {
      const check = CONFORMS[key] as (value: unknown) => boolean;
      expect({ field: key, conforms: check(row[key]) }).toEqual({ field: key, conforms: true });
    }
  }
}

/**
 * Minimal engine fake. Deliberately stores exactly what it is seeded with — no
 * key dropping, no coercion — so a `Date` planted in a row survives to the read
 * door the way a live driver's would. The `$or` arm is real because
 * `listDrafts` issues one for a non-null-org caller (the ADR-0005 overlay
 * reach), and an unimplemented combinator throws rather than silently reading
 * a `$`-prefixed key as a field name.
 */
function makeFakeEngine(seed: Row[] = []) {
  let nextId = 1;
  const rows: Row[] = seed.map((r) => ({ id: `seed_${nextId++}`, ...r }));
  const history: Row[] = [];

  const matches = (row: Row, where: Record<string, unknown>): boolean => {
    for (const [k, v] of Object.entries(where)) {
      if (k === '$or') {
        const branches = v as Array<Record<string, unknown>>;
        if (!branches.some((b) => matches(row, b))) return false;
        continue;
      }
      if (k.startsWith('$')) {
        throw new Error(`fake matcher: unimplemented combinator ${k}`);
      }
      const rv = row[k] ?? null;
      if ((v ?? null) !== rv) return false;
    }
    return true;
  };

  const tableOf = (name: string): Row[] => (name === 'sys_metadata' ? rows : history);

  return {
    rows,
    history,
    async findOne(table: string, q: { where: Record<string, unknown> }) {
      assertEngineFindOnePredicate(table, q);
      return tableOf(table).find((r) => matches(r, q.where)) ?? null;
    },
    async find(table: string, q: { where: Record<string, unknown>; limit?: number }) {
      const matched = tableOf(table).filter((r) => matches(r, q.where));
      // Hold the caller's bound AFTER the filter and by PRESENCE — a double
      // that ignores `limit` answers more rows than the real engine would.
      return typeof q?.limit === 'number' ? matched.slice(0, q.limit) : matched;
    },
    async insert(table: string, data: Row) {
      const row = { id: `row_${nextId++}`, ...data };
      tableOf(table).push(row);
      return row;
    },
    async update(table: string, data: Row, opts: { where: Record<string, unknown> }) {
      assertEngineUpdateDispatch(data, opts);
      const row = tableOf(table).find((r) => matches(r, opts.where));
      if (row) Object.assign(row, data);
      return row;
    },
    async delete(_table: string, opts: { where?: Record<string, unknown> }) {
      assertEngineDeleteDispatch(opts);
      /* not exercised here */
    },
  };
}

/** One env-wide draft row, seeded with whatever audit stamps a case drives. */
const draftRow = (stamps: Row): Row => ({
  type: 'view',
  name: 'case_grid',
  organization_id: null,
  state: 'draft',
  package_id: null,
  metadata: '{"label":"Cases"}',
  checksum: 'sha-draft',
  version: 1,
  updated_by: 'usr_1',
  created_by: 'usr_0',
  ...stamps,
});

function makeRepo(engine: ReturnType<typeof makeFakeEngine>, organizationId: string | null = null) {
  return new SysMetadataRepository({
    engine: engine as never,
    organizationId,
    orgLabel: organizationId ?? 'env',
  } as never);
}

describe('#14938 — listDrafts emits canonical ISO text for updatedAt, whatever the dialect materialised', () => {
  describe('§A updated_at as a JS Date — the Postgres/MySQL materialisation', () => {
    it('canonicalises it and the whole projection conforms to the declared type', async () => {
      const engine = makeFakeEngine([draftRow({ updated_at: PG_INSTANT, created_at: PG_CREATED })]);
      const repo = makeRepo(engine);

      // Non-vacuity: if the fixture ever degrades to a string this file would
      // keep passing while testing the shape that was never broken.
      expect(engine.rows[0]!.updated_at).toBeInstanceOf(Date);

      const drafts = await repo.listDrafts();
      expect(drafts).toHaveLength(1);
      expect(typeof drafts[0]!.updatedAt).toBe('string');
      expect(drafts[0]!.updatedAt).toMatch(ISO_Z);
      expect(drafts[0]!.updatedAt).toBe(PG_INSTANT.toISOString());
      expectConformsToDeclaration(drafts);
    });

    it('reaches the same canonicalisation through the org-scoped $or read', async () => {
      // A non-null-org caller sees BOTH its own overlay drafts and the env-wide
      // ones (#3115); the canonicalisation must not depend on which arm matched.
      const engine = makeFakeEngine([
        draftRow({ organization_id: 'org_alpha', updated_at: PG_INSTANT }),
        draftRow({ name: 'lead_grid', updated_at: PG_INSTANT }),
      ]);
      const repo = makeRepo(engine, 'org_alpha');

      expect(engine.rows[0]!.updated_at).toBeInstanceOf(Date);

      const drafts = await repo.listDrafts();
      expect(drafts).toHaveLength(2);
      for (const draft of drafts) expect(draft.updatedAt).toBe(PG_INSTANT.toISOString());
      expectConformsToDeclaration(drafts);
    });
  });

  describe('§B the created_at fallback — the second link of the same chain', () => {
    it('canonicalises created_at when updated_at is absent', async () => {
      const engine = makeFakeEngine([draftRow({ created_at: PG_CREATED })]);
      const repo = makeRepo(engine);

      expect(engine.rows[0]!.updated_at).toBeUndefined();
      expect(engine.rows[0]!.created_at).toBeInstanceOf(Date);

      const drafts = await repo.listDrafts();
      expect(drafts[0]!.updatedAt).toBe(PG_CREATED.toISOString());
      expectConformsToDeclaration(drafts);
    });
  });

  describe('§C SQLite — the dialect that was already correct is not reshaped', () => {
    it('passes an already-canonical string through byte-identically', async () => {
      const canonical = '2026-03-04T05:06:07.089Z';
      const engine = makeFakeEngine([draftRow({ updated_at: canonical })]);
      const repo = makeRepo(engine);

      expect(typeof engine.rows[0]!.updated_at).toBe('string');

      const drafts = await repo.listDrafts();
      expect(drafts[0]!.updatedAt).toBe(canonical);
      expectConformsToDeclaration(drafts);
    });
  });

  describe('§D the terminal this call site keeps', () => {
    it('answers null — not a synthesised "now" — when both audit columns are absent', async () => {
      // This projection declares `updatedAt: string | null` and the chain being
      // replaced already ended in `?? null`, so `null` is what "absent" already
      // means to every consumer of this list. `rowToItem` terminates in
      // `?? new Date(...).toISOString()` instead; the terminal is chosen per
      // call site (#14078), and substituting one for the other here would
      // invent an edit instant for a row that never recorded one.
      const engine = makeFakeEngine([draftRow({})]);
      const repo = makeRepo(engine);

      const drafts = await repo.listDrafts();
      expect(drafts[0]!.updatedAt).toBeNull();
      expectConformsToDeclaration(drafts);
    });

    it('answers null for an Invalid Date rather than throwing or serving the text "Invalid Date"', async () => {
      // The total `Date` arm (#14078, ruled B): unguarded, `toISOString()`
      // raises `RangeError: Invalid time value`, and the spelling it replaced
      // served the visible text instead. Here the shape takes the same branch
      // an absent column takes.
      const engine = makeFakeEngine([draftRow({ updated_at: INVALID_INSTANT })]);
      const repo = makeRepo(engine);

      expect(engine.rows[0]!.updated_at).toBeInstanceOf(Date);
      expect(Number.isNaN((engine.rows[0]!.updated_at as Date).getTime())).toBe(true);

      const drafts = await repo.listDrafts();
      expect(drafts[0]!.updatedAt).toBeNull();
      expect(drafts[0]!.updatedAt).not.toBe('Invalid Date');
      expectConformsToDeclaration(drafts);
    });
  });

  describe('§E updatedBy is deliberately NOT canonicalised — it is not a timestamp', () => {
    it('passes the lookup column straight through, and the dialect asymmetry never reaches it', async () => {
      // `updated_by` / `created_by` are `Field.lookup('sys_user')` on
      // `sys_metadata` — string ids, not `Field.datetime`. The identical `??`
      // shape on the next line is therefore correct as written; canonicalising
      // it would be `String(value)` applied to a value that is already a
      // string, and folding it into this fix would widen the card's scope to a
      // line with no defect.
      const engine = makeFakeEngine([draftRow({ updated_at: PG_INSTANT, updated_by: 'usr_7' })]);
      const repo = makeRepo(engine);

      const drafts = await repo.listDrafts();
      expect(drafts[0]!.updatedBy).toBe('usr_7');
      expectConformsToDeclaration(drafts);
    });

    it('falls back to created_by and terminates in null, unchanged by this card', async () => {
      const engine = makeFakeEngine([
        draftRow({ updated_at: PG_INSTANT, updated_by: undefined, created_by: 'usr_0' }),
        draftRow({
          name: 'lead_grid',
          updated_at: PG_INSTANT,
          updated_by: undefined,
          created_by: undefined,
        }),
      ]);
      const repo = makeRepo(engine);

      const drafts = await repo.listDrafts();
      expect(drafts.find((d) => d.name === 'case_grid')!.updatedBy).toBe('usr_0');
      expect(drafts.find((d) => d.name === 'lead_grid')!.updatedBy).toBeNull();
      expectConformsToDeclaration(drafts);
    });
  });
});
