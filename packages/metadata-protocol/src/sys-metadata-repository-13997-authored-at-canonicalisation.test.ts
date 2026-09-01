// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#13997] `MetadataItem.authoredAt` is declared `z.string()` — the two
 * adapter sites that pass a driver row straight through must canonicalise it.
 *
 * ## The defect
 *
 * `MetadataItem.authoredAt` is declared `z.string().describe('ISO-8601
 * timestamp')` (`packages/metadata-core/src/types.ts`), and `MetadataItem` is
 * a `z.infer`, so the field is `string` to every consumer. Two producers in
 * this file adapted a driver row into that declared type WITHOUT converting
 * the timestamp:
 *
 *   - `getByHash()` — `recorded_at`, a declared `Field.datetime` on
 *     `sys_metadata_history`;
 *   - `rowToItem()` (reached by `get()`) — `updated_at` / `created_at`, the
 *     BUILTIN audit columns.
 *
 * On Postgres and MySQL both arrive out of the record read door as a JS
 * `Date`: `SqlDriver#formatOutput` repairs the audit columns and folds
 * declared `datetime` columns only inside its `if (this.isSqlite)` arm, and
 * `withPostgresCalendarDayAsText` leaves `timestamptz` / `timestamp`
 * deliberately untouched. That dialect fact is pinned live in
 * `packages/drivers/driver-sql/src/sql-driver-13567-audit-stamp-materialisation.test.ts`.
 *
 * ## Why nothing reported it, and what that costs THIS file
 *
 * Two independent reasons. `row` is `any`, so tsc saw a `string` assignment
 * that never happened. And `MetadataItemSchema` — the runtime validator that
 * would have caught it — is parsed nowhere on a production path: its only
 * `.parse` call sites in the repo are its own unit test
 * (`packages/metadata-core/test/types.test.ts`), which feeds a hand-made
 * **string**.
 *
 * ⚠️ That is the trap this file exists to break. A fixture built from a
 * hand-made string proves nothing here, because the value under test is
 * already the declared shape before the adapter runs — the assertion and the
 * input share an identity. **Every case below drives a hand-made `Date`**, the
 * one shape the live dialects produce and no existing fixture ever did, and
 * §A's non-vacuity guard asserts the input really is a `Date` before reading
 * the output. Without that guard a fixture that silently degraded to a string
 * would keep this file green while measuring nothing.
 *
 * ⛔ No driver dependency: `@objectstack/metadata-protocol` has none and must
 * not grow one — the layering runs the other way. The `Date` is hand-made here
 * for exactly the reason the #13567 pin states for the OCC seam next door.
 *
 * ## What is asserted
 *
 * The declared contract itself, via `MetadataItemSchema.safeParse` — not a
 * hand-rolled regex standing in for it. This is the schema's first evaluation
 * against a driver-shaped input in this repo; a bare `toThrow()` or a
 * `typeof` check would each pass for reasons unrelated to the defect.
 */

import { describe, it, expect, beforeEach } from 'vitest';
// The producer's OWN write-verb dispatch decisions (#4550 delete / #5480
// update), so the fake engine below cannot accept a call ObjectQL refuses.
// Imported from `@objectstack/metadata-core`, not `@objectstack/objectql`:
// objectql depends on this package, so that import would close a cycle.
import {
  assertEngineDeleteDispatch,
  assertEngineUpdateDispatch,
  assertEngineFindOnePredicate,
  MetadataItemSchema,
} from '@objectstack/metadata-core';
import { SysMetadataRepository } from './sys-metadata-repository.js';

interface Row {
  [k: string]: unknown;
}

/** Canonical instant text — exactly what `Date.prototype.toISOString` emits. */
const ISO_Z = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

/**
 * The instant every case drives, as the live dialects hand it out: a JS
 * `Date`. Carries non-zero milliseconds on purpose — `String(date)` and
 * `date.toString()` both drop them, so a truncating regression stays
 * observable rather than coinciding with the canonical text.
 */
const PG_INSTANT = new Date('2026-03-04T05:06:07.089Z');

/**
 * Minimal engine fake. Deliberately stores exactly what it is handed — no key
 * dropping, no coercion — so a `Date` planted in a row survives to the read
 * door the way a live driver's would.
 */
function makeFakeEngine() {
  const rows = new Map<string, Row>();
  const historyRows: Row[] = [];

  const keyOf = (w: Record<string, unknown>) =>
    `${String(w.type)}|${String(w.name)}|${String(w.organization_id ?? 'null')}|${String(w.state ?? 'active')}`;

  const findRow = (where: Record<string, unknown>) => {
    if (where.id !== undefined) {
      for (const [k, r] of rows) if (r.id === where.id) return { key: k, row: r };
      return null;
    }
    const k = keyOf(where);
    const r = rows.get(k);
    return r ? { key: k, row: r } : null;
  };

  const matchesHistory = (h: Row, where: Record<string, unknown>): boolean =>
    Object.entries(where).every(([k, v]) => {
      if (k.startsWith('$')) throw new Error(`fake driver: unsupported operator ${k}`);
      return v === undefined || h[k] === v;
    });

  return {
    rows,
    historyRows,
    async find(table: string, opts: { where: Record<string, unknown> }) {
      if (table === 'sys_metadata_history')
        return historyRows.filter((h) => matchesHistory(h, opts.where));
      return Array.from(rows.values()).filter((r) => {
        if (opts.where.type && r.type !== opts.where.type) return false;
        if (
          opts.where.organization_id !== undefined &&
          r.organization_id !== opts.where.organization_id
        )
          return false;
        if (opts.where.state && r.state !== opts.where.state) return false;
        return true;
      });
    },
    async findOne(table: string, opts: { where: Record<string, unknown> }) {
      assertEngineFindOnePredicate(table, opts);
      if (table === 'sys_metadata_history')
        return historyRows.find((h) => matchesHistory(h, opts.where)) ?? null;
      return findRow(opts.where)?.row ?? null;
    },
    async insert(table: string, data: Record<string, unknown>) {
      if (table === 'sys_metadata_history') {
        const h: Row = { ...data };
        if (!h.id) h.id = `h_${historyRows.length + 1}`;
        historyRows.push(h);
        return { id: h.id as string };
      }
      const k = keyOf(data);
      const row: Row = { id: `r_${rows.size + 1}`, ...data };
      rows.set(k, row);
      return { id: row.id as string };
    },
    async update(_t: string, data: Record<string, unknown>, opts: { where: Record<string, unknown> }) {
      assertEngineUpdateDispatch(data, opts);
      const found = findRow(opts.where);
      if (!found) throw new Error('not found');
      rows.set(found.key, { ...found.row, ...data });
      return { id: found.row.id as string };
    },
    async delete(_t: string, opts: { where: Record<string, unknown> }) {
      assertEngineDeleteDispatch(opts);
      const found = findRow(opts.where);
      if (!found) return { deleted: 0 };
      rows.delete(found.key);
      return { deleted: 1 };
    },
    async transaction<T>(cb: (ctx: any, info: { owned: boolean }) => Promise<T>): Promise<T> {
      return cb(undefined, { owned: true });
    },
  };
}

const view = (label: string) => ({
  name: 'case_grid',
  label,
  object: 'case',
  columns: [{ field: 'name' }],
});

describe('#13997 — authoredAt is canonical ISO-8601 text, whatever the dialect materialised', () => {
  let engine: ReturnType<typeof makeFakeEngine>;
  let repo: SysMetadataRepository;
  const ref = { org: 'org_alpha', type: 'view' as const, name: 'case_grid' };

  beforeEach(() => {
    engine = makeFakeEngine();
    repo = new SysMetadataRepository({
      engine,
      organizationId: 'org_alpha',
      orgLabel: 'org_alpha',
    });
  });

  describe('§A get() — the builtin audit columns, via rowToItem', () => {
    it('emits a canonical ISO string when the row carries a JS Date', async () => {
      await repo.put(ref, view('A'), { parentVersion: null, actor: 'usr_1' });

      // Restate the row the way Postgres/MySQL hand it out. Mutating the
      // stored row rather than the returned copy is what makes the READ path
      // — the adapter under test — see the `Date`.
      const stored = Array.from(engine.rows.values())[0]!;
      stored.updated_at = PG_INSTANT;
      stored.created_at = PG_INSTANT;

      // Non-vacuity guard: if the fixture ever degrades to a string this file
      // would keep passing while testing the shape that was never broken.
      expect(stored.updated_at).toBeInstanceOf(Date);

      const item = await repo.get(ref);
      expect(item).not.toBeNull();

      expect(typeof item!.authoredAt).toBe('string');
      expect(item!.authoredAt).toMatch(ISO_Z);
      expect(item!.authoredAt).toBe(PG_INSTANT.toISOString());

      // The declared contract itself, evaluated against a driver-shaped input.
      const parsed = MetadataItemSchema.safeParse(item);
      expect(parsed.success).toBe(true);
    });

    it('passes an already-canonical SQLite string through byte-identically', async () => {
      await repo.put(ref, view('A'), { parentVersion: null, actor: 'usr_1' });

      const canonical = '2026-03-04T05:06:07.089Z';
      const stored = Array.from(engine.rows.values())[0]!;
      stored.updated_at = canonical;

      expect(typeof stored.updated_at).toBe('string');

      const item = await repo.get(ref);
      // Idempotent: the dialect that was already correct must not be reshaped.
      expect(item!.authoredAt).toBe(canonical);
    });
  });

  describe('§B getByHash() — recorded_at, a declared Field.datetime', () => {
    it('emits a canonical ISO string when the history row carries a JS Date', async () => {
      const put = await repo.put(ref, view('A'), { parentVersion: null, actor: 'usr_1' });
      const hash = put.version;

      const historyRow = engine.historyRows[0]!;
      historyRow.recorded_at = PG_INSTANT;

      // Same non-vacuity guard as §A, for the other column and the other door.
      expect(historyRow.recorded_at).toBeInstanceOf(Date);

      const item = await repo.getByHash(ref, hash);
      expect(item).not.toBeNull();

      expect(typeof item!.authoredAt).toBe('string');
      expect(item!.authoredAt).toMatch(ISO_Z);
      expect(item!.authoredAt).toBe(PG_INSTANT.toISOString());

      const parsed = MetadataItemSchema.safeParse(item);
      expect(parsed.success).toBe(true);
    });
  });
});
