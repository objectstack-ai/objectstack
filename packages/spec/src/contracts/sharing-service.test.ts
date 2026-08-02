// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect } from 'vitest';
import type { RecordShareRecipientType, SharingRuleRecipientType } from './sharing-service';
import { ShareRecipientType } from '../security/sharing.zod';

/**
 * [#4539] `RecordShareRecipientType` (né `ShareRecipientType`) pins.
 *
 * The contract type used to be named `ShareRecipientType` while
 * `spec/security` exported a zod enum `ShareRecipientType` for a DIFFERENT
 * concept (sharing-RULE recipients) with a diverged value set — the #4411
 * dual-source trap, worsened by the type≠const kind split. The contract side
 * was renamed; these pins keep the two vocabularies honest about what they
 * each describe.
 */
describe('Sharing Service Contract — recipient vocabularies (#4539)', () => {
  it('RecordShareRecipientType matches the sys_record_share recipient_type select', () => {
    // The storage select on SysRecordShare (`@objectstack/plugin-sharing`) is
    // the gate on what a row can contain; the contract type mirrors it 1:1.
    // `role` — the value the old contract type carried — was never
    // persistable there and is NOT a member.
    const rowRecipients: RecordShareRecipientType[] = [
      'user',
      'group',
      'position',
      'unit_and_subordinates',
      'guest',
    ];
    // @ts-expect-error `role` never was a persistable recipient_type value
    const notARowRecipient: RecordShareRecipientType = 'role';
    expect(rowRecipients).toHaveLength(5);
    expect(notARowRecipient).toBe('role');
  });

  it('security ShareRecipientType is the RULE vocabulary and shares no declaration', () => {
    // The authorable rule-recipient enum: SharingRuleRecipientType minus the
    // reserved `queue`. Distinct concept, distinct values — `group` / `guest`
    // were deliberately removed from it (ADR-0078) while the record-share ROW
    // vocabulary keeps persisting them for forward compatibility.
    expect(ShareRecipientType.options).toEqual([
      'user',
      'team',
      'position',
      'unit_and_subordinates',
      'business_unit',
    ]);
    const ruleRecipient: SharingRuleRecipientType = 'queue';
    // @ts-expect-error `queue` is reserved to the runtime rule contract — not authorable
    const notAuthorable: (typeof ShareRecipientType.options)[number] = 'queue';
    expect(ruleRecipient).toBe(notAuthorable);
  });
});
