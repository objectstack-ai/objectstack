// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect, vi } from 'vitest';
import { ObjectStackProtocolImplementation } from './protocol.js';

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
});
