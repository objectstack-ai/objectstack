// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect } from 'vitest';
import { FieldSchema } from './field.zod';
import { ObjectSchema } from './object.zod';
import { transferCascadeIneligibilityReason } from './user-action-transfer';

/**
 * [ruling 7000907189 point 4] `transferBehavior` — the Change Owner cascade,
 * declared per relationship on the child's reference field beside
 * `deleteBehavior`. Accepted where it can act; refused at parse where it never
 * could (ADR-0049): off `lookup` / `master_detail`, on a reference to a `sys_*`
 * object, and `'cascade'` on a field of an object that does not offer Change
 * Owner itself.
 */

const TO_ACCOUNT = { type: 'lookup', reference: 'account' } as const;

function childWith(extra: Record<string, unknown>, fields: Record<string, unknown>) {
  return { name: 'opportunity', label: 'Opportunity', fields, ...extra };
}

function issuesAt(result: { success: boolean; error?: { issues: Array<{ path: PropertyKey[]; message: string }> } }, path: string) {
  return result.success ? [] : result.error!.issues.filter((i) => i.path.join('.') === path);
}

describe('FieldSchema — transferBehavior, the type half', () => {
  it.each(['none', 'cascade'] as const)('accepts %s on a lookup and on a master_detail', (value) => {
    expect(FieldSchema.safeParse({ ...TO_ACCOUNT, transferBehavior: value }).success).toBe(true);
    expect(FieldSchema.safeParse({ type: 'master_detail', reference: 'account', transferBehavior: value }).success).toBe(true);
  });

  it('parses an omitted key to no key (the default none is not materialized)', () => {
    const parsed = FieldSchema.parse({ ...TO_ACCOUNT });
    expect('transferBehavior' in parsed).toBe(false);
  });

  it('refuses a value outside none | cascade', () => {
    const result = FieldSchema.safeParse({ ...TO_ACCOUNT, transferBehavior: 'restrict' });
    expect(result.success).toBe(false);
    expect(issuesAt(result as never, 'transferBehavior')).toHaveLength(1);
  });

  it.each(['text', 'user', 'tree', 'number'])('refuses the key, none included, on a %s field', (type) => {
    for (const value of ['none', 'cascade']) {
      const field: Record<string, unknown> = { type, transferBehavior: value };
      if (type === 'tree') field.reference = 'account';
      const issues = issuesAt(FieldSchema.safeParse(field) as never, 'transferBehavior');
      expect(issues).toHaveLength(1);
      expect(issues[0]!.message).toContain("only valid on `type: 'lookup'` or `type: 'master_detail'`");
    }
  });

  it('refuses cascade on a reference to a sys_ object, and accepts none there', () => {
    const refused = issuesAt(FieldSchema.safeParse({ type: 'lookup', reference: 'sys_user', transferBehavior: 'cascade' }) as never, 'transferBehavior');
    expect(refused).toHaveLength(1);
    expect(refused[0]!.message).toContain("'sys_user'");
    expect(FieldSchema.safeParse({ type: 'lookup', reference: 'sys_user', transferBehavior: 'none' }).success).toBe(true);
  });
});

describe('ObjectSchema — transferBehavior: cascade, the object half', () => {
  it('accepts cascade on a field of an object that offers Change Owner (private, public_read, omitted)', () => {
    for (const extra of [{}, { sharingModel: 'private' }, { sharingModel: 'public_read' }, { ownership: 'user' }]) {
      const result = ObjectSchema.safeParse(childWith(extra, { account: { ...TO_ACCOUNT, transferBehavior: 'cascade' } }));
      expect(issuesAt(result as never, 'fields.account.transferBehavior')).toEqual([]);
      expect(result.success).toBe(true);
    }
  });

  it('accepts cascade on a controlled_by_parent-free detail that opens its own switch', () => {
    const result = ObjectSchema.safeParse(childWith(
      { sharingModel: 'private', userActions: { transfer: true } },
      { account: { type: 'master_detail', reference: 'account', transferBehavior: 'cascade' } },
    ));
    expect(result.success).toBe(true);
  });

  it.each([
    ['ownership: none', { ownership: 'none' }, "ownership: 'none'"],
    ['ownership: org', { ownership: 'org' }, "ownership: 'org'"],
    ['managedBy', { managedBy: 'platform' }, "managedBy: 'platform'"],
    ['systemFields: false', { systemFields: false }, 'systemFields: false'],
    ['a switched-off object', { userActions: { transfer: false } }, 'userActions.transfer is off'],
  ])('refuses cascade on a field of an object that does not offer Change Owner (%s)', (_label, extra, clause) => {
    const result = ObjectSchema.safeParse(childWith(extra, { account: { ...TO_ACCOUNT, transferBehavior: 'cascade' } }));
    const issues = issuesAt(result as never, 'fields.account.transferBehavior');
    expect(issues).toHaveLength(1);
    expect(issues[0]!.message).toContain("cannot take a Change Owner cascade");
    expect(issues[0]!.message).toContain(clause);
  });

  it('refuses cascade on a controlled_by_parent detail, even one that opens its own switch', () => {
    for (const userActions of [undefined, { transfer: true }]) {
      const result = ObjectSchema.safeParse(childWith(
        { sharingModel: 'controlled_by_parent', ...(userActions ? { userActions } : {}) },
        { account: { type: 'master_detail', reference: 'account', required: true, transferBehavior: 'cascade' } },
      ));
      const issues = issuesAt(result as never, 'fields.account.transferBehavior');
      expect(issues).toHaveLength(1);
      expect(issues[0]!.message).toContain('controlled_by_parent');
    }
  });

  it('accepts none on a field of any object, an ineligible one included', () => {
    const result = ObjectSchema.safeParse(childWith({ ownership: 'none' }, { account: { ...TO_ACCOUNT, transferBehavior: 'none' } }));
    expect(result.success).toBe(true);
  });

  it('names every cascading field of an ineligible object, one issue each', () => {
    const result = ObjectSchema.safeParse(childWith({ ownership: 'org' }, {
      account: { ...TO_ACCOUNT, transferBehavior: 'cascade' },
      partner: { ...TO_ACCOUNT, transferBehavior: 'cascade' },
      other: { ...TO_ACCOUNT },
    }));
    expect(issuesAt(result as never, 'fields.account.transferBehavior')).toHaveLength(1);
    expect(issuesAt(result as never, 'fields.partner.transferBehavior')).toHaveLength(1);
    expect(issuesAt(result as never, 'fields.other.transferBehavior')).toEqual([]);
  });
});

describe('transferCascadeIneligibilityReason', () => {
  it('answers undefined for an object that offers Change Owner, and a clause otherwise', () => {
    expect(transferCascadeIneligibilityReason({ name: 'opportunity', fields: {} })).toBeUndefined();
    expect(transferCascadeIneligibilityReason({ name: 'opportunity', fields: {}, sharingModel: 'controlled_by_parent' })).toContain('controlled_by_parent');
    expect(transferCascadeIneligibilityReason({ name: 'opportunity', fields: {}, security: { sharingModel: 'controlled_by_parent' } })).toContain('controlled_by_parent');
    expect(transferCascadeIneligibilityReason({ name: 'sys_thing', fields: {} })).toContain("'sys_'");
    expect(transferCascadeIneligibilityReason(null)).toBeDefined();
  });
});
