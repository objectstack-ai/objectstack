// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect, vi } from 'vitest';
import { ObjectStackProtocolImplementation } from '@objectstack/metadata-protocol';
import { SchemaRegistry } from './registry.js';
// [#4550 / #5480] The producer's OWN write-verb dispatch decisions, so the
// #6215 double below cannot accept a call `ObjectQL.delete` / `ObjectQL.update`
// refuses.
import { assertEngineDeleteDispatch } from './engine-delete-dispatch.js';
import { assertEngineUpdateDispatch } from './engine-update-dispatch.js';

/**
 * ADR-0067 — package-scoped commit history & rollback.
 *
 * These tests exercise the commit primitives in isolation with a tiny in-memory
 * `sys_metadata_commit` engine fake + a stubbed overlay repo, mirroring the
 * `makeProtocol` pattern in protocol-publish-package-drafts.test.ts. They prove
 * the revert PLAN semantics (created → soft-remove; edited → restoreVersion) and
 * the append-only "a revert is itself a commit" rule, without a real database.
 */
function makeFakeEngine(seedCommits: any[] = []) {
  const commits: any[] = [...seedCommits];
  const engine: any = {
    insert: vi.fn(async (table: string, data: any) => {
      if (table === 'sys_metadata_commit') commits.push(data);
    }),
    find: vi.fn(async (table: string, q: any) => {
      if (table === 'sys_metadata_commit') {
        return commits.filter((c) => c.package_id === q.where.package_id);
      }
      return [];
    }),
    findOne: vi.fn(async (table: string, q: any) => {
      if (table === 'sys_metadata_commit') return commits.find((c) => c.id === q.where.id) ?? null;
      return null; // no active sys_metadata rows by default
    }),
  };
  return { engine, commits };
}

function makeProtocol(engine: any, repo: any) {
  const protocol = new ObjectStackProtocolImplementation(engine as never);
  (protocol as any).ensureOverlayIndex = async () => {};
  (protocol as any).getOverlayRepo = () => repo;
  return protocol;
}

const applyCommit = (over: Partial<any> & { id: string; items: any[]; created_at: string }) => ({
  package_id: 'app.edu',
  operation: 'apply',
  message: 'build',
  organization_id: null,
  item_count: over.items.length,
  ...over,
  items: JSON.stringify(over.items),
});

describe('ADR-0067 — listCommits', () => {
  it('returns [] for a package with no commits', async () => {
    const { engine } = makeFakeEngine();
    const p = makeProtocol(engine, {});
    expect(await p.listCommits({ packageId: 'app.none' })).toEqual([]);
  });

  it('returns a package’s commits newest-first with parsed items', async () => {
    const { engine } = makeFakeEngine([
      applyCommit({ id: 'c1', items: [{ type: 'object', name: 'a', existedBefore: false, prevVersion: null }], created_at: '2026-06-24T00:00:01.000Z' }),
      applyCommit({ id: 'c2', items: [{ type: 'view', name: 'b', existedBefore: false, prevVersion: null }], created_at: '2026-06-24T00:00:02.000Z' }),
    ]);
    const p = makeProtocol(engine, {});
    const list = await p.listCommits({ packageId: 'app.edu' });
    expect(list.map((c) => c.id)).toEqual(['c2', 'c1']); // newest-first
    expect(list[0].items[0]).toMatchObject({ type: 'view', name: 'b' });
  });
});

describe('ADR-0067 — revertCommit', () => {
  it('soft-removes artifacts the commit CREATED and records a revert commit', async () => {
    const { engine, commits } = makeFakeEngine([
      applyCommit({ id: 'cmt_1', items: [{ type: 'object', name: 'course', existedBefore: false, prevVersion: null }], created_at: '2026-06-24T00:00:00.000Z' }),
    ]);
    const del = vi.fn(async () => {});
    const repo = { get: vi.fn(async () => ({ hash: 'h1' })), delete: del, restoreVersion: vi.fn() };
    const p = makeProtocol(engine, repo);

    const res = await p.revertCommit({ commitId: 'cmt_1' });

    expect(del).toHaveBeenCalledTimes(1);
    expect(res.revertedCount).toBe(1);
    expect(res.reverted[0]).toMatchObject({ type: 'object', name: 'course', action: 'removed' });
    const revertRow = commits.find((c) => c.operation === 'revert');
    expect(revertRow).toBeTruthy();
    expect(revertRow.parent_commit_id).toBe('cmt_1');
  });

  it('restores artifacts the commit EDITED to their prevVersion', async () => {
    const { engine } = makeFakeEngine([
      applyCommit({ id: 'cmt_2', items: [{ type: 'object', name: 'course', existedBefore: true, prevVersion: 3 }], created_at: '2026-06-24T00:00:00.000Z' }),
    ]);
    const restoreVersion = vi.fn(async () => ({}));
    const repo = { get: vi.fn(async () => ({ hash: 'h2' })), delete: vi.fn(), restoreVersion };
    const p = makeProtocol(engine, repo);

    const res = await p.revertCommit({ commitId: 'cmt_2' });

    expect(restoreVersion).toHaveBeenCalledWith(
      expect.anything(),
      3,
      expect.objectContaining({ source: 'protocol.revertCommit' }),
    );
    expect(res.reverted[0]).toMatchObject({ type: 'object', name: 'course', action: 'restored' });
  });

  it('throws commit_not_found (404) for an unknown commit', async () => {
    const { engine } = makeFakeEngine();
    const p = makeProtocol(engine, {});
    await expect(p.revertCommit({ commitId: 'nope' })).rejects.toMatchObject({ code: 'COMMIT_NOT_FOUND', status: 404 });
  });

  it('reverts dependent artifacts in REVERSE apply order (view before its object)', async () => {
    const { engine } = makeFakeEngine([
      applyCommit({
        id: 'cmt_3',
        items: [
          { type: 'object', name: 'course', existedBefore: false, prevVersion: null },
          { type: 'view', name: 'course_list', existedBefore: false, prevVersion: null },
        ],
        created_at: '2026-06-24T00:00:00.000Z',
      }),
    ]);
    const order: string[] = [];
    const repo = {
      get: vi.fn(async () => ({ hash: 'h' })),
      delete: vi.fn(async (ref: any) => { order.push(ref.name); }),
      restoreVersion: vi.fn(),
    };
    const p = makeProtocol(engine, repo);
    await p.revertCommit({ commitId: 'cmt_3' });
    expect(order).toEqual(['course_list', 'course']); // dependents first
  });
});

describe('ADR-0067 — rollbackToPackageCommit', () => {
  it('reverts every apply commit strictly newer than the target', async () => {
    const { engine } = makeFakeEngine([
      applyCommit({ id: 'c1', items: [], created_at: '2026-06-24T00:00:01.000Z' }),
      applyCommit({ id: 'c2', items: [{ type: 'object', name: 'x', existedBefore: false, prevVersion: null }], created_at: '2026-06-24T00:00:02.000Z' }),
      applyCommit({ id: 'c3', items: [{ type: 'view', name: 'y', existedBefore: false, prevVersion: null }], created_at: '2026-06-24T00:00:03.000Z' }),
    ]);
    const repo = { get: vi.fn(async () => ({ hash: 'h' })), delete: vi.fn(async () => {}), restoreVersion: vi.fn() };
    const p = makeProtocol(engine, repo);

    const res = await p.rollbackToPackageCommit({ commitId: 'c1' });

    expect(res.success).toBe(true);
    expect([...res.revertedCommits].sort()).toEqual(['c2', 'c3']); // c1 itself kept
  });

  it('throws commit_not_found for an unknown target', async () => {
    const { engine } = makeFakeEngine();
    const p = makeProtocol(engine, {});
    await expect(p.rollbackToPackageCommit({ commitId: 'ghost' })).rejects.toMatchObject({ code: 'COMMIT_NOT_FOUND' });
  });
});

describe('ADR-0067 — publishPackageDrafts records a commit', () => {
  it('records an apply commit carrying the message + aiModel + revert plan', async () => {
    const commits: any[] = [];
    const engine: any = {
      insert: vi.fn(async (t: string, d: any) => { if (t === 'sys_metadata_commit') commits.push(d); }),
      findOne: vi.fn(async () => null), // no active rows → every draft is a CREATE
      find: vi.fn(async () => []),
    };
    const protocol = new ObjectStackProtocolImplementation(engine as never);
    (protocol as any).ensureOverlayIndex = async () => {};
    (protocol as any).getOverlayRepo = () => ({
      listDrafts: async () => [{ type: 'object', name: 'course' }],
      get: async () => null,
    });
    // ADR-0067 D2 — the batch promotes via the phase-1 seam (inside one
    // transaction), not per-item publishMetaItem; side effects are phase 2.
    vi.spyOn(protocol as any, 'promoteDraftForPublish').mockImplementation(async (req: any) => ({
      singularType: req.type,
      orgId: null,
      result: { version: 'h', seq: 7, item: { body: { name: req.name } }, packageId: null },
    }));
    vi.spyOn(protocol as any, 'runPublishSideEffects').mockResolvedValue({});

    const res: any = await (protocol as any).publishPackageDrafts({
      packageId: 'app.edu',
      message: 'build an education app',
      aiModel: 'claude-opus-4-8',
      actor: 'ai:claude',
    });

    expect(res.commitId).toBeTruthy();
    const apply = commits.find((c) => c.operation === 'apply');
    expect(apply).toBeTruthy();
    expect(apply.message).toBe('build an education app');
    expect(apply.ai_model).toBe('claude-opus-4-8');
    expect(apply.item_count).toBe(1);
    const items = JSON.parse(apply.items);
    expect(items[0]).toMatchObject({ type: 'object', name: 'course', existedBefore: false });
  });
});

/**
 * #6215 — `revertCommit`'s RESTORE limb, on a package-bound overlay row.
 *
 * The suites above drive `revertCommit` against a stubbed overlay repo, which
 * is the right instrument for the revert PLAN (created → soft-remove, edited →
 * `restoreVersion`) and blind by construction to what the repository then does
 * with the plan. #6215 lived exactly there: `restoreVersion` called `put`
 * without a `packageId`, `put` scoped its optimistic-lock lookup with
 * `whereFor(ref, state, opts.packageId ?? null)`, and `null` is the PREDICATE
 * `package_id IS NULL` — so for a row bound to a Studio package the lock read a
 * hash of `null`, compared it against the real parent hash, and threw. Every
 * package-commit revert of an artifact authored in a package workspace came
 * back `failedCount: 1` with a message blaming a concurrent edit.
 *
 * So this block runs the REAL `SysMetadataRepository` over a package-aware
 * in-memory engine — the second of the two user-facing callers `restoreVersion`
 * has (the first, `rollbackMetaItem`, is pinned in
 * `protocol-writepath-object-ownership.test.ts`). Both share one line of
 * repository code; pinning both is what catches the day they diverge.
 */

/** A Studio authoring workspace id — writable under ADR-0070. */
const APP_PKG = 'app.myapp';

const matchesWhere = (r: Record<string, unknown>, w: Record<string, unknown>): boolean => {
  for (const [k, v] of Object.entries(w)) {
    if (v === undefined) continue;
    if (r[k] !== v) return false;
  }
  return true;
};

const rowKey = (w: Record<string, unknown>) =>
  `${w.type}|${w.name}|${w.organization_id ?? '__env__'}|${w.state ?? 'active'}|${w.package_id ?? '__nopkg__'}`;

/**
 * Multi-table in-memory engine: `sys_metadata` (keyed by the ADR-0048 overlay
 * key INCLUDING `package_id`, without which this file could not see the defect
 * at all), `sys_metadata_history`, `sys_metadata_commit`. Both write verbs are
 * pinned to ObjectQL's own dispatch predicates.
 */
function makeRealRepoHarness(seedCommits: any[] = []) {
  const registry = new SchemaRegistry({ multiTenant: false });
  (registry as any).logLevel = 'silent';
  const rows = new Map<string, any>();
  const historyRows: any[] = [];
  const commits: any[] = [...seedCommits];
  let nextId = 0;

  const findRow = (w: Record<string, unknown>) => {
    for (const [k, r] of rows) if (matchesWhere(r, w)) return { key: k, row: r };
    return null;
  };

  const engine: any = {
    registry,
    async findOne(table: string, opts: { where: Record<string, unknown> }) {
      if (table === 'sys_metadata_commit') return commits.find((c) => matchesWhere(c, opts.where)) ?? null;
      if (table === 'sys_metadata_history') return historyRows.find((h) => matchesWhere(h, opts.where)) ?? null;
      if (table !== 'sys_metadata') return null;
      return findRow(opts.where)?.row ?? null;
    },
    async find(table: string, opts: { where: Record<string, unknown> }) {
      if (table === 'sys_metadata_commit') return commits.filter((c) => matchesWhere(c, opts.where));
      if (table === 'sys_metadata_history') return historyRows.filter((h) => matchesWhere(h, opts.where));
      if (table !== 'sys_metadata') return [];
      return Array.from(rows.values()).filter((r) => matchesWhere(r, opts.where));
    },
    async insert(table: string, data: Record<string, unknown>) {
      if (table === 'sys_metadata_commit') { commits.push(data); return { id: (data as any).id }; }
      if (table === 'sys_metadata_history') {
        const h = { id: `h_${++nextId}`, ...(data as any) };
        historyRows.push(h);
        return { id: h.id };
      }
      if (table !== 'sys_metadata') return { id: 'side_table' };
      const row = { id: `r_${++nextId}`, ...(data as any) };
      rows.set(rowKey(data), row);
      return { id: row.id };
    },
    async update(table: string, data: Record<string, unknown>, opts: { where: Record<string, unknown> }) {
      assertEngineUpdateDispatch(data, opts);
      if (table !== 'sys_metadata') return { id: null };
      const found = findRow(opts.where);
      if (!found) return { id: null };
      const merged = { ...found.row, ...(data as any) };
      rows.delete(found.key);
      rows.set(rowKey(merged), merged);
      return { id: merged.id };
    },
    async delete(table: string, opts?: Record<string, unknown>) {
      assertEngineDeleteDispatch(opts);
      if (table !== 'sys_metadata') return { deleted: 0 };
      const found = findRow(((opts as any)?.where ?? {}) as Record<string, unknown>);
      if (!found) return { deleted: 0 };
      rows.delete(found.key);
      return { deleted: 1 };
    },
    async syncObjectSchema() { /* no physical storage in this double */ },
  };

  const protocol = new ObjectStackProtocolImplementation(engine, undefined, 'env_test');
  return { protocol, engine, rows, historyRows, commits, registry };
}

/**
 * The reverted artifact is a `view`, not an `object`, and deliberately: the
 * repository's `assertAllowed` refuses `override-artifact` on `object` (not
 * `allowOrgOverride`), and `revertCommit` — unlike `rollbackMetaItem`, which
 * derives `runtime-only` for a runtime-created artifact — passes no intent, so
 * an object item fails that gate BEFORE reaching the scoping this file pins.
 * That is a separate defect of the same family, filed as #6563; using an
 * overlay-allowed type keeps this pin measuring one thing. The repository line
 * under test is type-agnostic.
 */
const gridBody = (label: string) => ({
  name: 'myapp_case_grid', type: 'grid', label, columns: ['id', 'title'],
});

/** v1 authored in the package workspace, then the edit the commit recorded. */
async function seedPackageBoundEdit(protocol: any) {
  await protocol.saveMetaItem({
    type: 'view', name: 'myapp_case_grid', packageId: APP_PKG, item: gridBody('Cases'),
  });
  await protocol.saveMetaItem({
    type: 'view', name: 'myapp_case_grid', packageId: APP_PKG, item: gridBody('Renamed'),
  });
}

const editedCommit = () => applyCommit({
  id: 'cmt_pkg',
  package_id: APP_PKG,
  items: [{ type: 'view', name: 'myapp_case_grid', existedBefore: true, prevVersion: 1 }],
  created_at: '2026-08-08T00:00:00.000Z',
});

describe('#6215 — revertCommit restores a PACKAGE-BOUND overlay row', () => {
  it('restores the pre-commit body IN PLACE: one row, still bound to its package', async () => {
    const { protocol, rows } = makeRealRepoHarness([editedCommit()]);
    await seedPackageBoundEdit(protocol);

    const res = await protocol.revertCommit({ commitId: 'cmt_pkg' });

    // Pre-fix this was `failedCount: 1` carrying "advanced during rollback".
    expect(res.failed).toEqual([]);
    expect(res.revertedCount).toBe(1);
    expect(res.reverted[0]).toMatchObject({ type: 'view', name: 'myapp_case_grid', action: 'restored' });

    // IN PLACE — the write targeted the bound row rather than inserting an
    // unbound duplicate beside it (the defect's second face; `sys_metadata`'s
    // partial unique index keys on `COALESCE(package_id,'')`, so a real DB
    // would have accepted that duplicate too).
    const stored = Array.from(rows.values()).filter((r) => r.name === 'myapp_case_grid');
    expect(stored).toHaveLength(1);
    expect(stored[0].package_id).toBe(APP_PKG);
    expect(JSON.parse(stored[0].metadata).label).toBe('Cases');
    // The revert is itself an append-only commit (ADR-0067), as before.
    expect((res as any).revertCommitId).toBeTruthy();
  });

  it('a package-LESS row still reverts — the legacy shape is not regressed', async () => {
    const { protocol, rows } = makeRealRepoHarness([applyCommit({
      id: 'cmt_global',
      package_id: null,
      items: [{ type: 'view', name: 'myapp_case_grid', existedBefore: true, prevVersion: 1 }],
      created_at: '2026-08-08T00:00:00.000Z',
    })]);
    await protocol.saveMetaItem({ type: 'view', name: 'myapp_case_grid', item: gridBody('Cases') });
    await protocol.saveMetaItem({ type: 'view', name: 'myapp_case_grid', item: gridBody('Renamed') });

    const res = await protocol.revertCommit({ commitId: 'cmt_global' });

    expect(res.failed).toEqual([]);
    expect(res.revertedCount).toBe(1);
    const stored = Array.from(rows.values()).filter((r) => r.name === 'myapp_case_grid');
    expect(stored).toHaveLength(1);
    expect(stored[0].package_id).toBeNull();
    expect(JSON.parse(stored[0].metadata).label).toBe('Cases');
  });

  /**
   * The refusal that must SURVIVE the fix: a row that REALLY advanced between
   * the revert's parent read and its write is still refused. Staging it needs a
   * real interleaving now that both facts come from one read, so the engine's
   * `findOne` hands the restore a snapshot while a concurrent publish lands on
   * the stored row.
   *
   * Envelope note (ADR-0112): `revertCommit` converts a per-item throw into a
   * `failed[]` record, whose declared shape carries `error` + `code` and no
   * `status` — so `code` is asserted here and the full `{ code, status }` pair
   * is asserted at the throwing surface, `rollbackMetaItem`, in
   * `protocol-writepath-object-ownership.test.ts`.
   */
  it('still refuses a GENUINELY advanced row: METADATA_CONFLICT, nothing written', async () => {
    const { protocol, engine, rows } = makeRealRepoHarness([editedCommit()]);
    await seedPackageBoundEdit(protocol);

    const realFindOne = engine.findOne.bind(engine);
    // The concurrent publish lands between `restoreVersion`'s parent read and
    // `put`'s optimistic-lock read. That second read is identified by the one
    // property only it has — it runs INSIDE the write transaction, so the
    // engine call carries a `context` — rather than by counting reads, which
    // would silently stop covering anything the day a read is added.
    let fired = false;
    engine.findOne = async (table: string, opts: Record<string, any>) => {
      const row = await realFindOne(table, opts);
      if (!fired && table === 'sys_metadata' && row && 'context' in opts && opts.where?.state === 'active') {
        fired = true;
        row.checksum = `sha256:${'a'.repeat(64)}`; // someone else published
      }
      return row;
    };

    const res = await protocol.revertCommit({ commitId: 'cmt_pkg' });

    expect(fired).toBe(true);
    expect(res.revertedCount).toBe(0);
    expect(res.failedCount).toBe(1);
    expect(res.failed[0]).toMatchObject({ type: 'view', name: 'myapp_case_grid', code: 'METADATA_CONFLICT' });
    // Refused means refused: the concurrent writer's body stands, and no
    // unbound duplicate was left behind.
    const stored = Array.from(rows.values()).filter((r) => r.name === 'myapp_case_grid');
    expect(stored).toHaveLength(1);
    expect(stored[0].package_id).toBe(APP_PKG);
    expect(JSON.parse(stored[0].metadata).label).toBe('Renamed');
  });
});
