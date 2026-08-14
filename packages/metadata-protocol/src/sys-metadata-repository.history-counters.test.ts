// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #4867 — `SysMetadataRepository` never invents `event_seq` / `version` from a
 * read that failed. Same family as #4825 (`DatabaseLoader.nextEventSeq()`) and
 * #4728 (`ensureSchema()`); the log-level rule is #4632.
 *
 * Both counters used to `catch { return 1 }`, folding EVERY read failure of
 * `sys_metadata_history` into the one benign answer. The damage is not "a row
 * that never landed" but **a row that landed carrying a wrong number**, which
 * is why every assertion below is about the VALUE that reaches the table — and
 * about the table's contents AFTER the failure, since a committed transaction
 * commits a wrong number just as durably as a non-transactional insert does.
 *
 * `version` is the worse of the two: `nextItemVersion()` reads MAX from history
 * precisely "so delete + recreate continues incrementing instead of restarting
 * at 1", and a read failure restored exactly the behaviour it exists to
 * prevent — while `MetadataManager.rollback(type, name, version)` and
 * `POST /api/v1/meta/:type/:name/rollback` resolve a snapshot BY that number.
 *
 * Both directions are pinned deliberately. A suite proving only the loud half
 * would pass on a `() => false` discriminator (fresh DBs would stop booting),
 * and one proving only the benign half passes on the original defect.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
// [#5619] The producer's OWN write-verb dispatch decisions (#4550 delete /
// #5480 update), so the fake engine below cannot accept a call ObjectQL
// refuses. Imported from `@objectstack/metadata-core` and not from
// `@objectstack/objectql`: objectql DEPENDS ON this package, so that import
// would close a dependency cycle turbo rejects outright — which is why all 26
// of this package's (file, verb) pairs sat in the gate's DEBT ledger until
// #5619 sank the two predicates into a package both sides already depend on.
import { assertEngineDeleteDispatch, assertEngineUpdateDispatch } from '@objectstack/metadata-core';
import { readFileSync } from 'node:fs';
import { SysMetadataRepository } from './sys-metadata-repository.js';
import { isMissingTableError } from '@objectstack/metadata/errors';

/**
 * The discriminator is spied on, not reimplemented: every test below runs the
 * REAL `@objectstack/metadata/errors` implementation through a spy, so
 * "was the shared function consulted?" is observable without changing what it
 * answers. See the pin at the bottom of this file.
 */
vi.mock('@objectstack/metadata/errors', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@objectstack/metadata/errors')>();
  return { ...actual, isMissingTableError: vi.fn(actual.isMissingTableError) };
});

const discriminator = vi.mocked(isMissingTableError);

/** The unmocked implementation, kept so a flipped verdict can be put back. */
const { isMissingTableError: realIsMissingTableError } = await vi.importActual<
  typeof import('@objectstack/metadata/errors')
>('@objectstack/metadata/errors');

interface Row { [k: string]: unknown }

/** Benign: nothing is provisioned, so there is no row to collide with. */
const noSuchTable = () =>
  Object.assign(new Error('no such table: sys_metadata_history'), { code: 'SQLITE_ERROR' });

/** NOT benign: the rows are still there, this read just did not see them. */
const connectionReset = () =>
  Object.assign(new Error('read ECONNRESET'), { code: 'ECONNRESET' });

/**
 * Engine fake with REAL transaction semantics — a txn body that throws commits
 * nothing. That is load-bearing here rather than decorative: the claim under
 * test is "the enclosing transaction aborts instead of committing a wrong
 * number", and a fake that ignores rollback (like the other suites' fakes, which
 * do not need it) could not tell a rollback from a commit.
 *
 * Reads of the HISTORY table can be broken independently; writes and the
 * `sys_metadata` table keep working throughout, which is exactly what makes the
 * defect invisible in production.
 */
function makeFakeEngine() {
  const rows = new Map<string, Row>();
  const historyRows: Row[] = [];
  let historyReadFailure: (() => unknown) | null = null;

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
    /** Every history row that actually COMMITTED, in write order. */
    committed: () =>
      historyRows.map((h) => ({
        name: h.name,
        version: h.version,
        event_seq: h.event_seq,
        operation_type: h.operation_type,
      })),
    breakHistoryReads(makeError: () => unknown) {
      historyReadFailure = makeError;
    },
    healHistoryReads() {
      historyReadFailure = null;
    },
    async find(table: string, opts: { where: Record<string, unknown> }) {
      if (table === 'sys_metadata_history') {
        if (historyReadFailure) throw historyReadFailure();
        return historyRows.filter((h) => matchesHistory(h, opts.where));
      }
      return Array.from(rows.values()).filter((r) => {
        if (opts.where.type && r.type !== opts.where.type) return false;
        if (opts.where.organization_id !== undefined && r.organization_id !== opts.where.organization_id) return false;
        if (opts.where.state && r.state !== opts.where.state) return false;
        return true;
      });
    },
    async findOne(table: string, opts: { where: Record<string, unknown> }) {
      if (table === 'sys_metadata_history') {
        if (historyReadFailure) throw historyReadFailure();
        return historyRows.find((h) => matchesHistory(h, opts.where)) ?? null;
      }
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
      const rowsSnapshot = new Map(Array.from(rows, ([k, r]) => [k, { ...r }] as const));
      const historySnapshot = historyRows.map((h) => ({ ...h }));
      try {
        return await cb({ txn: true }, { owned: true });
      } catch (err) {
        // ACID: a txn body that throws commits nothing at all.
        rows.clear();
        for (const [k, r] of rowsSnapshot) rows.set(k, r);
        historyRows.length = 0;
        historyRows.push(...historySnapshot);
        throw err;
      }
    },
  };
}

const view = (label: string) => ({ name: 'case_grid', label, object: 'case', columns: [{ field: 'name' }] });
const otherView = (label: string) => ({ name: 'lead_grid', label, object: 'lead', columns: [{ field: 'name' }] });

describe('#4867 — history counters are never invented from a failed read', () => {
  let engine: ReturnType<typeof makeFakeEngine>;
  let repo: SysMetadataRepository;
  let errorSpy: ReturnType<typeof vi.spyOn>;
  let infoSpy: ReturnType<typeof vi.spyOn>;

  const ref = { org: 'org_alpha', type: 'view' as const, name: 'case_grid' };
  const ref2 = { org: 'org_alpha', type: 'view' as const, name: 'lead_grid' };

  beforeEach(() => {
    discriminator.mockClear();
    engine = makeFakeEngine();
    repo = new SysMetadataRepository({ engine, organizationId: 'org_alpha', orgLabel: 'org_alpha' });
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {});
  });

  afterEach(() => {
    errorSpy.mockRestore();
    infoSpy.mockRestore();
  });

  describe('the benign case — a fresh DB where the history table is not provisioned', () => {
    it('numbers BOTH counters from 1 and stays silent', async () => {
      engine.breakHistoryReads(noSuchTable);

      await repo.put(ref, view('A'), { parentVersion: null, actor: 'usr_alice' });

      // Two independently derived numbers: `version` from nextItemVersion(),
      // `event_seq` from nextEventSeq(). Both must survive a missing table.
      expect(engine.committed()).toEqual([
        { name: 'case_grid', version: 1, event_seq: 1, operation_type: 'create' },
      ]);
      expect(errorSpy).not.toHaveBeenCalled();
      expect(infoSpy).not.toHaveBeenCalled();
    });

    it('lets the metadata write itself commit — a fresh DB must still boot', async () => {
      engine.breakHistoryReads(noSuchTable);

      const result = await repo.put(ref, view('A'), { parentVersion: null, actor: null });

      expect(result.version).toBeTruthy();
      expect((await repo.get(ref))?.body).toMatchObject({ label: 'A' });
    });
  });

  describe('a REAL read failure against history that already has rows', () => {
    /** Two lineages: case_grid at version 1 and 2, lead_grid at version 1. */
    async function seedHistory(): Promise<{ caseHash: string; leadHash: string }> {
      const first = await repo.put(ref, view('A'), { parentVersion: null, actor: 'usr_alice' });
      const second = await repo.put(ref, view('B'), { parentVersion: first.version, actor: 'usr_alice' });
      const other = await repo.put(ref2, otherView('C'), { parentVersion: null, actor: 'usr_alice' });
      expect(engine.committed()).toEqual([
        { name: 'case_grid', version: 1, event_seq: 1, operation_type: 'create' },
        { name: 'case_grid', version: 2, event_seq: 2, operation_type: 'update' },
        { name: 'lead_grid', version: 1, event_seq: 3, operation_type: 'create' },
      ]);
      return { caseHash: second.version, leadHash: other.version };
    }

    it('aborts the put — no row with a colliding version/event_seq is committed', async () => {
      const { caseHash } = await seedHistory();
      const before = engine.committed();

      engine.breakHistoryReads(connectionReset);
      await expect(
        repo.put(ref, view('D'), { parentVersion: caseHash, actor: 'usr_alice' }),
      ).rejects.toThrow('read ECONNRESET');

      // Before #4867 this committed a FOURTH row at version 1 / event_seq 1 —
      // duplicating case_grid's own first version and the org's first event,
      // successfully and silently.
      expect(engine.committed()).toEqual(before);
      const versions = engine.historyRows.filter((h) => h.name === 'case_grid').map((h) => h.version);
      expect(versions).toEqual([1, 2]);
      expect(new Set(engine.historyRows.map((h) => h.event_seq)).size).toBe(engine.historyRows.length);
    });

    it('rolls the whole transaction back — the metadata row is untouched too', async () => {
      const { caseHash } = await seedHistory();

      engine.breakHistoryReads(connectionReset);
      await expect(
        repo.put(ref, view('D'), { parentVersion: caseHash, actor: 'usr_alice' }),
      ).rejects.toThrow('read ECONNRESET');

      engine.healHistoryReads();
      // 'B' was the last committed body; 'D' never happened.
      expect((await repo.get(ref))?.body).toMatchObject({ label: 'B' });
    });

    it('reports at error level, naming the consequence and the remedy', async () => {
      const { caseHash } = await seedHistory();

      engine.breakHistoryReads(connectionReset);
      await expect(
        repo.put(ref, view('D'), { parentVersion: caseHash, actor: 'usr_alice' }),
      ).rejects.toThrow();

      expect(errorSpy).toHaveBeenCalledTimes(1);
      const [message, cause] = errorSpy.mock.calls[0] as [string, unknown];
      expect(message).toContain('sys_metadata_history');
      // which number was at stake
      expect(message).toMatch(/\bversion\b/);
      // consequence: restarting at 1 collides, and ordering/rollback go bad
      expect(message).toMatch(/COLLIDES/);
      expect(message).toMatch(/= 1/);
      expect(message).toMatch(/ordering untrustworthy/i);
      expect(message).toMatch(/rollback/i);
      // what happened instead — the write is not silently half-done
      expect(message).toMatch(/ABORTED/);
      expect(message).toMatch(/rolled back/i);
      // remedy
      expect(message).toMatch(/Fix the datasource\/driver error/i);
      // and the driver error is carried, not swallowed
      expect((cause as Error).message).toBe('read ECONNRESET');
    });

    it('covers the delete path too — no tombstone with an invented number', async () => {
      const { caseHash } = await seedHistory();
      const before = engine.committed();

      engine.breakHistoryReads(connectionReset);
      await expect(
        repo.delete(ref, { parentVersion: caseHash, actor: 'usr_alice' }),
      ).rejects.toThrow('read ECONNRESET');

      expect(engine.committed()).toEqual(before);
      // The row itself is still there: `delete` rolled back with the counter.
      engine.healHistoryReads();
      expect(await repo.get(ref)).not.toBeNull();
    });

    it('says it once per outage, and reports recovery once', async () => {
      const { caseHash, leadHash } = await seedHistory();

      engine.breakHistoryReads(connectionReset);
      await expect(repo.put(ref, view('D'), { parentVersion: caseHash, actor: null })).rejects.toThrow();
      await expect(
        repo.put(ref2, otherView('E'), { parentVersion: leadHash, actor: null }),
      ).rejects.toThrow();
      expect(errorSpy).toHaveBeenCalledTimes(1);
      expect(infoSpy).not.toHaveBeenCalled();

      engine.healHistoryReads();
      await repo.put(ref, view('F'), { parentVersion: caseHash, actor: null });

      expect(errorSpy).toHaveBeenCalledTimes(1);
      expect(infoSpy).toHaveBeenCalledTimes(1);
      expect((infoSpy.mock.calls[0] as [string])[0]).toMatch(/readable again/i);
      // Numbering resumes after the surviving max — never from 1 again.
      expect(engine.committed().at(-1)).toEqual({
        name: 'case_grid',
        version: 3,
        event_seq: 4,
        operation_type: 'update',
      });
    });
  });

  it('DISTINGUISHES the two: same call site, opposite verdicts', async () => {
    engine.breakHistoryReads(noSuchTable);
    await repo.put(ref, view('A'), { parentVersion: null, actor: null });

    const engine2 = makeFakeEngine();
    const repo2 = new SysMetadataRepository({
      engine: engine2,
      organizationId: 'org_alpha',
      orgLabel: 'org_alpha',
    });
    engine2.breakHistoryReads(connectionReset);
    await expect(repo2.put(ref, view('A'), { parentVersion: null, actor: null })).rejects.toThrow();

    // Benign: numbered, committed, silent. Real: nothing committed, loud.
    expect(engine.committed()).toHaveLength(1);
    expect(engine2.committed()).toHaveLength(0);
    expect(errorSpy).toHaveBeenCalledTimes(1);
  });
});

/**
 * The cross-package pin (#4867). The whole point of routing through
 * `@objectstack/metadata/errors` is that ONE implementation decides which
 * driver errors are benign — a copy in this package would drift the day a
 * driver quirk is taught to only one of them, and the drift's symptom is
 * silently invented sequence numbers.
 */
describe('#4867 — the discriminator is the shared exported one, not a local copy', () => {
  let errorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    discriminator.mockClear();
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    discriminator.mockReset();
    discriminator.mockImplementation(realIsMissingTableError);
    errorSpy.mockRestore();
  });

  it('consults the exported `isMissingTableError` with the driver error itself', async () => {
    const engine = makeFakeEngine();
    const repo = new SysMetadataRepository({ engine, organizationId: 'org_alpha', orgLabel: 'org_alpha' });

    engine.breakHistoryReads(noSuchTable);
    await repo.put({ org: 'org_alpha', type: 'view', name: 'case_grid' }, view('A'), {
      parentVersion: null,
      actor: null,
    });

    expect(discriminator).toHaveBeenCalled();
    expect((discriminator.mock.calls[0]![0] as Error).message).toContain('no such table');
  });

  it("follows the shared function's verdict — flipping it flips the behaviour", async () => {
    const engine = makeFakeEngine();
    const repo = new SysMetadataRepository({ engine, organizationId: 'org_alpha', orgLabel: 'org_alpha' });

    // A connection reset, declared benign BY THE SHARED MODULE. A local copy
    // (or an inlined `catch { return 1 }`) would ignore this and answer 1 for
    // its own reasons; a local copy that hard-coded "loud" would throw. Only
    // code that actually asks this module can track it.
    discriminator.mockReturnValue(true);
    engine.breakHistoryReads(connectionReset);

    await repo.put({ org: 'org_alpha', type: 'view', name: 'case_grid' }, view('A'), {
      parentVersion: null,
      actor: null,
    });

    expect(engine.committed()).toEqual([
      { name: 'case_grid', version: 1, event_seq: 1, operation_type: 'create' },
    ]);
    expect(errorSpy).not.toHaveBeenCalled();
  });

  it('keeps no second driver-error vocabulary in this file', () => {
    const source = readFileSync(new URL('./sys-metadata-repository.ts', import.meta.url), 'utf8');

    expect(source).toMatch(
      /import\s*\{\s*isMissingTableError\s*\}\s*from\s*'@objectstack\/metadata\/errors'/,
    );
    // The signatures the shared matcher owns must live in exactly one place.
    expect(source).not.toMatch(/function\s+isMissingTableError/);
    expect(source).not.toMatch(/no such table|42P01|ER_NO_SUCH_TABLE|SQLITE_ERROR|errno/i);
  });
});
