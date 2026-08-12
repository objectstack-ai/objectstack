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
    // [#6621] `revertCommit` now touches `engine.registry` on BOTH limbs (the
    // restore write-through and the soft-remove heal), so the double carries
    // the real registry rather than nothing. A bare `{}` engine would make
    // every plan assertion below fail for a reason that has nothing to do with
    // the plan — which is exactly the false red a stubbed double is supposed
    // to avoid.
    registry: (() => {
      const r = new SchemaRegistry({ multiTenant: false });
      (r as any).logLevel = 'silent';
      return r;
    })(),
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
    // [#6621] `{}` was not what `SysMetadataRepository.restoreVersion` returns:
    // its declared `PutResult` carries the committed item, and the restore limb
    // now writes that body through to the registry. A double that answers less
    // than the contract makes the caller look broken.
    const restoreVersion = vi.fn(async () => ({
      version: 'h3',
      seq: 2,
      item: { body: { name: 'course', label: 'Course', fields: { name: { name: 'name', type: 'text' } } } },
    }));
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

/**
 * [#7819] `$or` / `$and` are understood, because a double that silently drops
 * an operator does not answer "no match" — it answers a WRONG match.
 *
 * `revertCommit` and `rollbackToPackageCommit` resolve their target commit with
 * `{ id, $or: [{ organization_id: <org> }, { organization_id: null }] }` so an
 * org-scoped caller can reach a commit recorded env-wide. This helper was flat
 * equality, so it compared `row['$or']` against the array and every lookup
 * missed — including the two org-scoped cases below, whose seeded rows carry
 * the caller's OWN org and therefore match the FIRST branch outright. Nothing
 * about their subject (#6602's registry org-asymmetry) changed; the double just
 * could not evaluate the predicate that now guards the door they enter through.
 *
 * ⚠️ CONJOINED with the sibling keys, in the entries loop — the corrected form
 * #7846 just landed across six doubles in this package (part of #7620), and
 * deliberately NOT the early-returning `if ($or) return …some(…)` shape those
 * six carried before it. That shape discards every sibling equality key, so
 * `{ id, $or: [...] }` would stop constraining `id` at all and this lookup
 * would return SOME OTHER commit whose org happened to match. With one seeded
 * commit per harness that is invisible today — which is exactly what makes it
 * worth ruling out here rather than discovering later.
 *
 * This file was not among #7846's six because it had no operator handling at
 * all to correct (pure flat equality), so it reads as a new member of the same
 * #7620 lane rather than a regression of it.
 *
 * ⚠️ What this helper does NOT do is pin `$or` semantics — it is a
 * reimplementation of them, so any assertion whose SUBJECT is the org predicate
 * would be measuring this function rather than the protocol. No case in this
 * file has that subject (which is precisely why this file could never see the
 * #7705/#7779/#7819 family), and the operator's real behaviour against a real
 * driver — whether `organization_id = 'org'` matches a NULL column — is pinned
 * on a real engine in `packages/runtime/src/package-revert-commit-org-scope.
 * integration.test.ts`. Keep it that way: do not add org-scoping cases here.
 */
const matchesWhere = (r: Record<string, unknown>, w: Record<string, unknown>): boolean => {
  if (!w || typeof w !== 'object') return true;
  for (const [k, v] of Object.entries(w)) {
    if (k === '$and' && Array.isArray(v)) {
      if (!v.every((s: any) => matchesWhere(r, s))) return false;
      continue;
    }
    if (k === '$or' && Array.isArray(v)) {
      if (!v.some((s: any) => matchesWhere(r, s))) return false;
      continue;
    }
    if (k.startsWith('$')) continue;
    if (v === undefined) continue;
    // A column a row never set reads as NULL out of a real driver, so an
    // absent field must satisfy `{ organization_id: null }` — the env-wide
    // branch of the `$or`. Comparing `undefined !== null` would make this
    // double refuse rows SQLite returns.
    const actual = r[k] === undefined ? null : r[k];
    if (actual !== v) return false;
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
function makeRealRepoHarness(seedCommits: any[] = [], opts: { controlPlane?: boolean } = {}) {
  // [#6621] The kernel scope is a FLAG, never an `environmentId` parameter with
  // an `'env_test'` default: passing `undefined` explicitly to a defaulted
  // parameter re-applies the default, so a "control-plane" harness would have
  // silently stayed project-scoped and the overlay-type write-through — which
  // is gated on `environmentId === undefined` — would have been measured as
  // "never registers anything at all".
  const environmentId: string | undefined = opts.controlPlane === true ? undefined : 'env_test';
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

  const protocol = new ObjectStackProtocolImplementation(engine, undefined, environmentId);
  return { protocol, engine, rows, historyRows, commits, registry };
}

/**
 * The reverted artifact is a `view`, not an `object`, and deliberately: the
 * repository's `assertAllowed` refuses `override-artifact` on `object` (not
 * `allowOrgOverride`), and `revertCommit` — unlike `rollbackMetaItem`, which
 * derives `runtime-only` for a runtime-created artifact — passed no intent, so
 * an object item failed that gate BEFORE reaching the scoping this file pins.
 * That was a separate defect of the same family, fixed as #6563 (whose own pins
 * are the last block in this file); using an overlay-allowed type keeps this pin
 * measuring one thing. The repository line under test is type-agnostic.
 */
const gridBody = (label: string) => ({
  name: 'myapp_case_grid', type: 'grid', label, columns: ['id', 'title'],
  object: 'case', viewKind: 'list', // [#7741] the inline arm requires the object binding pair
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

/**
 * #6563 — `revertCommit` states its write INTENT, per item.
 *
 * The block above could only be written about a `view`: `revertCommit` passed
 * no `intent`, so `SysMetadataRepository.restoreVersion` fell back to its
 * `?? 'override-artifact'` default, `put` opened with
 * `assertAllowed(ref.type, opts.intent)`, and every type that is not
 * `allowOrgOverride` was refused — `object` among them. So the metadata type
 * Studio creates most could not be reverted through the package-commit undo AT
 * ALL, while the same edit reverted fine one artifact at a time through
 * `rollbackMetaItem`, which derives the intent instead of defaulting it. The
 * two user-facing revert paths disagreed about what is revertable.
 *
 * The repository default is unchanged and correct — it is right for callers
 * that genuinely mean "override a packaged artifact". What was missing is this
 * caller saying which of the two cases each item is, which is why the fix is a
 * per-item `isArtifactBacked` derivation in `revertCommit` and not a looser
 * gate: the artifact-backed refusal below is the half that must NOT move.
 */

const invoiceBody = (name: string, extra?: Record<string, unknown>) => ({
  name,
  label: 'Invoice',
  fields: {
    name: { name: 'name', type: 'text', label: 'Name' },
    amount: { name: 'amount', type: 'number', label: 'Amount' },
  },
  ...extra,
});

/** v2 of the same object: the commit's edit added a field. */
const evolvedInvoiceBody = (name: string) => {
  const body = invoiceBody(name);
  (body.fields as Record<string, unknown>).due_date = { name: 'due_date', type: 'date', label: 'Due' };
  return body;
};

/** The exact measured repro: saved twice through `saveMetaItem`, then reverted. */
async function seedObjectEdit(protocol: any, name: string, packageId?: string) {
  const pkg = packageId ? { packageId } : {};
  await protocol.saveMetaItem({ type: 'object', name, ...pkg, item: invoiceBody(name) });
  await protocol.saveMetaItem({ type: 'object', name, ...pkg, item: evolvedInvoiceBody(name) });
}

const storedFields = (rows: Map<string, any>, name: string) => {
  const stored = Array.from(rows.values()).filter((r) => r.name === name);
  expect(stored).toHaveLength(1);
  return { row: stored[0], fields: Object.keys(JSON.parse(stored[0].metadata).fields) };
};

const objectCommit = (over: Record<string, unknown> & { id: string; items: any[] }) => applyCommit({
  package_id: APP_PKG,
  created_at: '2026-08-08T00:00:02.000Z',
  ...over,
} as any);

describe('#6563 — revertCommit restores a runtime-created `object`', () => {
  it('a package-bound object reverts: revertedCount 1, failed [], pre-commit body back', async () => {
    const { protocol, rows } = makeRealRepoHarness([objectCommit({
      id: 'cmt_obj',
      items: [{ type: 'object', name: 'myapp_invoice', existedBefore: true, prevVersion: 1 }],
    })]);
    await seedObjectEdit(protocol, 'myapp_invoice', APP_PKG);

    const res = await protocol.revertCommit({ commitId: 'cmt_obj' });

    // Pre-fix, verbatim: revertedCount 0 / failedCount 1 carrying
    // "[NOT_OVERRIDABLE] 'object' is not allowOrgOverride in the registry."
    expect(res.failed).toEqual([]);
    expect(res.revertedCount).toBe(1);
    expect(res.reverted[0]).toMatchObject({ type: 'object', name: 'myapp_invoice', action: 'restored' });
    // The restore also still lands IN PLACE on the bound row (#6215's half, now
    // exercised on the type that could not reach it).
    const { row, fields } = storedFields(rows, 'myapp_invoice');
    expect(row.package_id).toBe(APP_PKG);
    expect(fields).not.toContain('due_date');
  });

  it('a package-LESS object reverts identically — the binding was never the cause', async () => {
    const { protocol, rows } = makeRealRepoHarness([objectCommit({
      id: 'cmt_obj_global',
      package_id: null,
      items: [{ type: 'object', name: 'global_invoice', existedBefore: true, prevVersion: 1 }],
    })]);
    await seedObjectEdit(protocol, 'global_invoice');

    const res = await protocol.revertCommit({ commitId: 'cmt_obj_global' });

    expect(res.failed).toEqual([]);
    expect(res.revertedCount).toBe(1);
    const { row, fields } = storedFields(rows, 'global_invoice');
    expect(row.package_id).toBeNull();
    expect(fields).not.toContain('due_date');
  });

  /**
   * The refusal that must SURVIVE the fix. Deriving the intent is the caller
   * stating its case, not a wider gate: an object a code package really ships
   * resolves to `'override-artifact'` and is refused exactly as before.
   *
   * Staging it needs the ordering a real deployment has anyway — the overlay
   * rows are authored while the name is runtime-only, and the artifact arrives
   * with the package that later claims it. `registerObject(body, pkg)` with no
   * `_provenance` is the shape `applyProtection` stamps as `'package'`, which
   * is what `getArtifactItem` reads and `isArtifactBacked` answers on (the same
   * lever #4636's B-minimal counter-example pulls).
   *
   * Envelope note (ADR-0112): `revertCommit` converts a per-item throw into a
   * `failed[]` record whose DECLARED shape is `{ type, name, error, code? }` —
   * no `status`. So `code` is asserted here together with the condition's own
   * first sentence, and the full `{ code, status }` pair is asserted at the
   * throwing surface in `protocol-writepath-object-ownership.test.ts`.
   */
  it('still REFUSES an artifact-backed object: NOT_OVERRIDABLE, nothing written', async () => {
    const { protocol, registry, rows } = makeRealRepoHarness([objectCommit({
      id: 'cmt_obj_artifact',
      items: [{ type: 'object', name: 'myapp_invoice', existedBefore: true, prevVersion: 1 }],
    })]);
    await seedObjectEdit(protocol, 'myapp_invoice', APP_PKG);
    registry.registerObject(invoiceBody('myapp_invoice') as never, APP_PKG);

    const res = await protocol.revertCommit({ commitId: 'cmt_obj_artifact' });

    expect(res.revertedCount).toBe(0);
    expect(res.failedCount).toBe(1);
    expect(res.failed[0]).toMatchObject({
      type: 'object',
      name: 'myapp_invoice',
      code: 'NOT_OVERRIDABLE',
    });
    expect(res.failed[0].error).toContain(
      `[NOT_OVERRIDABLE] 'object' is not allowOrgOverride in the registry.`,
    );
    // Refused means refused: the edit the commit made is still the live body.
    expect(storedFields(rows, 'myapp_invoice').fields).toContain('due_date');
  });

  /**
   * PER ITEM, not per call — the half a single-item fixture cannot see. One
   * commit, two objects, opposite verdicts: a `for` loop that hoisted one
   * intent for the batch would have to pick one and be wrong about the other.
   */
  it('derives the intent PER ITEM: one object restored, its artifact-backed neighbour refused', async () => {
    const { protocol, registry, rows } = makeRealRepoHarness([objectCommit({
      id: 'cmt_obj_mixed',
      items: [
        { type: 'object', name: 'myapp_invoice', existedBefore: true, prevVersion: 1 },
        { type: 'object', name: 'myapp_quote', existedBefore: true, prevVersion: 1 },
      ],
    })]);
    await seedObjectEdit(protocol, 'myapp_invoice', APP_PKG);
    await seedObjectEdit(protocol, 'myapp_quote', APP_PKG);
    // Only the quote is claimed by a code artifact.
    registry.registerObject(invoiceBody('myapp_quote') as never, APP_PKG);

    const res = await protocol.revertCommit({ commitId: 'cmt_obj_mixed' });

    expect(res.reverted).toEqual([
      { type: 'object', name: 'myapp_invoice', action: 'restored' },
    ]);
    expect(res.failed).toHaveLength(1);
    expect(res.failed[0]).toMatchObject({ name: 'myapp_quote', code: 'NOT_OVERRIDABLE' });
    expect(storedFields(rows, 'myapp_invoice').fields).not.toContain('due_date');
    expect(storedFields(rows, 'myapp_quote').fields).toContain('due_date');
  });
});

/**
 * #6563 — the inheritance. `rollbackToPackageCommit` reverts through the SAME
 * loop, one `revertCommit` per apply commit newer than the target.
 *
 * Its own return shape cannot show this defect: `revertCommit` converts a
 * per-item refusal into `failed[]` rather than throwing, so the rollback
 * recorded the commit as reverted and answered `success: true` while the object
 * was untouched. The assertion that goes red pre-fix is therefore the STORED
 * BODY, not the status — asserting `success` alone would have been green on the
 * defect.
 */
describe('#6563 — rollbackToPackageCommit inherits the per-item intent', () => {
  it('rolls an object edit back through the loop — and the stored body really moved', async () => {
    const { protocol, rows } = makeRealRepoHarness([
      objectCommit({ id: 'cmt_base', items: [], created_at: '2026-08-08T00:00:01.000Z' }),
      objectCommit({
        id: 'cmt_edit',
        items: [{ type: 'object', name: 'myapp_invoice', existedBefore: true, prevVersion: 1 }],
        created_at: '2026-08-08T00:00:02.000Z',
      }),
    ]);
    await seedObjectEdit(protocol, 'myapp_invoice', APP_PKG);

    const res = await protocol.rollbackToPackageCommit({ commitId: 'cmt_base' });

    expect(res.revertedCommits).toEqual(['cmt_edit']);
    expect(res.failed).toEqual([]);
    // `success: true` was ALREADY true pre-fix — this is the line that was not.
    const { row, fields } = storedFields(rows, 'myapp_invoice');
    expect(row.package_id).toBe(APP_PKG);
    expect(fields).not.toContain('due_date');
  });
});

/**
 * #6620 — the OTHER limb of the same loop: SOFT-REMOVE states its intent too.
 *
 * `revertCommit` has two limbs, and #6563 (above) only fixed the restore one.
 * The limb that undoes an artifact the commit CREATED stated its intent as a
 * CONSTANT — `intent: 'override-artifact'`, written into the `repo.delete(...)`
 * call — and `SysMetadataRepository.delete` opens with the same
 * `assertAllowed(ref.type, opts.intent)` gate `put` uses. So `object`, which is
 * not `allowOrgOverride`, was refused on the delete path exactly as it had been
 * on the restore path, and a commit that CREATED an object could not be
 * reverted either.
 *
 * That is the FIRST-BUILD undo — publish a brand-new app, then undo it — which
 * is the flow Studio and AI authoring produce most. Every object the commit
 * created stayed behind, `success` came back `false` with a populated
 * `failed[]`, and the package was left half-reverted: its overlay-allowed items
 * removed, its objects not.
 *
 * The two causes are different even though the symptom rhymes: #6563 was an
 * UNSTATED intent falling through to the repository's `?? 'override-artifact'`
 * default, this one is a literal the caller wrote down. The fix is the same
 * family shape — derive it per item from `isArtifactBacked`, the way the
 * sibling delete caller `deleteMetaItem` and the sibling revert caller
 * `rollbackMetaItem` both already do — so all three delete/revert callers now
 * agree, and the repository's gate is untouched.
 */

/** The commit item shape for an artifact this commit CREATED (ADR-0067). */
const createdItem = (name: string) => ({
  type: 'object', name, existedBefore: false, prevVersion: null,
});

/** The first-build shape: authored ONCE, never edited — nothing to restore to. */
async function seedCreatedObject(protocol: any, name: string, packageId?: string) {
  await protocol.saveMetaItem({
    type: 'object', name, ...(packageId ? { packageId } : {}), item: invoiceBody(name),
  });
}

const storedRows = (rows: Map<string, any>, name: string) =>
  Array.from(rows.values()).filter((r) => r.name === name);

describe('#6620 — revertCommit soft-removes a runtime-CREATED `object`', () => {
  it('a package-bound created object reverts: revertedCount 1, failed [], row gone', async () => {
    const { protocol, rows, historyRows } = makeRealRepoHarness([objectCommit({
      id: 'cmt_new',
      items: [createdItem('myapp_invoice')],
    })]);
    await seedCreatedObject(protocol, 'myapp_invoice', APP_PKG);
    expect(storedRows(rows, 'myapp_invoice')).toHaveLength(1);

    const res = await protocol.revertCommit({ commitId: 'cmt_new' });

    // Pre-fix, verbatim (the issue's measurement): success false, revertedCount
    // 0, failedCount 1 carrying "[NOT_OVERRIDABLE] 'object' is not
    // allowOrgOverride in the registry.", and the row still standing.
    expect(res.failed).toEqual([]);
    expect(res.success).toBe(true);
    expect(res.revertedCount).toBe(1);
    expect(res.reverted[0]).toMatchObject({ type: 'object', name: 'myapp_invoice', action: 'removed' });
    expect(storedRows(rows, 'myapp_invoice')).toHaveLength(0);
    // Soft, not hard: ADR-0067 §5 keeps the removal recoverable, so the delete
    // is an append-only tombstone in history rather than a vanished lineage.
    const tombstone = historyRows.filter(
      (h) => h.name === 'myapp_invoice' && h.operation_type === 'delete',
    );
    expect(tombstone).toHaveLength(1);
    expect(tombstone[0].metadata).toBeNull();
  });

  it('a package-LESS created object reverts identically — the binding was never the cause', async () => {
    const { protocol, rows } = makeRealRepoHarness([objectCommit({
      id: 'cmt_new_global',
      package_id: null,
      items: [createdItem('global_invoice')],
    })]);
    await seedCreatedObject(protocol, 'global_invoice');

    const res = await protocol.revertCommit({ commitId: 'cmt_new_global' });

    expect(res.failed).toEqual([]);
    expect(res.revertedCount).toBe(1);
    expect(storedRows(rows, 'global_invoice')).toHaveLength(0);
  });

  /**
   * The refusal that must SURVIVE the fix — and the one case the constant got
   * right by accident, which is why its direction is INVERTED: it was green
   * before the change and is green after. It cannot go red by removing the fix,
   * because removing the fix refuses EVERYTHING. What it does go red on is the
   * wrong fix — hard-coding `'runtime-only'` in place of the old
   * `'override-artifact'` — which is the mistake a one-line "just make objects
   * work" edit would make, and which would let a revert tombstone an artifact a
   * code package genuinely ships.
   *
   * Staged the way a real deployment stages it (as in #6563's block): the
   * overlay row is authored while the name is runtime-only, and the artifact
   * arrives with the package that later claims it. `registerObject(body, pkg)`
   * with no `_provenance` is the shape `applyProtection` stamps as `'package'`,
   * which is what `getArtifactItem` reads and `isArtifactBacked` answers on.
   *
   * Envelope note (ADR-0112): `revertCommit` converts a per-item throw into a
   * `failed[]` record whose DECLARED shape is `{ type, name, error, code? }` —
   * no `status`. So `code` is asserted here together with the condition's own
   * first sentence, and the full `{ code, status }` pair belongs to the
   * throwing surface (`protocol-writepath-object-ownership.test.ts`), exactly
   * as #6563 split it.
   */
  it('still REFUSES soft-removing an artifact-backed object: NOT_OVERRIDABLE, row kept', async () => {
    const { protocol, registry, rows } = makeRealRepoHarness([objectCommit({
      id: 'cmt_new_artifact',
      items: [createdItem('myapp_invoice')],
    })]);
    await seedCreatedObject(protocol, 'myapp_invoice', APP_PKG);
    registry.registerObject(invoiceBody('myapp_invoice') as never, APP_PKG);

    const res = await protocol.revertCommit({ commitId: 'cmt_new_artifact' });

    expect(res.revertedCount).toBe(0);
    expect(res.failedCount).toBe(1);
    expect(res.failed[0]).toMatchObject({
      type: 'object',
      name: 'myapp_invoice',
      code: 'NOT_OVERRIDABLE',
    });
    expect(res.failed[0].error).toContain(
      `[NOT_OVERRIDABLE] 'object' is not allowOrgOverride in the registry.`,
    );
    // Refused means refused: the artifact-backed row is still there.
    expect(storedRows(rows, 'myapp_invoice')).toHaveLength(1);
  });

  /**
   * PER ITEM, not per call — the half a single-item fixture cannot see, on the
   * soft-remove limb this time. One commit, two created objects, opposite
   * verdicts: a loop that hoisted one intent for the batch (which is precisely
   * what the constant did) has to pick one and be wrong about the other.
   */
  it('derives the intent PER ITEM: one created object removed, its artifact-backed neighbour refused', async () => {
    const { protocol, registry, rows } = makeRealRepoHarness([objectCommit({
      id: 'cmt_new_mixed',
      items: [createdItem('myapp_invoice'), createdItem('myapp_quote')],
    })]);
    await seedCreatedObject(protocol, 'myapp_invoice', APP_PKG);
    await seedCreatedObject(protocol, 'myapp_quote', APP_PKG);
    // Only the quote is claimed by a code artifact.
    registry.registerObject(invoiceBody('myapp_quote') as never, APP_PKG);

    const res = await protocol.revertCommit({ commitId: 'cmt_new_mixed' });

    expect(res.reverted).toEqual([
      { type: 'object', name: 'myapp_invoice', action: 'removed' },
    ]);
    expect(res.failed).toHaveLength(1);
    expect(res.failed[0]).toMatchObject({ name: 'myapp_quote', code: 'NOT_OVERRIDABLE' });
    expect(storedRows(rows, 'myapp_invoice')).toHaveLength(0);
    expect(storedRows(rows, 'myapp_quote')).toHaveLength(1);
  });

  /**
   * A commit that created BOTH an overlay-allowed item and an object is the
   * half-reverted package the issue describes: pre-fix the view came out and
   * the object stayed, so `success` was `false` and the package sat in a state
   * neither before nor after the commit.
   */
  it('reverts a mixed-TYPE first build whole: the view and the object both come out', async () => {
    const { protocol, rows } = makeRealRepoHarness([objectCommit({
      id: 'cmt_new_build',
      items: [
        createdItem('myapp_invoice'),
        { type: 'view', name: 'myapp_case_grid', existedBefore: false, prevVersion: null },
      ],
    })]);
    await seedCreatedObject(protocol, 'myapp_invoice', APP_PKG);
    await protocol.saveMetaItem({
      type: 'view', name: 'myapp_case_grid', packageId: APP_PKG, item: gridBody('Cases'),
    });

    const res = await protocol.revertCommit({ commitId: 'cmt_new_build' });

    expect(res.failed).toEqual([]);
    expect(res.success).toBe(true);
    expect(res.revertedCount).toBe(2);
    expect(storedRows(rows, 'myapp_invoice')).toHaveLength(0);
    expect(storedRows(rows, 'myapp_case_grid')).toHaveLength(0);
  });
});

/**
 * #6620 — the inheritance, on the soft-remove limb. `rollbackToPackageCommit`
 * reverts through the SAME loop, so it carried the same constant.
 *
 * As in #6563's inheritance pin, the status cannot show the defect:
 * `revertCommit` turns a per-item refusal into `failed[]` instead of throwing,
 * so the rollback recorded the commit as reverted and answered `success: true`
 * while the created object was never removed. The line that goes red pre-fix is
 * the STORED ROW.
 */
/**
 * #6621 — a successful `revertCommit` REFRESHES the SchemaRegistry.
 *
 * Everything above pins what `revertCommit` writes to `sys_metadata`. Nothing
 * above looks at what the RUNTIME then dispatches on, and that is where this
 * defect lived: the restore limb awaited `repo.restoreVersion(...)`, pushed
 * `{ action: 'restored' }` and moved on, while the sibling single-item revert
 * `rollbackMetaItem` had ended the same repository call with a registry
 * write-through since #4521 ("a rollback is a live write like any other"). One
 * seam over, the rule was simply missing.
 *
 * Measured on `origin/main` (this file's own harness, real
 * `SysMetadataRepository`), an `object` saved twice then reverted:
 *
 *   revertCommit                         -> { success: true, revertedCount: 1, failed: [] }
 *   stored sys_metadata row fields       -> ["name","amount"]                  # reverted
 *   SchemaRegistry.getObject(...) fields -> [..., "name","amount","due_date"]  # NOT reverted
 *
 * `success: true` while CRUD keeps dispatching the body the operator just
 * reverted away, healing only at the next restart — and
 * `rollbackToPackageCommit` reverts through the same loop, so a whole-package
 * rollback could report success and change nothing the running process sees.
 *
 * Type-agnostic and older than #6563: an overlay `view` on a control-plane
 * kernel showed the same split (stored `Cases`, registry still `Renamed`).
 * `object` merely makes it loud, because the registry copy is what data CRUD
 * dispatches on.
 */

/** The registry copy — the thing the runtime dispatches on, not the row. */
const registryObjectFields = (registry: SchemaRegistry, name: string) =>
  Object.keys(((registry.getObject(name) as any)?.fields ?? {}));

const registryViewLabel = (registry: SchemaRegistry, name: string) =>
  (registry.getItem('view', name) as any)?.label ?? null;

describe('#6621 — revertCommit RESTORE limb refreshes the registry', () => {
  it('an object revert moves the registry copy too, not just the stored row', async () => {
    const { protocol, rows, registry } = makeRealRepoHarness([objectCommit({
      id: 'cmt_reg_obj',
      items: [{ type: 'object', name: 'myapp_invoice', existedBefore: true, prevVersion: 1 }],
    })]);
    await seedObjectEdit(protocol, 'myapp_invoice', APP_PKG);
    // The edit really is live in the registry before the revert — otherwise
    // "reverted" below could be true for the empty reason.
    expect(registryObjectFields(registry, 'myapp_invoice')).toContain('due_date');

    const res = await protocol.revertCommit({ commitId: 'cmt_reg_obj' });

    expect(res.failed).toEqual([]);
    expect(res.revertedCount).toBe(1);
    expect(storedFields(rows, 'myapp_invoice').fields).not.toContain('due_date');
    // THE LINE THAT WAS RED: pre-fix this still contained `due_date`.
    expect(registryObjectFields(registry, 'myapp_invoice')).not.toContain('due_date');
    expect(registryObjectFields(registry, 'myapp_invoice')).toEqual(
      expect.arrayContaining(['name', 'amount']),
    );
  });

  /**
   * #4636 — the write-through re-registers under the ROW'S OWN ownership key.
   * Stated as the `'sys_metadata'` sentinel instead, `registerObject` throws
   * `already owned by package "app.myapp"` into a best-effort `console.warn`
   * and the registry keeps the pre-revert body — a revert that reports success
   * and changed nothing, which is the very failure this block exists to close.
   * So ownership is asserted as a SURVIVING fact, not a changed one.
   */
  it('ownership survives the refresh: same owner package, still org-provenanced, no clash', async () => {
    const { protocol, registry } = makeRealRepoHarness([objectCommit({
      id: 'cmt_reg_owner',
      items: [{ type: 'object', name: 'myapp_invoice', existedBefore: true, prevVersion: 1 }],
    })]);
    await seedObjectEdit(protocol, 'myapp_invoice', APP_PKG);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const res = await protocol.revertCommit({ commitId: 'cmt_reg_owner' });
      expect(res.failed).toEqual([]);
      expect(registry.getObjectOwner('myapp_invoice')?.packageId).toBe(APP_PKG);
      expect((registry.getObject('myapp_invoice') as any)?._provenance).toBe('org');
      expect(
        warn.mock.calls.map((c) => String(c[0])).filter((m) => m.includes('already owned by package')),
      ).toEqual([]);
    } finally {
      warn.mockRestore();
    }
  });

  /**
   * The overlay half. `applyRegistryWriteThrough`'s non-object branch is gated
   * on `environmentId === undefined`, so this one needs a control-plane kernel
   * — which is also the kernel on which an overlay type could ALWAYS reach this
   * limb, long before #6563 let `object` in. The defect is older than the issue
   * that made it visible.
   */
  it('an overlay-type revert moves the registry copy too (control-plane kernel)', async () => {
    const { protocol, rows, registry } = makeRealRepoHarness([applyCommit({
      id: 'cmt_reg_view',
      package_id: APP_PKG,
      items: [{ type: 'view', name: 'myapp_case_grid', existedBefore: true, prevVersion: 1 }],
      created_at: '2026-08-08T00:00:02.000Z',
    })], { controlPlane: true });
    await seedPackageBoundEdit(protocol);
    expect(registryViewLabel(registry, 'myapp_case_grid')).toBe('Renamed');

    const res = await protocol.revertCommit({ commitId: 'cmt_reg_view' });

    expect(res.failed).toEqual([]);
    const stored = Array.from(rows.values()).filter((r) => r.name === 'myapp_case_grid');
    expect(JSON.parse(stored[0].metadata).label).toBe('Cases');
    // THE LINE THAT WAS RED: pre-fix the registry still served 'Renamed'.
    expect(registryViewLabel(registry, 'myapp_case_grid')).toBe('Cases');
  });

  /**
   * [#6602] The org dimension, INHERITED rather than re-decided here. ADR-0005:
   * only env-wide rows enter the process-wide SchemaRegistry, and PR #6779 made
   * `organizationId` a REQUIRED argument of the write-through so no caller can
   * forget to say which it is. This limb passes the row's own org, so an
   * org-scoped revert persists and stays out of the shared registry.
   *
   * Direction note (measured, not assumed): this case is green BEFORE the fix
   * as well — pre-fix nothing was written through at all, so "the shared
   * registry is untouched" was true for the wrong reason. It cannot go red by
   * removing the write-through; what it goes red on is the write-through
   * passing anything other than the row's own org, which is the mistake the
   * required parameter exists to prevent.
   */
  it('an ORG-scoped revert persists and still never reaches the process-wide registry', async () => {
    const { protocol, rows, registry } = makeRealRepoHarness([applyCommit({
      id: 'cmt_reg_org',
      package_id: APP_PKG,
      organization_id: 'org_a',
      items: [{ type: 'view', name: 'myapp_case_grid', existedBefore: true, prevVersion: 1 }],
      created_at: '2026-08-08T00:00:02.000Z',
    })], { controlPlane: true });
    await protocol.saveMetaItem({
      type: 'view', name: 'myapp_case_grid', organizationId: 'org_a', packageId: APP_PKG, item: gridBody('Cases'),
    });
    await protocol.saveMetaItem({
      type: 'view', name: 'myapp_case_grid', organizationId: 'org_a', packageId: APP_PKG, item: gridBody('Renamed'),
    });
    expect(registryViewLabel(registry, 'myapp_case_grid')).toBeNull();

    const res = await protocol.revertCommit({ commitId: 'cmt_reg_org', organizationId: 'org_a' });

    expect(res.failed).toEqual([]);
    expect(res.revertedCount).toBe(1);
    const stored = Array.from(rows.values()).filter((r) => r.name === 'myapp_case_grid');
    expect(stored[0].organization_id).toBe('org_a');
    expect(JSON.parse(stored[0].metadata).label).toBe('Cases');
    expect(registryViewLabel(registry, 'myapp_case_grid')).toBeNull();
  });
});

/**
 * #6621 — the SOFT-REMOVE limb's symmetric decision, and why it is `reuse the
 * heal` rather than `nothing` or `unregister`.
 *
 * Measured on `origin/main`: a first-build undo of a created `object` answered
 * `success: true`, left zero `sys_metadata` rows for the name, and the registry
 * kept serving it. Same for a created overlay `view` on a control-plane kernel.
 * So "do nothing" was not a neutral option — it is the measured defect.
 *
 * The heal reused is the one the sibling DELETE caller `deleteMetaItem` runs
 * after its own `repo.delete` (`restoreArtifactRegistryView`, the #6687
 * three-tier walk), and the tiers are the reason a flat unregister was
 * rejected: an overlay that shadows a packaged artifact must fall BACK to the
 * artifact (tier 1), and only a name no layer serves is retired (tier 3,
 * #5079). Both cases are pinned below.
 *
 * These assert PARITY with `deleteMetaItem` rather than a literal registry
 * state, deliberately. The two callers perform the same repository delete and
 * should leave the same runtime view; stating it as parity also kept the pin
 * honest about a gap it did NOT close — `restoreArtifactRegistryView` reached
 * the `metadata` map but not `objectContributors`, so `getObject` still served
 * a soft-removed runtime object. That gap was `deleteMetaItem`'s too (there was
 * no per-name object unregister in `SchemaRegistry` at all, only
 * `unregisterObjectsByPackage`), it was not introduced here, and the parity
 * assertion was written to stay green when it was fixed for both.
 *
 * [#6808] It has been: `SchemaRegistry.unregisterObject` is the name-addressed
 * removal that was missing, and the heal's tier-3 branch now calls it, so both
 * callers stop serving the object as well as listing it. The parity assertion
 * is unchanged and still green — but `objectServed` now reads `false` on both
 * sides rather than `true` on both, so the object case below states that
 * value outright. A parity pin that never names the value it agrees on can
 * freeze a shared bug as "consistent"; this one no longer can.
 */

/** The registry facts a soft-remove is allowed to change, as one comparable value. */
const registryShapeFor = (registry: SchemaRegistry, type: string, name: string) => ({
  plainKeyEntry: Array.from(
    ((registry as any).metadata as Map<string, Map<string, unknown>>).get(type)?.keys() ?? [],
  ).includes(name),
  itemLabel: (registry.getItem(type, name) as any)?.label ?? null,
  objectServed: registry.getObject(name) !== undefined,
});

describe('#6621 — revertCommit SOFT-REMOVE limb heals the registry, like deleteMetaItem', () => {
  it('a created overlay item stops being served — and matches what deleteMetaItem leaves', async () => {
    const viaRevert = makeRealRepoHarness([applyCommit({
      id: 'cmt_reg_new_view',
      package_id: APP_PKG,
      items: [{ type: 'view', name: 'myapp_case_grid', existedBefore: false, prevVersion: null }],
      created_at: '2026-08-08T00:00:02.000Z',
    })], { controlPlane: true });
    await viaRevert.protocol.saveMetaItem({
      type: 'view', name: 'myapp_case_grid', packageId: APP_PKG, item: gridBody('Cases'),
    });
    expect(registryViewLabel(viaRevert.registry, 'myapp_case_grid')).toBe('Cases');

    const res = await viaRevert.protocol.revertCommit({ commitId: 'cmt_reg_new_view' });
    expect(res.failed).toEqual([]);
    expect(storedRows(viaRevert.rows, 'myapp_case_grid')).toHaveLength(0);
    // THE LINE THAT WAS RED: pre-fix the registry still served 'Cases'.
    expect(registryViewLabel(viaRevert.registry, 'myapp_case_grid')).toBeNull();

    // …and it is the SAME view the single-item delete leaves behind.
    const viaDelete = makeRealRepoHarness([], { controlPlane: true });
    await viaDelete.protocol.saveMetaItem({
      type: 'view', name: 'myapp_case_grid', packageId: APP_PKG, item: gridBody('Cases'),
    });
    await viaDelete.protocol.deleteMetaItem({ type: 'view', name: 'myapp_case_grid' });
    expect(registryShapeFor(viaRevert.registry, 'view', 'myapp_case_grid'))
      .toEqual(registryShapeFor(viaDelete.registry, 'view', 'myapp_case_grid'));
  });

  /**
   * Tier 1, and the reason a flat `removeOverlayEntry` was the WRONG answer: a
   * packaged artifact sits under the reverted overlay, so the revert must leave
   * the artifact serving the name — not leave the name unresolvable.
   */
  it('falls BACK to the packaged artifact when one is underneath, never retiring the name', async () => {
    const { protocol, registry } = makeRealRepoHarness([applyCommit({
      id: 'cmt_reg_new_shadow',
      package_id: APP_PKG,
      items: [{ type: 'view', name: 'myapp_case_grid', existedBefore: false, prevVersion: null }],
      created_at: '2026-08-08T00:00:02.000Z',
    })], { controlPlane: true });
    // The code package's own artifact, registered under its composite key.
    (registry as any).registerItem('view', gridBody('Packaged'), 'name', APP_PKG);
    await protocol.saveMetaItem({
      type: 'view', name: 'myapp_case_grid', packageId: APP_PKG, item: gridBody('Overlay'),
    });
    expect(registryViewLabel(registry, 'myapp_case_grid')).toBe('Overlay');

    await protocol.revertCommit({ commitId: 'cmt_reg_new_shadow' });

    // Not `null` — the artifact default is back (ADR-0005 reset semantics).
    expect(registryViewLabel(registry, 'myapp_case_grid')).toBe('Packaged');
  });

  it('an object soft-remove leaves exactly the registry view deleteMetaItem leaves', async () => {
    const viaRevert = makeRealRepoHarness([objectCommit({
      id: 'cmt_reg_new_obj',
      items: [createdItem('myapp_invoice')],
    })], { controlPlane: true });
    await seedCreatedObject(viaRevert.protocol, 'myapp_invoice', APP_PKG);
    expect(registryShapeFor(viaRevert.registry, 'object', 'myapp_invoice').plainKeyEntry).toBe(true);

    const res = await viaRevert.protocol.revertCommit({ commitId: 'cmt_reg_new_obj' });
    expect(res.failed).toEqual([]);
    expect(storedRows(viaRevert.rows, 'myapp_invoice')).toHaveLength(0);
    // THE LINE THAT WAS RED: pre-fix the plain-key entry stayed for the life of
    // the process, so `GET /meta/object` kept enumerating a reverted-away item.
    expect(registryShapeFor(viaRevert.registry, 'object', 'myapp_invoice').plainKeyEntry).toBe(false);
    // [#6808] THE SECOND LINE THAT WAS RED, and the load-bearing one: the
    // contributor entry survived, so `getObject` — the surface data CRUD
    // dispatches on — kept serving a soft-removed object. Named outright rather
    // than left to the parity comparison below, which agreed on `true` before
    // this was fixed and agrees on `false` after.
    expect(registryShapeFor(viaRevert.registry, 'object', 'myapp_invoice').objectServed).toBe(false);

    const viaDelete = makeRealRepoHarness([], { controlPlane: true });
    await seedCreatedObject(viaDelete.protocol, 'myapp_invoice', APP_PKG);
    await viaDelete.protocol.deleteMetaItem({ type: 'object', name: 'myapp_invoice' });
    expect(registryShapeFor(viaDelete.registry, 'object', 'myapp_invoice').objectServed).toBe(false);
    expect(registryShapeFor(viaRevert.registry, 'object', 'myapp_invoice'))
      .toEqual(registryShapeFor(viaDelete.registry, 'object', 'myapp_invoice'));
  });

  /**
   * [#6602] The org gate on this limb is ASYMMETRIC with the write-through's
   * object branch, on purpose: only an env-wide revert may mutate the registry
   * every org in this process shares. An org-scoped row never entered it, so
   * healing on its behalf would retire or un-shadow the ENV-WIDE row's entry —
   * a per-org undo breaking every other org. Register wide, retire narrow.
   */
  it('an ORG-scoped soft-remove leaves the env-wide registry entry alone', async () => {
    const { protocol, rows, registry } = makeRealRepoHarness([applyCommit({
      id: 'cmt_reg_new_org',
      package_id: APP_PKG,
      organization_id: 'org_a',
      items: [{ type: 'view', name: 'myapp_case_grid', existedBefore: false, prevVersion: null }],
      created_at: '2026-08-08T00:00:02.000Z',
    })], { controlPlane: true });
    // The env-wide row is what the shared registry holds (ADR-0005).
    await protocol.saveMetaItem({
      type: 'view', name: 'myapp_case_grid', packageId: APP_PKG, item: gridBody('EnvWide'),
    });
    // …and org A authored its own overlay of the same name.
    await protocol.saveMetaItem({
      type: 'view', name: 'myapp_case_grid', organizationId: 'org_a', packageId: APP_PKG, item: gridBody('OrgA'),
    });
    expect(registryViewLabel(registry, 'myapp_case_grid')).toBe('EnvWide');

    const res = await protocol.revertCommit({ commitId: 'cmt_reg_new_org', organizationId: 'org_a' });

    expect(res.failed).toEqual([]);
    // Org A's row really went away…
    expect(Array.from(rows.values()).filter((r) => r.name === 'myapp_case_grid' && r.organization_id === 'org_a'))
      .toHaveLength(0);
    // …and the env-wide entry every other org reads is untouched.
    expect(registryViewLabel(registry, 'myapp_case_grid')).toBe('EnvWide');
  });
});

/**
 * #6621 — the inheritance. `rollbackToPackageCommit` reverts through the SAME
 * loop, so a whole-package rollback answered `success: true` while the running
 * process kept dispatching every reverted-away body. As in #6563's and #6620's
 * inheritance pins, the status cannot show it: the line that was red is the
 * REGISTRY copy, not the result shape.
 */
describe('#6621 — rollbackToPackageCommit inherits the registry refresh', () => {
  it('rolls an object edit back through the loop — and the registry copy really moved', async () => {
    const { protocol, rows, registry } = makeRealRepoHarness([
      objectCommit({ id: 'cmt_base', items: [], created_at: '2026-08-08T00:00:01.000Z' }),
      objectCommit({
        id: 'cmt_edit',
        items: [{ type: 'object', name: 'myapp_invoice', existedBefore: true, prevVersion: 1 }],
        created_at: '2026-08-08T00:00:02.000Z',
      }),
    ]);
    await seedObjectEdit(protocol, 'myapp_invoice', APP_PKG);
    expect(registryObjectFields(registry, 'myapp_invoice')).toContain('due_date');

    const res = await protocol.rollbackToPackageCommit({ commitId: 'cmt_base' });

    expect(res.revertedCommits).toEqual(['cmt_edit']);
    expect(res.failed).toEqual([]);
    expect(storedFields(rows, 'myapp_invoice').fields).not.toContain('due_date');
    // `success: true` was ALREADY true pre-fix — this is the line that was not.
    expect(registryObjectFields(registry, 'myapp_invoice')).not.toContain('due_date');
  });
});

describe('#6620 — rollbackToPackageCommit inherits the per-item soft-remove intent', () => {
  it('rolls a first build back through the loop — and the created row really went away', async () => {
    const { protocol, rows } = makeRealRepoHarness([
      objectCommit({ id: 'cmt_base', items: [], created_at: '2026-08-08T00:00:01.000Z' }),
      objectCommit({
        id: 'cmt_build',
        items: [createdItem('myapp_invoice')],
        created_at: '2026-08-08T00:00:02.000Z',
      }),
    ]);
    await seedCreatedObject(protocol, 'myapp_invoice', APP_PKG);

    const res = await protocol.rollbackToPackageCommit({ commitId: 'cmt_base' });

    expect(res.revertedCommits).toEqual(['cmt_build']);
    expect(res.failed).toEqual([]);
    // `success: true` was ALREADY true pre-fix — this is the line that was not.
    expect(storedRows(rows, 'myapp_invoice')).toHaveLength(0);
  });
});
