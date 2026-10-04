// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#21729] The attachment gate's parent-editor delete limb, made reachable past
 * the platform's `created_by` delete floor by an alternate match contributed
 * TOGETHER with the gate (`attachment-delete-floor-alternate.ts`).
 *
 * The contribution itself, and every way it can fail to land. The pairing with
 * the gate — contributed where `installAttachmentAccessHooks` runs and nowhere
 * else — is pinned in `storage-service-plugin.test.ts`; the door it opens, in
 * the attachments dogfood matrix.
 */

import { describe, it, expect, vi } from 'vitest';

import {
  ATTACHMENT_FLOOR_ALTERNATE_CONTRIBUTOR,
  ATTACHMENT_PARENT_EDITOR_DELETE,
  contributeAttachmentDeleteFloorAlternate,
} from './attachment-delete-floor-alternate.js';

const logger = () => ({ info: vi.fn(), warn: vi.fn(), debug: vi.fn() });

describe('the alternate match service-storage contributes', () => {
  it('is the delete limb of sys_attachment, every row, and nothing else', () => {
    // Written out: the ruling is the expectation, so editing the module must
    // not edit it too. `id != null` is every row — the gate decides, the
    // floor stops answering. No `positions`: the domain is the floor's.
    expect({ ...ATTACHMENT_PARENT_EDITOR_DELETE }).toEqual({
      name: 'sys_attachment_parent_editor_delete',
      object: 'sys_attachment',
      operation: 'delete',
      using: 'id != null',
    });
    expect(Object.isFrozen(ATTACHMENT_PARENT_EDITOR_DELETE)).toBe(true);
  });

  it('lands through the seam, keyed by this package', () => {
    const contribute = vi.fn();
    const log = logger();
    expect(contributeAttachmentDeleteFloorAlternate(() => ({ contributeOwnershipFloorAlternates: contribute }), log)).toBe(
      'contributed',
    );
    expect(contribute).toHaveBeenCalledTimes(1);
    expect(contribute).toHaveBeenCalledWith(ATTACHMENT_FLOOR_ALTERNATE_CONTRIBUTOR, [ATTACHMENT_PARENT_EDITOR_DELETE]);
    expect(ATTACHMENT_FLOOR_ALTERNATE_CONTRIBUTOR).toBe('com.objectstack.service.storage');
    expect(log.warn).not.toHaveBeenCalled();
  });

  it('no security service: nothing enforces the floor, nothing to relieve — quiet', () => {
    const log = logger();
    const absent = () => {
      throw new Error("service 'security' not registered");
    };
    expect(contributeAttachmentDeleteFloorAlternate(absent, log)).toBe('no-security');
    expect(contributeAttachmentDeleteFloorAlternate(() => undefined, log)).toBe('no-security');
    expect(log.warn).not.toHaveBeenCalled();
  });

  it('a security service without the seam: the floor stays, and the consequence is said at warn', () => {
    const log = logger();
    expect(contributeAttachmentDeleteFloorAlternate(() => ({ getReadFilter: vi.fn() }), log)).toBe('no-seam');
    expect(log.warn).toHaveBeenCalledTimes(1);
    expect(String(log.warn.mock.calls[0]![0])).toMatch(/cannot delete another user's attachment/);
  });

  it('a seam that refuses: the floor stays, the boot goes on, and the refusal is said at warn', () => {
    const log = logger();
    const refusing = {
      contributeOwnershipFloorAlternates: () => {
        throw new Error('refused for the test');
      },
    };
    expect(contributeAttachmentDeleteFloorAlternate(() => refusing, log)).toBe('refused');
    expect(log.warn).toHaveBeenCalledTimes(1);
    expect(String(log.warn.mock.calls[0]![0])).toMatch(/refused the attachment delete alternate \(refused for the test\)/);
  });
});
