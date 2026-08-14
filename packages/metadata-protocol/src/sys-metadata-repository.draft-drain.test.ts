// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #4981 — `SysMetadataRepository.promoteDraft()` no longer treats EVERY draft
 * drain failure as "a concurrent publisher already took it". Same family as
 * #4728 / #4825 / #4867 (one benign cause amnestying all causes); the
 * log-level rule is #4632.
 *
 * The old code was a bare `catch {}` whose comment named exactly one cause and
 * whose behaviour covered all of them — connection drops, timeouts, privilege
 * errors, driver faults included. What it leaves behind is not a wrong number
 * (#4867) but a wrong ROW: a `state='draft'` row for an artifact that has just
 * been published. So every assertion below is about the overlay's contents
 * AFTER the drain, and about who is told.
 *
 * The throw-vs-report question this seam raises is answered "report", by
 * maintainer ruling on the issue: the drain runs AFTER the `put` committed, so
 * throwing would report a durably successful publish as a failure AND invite a
 * retry — and a retried publish is the harmful path, because it promotes the
 * stale draft again. Hence: success + `error` log + a machine-readable
 * `draftDrainFailed` on the result.
 *
 * Both directions are pinned deliberately. A suite proving only the loud half
 * would pass on a discriminator that never returns "benign" (every concurrent
 * publish would start screaming); one proving only the benign half passes on
 * the original defect.
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

interface Row {
  [k: string]: unknown;
}

/** NOT benign: the draft row is still there, this delete just did not land. */
const connectionReset = () => Object.assign(new Error('write ECONNRESET'), { code: 'ECONNRESET' });

/**
 * Engine fake with REAL transaction semantics — a txn body that throws commits
 * nothing, which is what makes "the draft row survives a failed drain" an
 * observation rather than an assumption.
 *
 * Two seams the tests drive:
 *   - `beforeDraftLookup(n)` — runs before the n-th `findOne` for a draft row,
 *     so a test can race the repository the way a second publisher does. Lookup
 *     #1 is `promoteDraft`'s own read; #2 is the drain's.
 *   - `breakDraftDeletes()` — makes the drain's `engine.delete` fail while
 *     every other write keeps working, which is exactly what makes the defect
 *     invisible in production.
 */
function makeFakeEngine() {
  const rows = new Map<string, Row>();
  const historyRows: Row[] = [];
  let draftLookups = 0;
  let beforeDraftLookup: ((n: number) => void) | null = null;
  let draftDeleteFailure: (() => unknown) | null = null;
  let pendingRollback: Map<string, Row> | null = null;

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
    /** The surviving `state='draft'` row for `name`, if any. */
    draftRow: (name: string) =>
      Array.from(rows.values()).find((r) => r.name === name && r.state === 'draft') ?? null,
    /**
     * Installing the hook RESETS the lookup counter, so a test counts draft
     * reads from its own starting line rather than from the fixture setup:
     * inside `promoteDraft`, #1 is the promotion's read and #2 is the drain's.
     */
    onBeforeDraftLookup(fn: (n: number) => void) {
      draftLookups = 0;
      beforeDraftLookup = fn;
    },
    breakDraftDeletes(makeError: () => unknown) {
      draftDeleteFailure = makeError;
    },
    healDraftDeletes() {
      draftDeleteFailure = null;
    },
    /**
     * Apply a change as if ANOTHER connection had committed it while our
     * transaction is open — it lands in the live rows *and* in the open
     * transaction's rollback snapshot, so our rollback cannot undo somebody
     * else's commit. Without this the fake would resurrect the very row a
     * concurrent publisher just drained, and the benign race would be
     * unobservable.
     */
    raceCommit(fn: (rows: Map<string, Row>) => void) {
      fn(rows);
      if (pendingRollback) fn(pendingRollback);
    },
    async find(table: string, opts: { where: Record<string, unknown> }) {
      if (table === 'sys_metadata_history') {
        return historyRows.filter((h) => matchesHistory(h, opts.where));
      }
      return Array.from(rows.values()).filter((r) => {
        if (opts.where.type && r.type !== opts.where.type) return false;
        if (
          opts.where.organization_id !== undefined &&
          r.organization_id !== opts.where.organization_id
        ) {
          return false;
        }
        if (opts.where.state && r.state !== opts.where.state) return false;
        return true;
      });
    },
    async findOne(table: string, opts: { where: Record<string, unknown> }) {
      if (table === 'sys_metadata_history') {
        return historyRows.find((h) => matchesHistory(h, opts.where)) ?? null;
      }
      if (opts.where.state === 'draft') {
        draftLookups += 1;
        beforeDraftLookup?.(draftLookups);
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
    async update(
      _t: string,
      data: Record<string, unknown>,
      opts: { where: Record<string, unknown> },
    ) {
      assertEngineUpdateDispatch(data, opts);
      const found = findRow(opts.where);
      if (!found) throw new Error('not found');
      rows.set(found.key, { ...found.row, ...data });
      return { id: found.row.id as string };
    },
    async delete(_t: string, opts: { where: Record<string, unknown> }) {
      assertEngineDeleteDispatch(opts);
      const found = findRow(opts.where);
      if (draftDeleteFailure && found?.row.state === 'draft') throw draftDeleteFailure();
      if (!found) return { deleted: 0 };
      rows.delete(found.key);
      return { deleted: 1 };
    },
    async transaction<T>(cb: (ctx: any, info: { owned: boolean }) => Promise<T>): Promise<T> {
      const rowsSnapshot = new Map(Array.from(rows, ([k, r]) => [k, { ...r }] as const));
      const historySnapshot = historyRows.map((h) => ({ ...h }));
      const outer = pendingRollback;
      pendingRollback = rowsSnapshot;
      try {
        return await cb({ txn: true }, { owned: true });
      } catch (err) {
        rows.clear();
        for (const [k, r] of rowsSnapshot) rows.set(k, r);
        historyRows.length = 0;
        historyRows.push(...historySnapshot);
        throw err;
      } finally {
        pendingRollback = outer;
      }
    },
  };
}

const view = (label: string) => ({
  name: 'case_grid',
  label,
  object: 'case',
  columns: [{ field: 'name' }],
});

const ref = { org: 'org_alpha', type: 'view' as const, name: 'case_grid' };

describe('#4981 — a failed draft drain is discriminated, not blanket-swallowed', () => {
  let engine: ReturnType<typeof makeFakeEngine>;
  let repo: SysMetadataRepository;
  let errorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    engine = makeFakeEngine();
    repo = new SysMetadataRepository({
      engine,
      organizationId: 'org_alpha',
      orgLabel: 'org_alpha',
    });
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    errorSpy.mockRestore();
  });

  /** Save a draft and return its hash. */
  async function saveDraft(label: string): Promise<string> {
    const existing = await repo.get(ref, { state: 'draft' });
    const res = await repo.put(ref, view(label), {
      parentVersion: existing?.hash ?? null,
      actor: 'studio',
      state: 'draft',
    });
    return res.version;
  }

  describe('the benign races — silent, and the publish reports plain success', () => {
    it('a concurrent publisher already drained the draft', async () => {
      await saveDraft('A');
      // Race the repo: the row vanishes between promoteDraft's read and the
      // drain's own lookup, exactly as a second publisher would make it.
      engine.onBeforeDraftLookup((n) => {
        if (n === 2) {
          engine.raceCommit((rows) => {
            for (const [k, r] of rows) if (r.state === 'draft') rows.delete(k);
          });
        }
      });

      const result = await repo.promoteDraft(ref, { actor: 'studio' });

      expect(result.draftDrainFailed).toBeUndefined();
      expect(errorSpy).not.toHaveBeenCalled();
      expect((await repo.get(ref))?.body).toMatchObject({ label: 'A' });
      expect(await repo.get(ref, { state: 'draft' })).toBeNull();
    });

    it('a NEWER draft was saved while the publish was in flight — and it survives', async () => {
      await saveDraft('A');
      let raced = false;
      engine.onBeforeDraftLookup((n) => {
        if (n === 2 && !raced) {
          raced = true;
          // Somebody hit Save again while Publish was running. The drain's
          // parentVersion no longer matches, and NOT deleting is the correct
          // outcome — this row is genuine pending work, not a stale ghost.
          engine.raceCommit((rows) => {
            for (const [k, r] of rows) {
              if (r.state === 'draft') {
                rows.set(k, { ...r, metadata: JSON.stringify(view('B')), checksum: 'newer' });
              }
            }
          });
        }
      });

      const result = await repo.promoteDraft(ref, { actor: 'studio' });

      expect(result.draftDrainFailed).toBeUndefined();
      expect(errorSpy).not.toHaveBeenCalled();
      // 'A' went live; the newer draft 'B' is still pending, untouched.
      expect((await repo.get(ref))?.body).toMatchObject({ label: 'A' });
      expect((await repo.get(ref, { state: 'draft' }))?.body).toMatchObject({ label: 'B' });
    });
  });

  describe('a REAL drain failure — success, but loudly and machine-readably', () => {
    async function publishWithBrokenDrain(): Promise<
      Awaited<ReturnType<SysMetadataRepository['promoteDraft']>>
    > {
      await saveDraft('A');
      engine.breakDraftDeletes(connectionReset);
      return repo.promoteDraft(ref, { actor: 'studio' });
    }

    it('still returns success — the publish itself committed and must not be re-run', async () => {
      const result = await publishWithBrokenDrain();

      expect(result.version).toBeTruthy();
      expect(result.item.body).toMatchObject({ label: 'A' });
      expect((await repo.get(ref))?.body).toMatchObject({ label: 'A' });
      // The `publish` history event is durable — the failure is post-commit.
      expect(engine.committed()).toEqual([
        { name: 'case_grid', version: 1, event_seq: 1, operation_type: 'create' },
        { name: 'case_grid', version: 2, event_seq: 2, operation_type: 'publish' },
      ]);
    });

    it('leaves the stale draft row behind — the consequence, observed', async () => {
      await publishWithBrokenDrain();

      // This is the row the old `catch {}` never mentioned: an artifact with
      // no pending changes that every "unpublished changes" read still sees.
      const stale = await repo.get(ref, { state: 'draft' });
      expect(stale).not.toBeNull();
      expect(stale?.body).toMatchObject({ label: 'A' });
      expect(engine.draftRow('case_grid')).not.toBeNull();
    });

    it('reports at error level, naming the consequence and the remedy', async () => {
      await publishWithBrokenDrain();

      expect(errorSpy).toHaveBeenCalledTimes(1);
      const [message, cause] = errorSpy.mock.calls[0] as [string, unknown];
      expect(message).toContain('view/case_grid');
      // consequence — the row that stayed, and that nothing repairs it
      expect(message).toMatch(/state='draft'/);
      expect(message).toMatch(/STILL in/);
      expect(message).toMatch(/nothing retries or repairs it/i);
      expect(message).toMatch(/unpublished changes/i);
      expect(message).toMatch(/NEXT publish/i);
      // why it is not thrown — a successful publish is not reported as failed
      expect(message).toMatch(/COMMITTED/);
      expect(message).toMatch(/reported, not thrown/i);
      // remedy
      expect(message).toMatch(/Remedy:/);
      expect(message).toMatch(/re-publish/i);
      expect(message).toMatch(/sys_metadata/);
      // and the driver error is carried, not swallowed
      expect((cause as Error).message).toBe('write ECONNRESET');
    });

    it('surfaces the failure on the RESULT too, so a caller need not parse logs', async () => {
      const result = await publishWithBrokenDrain();

      expect(result.draftDrainFailed).toBeDefined();
      expect(result.draftDrainFailed?.ref).toEqual({
        org: 'org_alpha',
        type: 'view',
        name: 'case_grid',
      });
      expect(result.draftDrainFailed?.draftHash).toBe(result.version);
      expect((result.draftDrainFailed?.cause as Error).message).toBe('write ECONNRESET');
    });

    it('speaks once per orphaned artifact — each names a different stale row', async () => {
      await publishWithBrokenDrain();
      const ref2 = { org: 'org_alpha', type: 'view' as const, name: 'lead_grid' };
      await repo.put(
        ref2,
        { name: 'lead_grid', label: 'L', object: 'lead', columns: [{ field: 'name' }] },
        { parentVersion: null, actor: 'studio', state: 'draft' },
      );
      await repo.promoteDraft(ref2, { actor: 'studio' });

      // Deliberately NOT #4867's once-per-outage suppression: the remedy is
      // per-row, so collapsing these would hide which drafts are stale.
      expect(errorSpy).toHaveBeenCalledTimes(2);
      expect((errorSpy.mock.calls[1] as [string])[0]).toContain('view/lead_grid');
    });
  });

  it('DISTINGUISHES the two: same call site, opposite verdicts', async () => {
    // Benign.
    await saveDraft('A');
    engine.onBeforeDraftLookup((n) => {
      if (n === 2) {
        engine.raceCommit((rows) => {
          for (const [k, r] of rows) if (r.state === 'draft') rows.delete(k);
        });
      }
    });
    const benign = await repo.promoteDraft(ref, { actor: 'studio' });

    // Real.
    const engine2 = makeFakeEngine();
    const repo2 = new SysMetadataRepository({
      engine: engine2,
      organizationId: 'org_alpha',
      orgLabel: 'org_alpha',
    });
    await repo2.put(ref, view('A'), { parentVersion: null, actor: 'studio', state: 'draft' });
    engine2.breakDraftDeletes(connectionReset);
    const real = await repo2.promoteDraft(ref, { actor: 'studio' });

    expect(benign.draftDrainFailed).toBeUndefined();
    expect(real.draftDrainFailed).toBeDefined();
    expect(errorSpy).toHaveBeenCalledTimes(1);
    // Both published; only one left a row behind.
    expect(engine.draftRow('case_grid')).toBeNull();
    expect(engine2.draftRow('case_grid')).not.toBeNull();
  });

  /**
   * The cheap half of "can the NEXT publish detect a stale draft?" — it
   * already can, and this pins that it does. `put()`'s identical-hash
   * short-circuit means re-publishing a stale draft writes NO second history
   * event, and the drain then succeeds and removes the row. The expensive half
   * (a stale draft whose body no longer matches the active row, i.e. after
   * something else published or reverted in between) is indistinguishable from
   * genuine pending work by content alone and is NOT guessed at here.
   */
  it('self-heals on the next publish while the active row is unchanged', async () => {
    await saveDraft('A');
    engine.breakDraftDeletes(connectionReset);
    await repo.promoteDraft(ref, { actor: 'studio' });
    expect(engine.draftRow('case_grid')).not.toBeNull();
    const afterFirst = engine.committed();

    // The driver recovers; the operator (or the UI's still-lit Publish button)
    // publishes again.
    engine.healDraftDeletes();
    const second = await repo.promoteDraft(ref, { actor: 'studio' });

    expect(second.draftDrainFailed).toBeUndefined();
    expect(engine.draftRow('case_grid')).toBeNull();
    // No duplicate `publish` event: the body was already live, so put() no-ops.
    expect(engine.committed()).toEqual(afterFirst);
    expect((await repo.get(ref))?.body).toMatchObject({ label: 'A' });
  });
});

/**
 * Gate registration (#4981). The behavioural tests above go red if the catch
 * goes silent, but only for the shapes they simulate; the AST gate is what
 * stops the seam regressing at all. `dropPromotedDraftRow` exists as a named
 * method precisely so the scanner can see a write that is otherwise spelled
 * `this.delete(...)` — a callee name far too common to put in the vocabulary.
 * Losing either half silently un-guards the seam, so both are pinned.
 */
describe('#4981 — the drain seam is registered with check:durability-log-level', () => {
  it('names `dropPromotedDraftRow` in the checker vocabulary', () => {
    const checker = readFileSync(
      new URL('../../../scripts/check-durability-degradation-log-level.mjs', import.meta.url),
      'utf8',
    );
    expect(checker).toContain('dropPromotedDraftRow');
    expect(checker).toMatch(/DURABILITY_CRITICAL_CALLEES[\s\S]*dropPromotedDraftRow/);
  });

  it('keeps the drain behind that named callee, with a discriminating catch', () => {
    const source = readFileSync(
      new URL('./sys-metadata-repository.ts', import.meta.url),
      'utf8',
    );
    // The guarded call the scanner looks for.
    expect(source).toMatch(/try\s*\{\s*await this\.dropPromotedDraftRow\(/);
    // The catch delegates to the verdict helper rather than swallowing.
    expect(source).toMatch(/catch \(error\) \{\s*draftDrainFailed = this\.draftDrainVerdict\(/);
    // And the verdict amnesties exactly one class of cause.
    expect(source).toMatch(/if \(error instanceof ConflictError\) return undefined;/);
  });
});
