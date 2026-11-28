// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [ADR-0066 D2 ⑧, v19 #36055] View All and Modify All cast no field vote, so a
 * permission set's own field rows bind its holders beside either bit. The
 * author-time rules follow:
 *
 *   - `security-superuser-field-mask-inert` is retired: no pair of a bit and
 *     the set's own row is inert any more;
 *   - `security-controlled-by-parent-master-reference-hidden` speaks beside
 *     View All and beside Modify All alike.
 *
 * The note of 2026-11-15 (#33828) that started this file made the set's own
 * `readable: false` bind beside its own View All; v19 extends it to Modify All.
 */

import { describe, it, expect } from 'vitest';
import { PermissionSetSchema } from '@objectstack/spec/security';
import {
  SECURITY_CBP_MASTER_REFERENCE_HIDDEN,
  validateSecurityPosture,
} from './validate-security-posture.js';

const parsed = (...sets: Array<Record<string, unknown>>) => ({
  permissions: sets.map((s) => PermissionSetSchema.parse(s)),
});

const RETIRED = 'security-superuser-field-mask-inert';

describe('[v19 #36055] a field row beside the set\'s own View All or Modify All binds, so nothing is reported as inert', () => {
  it('View All or Modify All on the object, through the wildcard, or both on one entry', () => {
    for (const stack of [
      parsed({ name: 'ps', objects: { deal: { allowRead: true, viewAllRecords: true } }, fields: { 'deal.amount': { readable: false, editable: false } } }),
      { permissions: [{ name: 'ps', objects: { '*': { viewAllRecords: true } }, fields: { 'deal.amount': { readable: false } } }] },
      parsed({
        name: 'ps', objects: { deal: { allowRead: true, allowEdit: true, viewAllRecords: true, modifyAllRecords: true } },
        fields: { 'deal.amount': { readable: false } },
      }),
      parsed({
        name: 'ps', objects: { sys_user: { allowRead: true, allowEdit: true, modifyAllRecords: true } },
        fields: { 'sys_user.email': { readable: true, editable: false } },
      }),
    ]) {
      expect(validateSecurityPosture(stack).map((f) => f.rule)).not.toContain(RETIRED);
    }
  });
});

describe('security-controlled-by-parent-master-reference-hidden · the set\'s own View All or Modify All leaves its mask binding', () => {
  const TEXT_FIELD = { name: { type: 'text', label: 'Name' } };
  const objectFixture = (extra: Record<string, unknown>) => ({ label: 'X', fields: TEXT_FIELD, ...extra });
  const DETAIL = objectFixture({
    name: 'line_item', sharingModel: 'controlled_by_parent',
    fields: {
      invoice: { type: 'master_detail', label: 'Invoice', reference: 'invoice', required: true },
      note: { type: 'text', label: 'Note' },
    },
  });
  const MASTER = objectFixture({ name: 'invoice', sharingModel: 'private' });
  const rulesOf = (bits: Record<string, unknown>) =>
    validateSecurityPosture({
      objects: [MASTER, DETAIL],
      ...parsed({
        name: 'auditor', objects: { line_item: { allowRead: true, ...bits } },
        fields: { 'line_item.invoice': { readable: false, editable: false } },
      }),
    }).map((f) => f.rule);

  it('View All on the detail: the hidden master reference is reported', () => {
    expect(rulesOf({ viewAllRecords: true }).filter((r) => r === SECURITY_CBP_MASTER_REFERENCE_HIDDEN)).toHaveLength(1);
  });

  it('[v19] Modify All on the detail: the mask binds too, so the hidden master reference is reported', () => {
    const rules = rulesOf({ allowEdit: true, modifyAllRecords: true });
    expect(rules.filter((r) => r === SECURITY_CBP_MASTER_REFERENCE_HIDDEN)).toHaveLength(1);
    expect(rules).not.toContain(RETIRED);
  });
});
