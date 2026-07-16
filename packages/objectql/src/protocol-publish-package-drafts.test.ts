// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect, vi } from 'vitest';
import { ObjectStackProtocolImplementation } from '@objectstack/metadata-protocol';

/**
 * ADR-0033 / ADR-0067 D2 — `publishPackageDrafts` promotes every pending
 * draft bound to a package in one shot ("publish whole app"). Since ADR-0067
 * D2 the orchestration is TWO-PHASE: every promotion + the commit record run
 * inside ONE engine transaction (all-or-nothing — a commit cannot half-land),
 * and side effects (registry/DDL/materializers/projections) run after the
 * metadata committed. These tests cover the orchestration contract; the
 * per-item guards live in `publishMetaItem`'s own suites.
 */
function makeProtocol(drafts: Array<{ type: string; name: string }>) {
  const protocol = new ObjectStackProtocolImplementation({} as never);
  // Stub the bits that need a real engine/overlay so we can exercise the loop.
  (protocol as any).ensureOverlayIndex = async () => {};
  (protocol as any).getOverlayRepo = () => ({ listDrafts: async () => drafts });
  // Phase-1 / Phase-2 seams (ADR-0067 D2).
  const promote = vi.spyOn(protocol as any, 'promoteDraftForPublish');
  const sideEffects = vi
    .spyOn(protocol as any, 'runPublishSideEffects')
    .mockResolvedValue({});
  const promoteOk = (req: any) => ({
    singularType: req.type,
    orgId: null,
    result: { version: 'h', seq: 1, item: { body: { name: req.name } }, packageId: null },
  });
  return { protocol, promote, sideEffects, promoteOk };
}

/** A fake engine whose transaction() tracks commit/rollback (ADR-0067 D2). */
function makeTxnEngine() {
  const txn = { began: 0, committed: 0, rolledBack: 0 };
  const engine = {
    transaction: async <T>(cb: (ctx: unknown) => Promise<T>): Promise<T> => {
      txn.began += 1;
      try {
        const r = await cb({});
        txn.committed += 1;
        return r;
      } catch (e) {
        txn.rolledBack += 1;
        throw e;
      }
    },
  };
  return { engine, txn };
}

describe('protocol.publishPackageDrafts (ADR-0033 / ADR-0067 D2)', () => {
  it('publishes every draft of the package and reports success', async () => {
    const drafts = [
      { type: 'object', name: 'course' },
      { type: 'object', name: 'student' },
      { type: 'view', name: 'course_list' },
    ];
    const { protocol, promote, sideEffects, promoteOk } = makeProtocol(drafts);
    promote.mockImplementation(async (req: any) => promoteOk(req));

    const res = await protocol.publishPackageDrafts({ packageId: 'app.edu' });

    expect(promote).toHaveBeenCalledTimes(3);
    expect((promote.mock.calls[0][0] as any)).toMatchObject({ type: 'object', name: 'course' });
    // Side effects ran once per promoted item, AFTER promotion, in order.
    expect(sideEffects).toHaveBeenCalledTimes(3);
    expect((sideEffects.mock.calls[0][0] as any)).toMatchObject({ requestType: 'object', name: 'course' });
    expect(res).toMatchObject({ success: true, publishedCount: 3, failedCount: 0 });
    expect(res.published.map((p) => p.name)).toEqual(['course', 'student', 'course_list']);
  });

  it('rejects an object draft missing the package namespace prefix — atomic, before promoting', async () => {
    const { protocol, promote } = makeProtocol([
      { type: 'object', name: 'edu_course' },
      { type: 'object', name: 'ticket' }, // missing the 'edu_' prefix
    ]);
    // Package declares namespace 'edu' (derived+persisted at install time).
    (protocol as any).engine = { registry: { getPackage: () => ({ manifest: { namespace: 'edu' } }) } };

    const res = await protocol.publishPackageDrafts({ packageId: 'app.edu' });

    expect(promote).not.toHaveBeenCalled(); // aborted BEFORE any promote
    expect(res.success).toBe(false);
    expect(res.publishedCount).toBe(0);
    expect(res.failedCount).toBe(1);
    expect(res.failed[0]).toMatchObject({ type: 'object', name: 'ticket', code: 'NAMESPACE_PREFIX' });
    expect(res.failed[0].error).toMatch(/Rename it to 'edu_ticket'/);
  });

  it('publishes compliant prefixed object drafts under a declared namespace', async () => {
    const { protocol, promote, promoteOk } = makeProtocol([
      { type: 'object', name: 'edu_course' },
      { type: 'object', name: 'edu_student' },
    ]);
    (protocol as any).engine = { registry: { getPackage: () => ({ manifest: { namespace: 'edu' } }) } };
    promote.mockImplementation(async (req: any) => promoteOk(req));

    const res = await protocol.publishPackageDrafts({ packageId: 'app.edu' });

    expect(res).toMatchObject({ success: true, publishedCount: 2, failedCount: 0 });
  });

  it('skips the namespace check when the package declares no namespace (legacy grandfathered)', async () => {
    // No registry / no declared namespace → bare names still publish, exactly
    // as before this rule existed (mirrors defineStack's absent-namespace skip).
    const { protocol, promote, promoteOk } = makeProtocol([
      { type: 'object', name: 'course' }, // bare name, no prefix
    ]);
    promote.mockImplementation(async (req: any) => promoteOk(req));

    const res = await protocol.publishPackageDrafts({ packageId: 'app.edu' });

    expect(res).toMatchObject({ success: true, publishedCount: 1 });
  });

  it('all-or-nothing (ADR-0067 D2): a mid-batch failure publishes NOTHING and stops the loop', async () => {
    const { protocol, promote, sideEffects, promoteOk } = makeProtocol([
      { type: 'object', name: 'course' },
      { type: 'object', name: 'student' },
      { type: 'view', name: 'course_list' },
    ]);
    promote.mockImplementation(async (req: any) => {
      if (req.name === 'student') throw Object.assign(new Error('locked'), { code: 'locked' });
      return promoteOk(req);
    });

    const res = await protocol.publishPackageDrafts({ packageId: 'app.edu' });

    // The loop stopped AT the failure — the third draft was never attempted…
    expect(promote).toHaveBeenCalledTimes(2);
    // …no side effect ran (side effects are post-commit only)…
    expect(sideEffects).not.toHaveBeenCalled();
    // …and NOTHING reports as published: the causal item carries its real
    // error, every other draft is batch_aborted.
    expect(res.success).toBe(false);
    expect(res.publishedCount).toBe(0);
    expect(res.published).toEqual([]);
    expect(res.failedCount).toBe(3);
    expect(res.failed.find((f) => f.name === 'student')).toMatchObject({ code: 'locked', error: 'locked' });
    expect(res.failed.find((f) => f.name === 'course')).toMatchObject({ code: 'batch_aborted' });
    expect(res.failed.find((f) => f.name === 'course_list')).toMatchObject({ code: 'batch_aborted' });
  });

  it('wraps the batch in ONE engine transaction and rolls it back on failure', async () => {
    const { protocol, promote, promoteOk } = makeProtocol([
      { type: 'object', name: 'course' },
      { type: 'object', name: 'student' },
    ]);
    const { engine, txn } = makeTxnEngine();
    (protocol as any).engine = engine;
    promote.mockImplementation(async (req: any) => {
      if (req.name === 'student') throw new Error('boom');
      return promoteOk(req);
    });

    const res = await protocol.publishPackageDrafts({ packageId: 'app.edu' });

    expect(txn.began).toBe(1);
    expect(txn.rolledBack).toBe(1);
    expect(txn.committed).toBe(0);
    expect(res).toMatchObject({ success: false, publishedCount: 0 });
  });

  it('commits the transaction once on a clean batch', async () => {
    const { protocol, promote, promoteOk } = makeProtocol([
      { type: 'object', name: 'course' },
    ]);
    const { engine, txn } = makeTxnEngine();
    (protocol as any).engine = engine;
    promote.mockImplementation(async (req: any) => promoteOk(req));

    const res = await protocol.publishPackageDrafts({ packageId: 'app.edu' });

    expect(txn.began).toBe(1);
    expect(txn.committed).toBe(1);
    expect(txn.rolledBack).toBe(0);
    expect(res).toMatchObject({ success: true, publishedCount: 1 });
  });

  it('a side-effect failure does NOT unpublish — metadata is live, the failure is surfaced', async () => {
    const { protocol, promote, sideEffects, promoteOk } = makeProtocol([
      { type: 'object', name: 'course' },
      { type: 'view', name: 'course_list' },
    ]);
    promote.mockImplementation(async (req: any) => promoteOk(req));
    sideEffects.mockImplementation(async (args: any) => {
      if (args.name === 'course_list') throw new Error('DDL hiccup');
      return {};
    });

    const res = await protocol.publishPackageDrafts({ packageId: 'app.edu' });

    // Both items published (the metadata transaction already committed)…
    expect(res.publishedCount).toBe(2);
    expect(res.success).toBe(true);
    // …and the side-effect failure is SURFACED, not swallowed into a fake unpublish.
    expect(res.materializeApplied?.success).toBe(false);
    expect(res.materializeApplied?.failures?.[0]).toMatchObject({ name: 'course_list' });
  });

  it('returns publishedCount 0 / success false for an empty package', async () => {
    const { protocol, promote } = makeProtocol([]);

    const res = await protocol.publishPackageDrafts({ packageId: 'app.empty' });

    expect(promote).not.toHaveBeenCalled();
    expect(res).toMatchObject({ success: false, publishedCount: 0, failedCount: 0 });
  });

  it('publishes seeds LAST and batch-applies their rows in ONE pass (seedApplied)', async () => {
    // listDrafts order puts the seed FIRST — the partition must still publish
    // the object before it (its table must exist before rows land).
    const drafts = [
      { type: 'seed', name: 'project_sample' },
      { type: 'object', name: 'project' },
      { type: 'seed', name: 'task_sample' },
    ];
    const protocol = new ObjectStackProtocolImplementation({} as never);
    (protocol as any).ensureOverlayIndex = async () => {};
    const seedBodyByName: Record<string, unknown> = {
      project_sample: { object: 'project', records: [{ name: 'Apollo' }] },
      task_sample: { object: 'task', records: [{ name: 'Design' }] },
    };
    (protocol as any).getOverlayRepo = () => ({
      listDrafts: async () => drafts,
      get: async (ref: any, opts: any) =>
        opts?.state === 'draft' && seedBodyByName[ref.name]
          ? { body: seedBodyByName[ref.name], hash: 'h' }
          : null,
    });
    const promote = vi.spyOn(protocol as any, 'promoteDraftForPublish')
      .mockImplementation(async (req: any) => ({
        singularType: req.type,
        orgId: null,
        result: { version: 'h', seq: 1, item: { body: { name: req.name } }, packageId: null },
      }));
    const sideEffects = vi.spyOn(protocol as any, 'runPublishSideEffects').mockResolvedValue({});
    const applySeedBodies = vi
      .spyOn(protocol as any, 'applySeedBodies')
      .mockResolvedValue({ success: true, inserted: 2, updated: 0 });

    const res = await protocol.publishPackageDrafts({ packageId: 'app.pm' });

    // Object published BEFORE the seeds, and every item's side effects
    // suppressed the per-item seed apply (batch pass below owns it).
    expect((promote.mock.calls[0][0] as any)).toMatchObject({ type: 'object', name: 'project' });
    for (const call of sideEffects.mock.calls) {
      expect((call[0] as any).skipSeedApply).toBe(true);
    }
    // ONE batch apply with BOTH seed bodies (cross-seed refs need a single pass).
    expect(applySeedBodies).toHaveBeenCalledTimes(1);
    expect(applySeedBodies.mock.calls[0][0]).toEqual([
      seedBodyByName.project_sample,
      seedBodyByName.task_sample,
    ]);
    expect(res.seedApplied).toEqual({ success: true, inserted: 2, updated: 0 });
  });

  it('omits seedApplied when the package has no seed drafts', async () => {
    const { protocol, promote, promoteOk } = makeProtocol([{ type: 'object', name: 'course' }]);
    promote.mockImplementation(async (req: any) => promoteOk(req));
    const res = await protocol.publishPackageDrafts({ packageId: 'app.edu' });
    expect(res.seedApplied).toBeUndefined();
  });
});

/**
 * Publishing a single `seed` draft (the per-ref path: POST /meta/seed/:name/publish,
 * used by the home banner) must materialize its rows too — not only the package
 * route. The publish itself NEVER fails on a seed problem; it reports under
 * `seedApplied`.
 */
describe('protocol.publishMetaItem — seed self-apply', () => {
  function makePublishable(body: unknown) {
    const protocol = new ObjectStackProtocolImplementation({} as never);
    (protocol as any).ensureOverlayIndex = async () => {};
    (protocol as any).assertLockAllowsWrite = async () => null;
    (protocol as any).isArtifactBacked = () => false;
    (protocol as any).applyObjectRegistryMutation = () => {};
    (protocol as any).ensureObjectStorage = async () => {};
    (protocol as any).getOverlayRepo = () => ({
      promoteDraft: async () => ({ version: 'sha256:x', seq: 7, item: { body } }),
    });
    const applySeedBodies = vi
      .spyOn(protocol as any, 'applySeedBodies')
      .mockResolvedValue({ success: true, inserted: 3, updated: 0 });
    return { protocol, applySeedBodies };
  }

  it('applies the seed body on publish and reports seedApplied', async () => {
    const body = { object: 'project', records: [{ name: 'Apollo' }] };
    const { protocol, applySeedBodies } = makePublishable(body);
    const res = await protocol.publishMetaItem({ type: 'seed', name: 'project_sample' });
    expect(applySeedBodies).toHaveBeenCalledWith([body], null);
    expect(res.seedApplied).toEqual({ success: true, inserted: 3, updated: 0 });
    expect(res.success).toBe(true);
  });

  it('suppresses the self-apply when _skipSeedApply is set (package batch path)', async () => {
    const { protocol, applySeedBodies } = makePublishable({ object: 'p', records: [] });
    const res = await protocol.publishMetaItem({ type: 'seed', name: 'p_sample', _skipSeedApply: true });
    expect(applySeedBodies).not.toHaveBeenCalled();
    expect(res.seedApplied).toBeUndefined();
  });

  it('does not touch the loader for non-seed publishes', async () => {
    const { protocol, applySeedBodies } = makePublishable({ name: 'overview' });
    const res = await protocol.publishMetaItem({ type: 'dashboard', name: 'overview' });
    expect(applySeedBodies).not.toHaveBeenCalled();
    expect(res.seedApplied).toBeUndefined();
  });
});

/**
 * applySeedBodies wires the real SeedLoaderService: externalId('name')-keyed
 * upsert against the engine, object metadata read through the protocol's own
 * getMetaItem. A smoke test with a fake engine proves rows actually land and
 * the result mapping is faithful.
 */
describe('protocol.applySeedBodies — real loader smoke test', () => {
  it('inserts seed records via the engine and reports counts', async () => {
    const protocol = new ObjectStackProtocolImplementation({} as never);
    const inserted: Array<{ object: string; record: any }> = [];
    (protocol as any).engine = {
      find: async () => [],
      insert: async (object: string, data: any) => {
        // Mirror the real engine's array-form insert (bulk path): an array in
        // → an array of created records out, same order — see framework#2678.
        if (Array.isArray(data)) {
          return data.map((record) => {
            inserted.push({ object, record });
            return { id: `${object}_${inserted.length}` };
          });
        }
        inserted.push({ object, record: data });
        return { id: `${object}_${inserted.length}` };
      },
      update: async () => ({}),
    };
    (protocol as any).getMetaItem = async ({ name }: any) => ({
      item: { name, fields: { name: { type: 'text' } } },
    });

    const res = await (protocol as any).applySeedBodies(
      [{ object: 'project', records: [{ name: 'Apollo' }, { name: 'Gemini' }] }],
      null,
    );

    expect(inserted.map((i) => i.record.name)).toEqual(['Apollo', 'Gemini']);
    expect(res.success).toBe(true);
    expect(res.inserted).toBe(2);
  });

  it('returns a loud failure (never throws) for an unreadable body', async () => {
    const protocol = new ObjectStackProtocolImplementation({} as never);
    const res = await (protocol as any).applySeedBodies([{ nope: true }], null);
    expect(res.success).toBe(false);
    expect(res.error).toMatch(/no readable seed bodies/);
  });
});
