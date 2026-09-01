// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect, vi } from 'vitest';
import { LifecycleService, assertEngineDeleteDispatch } from '@objectstack/objectql';
import {
  inventoryStrandedFileOrphans,
  formatStrandedOrphanInventory,
  formatBytes,
} from './stranded-orphan-inventory.js';
import { createSysFileReapGuard, findFileHolder } from './attachment-lifecycle.js';
import { SystemFile } from './objects/system-file.object.js';

const silentLogger = () => ({ info: vi.fn(), warn: vi.fn(), debug: vi.fn() });

/**
 * WHERE matcher for the doubles below. It supports exactly the operators the
 * code under test emits — equality, `$and`, `$gt` (the keyset cursor) and
 * `$lt` (lifecycle cutoffs) — and THROWS on anything else, which is the
 * conforming shape this repo asks of a driver double: a double that silently
 * ignores an operator it does not know answers a narrower question with a
 * wider row set, and the test still passes.
 */
function matches(row: Record<string, unknown>, where: unknown): boolean {
  if (where == null) return true;
  if (typeof where !== 'object') throw new Error(`double: unsupported where ${String(where)}`);
  for (const [k, v] of Object.entries(where as Record<string, unknown>)) {
    if (k === '$and') {
      if (!Array.isArray(v)) throw new Error('double: $and expects an array');
      if (!v.every((clause) => matches(row, clause))) return false;
      continue;
    }
    if (k.startsWith('$')) throw new Error(`double: unsupported combinator ${k}`);
    if (v !== null && typeof v === 'object') {
      const ops = Object.entries(v as Record<string, unknown>);
      for (const [op, operand] of ops) {
        const cell = row[k];
        if (op === '$gt') {
          if (!(cell != null && String(cell) > String(operand))) return false;
        } else if (op === '$lt') {
          if (!(cell != null && String(cell) < String(operand))) return false;
        } else {
          throw new Error(`double: unsupported operator ${op} on ${k}`);
        }
      }
      continue;
    }
    if ((row[k] ?? null) !== (v ?? null)) return false;
  }
  return true;
}

/** Engine members the inventory is allowed to touch. Everything else is a write. */
const READ_ONLY_SURFACE = new Set(['find', 'tables', 'finds', 'then']);

/**
 * Read-only engine double.
 *
 * The double declares `find` and NOTHING else, and a Proxy throws on any other
 * member access. That is deliberately stronger than stubbing the write verbs I
 * happened to think of: `update`, `insert`, `delete`, `updateMany`,
 * `deleteMany`, `execute` and anything added later all fail the same way, so
 * the read-only claim is enforced against the whole engine surface rather than
 * against a list. Every case in this file runs through it, so "this pass writes
 * nothing" is a property the suite holds continuously, not one asserted once.
 *
 * (`then` is allowed through because awaiting a value probes it.)
 */
function inventoryEngine(seed: {
  files?: Array<Record<string, unknown>>;
  attachments?: Array<Record<string, unknown>>;
}) {
  const tables: Record<string, Array<Record<string, unknown>>> = {
    sys_file: [...(seed.files ?? [])],
    sys_attachment: [...(seed.attachments ?? [])],
  };
  const finds: Array<{ object: string; where: unknown }> = [];
  const engine = {
    tables,
    finds,
    async find(object: string, options: any) {
      finds.push({ object, where: options?.where });
      const table = tables[object];
      if (!table) throw new Error(`double: unknown object ${object}`);
      let rows = table.filter((r) => matches(r, options?.where));
      const orderBy = options?.orderBy?.[0];
      if (orderBy) {
        rows = [...rows].sort((a, b) => String(a[orderBy.field]).localeCompare(String(b[orderBy.field])));
      }
      return typeof options?.limit === 'number' ? rows.slice(0, options.limit) : rows;
    },
  };
  return new Proxy(engine, {
    get(target, prop, receiver) {
      if (typeof prop === 'string' && !READ_ONLY_SURFACE.has(prop)) {
        throw new Error(
          `READ-ONLY VIOLATION: the inventory reached for engine.${prop} — this pass may only read`,
        );
      }
      return Reflect.get(target, prop, receiver);
    },
  });
}

/** An attachments-scope file in the pre-fix terminal state (the leak). */
const strandedRow = (id: string, extra: Record<string, unknown> = {}) => ({
  id,
  key: `attachments/${id}.bin`,
  name: `${id}.bin`,
  size: 1024,
  scope: 'attachments',
  status: 'committed',
  deleted_at: null,
  ref_object: null,
  ref_id: null,
  created_at: '2026-01-01T00:00:00.000Z',
  ...extra,
});

describe('inventoryStrandedFileOrphans — the population', () => {
  it('counts an attachments-scope file with no join row and no ref_* owner', async () => {
    const engine = inventoryEngine({ files: [strandedRow('f1')] });

    const report = await inventoryStrandedFileOrphans(engine);

    expect(report.scope).toBe('attachments');
    expect(report.stranded).toBe(1);
    expect(report.strandedBytes).toBe(1024);
    expect(report.bytesAreLowerBound).toBe(false);
    expect(report.samples).toEqual([
      {
        fileId: 'f1',
        key: 'attachments/f1.bin',
        name: 'f1.bin',
        size: 1024,
        createdAt: '2026-01-01T00:00:00.000Z',
      },
    ]);
  });

  it('⛔ EXCLUDES a file with ZERO join rows that is ref_*-owned — the case a weaker question gets wrong', async () => {
    // This is the difference between an inventory that is safe to act on and a
    // list of LIVE files to delete. The file has no `sys_attachment` row at
    // all, so any count built on join rows alone reports it as an orphan; it
    // is owned through the ADR-0104 ownership columns and is in active use.
    const engine = inventoryEngine({
      files: [
        strandedRow('f_owned', { ref_object: 'product', ref_id: 'rec_1' }),
        strandedRow('f_real'),
      ],
      attachments: [],
    });

    const report = await inventoryStrandedFileOrphans(engine);

    expect(report.heldByFieldOwner).toBe(1);
    expect(report.stranded).toBe(1);
    expect(report.samples.map((s) => s.fileId)).toEqual(['f_real']);
    // …and its bytes are not in the magnitude a destructive step 2 would size.
    expect(report.strandedBytes).toBe(1024);
  });

  it('excludes a file a join row still points at', async () => {
    const engine = inventoryEngine({
      files: [strandedRow('f_held'), strandedRow('f_free')],
      attachments: [{ id: 'a1', file_id: 'f_held' }],
    });

    const report = await inventoryStrandedFileOrphans(engine);

    expect(report.heldByAttachment).toBe(1);
    expect(report.stranded).toBe(1);
    expect(report.samples.map((s) => s.fileId)).toEqual(['f_free']);
  });

  it('excludes rows outside the attachments scope and rows the sweep can already nominate', async () => {
    const engine = inventoryEngine({
      files: [
        strandedRow('f_ok'),
        // Other scopes: governed by the field-reference seam, not by join rows.
        strandedRow('f_user', { scope: 'user' }),
        strandedRow('f_tenant', { scope: 'tenant' }),
        // Already tombstoned → the TTL nominates it; not stranded.
        strandedRow('f_tomb', { status: 'deleted', deleted_at: '2026-02-01T00:00:00.000Z' }),
        // A committed row carrying a stray deleted_at is STILL ttl-nominable,
        // because the ttl policy keys on the field, not on the status.
        strandedRow('f_halfstate', { deleted_at: '2026-02-01T00:00:00.000Z' }),
        // Never-completed upload → the retention policy nominates it.
        strandedRow('f_pending', { status: 'pending' }),
      ],
    });

    const report = await inventoryStrandedFileOrphans(engine);

    expect(report.stranded).toBe(1);
    expect(report.samples.map((s) => s.fileId)).toEqual(['f_ok']);
    expect(report.alreadyOnTtlPath).toBe(1); // f_halfstate — f_tomb/f_pending never pass the status filter
    expect(report.filesScanned).toBe(2); // f_ok + f_halfstate
  });

  it('counts BOTH legacy classes — they share one terminal state, so one predicate enumerates them', async () => {
    // Pre-#10240 (delete verb): the join row was deleted and no tombstone was
    // written. Pre-#10171 (update verb): a surviving join row was re-pointed
    // at another file and the prior file was left behind. Both leave the SAME
    // row shape, and the data records no provenance — so a complete count is a
    // count of the terminal state, and the two cannot be split by verb.
    const engine = inventoryEngine({
      files: [
        strandedRow('f_delete_verb'),
        strandedRow('f_update_verb'),
        // the file the surviving join row was re-pointed AT — still live
        strandedRow('f_repointed_target'),
      ],
      attachments: [{ id: 'a_survivor', file_id: 'f_repointed_target' }],
    });

    const report = await inventoryStrandedFileOrphans(engine);

    expect(report.stranded).toBe(2);
    expect(report.samples.map((s) => s.fileId).sort()).toEqual(['f_delete_verb', 'f_update_verb']);
    expect(report.heldByAttachment).toBe(1);
  });

  it('every scanned row lands in exactly one bucket', async () => {
    const engine = inventoryEngine({
      files: [
        strandedRow('f1'),
        strandedRow('f2'),
        strandedRow('f_owned', { ref_object: 'product', ref_id: 'r1' }),
        strandedRow('f_held'),
        strandedRow('f_halfstate', { deleted_at: '2026-02-01T00:00:00.000Z' }),
      ],
      attachments: [{ id: 'a1', file_id: 'f_held' }],
    });

    const r = await inventoryStrandedFileOrphans(engine);

    expect(r.alreadyOnTtlPath + r.heldByAttachment + r.heldByFieldOwner + r.stranded).toBe(r.filesScanned);
    expect(r.filesScanned).toBe(5);
  });
});

describe('inventoryStrandedFileOrphans — byte magnitude', () => {
  it('sums recorded sizes', async () => {
    const engine = inventoryEngine({
      files: [strandedRow('f1', { size: 1000 }), strandedRow('f2', { size: 2_500_000 })],
    });

    const report = await inventoryStrandedFileOrphans(engine);

    expect(report.strandedBytes).toBe(2_501_000);
    expect(report.strandedRowsWithoutSize).toBe(0);
    expect(report.bytesAreLowerBound).toBe(false);
  });

  it('flags the total as a LOWER BOUND when a stranded row carries no usable size', async () => {
    // Silently treating a missing size as zero would under-report the leak and
    // read as a precise figure.
    const engine = inventoryEngine({
      files: [
        strandedRow('f1', { size: 512 }),
        strandedRow('f_nosize', { size: null }),
        strandedRow('f_bogus', { size: 'not-a-number' }),
        strandedRow('f_negative', { size: -5 }),
      ],
    });

    const report = await inventoryStrandedFileOrphans(engine);

    expect(report.stranded).toBe(4);
    expect(report.strandedBytes).toBe(512);
    expect(report.strandedRowsWithoutSize).toBe(3);
    expect(report.bytesAreLowerBound).toBe(true);
    expect(formatStrandedOrphanInventory(report)).toContain('LOWER BOUND');
  });

  it('reads a numeric size that a driver handed back as a string', async () => {
    const engine = inventoryEngine({ files: [strandedRow('f1', { size: '2048' })] });

    const report = await inventoryStrandedFileOrphans(engine);

    expect(report.strandedBytes).toBe(2048);
    expect(report.bytesAreLowerBound).toBe(false);
  });
});

describe('inventoryStrandedFileOrphans — bounds and honesty', () => {
  it('reports a truncated walk rather than passing a partial count off as the population', async () => {
    const engine = inventoryEngine({
      files: Array.from({ length: 10 }, (_, i) => strandedRow(`f${String(i).padStart(2, '0')}`)),
    });

    const report = await inventoryStrandedFileOrphans(engine, { maxCandidates: 4 });

    expect(report.truncated).toBe(true);
    expect(report.stranded).toBe(4);
    expect(formatStrandedOrphanInventory(report)).toContain('LOWER BOUND');
  });

  it('does not report truncation when the walk read everything', async () => {
    const engine = inventoryEngine({ files: [strandedRow('f1'), strandedRow('f2')] });

    const report = await inventoryStrandedFileOrphans(engine, { maxCandidates: 500 });

    expect(report.truncated).toBe(false);
    expect(report.stranded).toBe(2);
  });

  it('honours the sample bound while still counting every row', async () => {
    const engine = inventoryEngine({
      files: Array.from({ length: 7 }, (_, i) => strandedRow(`f${i}`)),
    });

    const report = await inventoryStrandedFileOrphans(engine, { sampleLimit: 2 });

    expect(report.stranded).toBe(7);
    expect(report.samples).toHaveLength(2);
  });

  it('⛔ writes nothing — every write seam on the double throws', async () => {
    const engine = inventoryEngine({
      files: [strandedRow('f1'), strandedRow('f_owned', { ref_object: 'p', ref_id: 'r' })],
      attachments: [{ id: 'a1', file_id: 'f_other' }],
    });

    await expect(inventoryStrandedFileOrphans(engine)).resolves.toMatchObject({ stranded: 1 });

    // Only reads reached the engine, and only against the two system objects.
    expect(new Set(engine.finds.map((f) => f.object))).toEqual(new Set(['sys_file', 'sys_attachment']));
  });

  it('an empty deployment reports zero without claiming anything else', async () => {
    const report = await inventoryStrandedFileOrphans(inventoryEngine({}));

    expect(report).toMatchObject({ filesScanned: 0, stranded: 0, strandedBytes: 0, truncated: false });
    const text = formatStrandedOrphanInventory(report);
    expect(text).toContain('No stranded attachments-scope orphans');
    expect(text).toContain('READ-ONLY');
  });

  it('names its scope in the rendered report, so the total cannot be read as "all orphans"', async () => {
    const report = await inventoryStrandedFileOrphans(inventoryEngine({ files: [strandedRow('f1')] }));

    const text = formatStrandedOrphanInventory(report);
    expect(text).toContain('attachments-scope');
    expect(text).toContain('the other scopes');
  });
});

describe('formatBytes', () => {
  it('renders magnitudes an operator can act on', () => {
    expect(formatBytes(0)).toBe('0 B');
    expect(formatBytes(999)).toBe('999 B');
    expect(formatBytes(1024)).toBe('1.0 KiB');
    expect(formatBytes(5 * 1024 * 1024)).toBe('5.0 MiB');
    expect(formatBytes(3 * 1024 ** 3)).toBe('3.0 GiB');
  });
});

/* ────────────────────────────────────────────────────────────────────────────
 * The ownership question is the reap guard's own — not a copy of it
 * ──────────────────────────────────────────────────────────────────────────── */

describe('the inventory asks the reap guard question, at full strength', () => {
  it('the guard and the inventory reach the same verdict on the same ref_*-owned row', async () => {
    // One fact — "zero join rows, but the ref_* columns name an owner" — and
    // two consumers. The guard must VETO (un-tombstone, reclaim nothing); the
    // inventory must EXCLUDE (not an orphan). If these ever disagree, the
    // inventory's number is sizing a delete the guard would refuse.
    const owned = strandedRow('f_owned', { ref_object: 'product', ref_id: 'rec_1' });

    const inventory = await inventoryStrandedFileOrphans(inventoryEngine({ files: [owned] }));
    expect(inventory.stranded).toBe(0);
    expect(inventory.heldByFieldOwner).toBe(1);

    const guardEngine = {
      async find() {
        return [];
      },
      async findOne() {
        return null;
      },
      update: vi.fn(async () => ({})),
    } as any;
    const storage = { delete: vi.fn(async () => {}) };
    const guard = createSysFileReapGuard(guardEngine, () => storage as any, silentLogger(), async () => true);

    const confirmed = await guard('sys_file', [{ ...owned, status: 'deleted', deleted_at: '2026-02-01T00:00:00.000Z' }]);

    expect(confirmed).toEqual([]); // vetoed
    expect(storage.delete).not.toHaveBeenCalled(); // no bytes reclaimed
    expect(guardEngine.update).toHaveBeenCalledTimes(1); // un-tombstoned
  });

  it('findFileHolder names the surface, and a join row wins over the columns', async () => {
    const engine = { async find() { return [{ id: 'a1' }]; } } as any;
    expect(await findFileHolder(engine, 'f1', { ref_object: 'p', ref_id: 'r' })).toBe('attachment');

    const empty = { async find() { return []; } } as any;
    expect(await findFileHolder(empty, 'f1', { ref_object: 'p', ref_id: 'r' })).toBe('field-owner');
    expect(await findFileHolder(empty, 'f1', {})).toBe(null);
    // A recorded object with an EMPTY record id is not an owner — the guard's
    // long-standing reading, preserved.
    expect(await findFileHolder(empty, 'f1', { ref_object: 'p', ref_id: '' })).toBe(null);
  });
});

/* ────────────────────────────────────────────────────────────────────────────
 * The premise, through the real LifecycleService
 *
 * The whole card rests on one claim: a stranded orphan matches NEITHER
 * declared policy, so the platform sweep never nominates it and the reap guard
 * is never asked about it. Asserting that against a fake would be circular, so
 * these cases drive the real `LifecycleService` against the real `sys_file`
 * lifecycle declaration and observe which rows a guard is actually handed.
 * ──────────────────────────────────────────────────────────────────────────── */

const FIXED_NOW = Date.parse('2026-08-23T00:00:00.000Z');
const daysAgo = (n: number) => new Date(FIXED_NOW - n * 86_400_000).toISOString();

function sweepEngine(files: Array<Record<string, unknown>>) {
  const store = new Map(files.map((f) => [String(f.id), { ...f }]));
  const engine: any = {
    registry: {
      getAllObjects: () => [{ name: 'sys_file', lifecycle: (SystemFile as any).lifecycle }],
    },
    async find(_object: string, options: any) {
      const rows = Array.from(store.values()).filter((r) => matches(r, options?.where));
      return typeof options?.limit === 'number' ? rows.slice(0, options.limit) : rows;
    },
    async delete(_object: string, options: any) {
      // Pinned to the real dispatch predicate: the reaper's per-id delete must
      // be a shape `ObjectQL.delete` actually accepts, or this double would be
      // proving nomination against a call the engine refuses.
      assertEngineDeleteDispatch(options);
      const id = String((options?.where as any)?.id);
      const had = store.delete(id);
      return { deletedCount: had ? 1 : 0 };
    },
    getDriverForObject: () => ({}),
    datasource: () => ({}),
  };
  return { engine, store };
}

describe("[#10950] the sweep cannot nominate a stranded orphan — the card's premise", () => {
  it('is the real lifecycle declaration under test', () => {
    const lc = (SystemFile as any).lifecycle;
    expect(lc.ttl).toEqual({ field: 'deleted_at', expireAfter: '30d' });
    expect(lc.retention).toEqual({ maxAge: '7d', onlyWhen: { status: 'pending' } });
  });

  it('hands the guard the tombstoned and the pending rows, and NEVER the stranded orphan', async () => {
    const { engine } = sweepEngine([
      // The subject: orphaned before the forward-only fixes, never tombstoned.
      strandedRow('f_stranded', { created_at: daysAgo(400) }),
      // Tombstoned orphan, past the 30d TTL → ttl policy nominates it.
      strandedRow('f_tomb', { status: 'deleted', deleted_at: daysAgo(60), created_at: daysAgo(400) }),
      // Never-completed upload, past 7d → retention policy nominates it.
      strandedRow('f_pending', { status: 'pending', created_at: daysAgo(400) }),
    ]);

    const seen: string[] = [];
    const service = new LifecycleService({
      getEngine: () => engine,
      logger: silentLogger(),
      now: () => FIXED_NOW,
      initialDelayMs: 1,
      sweepIntervalMs: 10,
    } as any);
    service.registerReapGuard('sys_file', async (_object, rows) => {
      for (const r of rows) seen.push(String(r.id));
      return []; // veto everything: this test observes nomination, not reaping
    });

    await service.sweep();

    expect(seen.sort()).toEqual(['f_pending', 'f_tomb']);
    expect(seen).not.toContain('f_stranded');
  });

  it('and age does not help it — a stranded orphan is still not a candidate years later', async () => {
    const { engine } = sweepEngine([strandedRow('f_stranded', { created_at: daysAgo(3650) })]);

    const seen: string[] = [];
    const service = new LifecycleService({
      getEngine: () => engine,
      logger: silentLogger(),
      now: () => FIXED_NOW,
      initialDelayMs: 1,
      sweepIntervalMs: 10,
    } as any);
    service.registerReapGuard('sys_file', async (_object, rows) => {
      for (const r of rows) seen.push(String(r.id));
      return [];
    });

    await service.sweep();

    expect(seen).toEqual([]);
    // …while the inventory finds exactly that row. The leak is real and the
    // pass measures it.
    const report = await inventoryStrandedFileOrphans(
      inventoryEngine({ files: [strandedRow('f_stranded', { created_at: daysAgo(3650) })] }),
    );
    expect(report.stranded).toBe(1);
  });
});
// ── [#13996] `createdAt` across the dialect divergence ──────────────────────

/**
 * What `samples[].createdAt` is, per runtime shape of `created_at`.
 *
 * ## Why this file could not have caught the defect before
 *
 * `created_at` is a BUILTIN audit column, so no declared-field coercion
 * reaches it and `SqlDriver#formatOutput` repairs it only inside its
 * `if (this.isSqlite)` arm. The record read door therefore hands it back as
 * canonical ISO-Z TEXT on SQLite and as a JS `Date` on Postgres and MySQL —
 * pinned at that door, per dialect, in driver-sql's
 * `sql-driver-13567-audit-stamp-materialisation.test.ts` (§B0/§B1).
 *
 * ⚠️ This repo's default test backend is SQLite, and every fixture above
 * spells `created_at` as an ISO STRING — the one shape the old
 * `typeof row.created_at === 'string'` guard accepted. So the guard dropped
 * the field for every row on both production default drivers while every pin
 * here stayed green. The discriminating input is a `Date`, and until this
 * block nothing in this file produced one.
 *
 * ## What each case is worth as evidence
 *
 * - POSITIVE is the only case that changes verdict with the repair: red
 *   before it (`undefined`), green after.
 * - CONTROL is a declared REGRESSION CONTROL and ⛔ NOT ablation evidence:
 *   it is green in both directions by construction, because the SQLite shape
 *   already worked. It exists to pin that the repair added an accepted shape
 *   and changed nothing about the one that already round-tripped.
 * - REVERSE CONTROL guards the `String(…)` trap: the arm that makes the
 *   `occurred_at` shape work for a non-optional field would spell the literal
 *   `"undefined"` / `"Invalid Date"` into an operator's report here.
 */
describe('[#13996] `samples[].createdAt` — the driver-dependent runtime type of `created_at`', () => {
  /** Canonical audit-timestamp text: what SQLite stores and `toISOString()` emits. */
  const ISO_Z = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
  /** Sub-second digits are load-bearing — `String(Date)` drops exactly these. */
  const INSTANT = '2026-08-30T10:19:25.947Z';

  it('POSITIVE — a JS `Date` (the Postgres/MySQL shape) is reported as canonical ISO-Z text', async () => {
    const engine = inventoryEngine({
      files: [strandedRow('os13996_pg', { created_at: new Date(INSTANT) })],
    });

    const report = await inventoryStrandedFileOrphans(engine);

    expect(report.stranded).toBe(1);
    expect(report.samples).toHaveLength(1);
    const sample = report.samples[0];
    // The whole defect, in one assertion: this was `undefined` for EVERY row
    // on both live dialects, for a field the walk explicitly projects.
    expect(
      sample.createdAt,
      'the driver handed `created_at` out as a Date and the sample dropped it',
    ).toBe(INSTANT);
    expect(typeof sample.createdAt).toBe('string');
    expect(sample.createdAt).toMatch(ISO_Z);
  });

  it('POSITIVE — it is the `toISOString()` spelling, not `String(Date)`: the milliseconds survive', async () => {
    const value = new Date(INSTANT);
    expect(value.getMilliseconds(), 'the fixture is vacuous without sub-second digits').toBe(947);

    const report = await inventoryStrandedFileOrphans(
      inventoryEngine({ files: [strandedRow('os13996_ms', { created_at: value })] }),
    );
    const spelled = report.samples[0].createdAt as string;

    // `String(Date)` renders whole seconds in the PROCESS zone (§A2 of the
    // driver pin). Naming the instant exactly is what separates the two.
    expect(Date.parse(spelled), 'the reported stamp names the row instant').toBe(value.getTime());
    expect(spelled).not.toBe(String(value));
    expect(Date.parse(String(value))).toBe(value.getTime() - value.getMilliseconds());
  });

  it('CONTROL (⛔ not ablation evidence — green both directions) — an ISO string is passed through byte-for-byte', async () => {
    // The SQLite shape, which already worked. Asserted as the WHOLE sample so
    // a change to any neighbouring field would show up here too.
    const report = await inventoryStrandedFileOrphans(
      inventoryEngine({ files: [strandedRow('os13996_sqlite')] }),
    );

    expect(report.samples).toEqual([
      {
        fileId: 'os13996_sqlite',
        key: 'attachments/os13996_sqlite.bin',
        name: 'os13996_sqlite.bin',
        size: 1024,
        createdAt: '2026-01-01T00:00:00.000Z',
      },
    ]);
  });

  it('CONTROL — passthrough is TOTAL over strings: a non-canonical stamp is not re-parsed or re-spelled', async () => {
    // Today any string reaches the report unchanged, including a naive-UTC
    // spelling. The repair adds an accepted shape; it must not quietly start
    // validating or normalising the shape that already round-tripped.
    for (const text of ['2026-01-01 00:00:00', 'not-a-timestamp', '']) {
      const report = await inventoryStrandedFileOrphans(
        inventoryEngine({ files: [strandedRow('os13996_text', { created_at: text })] }),
      );
      expect(report.samples[0].createdAt, `passthrough of ${JSON.stringify(text)}`).toBe(text);
    }
  });

  it('REVERSE CONTROL — an absent, null or unusable stamp stays `undefined`, never a spelled-out one', async () => {
    const absent = strandedRow('os13996_absent');
    delete (absent as Record<string, unknown>).created_at;

    const cases: Array<[string, Record<string, unknown>]> = [
      ['absent', absent],
      ['null', strandedRow('os13996_null', { created_at: null })],
      // `instanceof Date` is TRUE for this one, and `toISOString()` THROWS on
      // it — the case that would take the whole inventory down.
      ['Invalid Date', strandedRow('os13996_nat', { created_at: new Date('not a date') })],
      // Epoch millis: a shape no dialect produces here, kept `undefined`
      // rather than stringified into a timestamp position.
      ['epoch millis', strandedRow('os13996_num', { created_at: Date.parse(INSTANT) })],
    ];

    for (const [label, row] of cases) {
      const report = await inventoryStrandedFileOrphans(inventoryEngine({ files: [row] }));

      expect(report.stranded, `${label}: the row is still inventoried`).toBe(1);
      const sample = report.samples[0];
      expect(sample.createdAt, `${label}: an absent stamp must stay absent`).toBeUndefined();
      // Spelled out explicitly: these two strings are what a bare `String(…)`
      // terminal arm would put where an operator reads a timestamp.
      expect(sample.createdAt).not.toBe('Invalid Date');
      expect(sample.createdAt).not.toBe('undefined');
      // …and dropping the stamp must not drop the row's identity with it.
      expect(sample.fileId, `${label}: fileId`).toBe(row.id);
    }
  });
});
