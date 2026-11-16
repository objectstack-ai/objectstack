// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [ADR-0066 D2 ⑧ note of 2026-11-15] A permission set's own `readable: false`
 * row binds its holders beside the set's own View All, so the author-time
 * rules stop treating that pair as a mask the set unbinds:
 *
 *   - `security-superuser-field-mask-inert` reports only a row its own set's
 *     Modify All unbinds, and names Modify All alone;
 *   - `security-controlled-by-parent-master-reference-hidden` is skipped only
 *     beside Modify All, so it speaks beside View All.
 *
 * The pins the note flips stay where they were, in
 * `validate-security-posture.test.ts`; the cases below are the ones it adds.
 */

import { describe, it, expect } from 'vitest';
import { PermissionSetSchema } from '@objectstack/spec/security';
import {
  SECURITY_CBP_MASTER_REFERENCE_HIDDEN,
  SECURITY_SUPERUSER_FIELD_MASK_INERT,
  validateSecurityPosture,
} from './validate-security-posture.js';

const parsed = (...sets: Array<Record<string, unknown>>) => ({
  permissions: sets.map((s) => PermissionSetSchema.parse(s)),
});

describe('security-superuser-field-mask-inert · a read mask beside the set\'s own View All binds, so it is not reported', () => {
  const only = (stack: Record<string, unknown>) =>
    validateSecurityPosture(stack).filter((f) => f.rule === SECURITY_SUPERUSER_FIELD_MASK_INERT);
  const inert = (stack: Record<string, unknown>) => only(stack).map((f) => [f.severity, f.where, f.path]);

  it('View All on the object, or through the wildcard, beside the set\'s own readable: false', () => {
    expect(inert(parsed({
      name: 'ps', objects: { deal: { allowRead: true, viewAllRecords: true } },
      fields: { 'deal.amount': { readable: false, editable: false } },
    }))).toEqual([]);
    // The same pair through the set's wildcard, on a raw set.
    expect(inert({
      permissions: [{ name: 'ps', objects: { '*': { viewAllRecords: true } }, fields: { 'deal.amount': { readable: false } } }],
    })).toEqual([]);
  });

  it('a wildcard Modify All shadowed by an explicit View All entry is View All alone', () => {
    expect(inert({
      permissions: [{
        name: 'ps',
        objects: { '*': { modifyAllRecords: true }, deal: { allowRead: true, viewAllRecords: true } },
        fields: { 'deal.amount': { readable: false } },
      }],
    })).toEqual([]);
  });

  it('both bits on one entry: the Modify All vote is the one that counts, so the mask is reported', () => {
    expect(inert(parsed({
      name: 'ps', objects: { deal: { allowRead: true, allowEdit: true, viewAllRecords: true, modifyAllRecords: true } },
      fields: { 'deal.amount': { readable: false } },
    }))).toEqual([['warning', 'permission set "ps"', 'permissions[0].fields["deal.amount"]']]);
  });

  it('the finding names Modify All alone and says which half it unbinds', () => {
    const [read] = only(parsed({
      name: 'ps', objects: { sys_user: { allowRead: true, allowEdit: true, modifyAllRecords: true } },
      fields: { 'sys_user.email': { readable: false, editable: true } },
    }));
    const [lock] = only(parsed({
      name: 'ps', objects: { sys_user: { allowRead: true, allowEdit: true, modifyAllRecords: true } },
      fields: { 'sys_user.email': { readable: true, editable: false } },
    }));
    const [both] = only({
      permissions: [{ name: 'ps', objects: { '*': { modifyAllRecords: true } }, fields: { 'deal.note': { readable: false, editable: false } } }],
    });
    expect(read.message).toContain('readable: false');
    expect(read.message).not.toContain('the edit lock');
    expect(lock.message).toContain('the edit lock');
    expect(lock.message).not.toContain('readable: false');
    expect(both.message).toContain('readable: false and the edit lock');
    // The names the user sentence interpolates: no `bypass`, since one bypass is reported.
    expect([read, lock, both].map((f) => f.userTextParams)).toEqual([
      { permissionSet: 'ps', field: 'sys_user.email', object: 'sys_user', inert: 'read' },
      { permissionSet: 'ps', field: 'sys_user.email', object: 'sys_user', inert: 'edit' },
      { permissionSet: 'ps', field: 'deal.note', object: 'deal', inert: 'both' },
    ]);
    for (const f of [read, lock, both]) {
      expect(f.message, f.message).toContain('modifyAllRecords');
      expect(f.message, f.message).not.toContain('viewAllRecords');
      expect(f.hint, f.hint).not.toContain('viewAllRecords');
    }
  });
});

describe('security-controlled-by-parent-master-reference-hidden · the set\'s own View All leaves its mask binding', () => {
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

  it('View All on the detail: the hidden master reference is reported, and the inert rule is silent', () => {
    const rules = rulesOf({ viewAllRecords: true });
    expect(rules.filter((r) => r === SECURITY_CBP_MASTER_REFERENCE_HIDDEN)).toHaveLength(1);
    expect(rules).not.toContain(SECURITY_SUPERUSER_FIELD_MASK_INERT);
  });

  it('control: Modify All on the detail unbinds the mask, so the inert rule speaks instead', () => {
    const rules = rulesOf({ allowEdit: true, modifyAllRecords: true });
    expect(rules).not.toContain(SECURITY_CBP_MASTER_REFERENCE_HIDDEN);
    expect(rules).toContain(SECURITY_SUPERUSER_FIELD_MASK_INERT);
  });
});
