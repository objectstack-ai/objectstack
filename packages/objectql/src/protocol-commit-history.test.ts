// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect, vi } from 'vitest';
import { ObjectStackProtocolImplementation } from '@objectstack/metadata-protocol';

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
    await expect(p.revertCommit({ commitId: 'nope' })).rejects.toMatchObject({ code: 'commit_not_found', status: 404 });
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
    await expect(p.rollbackToPackageCommit({ commitId: 'ghost' })).rejects.toMatchObject({ code: 'commit_not_found' });
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
    vi.spyOn(protocol, 'publishMetaItem' as never).mockResolvedValue({ success: true, version: 'h', seq: 7 } as never);

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
