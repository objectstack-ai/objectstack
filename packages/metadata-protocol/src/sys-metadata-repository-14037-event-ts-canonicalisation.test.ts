// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#14037] `MetadataEvent.ts` is declared `z.string()` — `rowToEvent`, the
 * adapter that asserts that declared type over a driver row, must
 * canonicalise what the live dialects actually hand it: a JS `Date`.
 *
 * ## The defect
 *
 * `rowToEvent` reached `ts` through `(row.recorded_at as string) ?? new
 * Date(0).toISOString()`. `row` is `any`, so tsc saw a `string` assignment
 * that never happened, and the `??` fires only on nullish — a `Date` walks
 * straight past it into the declared field.
 *
 * `recorded_at` is a declared `Field.datetime` on `sys_metadata_history`, and
 * when this landed that did NOT protect it: `SqlDriver#formatOutput` folded
 * declared datetime columns (`normalizeSqliteDatetimeOutput`) only inside its
 * `if (this.isSqlite)` arm. #13973 ([ADR-0053 D-F1]) has since lifted that fold
 * out of the gate — it runs on every dialect — and the pin that recorded the
 * asymmetry now records the canonical-text contract
 * (`packages/drivers/driver-sql/src/sql-driver-13567-audit-stamp-materialisation.test.ts`
 * §B, inverted on purpose).
 *
 * ⚠️ `withPostgresCalendarDayAsText` is untouched by that ruling and still
 * leaves `timestamptz` / `timestamp` deliberately alone ([ADR-0053 D-F2]) — the
 * client still hands back a `Date`; the driver folds it at its own read
 * boundary now. And the `Date` this file plants stays reachable: an INVALID
 * `Date` leaves `driver-sql` unchanged ([ADR-0053 D-F3]) and non-SQL drivers
 * materialise their own, so what is pinned below is a live adapter arm.
 *
 * ## Why it matters downstream, not just as a type
 *
 * The value's one in-repo reader is `MetadataManager.applyRepoEvent`, which
 * forwards it verbatim to `MetadataWatchEvent.timestamp` — declared
 * `z.string().datetime()` in `packages/spec/src/system/metadata-persistence.zod.ts`.
 * So the wrong shape does not stop at this package's boundary; it is carried
 * into a field whose refinement a `Date` fails outright.
 *
 * ## Why the fixture drives a hand-made `Date`
 *
 * The trap the #13997 sibling in this directory names: a fixture built from a
 * hand-made ISO string is already the declared shape before the adapter runs,
 * so the assertion and the input share an identity and the case measures
 * nothing. Every case here plants the one shape the live dialects produce, and
 * carries a non-vacuity guard that the planted value really is a `Date`.
 *
 * ⛔ No driver dependency: `@objectstack/metadata-protocol` has none and must
 * not grow one — the layering runs the other way.
 *
 * ## What is asserted
 *
 * `MetadataEventSchema` itself (`@objectstack/metadata-core`), not a
 * hand-rolled regex standing in for it.
 *
 * §C WAS the #14078 neutrality pin — "an Invalid `Date` must reach the
 * consumer UNCHANGED, exactly as this cast passes it through" — written to go
 * red the moment anyone swapped the shared spelling into this site. #16422
 * made that swap DELIBERATELY, so §C is rewritten as the RULED pin rather
 * than kept or deleted: it now asserts the terminal value the ruling chose,
 * and it still goes red if anyone reverts to the pass-through, because the
 * shape that reaches `MetadataEvent.ts` under that spelling is a `Date`
 * object in a field declared `z.string()`.
 *
 * ⚠️ The rewrite is the point, not a formality. The neutrality pin existed so
 * the swap could not happen by accident; its evidence — the seven-input
 * before/after matrix in #16422's PR — is what discharges it. `rowToEvent`
 * now reads `canonicalIsoInstant(row.recorded_at) ?? new Date(0).toISOString()`,
 * the same spelling and the same terminal value `history()` already used for
 * `authoredAt` off this very column.
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
  MetadataEventSchema,
} from '@objectstack/metadata-core';
import { SysMetadataRepository } from './sys-metadata-repository.js';

interface Row {
  [k: string]: unknown;
}

/** Canonical instant text — exactly what `Date.prototype.toISOString` emits. */
const ISO_Z = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

/**
 * The instant every case drives, as Postgres and MySQL hand it out. Non-zero
 * milliseconds on purpose — `String(date)` and `date.toString()` both drop
 * them, so a truncating regression stays observable rather than coinciding
 * with the canonical text.
 */
const PG_INSTANT = new Date('2026-03-04T05:06:07.089Z');

/** What SQLite hands out for the same instant — already the declared shape. */
const SQLITE_TEXT = '2026-03-04T05:06:07.089Z';

/**
 * Minimal engine fake — the same shape the #13997 sibling in this directory
 * uses. Stores exactly what it is handed, so a `Date` planted in a row
 * survives to the read door the way a live driver's would.
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
    async find(table: string, opts: { where: Record<string, unknown>; limit?: number }) {
      const matched =
        table === 'sys_metadata_history'
          ? historyRows.filter((h) => matchesHistory(h, opts.where))
          : Array.from(rows.values()).filter((r) => {
              if (opts.where.type && r.type !== opts.where.type) return false;
              if (
                opts.where.organization_id !== undefined &&
                r.organization_id !== opts.where.organization_id
              )
                return false;
              if (opts.where.state && r.state !== opts.where.state) return false;
              return true;
            });
      // Hold the caller's bound, AFTER the filter and by PRESENCE — a double
      // that silently ignores `limit` answers more rows than the real engine
      // would, which is the shape `check:objectql-double-limit` exists to stop.
      return typeof opts?.limit === 'number' ? matched.slice(0, opts.limit) : matched;
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

describe('#14037 — MetadataEvent.ts is canonical ISO text, whatever the dialect materialised', () => {
  let engine: ReturnType<typeof makeFakeEngine>;
  let repo: SysMetadataRepository;
  const ref = { org: 'org_alpha', type: 'view' as const, name: 'case_grid' };

  const firstEvent = async () => {
    for await (const evt of repo.history(ref)) return evt;
    return null;
  };

  beforeEach(async () => {
    engine = makeFakeEngine();
    repo = new SysMetadataRepository({
      engine,
      organizationId: 'org_alpha',
      orgLabel: 'org_alpha',
    });
    await repo.put(ref, view('A'), { parentVersion: null, actor: 'usr_1' });
  });

  describe('§A history() — recorded_at, a declared Field.datetime', () => {
    it('emits a canonical ISO string when the history row carries a JS Date', async () => {
      const historyRow = engine.historyRows[0]!;
      historyRow.recorded_at = PG_INSTANT;

      // Non-vacuity guard: a fixture that silently degraded to a string would
      // keep this file green while measuring nothing.
      expect(historyRow.recorded_at).toBeInstanceOf(Date);

      const evt = await firstEvent();
      expect(evt).not.toBeNull();

      expect(typeof evt!.ts).toBe('string');
      expect(evt!.ts).toMatch(ISO_Z);
      expect(evt!.ts).toBe(PG_INSTANT.toISOString());

      // The declared contract itself, evaluated against a driver-shaped input.
      const parsed = MetadataEventSchema.safeParse(evt);
      expect(parsed.success).toBe(true);
    });

    it('passes an already-canonical SQLite string through byte-identically', async () => {
      engine.historyRows[0]!.recorded_at = SQLITE_TEXT;

      const evt = await firstEvent();

      // Idempotent: the dialect that was already correct must not be reshaped.
      expect(evt!.ts).toBe(SQLITE_TEXT);
    });
  });

  describe('§B the nullish arm keeps its meaning', () => {
    it('still falls back to the epoch when the column is absent', async () => {
      delete engine.historyRows[0]!.recorded_at;

      const evt = await firstEvent();

      expect(evt!.ts).toBe(new Date(0).toISOString());
    });
  });

  describe('§C [#16422] RULED — an Invalid Date takes the epoch, the branch an absent column takes', () => {
    /**
     * This section was the #14078 NEUTRALITY pin: it asserted that this site
     * hands an Invalid `Date` through UNCHANGED, and it was written to go red
     * on exactly the swap #16422 then performed. It is rewritten, not
     * deleted, because the swap was deliberate and now has its own evidence.
     *
     * What the ruling decided, per call site: `rowToEvent` reads
     * `canonicalIsoInstant(row.recorded_at) ?? new Date(0).toISOString()`. An
     * Invalid `Date` folds to `undefined` — #14078's own total `Date` arm —
     * and therefore takes the `??` branch an ABSENT column already took (§B),
     * which is also the answer `history()` gives for `authoredAt` off this
     * same column.
     *
     * ⛔ Why the old behaviour could not stay: `MetadataEvent.ts` is declared
     * `z.string()` (`@objectstack/metadata-core`) and its one in-repo reader
     * forwards it to `MetadataWatchEvent.timestamp`, a `z.string().datetime()`.
     * The pass-through put a `Date` OBJECT in that field, so
     * `MetadataEventSchema` refused the event this adapter produced — asserted
     * below rather than described, by parsing the same fixture both ways.
     */
    it('answers the epoch and produces an event the declared schema accepts', async () => {
      const invalid = new Date(NaN);
      expect(Number.isNaN(invalid.getTime())).toBe(true);
      // Non-vacuity: the shape really is the one with no canonical text.
      expect(() => invalid.toISOString()).toThrow(RangeError);

      engine.historyRows[0]!.recorded_at = invalid;

      const evt = await firstEvent();

      // The ruled terminal value — the same one §B's absent column takes.
      expect(evt!.ts).toBe(new Date(0).toISOString());
      expect(typeof evt!.ts).toBe('string');

      // ⛔ And specifically NOT the retired pass-through, which is what the
      // neutrality version of this section asserted.
      expect(evt!.ts).not.toBe(invalid as unknown as string);
      expect(evt!.ts).not.toBeInstanceOf(Date);

      // The declared contract, which the pass-through could not satisfy.
      const parsed = MetadataEventSchema.safeParse(evt);
      expect(parsed.success, JSON.stringify((parsed as { error?: { issues: unknown } }).error?.issues)).toBe(true);
    });

    it('rejects the retired shape, so a revert to pass-through cannot pass silently', () => {
      // The exact object the pass-through used to emit, checked against the
      // declared schema in isolation. This is why the swap was not cosmetic.
      const passThrough = { seq: 1, op: 'update', ref, hash: null, parentHash: null,
        actor: null, ts: new Date(NaN), source: 'sys-metadata-repo' };
      expect(MetadataEventSchema.safeParse(passThrough).success).toBe(false);
    });
  });
});
