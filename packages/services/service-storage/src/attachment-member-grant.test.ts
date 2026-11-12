// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Every member's attachment grant, contributed beside the attachment row gates
 * (`attachment-member-grant.ts`): the set itself, and every way it can fail to
 * land. The pairing with the gates — contributed after the last of them is
 * installed, and not at all on a kernel lacking one — is pinned in
 * `storage-service-plugin.test.ts`; what a member can then do, on a real stack,
 * in the dogfood suite `member-attachment-baseline.dogfood.test.ts`.
 */

import { describe, it, expect, vi } from 'vitest';

import {
  ATTACHMENT_MEMBER_GRANT_CONTRIBUTOR,
  ATTACHMENT_MEMBER_PERMISSION_SET,
  contributeAttachmentMemberGrant,
  type AttachmentRowGates,
} from './attachment-member-grant.js';

const logger = () => ({ info: vi.fn(), warn: vi.fn(), debug: vi.fn() });
const ALL_GATES: AttachmentRowGates = { writeRule: true, readVisibility: true, downloadCheck: true };

describe("the members' attachment grant service-storage contributes", () => {
  it('is read and create on sys_attachment, and nothing else', () => {
    // Written out: the ruling is the expectation, so editing the module must
    // not edit it too. No edit, no delete: a set every member holds through
    // the everyone anchor carries no delete bit.
    expect(ATTACHMENT_MEMBER_PERMISSION_SET.name).toBe('storage_attachment_member');
    expect(ATTACHMENT_MEMBER_PERMISSION_SET.objects).toEqual({ sys_attachment: { allowRead: true, allowCreate: true } });
    expect(Object.keys(ATTACHMENT_MEMBER_PERMISSION_SET).sort()).toEqual(['description', 'label', 'name', 'objects']);
    expect(Object.isFrozen(ATTACHMENT_MEMBER_PERMISSION_SET)).toBe(true);
    expect(Object.isFrozen(ATTACHMENT_MEMBER_PERMISSION_SET.objects.sys_attachment)).toBe(true);
  });

  it('lands through the seam when every gate is installed, keyed by this package', () => {
    const contribute = vi.fn(() => ({ name: 'storage_attachment_member', joined: true }));
    const log = logger();
    expect(contributeAttachmentMemberGrant(ALL_GATES, () => ({ contributePlatformBaselineSet: contribute }), log)).toBe('contributed');
    expect(contribute).toHaveBeenCalledTimes(1);
    expect(contribute).toHaveBeenCalledWith(ATTACHMENT_MEMBER_GRANT_CONTRIBUTOR, ATTACHMENT_MEMBER_PERMISSION_SET);
    expect(ATTACHMENT_MEMBER_GRANT_CONTRIBUTOR).toBe('com.objectstack.service.storage');
    expect(log.warn).not.toHaveBeenCalled();
  });

  it.each([
    ['writeRule', 'the attachment write rule'],
    ['readVisibility', 'the attachment read-visibility gate'],
    ['downloadCheck', "the download door's parent-record check"],
  ] as const)('a kernel without %s contributes nothing, and says which gate is missing at warn', (gate, named) => {
    const contribute = vi.fn();
    const log = logger();
    const gates = { ...ALL_GATES, [gate]: false };
    expect(contributeAttachmentMemberGrant(gates, () => ({ contributePlatformBaselineSet: contribute }), log)).toBe('gates-incomplete');
    expect(contribute).not.toHaveBeenCalled();
    expect(log.warn).toHaveBeenCalledTimes(1);
    expect(String(log.warn.mock.calls[0][0])).toContain(named);
    expect(String(log.warn.mock.calls[0][0])).toContain('members are NOT granted attachments');
  });

  it('no security service: no object grant is enforced, nothing to contribute — quiet', () => {
    const log = logger();
    const absent = () => {
      throw new Error("service 'security' not registered");
    };
    expect(contributeAttachmentMemberGrant(ALL_GATES, absent, log)).toBe('no-security');
    expect(contributeAttachmentMemberGrant(ALL_GATES, () => undefined, log)).toBe('no-security');
    expect(log.warn).not.toHaveBeenCalled();
  });

  it('a security service without the seam: members stay refused, said at warn', () => {
    const log = logger();
    expect(contributeAttachmentMemberGrant(ALL_GATES, () => ({ contributeOwnershipFloorAlternates: vi.fn() }), log)).toBe('no-seam');
    expect(String(log.warn.mock.calls[0][0])).toContain('contributePlatformBaselineSet');
  });

  it('a seam that refuses: members stay refused, the boot goes on, and the refusal is said at warn', () => {
    const log = logger();
    const refusing = () => ({
      contributePlatformBaselineSet: () => {
        throw new Error('the boot window is closed');
      },
    });
    expect(contributeAttachmentMemberGrant(ALL_GATES, refusing, log)).toBe('refused');
    expect(String(log.warn.mock.calls[0][0])).toContain('the boot window is closed');
  });

  it('a deployment that declares no member baseline: admitted, and handed to no one', () => {
    const log = logger();
    const seam = () => ({ contributePlatformBaselineSet: () => ({ name: 'storage_attachment_member', joined: false }) });
    expect(contributeAttachmentMemberGrant(ALL_GATES, seam, log)).toBe('no-baseline');
    expect(log.warn).not.toHaveBeenCalled();
  });
});
