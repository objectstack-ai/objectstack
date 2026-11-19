// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect } from 'vitest';
import { ObjectSchema } from './object.zod';
import {
  isTransferEligible,
  resolveUserActionTransfer,
  transferIneligibilityReason,
} from './user-action-transfer';

/**
 * [ruling 7000907189 point 1] Which objects offer the Change Owner action:
 * structural eligibility (derived, never overridable), the object switch
 * `userActions.transfer` with its `sharingModel`-derived default, and the parse
 * refusal of a switch that opens the action on an ineligible object (ADR-0049).
 */

const TITLE = { title: { type: 'text', label: 'Title' } };
const MASTER = { parent: { type: 'master_detail', reference: 'deal', required: true } };

function objectWith(extra: Record<string, unknown>, fields: Record<string, unknown> = TITLE) {
  return { name: 'deal_note', label: 'Probe', fields, ...extra };
}

function transferIssues(result: ReturnType<typeof ObjectSchema.safeParse>) {
  return result.success
    ? []
    : result.error.issues.filter((i) => i.path.join('.') === 'userActions.transfer');
}

describe('isTransferEligible — the structural test', () => {
  it('is eligible on an object whose ownership is user or omitted', () => {
    expect(isTransferEligible(objectWith({}))).toBe(true);
    expect(isTransferEligible(objectWith({ ownership: 'user' }))).toBe(true);
    expect(transferIneligibilityReason(objectWith({}))).toBeUndefined();
  });

  it.each(['business_unit', 'org', 'none'])('is never eligible under ownership: %s', (ownership) => {
    const def = objectWith({ ownership });
    expect(isTransferEligible(def)).toBe(false);
    expect(transferIneligibilityReason(def)).toContain(`ownership: '${ownership}'`);
  });

  it.each(['platform', 'config', 'system-data', 'engine-owned', 'append-only', 'synced', 'better-auth'])(
    'is never eligible on a managedBy: %s object',
    (managedBy) => {
      const def = objectWith({ managedBy });
      expect(isTransferEligible(def)).toBe(false);
      expect(transferIneligibilityReason(def)).toContain(`managedBy: '${managedBy}'`);
    },
  );

  it('is never eligible on a sys_* object', () => {
    const def = { ...objectWith({}), name: 'sys_custom_ledger' };
    expect(isTransferEligible(def)).toBe(false);
    expect(transferIneligibilityReason(def)).toContain("'sys_'");
  });

  it('is never eligible under systemFields: false', () => {
    expect(isTransferEligible(objectWith({ systemFields: false }))).toBe(false);
  });

  it('is not eligible when owner_id is declared readonly, and is when it is declared writable', () => {
    const pinned = objectWith({}, { ...TITLE, owner_id: { type: 'lookup', reference: 'sys_user', readonly: true } });
    expect(isTransferEligible(pinned)).toBe(false);
    expect(transferIneligibilityReason(pinned)).toContain('owner_id readonly');
    const writable = objectWith({}, { ...TITLE, owner_id: { type: 'lookup', reference: 'sys_user', readonly: false } });
    expect(isTransferEligible(writable)).toBe(true);
  });

  it('answers the same for a parsed schema as for the bare record', () => {
    const parsed = ObjectSchema.parse(objectWith({ ownership: 'none' }));
    expect(isTransferEligible(parsed)).toBe(false);
    expect(isTransferEligible(ObjectSchema.parse(objectWith({})))).toBe(true);
  });

  it('answers false for input that is not an object definition', () => {
    expect(isTransferEligible(null)).toBe(false);
    expect(isTransferEligible('deal')).toBe(false);
  });
});

describe('resolveUserActionTransfer — the switch and its derived default', () => {
  it.each([
    ['private', true],
    ['public_read', true],
    ['public_read_write', true],
    ['controlled_by_parent', false],
  ])('defaults to %s → %s when the switch is omitted', (sharingModel, enabled) => {
    expect(resolveUserActionTransfer(objectWith({ sharingModel }))).toEqual({ enabled });
  });

  it('defaults to on when sharingModel is omitted (a custom object resolves to private)', () => {
    expect(resolveUserActionTransfer(objectWith({}))).toEqual({ enabled: true });
  });

  it('turns the action on for a controlled_by_parent detail that opts in', () => {
    const def = objectWith({ sharingModel: 'controlled_by_parent', userActions: { transfer: true } }, MASTER);
    expect(resolveUserActionTransfer(def)).toEqual({ enabled: true });
    expect(resolveUserActionTransfer({ ...def, userActions: { transfer: { enabled: true } } })).toEqual({ enabled: true });
  });

  it('turns the action off for a private object that opts out', () => {
    expect(resolveUserActionTransfer(objectWith({ sharingModel: 'private', userActions: { transfer: false } })))
      .toEqual({ enabled: false });
    expect(resolveUserActionTransfer(objectWith({ userActions: { transfer: { enabled: false } } })))
      .toEqual({ enabled: false });
  });

  it('carries the predicates of the object form, and a predicate-only form keeps the default', () => {
    const def = objectWith({ userActions: { transfer: { visibleWhen: "record.status != 'converted'" } } });
    expect(resolveUserActionTransfer(def)).toEqual({
      enabled: true,
      predicates: { visibleWhen: "record.status != 'converted'" },
    });
    const detail = objectWith(
      { sharingModel: 'controlled_by_parent', userActions: { transfer: { disabledWhen: 'record.locked' } } },
      MASTER,
    );
    expect(resolveUserActionTransfer(detail)).toEqual({ enabled: false, predicates: { disabledWhen: 'record.locked' } });
  });

  it('keeps an ineligible object off whatever the switch says (a document that skipped the parse)', () => {
    expect(resolveUserActionTransfer({ name: 'stock_item', ownership: 'none', userActions: { transfer: true } }))
      .toEqual({ enabled: false });
    expect(resolveUserActionTransfer({
      name: 'stock_item',
      managedBy: 'config',
      userActions: { transfer: { enabled: true, visibleWhen: 'true' } },
    })).toEqual({ enabled: false });
  });

  it('reads the parsed schema the same way', () => {
    const parsed = ObjectSchema.parse(objectWith({ sharingModel: 'controlled_by_parent' }, MASTER));
    expect(resolveUserActionTransfer(parsed)).toEqual({ enabled: false });
  });
});

describe('ObjectSchema — userActions.transfer at parse', () => {
  it('accepts the switch both ways, and the object form, on an eligible object', () => {
    for (const transfer of [true, false, { enabled: true, visibleWhen: 'record.amount > 0' }, { disabledWhen: 'record.locked' }]) {
      const result = ObjectSchema.safeParse(objectWith({ userActions: { transfer } }));
      expect(result.success, JSON.stringify(transfer)).toBe(true);
    }
  });

  it('accepts transfer: true on a controlled_by_parent detail (an author opting a real owner in)', () => {
    const result = ObjectSchema.safeParse(
      objectWith({ sharingModel: 'controlled_by_parent', userActions: { transfer: true } }, MASTER),
    );
    expect(result.success).toBe(true);
  });

  it.each([
    ['ownership: none', { ownership: 'none' }, "ownership: 'none'"],
    ['ownership: business_unit', { ownership: 'business_unit' }, "ownership: 'business_unit'"],
    ['managedBy: config', { managedBy: 'config' }, "managedBy: 'config'"],
  ])('refuses transfer: true on an %s object, at userActions.transfer, naming the structural reason', (_label, extra, reason) => {
    for (const transfer of [true, { enabled: true }]) {
      const issues = transferIssues(ObjectSchema.safeParse(objectWith({ ...extra, userActions: { transfer } })));
      expect(issues).toHaveLength(1);
      expect(issues[0]!.code).toBe('custom');
      expect(issues[0]!.message).toContain(reason);
    }
  });

  it('refuses transfer: true on a sys_* object and where owner_id is declared readonly', () => {
    const sys = ObjectSchema.safeParse({ ...objectWith({ userActions: { transfer: true } }), name: 'sys_custom_ledger' });
    expect(transferIssues(sys)).toHaveLength(1);
    const pinned = ObjectSchema.safeParse(objectWith(
      { userActions: { transfer: true } },
      { ...TITLE, owner_id: { type: 'lookup', reference: 'sys_user', readonly: true } },
    ));
    expect(transferIssues(pinned)).toHaveLength(1);
    expect(transferIssues(pinned)[0]!.message).toContain('owner_id readonly');
  });

  it('accepts closing the switch, or a predicate-only form, on an ineligible object', () => {
    for (const transfer of [false, { enabled: false }, { visibleWhen: 'record.amount > 0' }]) {
      const result = ObjectSchema.safeParse(objectWith({ ownership: 'none', userActions: { transfer } }));
      expect(result.success, JSON.stringify(transfer)).toBe(true);
    }
  });

  it('refuses the near-miss spelling changeOwner with a pointer to transfer', () => {
    const result = ObjectSchema.safeParse(objectWith({ userActions: { changeOwner: true } }));
    expect(result.success).toBe(false);
    const messages = result.success ? [] : result.error.issues.map((i) => i.message).join('\n');
    expect(messages).toContain('transfer');
  });
});
