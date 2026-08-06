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

/**
 * [#5125] The three WRITE gates must all document the `modifyAllRecords`
 * super-user bypass.
 *
 * #4647 made the bypass EXPLICIT on the enforcement side: `canEdit`,
 * `canDelete` and `canManageShares` all fold through the one
 * `ISecurityService.hasWriteBypass` predicate (`hasModifyAllBypass` in
 * `@objectstack/plugin-sharing`'s `SharingService`). Two of the three
 * docstrings said so; `canEdit`'s did not, and its omission read as a
 * deliberate exclusion — the exact opposite of the implementation, and
 * strictly worse than silence because `canDelete` sits four lines below
 * naming the bypass it supposedly does not share.
 *
 * A prose pin rather than a behavioural one, because prose is what drifted:
 * nothing type-checks a doc comment, and this interface's whole job is to be
 * the thing cross-package callers read instead of the plugin. Deleting the
 * sentence again turns this red.
 */
describe('[#5125] ISharingService write-gate bypass documentation parity', () => {
  it('canEdit / canDelete / canManageShares each name the `modifyAllRecords` bypass', async () => {
    const ts = (await import('typescript')).default;
    const { readFileSync } = await import('node:fs');
    const { dirname, resolve } = await import('node:path');
    const { fileURLToPath } = await import('node:url');

    const file = resolve(dirname(fileURLToPath(import.meta.url)), 'sharing-service.ts');
    const source = ts.createSourceFile(
      file,
      readFileSync(file, 'utf8'),
      ts.ScriptTarget.Latest,
      /* setParentNodes */ true,
    );

    const iface = source.statements.find(
      (s): s is import('typescript').InterfaceDeclaration =>
        ts.isInterfaceDeclaration(s) && s.name.text === 'ISharingService',
    );
    expect(iface, 'ISharingService must still be an interface in this file').toBeDefined();

    // `getFullText` carries a member's LEADING TRIVIA — its doc comment — so
    // the pin reads exactly what an IDE shows on hover, with no assumption
    // about how the comment is wrapped.
    const docOf = new Map<string, string>();
    for (const member of iface!.members) {
      if (!ts.isMethodSignature(member) || !member.name || !ts.isIdentifier(member.name)) continue;
      docOf.set(member.name.text, member.getFullText(source));
    }

    // Anti-vacuity 1: the enumeration found the real contract surface, so a
    // rename cannot quietly empty the assertions below.
    expect([...docOf.keys()].sort()).toEqual([
      'buildReadFilter',
      'canDelete',
      'canEdit',
      'canManageShares',
      'grant',
      'listShares',
      'revoke',
    ]);

    for (const gate of ['canEdit', 'canDelete', 'canManageShares'] as const) {
      expect(docOf.get(gate), `${gate} must document the modifyAllRecords bypass`)
        .toContain('modifyAllRecords');
    }

    // Anti-vacuity 2: the search DISCRIMINATES — it is not matching text every
    // member happens to carry. `buildReadFilter` is the honest negative: the
    // read path has no `hasWriteBypass` branch at all (a View/Modify All Data
    // holder reaches every row because the security layer resolves read DEPTH
    // to `org`, which short-circuits the filter before sharing is consulted),
    // so naming the write bypass there would itself be drift.
    expect(docOf.get('buildReadFilter')).not.toContain('modifyAllRecords');
  });
});
