// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack#32774 — the readings PR #32769 left by name (ADR-0150 D3/D5/D8):
 *
 *  - item 6: a door's `409 RESOURCE_CONFLICT` names its holders in either body
 *    shape — the wrapped envelope (`error.code`, `error.details.candidates`)
 *    and the flat one the `/data` doors send since objectstack#32740 (`code`,
 *    `details.candidates`) — and through the client's error (`err.code`,
 *    `err.details`);
 *  - item 5: a switch written for a holder records that holder's
 *    `(package, name)` row, also after a pick of a refusal that named one
 *    holder, where the by-name state is recorded too;
 *  - item 9: a read naming the overlay sentinel (`?package=sys_metadata`)
 *    addresses the environment's own set.
 *
 * Each against a CONTROL: no holding, or another refusal, reads as before.
 */
import { describe, expect, it } from 'vitest';
import { ledgerAfterSwitch } from './catalog-activation';
import { holderCandidatesOf, holderCandidatesOfError, holdingOfRead } from './permission-set-holder';

const CANDIDATES = [{ kind: 'package', packageId: 'com.acme.crm' }, { kind: 'environment' }];
const SENTENCE = 'Permission set "sales_rep" is held by more than one package.';

describe('a refusal names its holders in either body shape (objectstack#32774 item 6)', () => {
  it('reads the wrapped and the flat body alike', () => {
    const wrapped = { success: false, error: { code: 'RESOURCE_CONFLICT', message: SENTENCE, details: { candidates: CANDIDATES } } };
    const flat = { success: false, error: SENTENCE, code: 'RESOURCE_CONFLICT', details: { candidates: CANDIDATES } };
    expect(holderCandidatesOf(wrapped)).toEqual(CANDIDATES);
    expect(holderCandidatesOf(flat)).toEqual(CANDIDATES);
    // CONTROL: another refusal, in either shape, is not a pick.
    expect(holderCandidatesOf({ error: SENTENCE, code: 'PERMISSION_DENIED', details: { candidates: CANDIDATES } })).toBeNull();
    expect(holderCandidatesOf({ error: SENTENCE, code: 'RESOURCE_CONFLICT' })).toBeNull();
    expect(holderCandidatesOf({ error: SENTENCE, code: 'RESOURCE_CONFLICT', details: { candidates: ['com.acme.crm'] } })).toBeNull();
  });

  it("reads the client's error: the body's code on `code`, its details on `details`", () => {
    const err = Object.assign(new Error(SENTENCE), { code: 'RESOURCE_CONFLICT', httpStatus: 409, details: { candidates: CANDIDATES } });
    expect(holderCandidatesOfError(err)).toEqual(CANDIDATES);
    // CONTROL: a unique-key 409, a validation refusal, a plain error.
    expect(holderCandidatesOfError(Object.assign(new Error('taken'), { code: 'DUPLICATE_KEY', details: {} }))).toBeNull();
    expect(holderCandidatesOfError(Object.assign(new Error('bad'), { code: 'VALIDATION_FAILED', details: { fields: [] } }))).toBeNull();
    expect(holderCandidatesOfError(new Error(SENTENCE))).toBeNull();
    expect(holderCandidatesOfError(null)).toBeNull();
  });
});

describe("a switch records the holder's own row (objectstack#32774 item 5)", () => {
  const base = () => ({
    states: new Map<string, boolean>([['sales_rep', true]]),
    permissionRows: [{ name: 'sales_rep', packageId: 'com.acme.crm', active: true }],
  });

  it('a pick of a refusal that named one holder records its (package, name) row and the by-name state', () => {
    const after = ledgerAfterSwitch(base(), 'sales_rep', false, { packageId: 'com.acme.crm', holders: ['com.acme.crm'] });
    expect(after.states.get('sales_rep')).toBe(false);
    expect(after.permissionRows).toEqual([{ name: 'sales_rep', packageId: 'com.acme.crm', active: false }]);
  });

  it('under two holders, only the holder switched; with no holding, only the by-name state (CONTROL)', () => {
    const two = ledgerAfterSwitch(base(), 'sales_rep', false, { packageId: null, holders: [null, 'com.acme.crm'] });
    expect(two.states.get('sales_rep')).toBe(true);
    expect(two.permissionRows).toEqual([
      { name: 'sales_rep', packageId: 'com.acme.crm', active: true },
      { name: 'sales_rep', packageId: null, active: false },
    ]);
    const none = ledgerAfterSwitch(base(), 'sales_rep', false);
    expect(none.states.get('sales_rep')).toBe(false);
    expect(none.permissionRows).toEqual(base().permissionRows);
  });
});

describe('a read naming the overlay sentinel addresses the environment (objectstack#32774 item 9)', () => {
  it('maps `?package=sys_metadata` to the environment holder, and to none where the environment holds no set', () => {
    const items = [
      { name: 'env_rep', _packageId: 'sys_metadata' },
      { name: 'env_rep', _packageId: 'com.acme.crm' },
      { name: 'sales_rep', _packageId: 'com.acme.crm' },
      { name: 'sales_rep', _packageId: 'com.acme.sales' },
    ];
    expect(holdingOfRead(items, 'env_rep', 'sys_metadata')).toEqual({ packageId: null, holders: [null, 'com.acme.crm'] });
    expect(holdingOfRead(items, 'sales_rep', 'sys_metadata')).toBeNull();
  });
});
