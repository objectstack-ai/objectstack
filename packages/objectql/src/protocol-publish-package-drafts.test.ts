// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect, vi } from 'vitest';
import { ObjectStackProtocolImplementation } from '@objectstack/metadata-protocol';

/**
 * ADR-0033 — `publishPackageDrafts` promotes every pending draft bound to a
 * package in one shot ("publish whole app"), reusing the per-item
 * `publishMetaItem` primitive (no metadata-service dependency). These tests
 * cover the orchestration: it publishes each listed draft, collects per-item
 * failures without aborting, and reports an accurate success flag.
 */
function makeProtocol(drafts: Array<{ type: string; name: string }>) {
  const protocol = new ObjectStackProtocolImplementation({} as never);
  // Stub the bits that need a real engine/overlay so we can exercise the loop.
  (protocol as any).ensureOverlayIndex = async () => {};
  (protocol as any).getOverlayRepo = () => ({ listDrafts: async () => drafts });
  const publishMetaItem = vi.spyOn(protocol, 'publishMetaItem' as never);
  return { protocol, publishMetaItem };
}

describe('protocol.publishPackageDrafts (ADR-0033)', () => {
  it('publishes every draft of the package and reports success', async () => {
    const drafts = [
      { type: 'object', name: 'course' },
      { type: 'object', name: 'student' },
      { type: 'view', name: 'course_list' },
    ];
    const { protocol, publishMetaItem } = makeProtocol(drafts);
    publishMetaItem.mockResolvedValue({ success: true, version: 'h', seq: 1 } as never);

    const res = await protocol.publishPackageDrafts({ packageId: 'app.edu' });

    expect(publishMetaItem).toHaveBeenCalledTimes(3);
    expect((publishMetaItem.mock.calls[0][0] as any)).toMatchObject({ type: 'object', name: 'course' });
    expect(res).toMatchObject({ success: true, publishedCount: 3, failedCount: 0 });
    expect(res.published.map((p) => p.name)).toEqual(['course', 'student', 'course_list']);
  });

  it('collects per-item failures without aborting the rest', async () => {
    const { protocol, publishMetaItem } = makeProtocol([
      { type: 'object', name: 'course' },
      { type: 'object', name: 'student' },
      { type: 'view', name: 'course_list' },
    ]);
    publishMetaItem.mockImplementation((async (req: any) => {
      if (req.name === 'student') throw Object.assign(new Error('locked'), { code: 'locked' });
      return { success: true, version: 'h', seq: 1 };
    }) as never);

    const res = await protocol.publishPackageDrafts({ packageId: 'app.edu' });

    expect(res.publishedCount).toBe(2);
    expect(res.failedCount).toBe(1);
    expect(res.failed[0]).toMatchObject({ type: 'object', name: 'student', code: 'locked' });
    expect(res.success).toBe(false); // any failure → not a clean success
  });

  it('returns publishedCount 0 / success false for an empty package', async () => {
    const { protocol, publishMetaItem } = makeProtocol([]);

    const res = await protocol.publishPackageDrafts({ packageId: 'app.empty' });

    expect(publishMetaItem).not.toHaveBeenCalled();
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
    const publishMetaItem = vi.spyOn(protocol, 'publishMetaItem' as never);
    publishMetaItem.mockResolvedValue({ success: true, version: 'h', seq: 1 } as never);
    const applySeedBodies = vi
      .spyOn(protocol as any, 'applySeedBodies')
      .mockResolvedValue({ success: true, inserted: 2, updated: 0 });

    const res = await protocol.publishPackageDrafts({ packageId: 'app.pm' });

    // Object published BEFORE the seeds, and every publish suppressed per-item apply.
    expect((publishMetaItem.mock.calls[0][0] as any)).toMatchObject({ type: 'object', name: 'project' });
    for (const call of publishMetaItem.mock.calls) {
      expect((call[0] as any)._skipSeedApply).toBe(true);
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
    const { protocol, publishMetaItem } = makeProtocol([{ type: 'object', name: 'course' }]);
    publishMetaItem.mockResolvedValue({ success: true, version: 'h', seq: 1 } as never);
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
      insert: async (object: string, record: any) => {
        inserted.push({ object, record });
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
