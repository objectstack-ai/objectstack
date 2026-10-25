// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The Audit Log's Action filter offers `sys_audit_log.action`'s declared
 * options, and an action with no local badge tone gets the neutral badge
 * (objectui#13175).
 *
 * The filter used to read a hand-kept `ACTION_OPTIONS` list that claimed to
 * mirror the server's declaration. It fell behind it: `read`,
 * `platform_admin_standing_change`, `login_failed` and `account_locked` are
 * declared and written by the server and could not be picked. A guard test
 * compared that list with a second hand-kept literal, so it stayed green
 * while both lists were behind the server.
 *
 * The list is gone. These pins feed `actionFilterOptionsOf` an object
 * document as the console's metadata serves it and read back what the filter
 * offers:
 *  - every declared option, exactly, in declared order — no option dropped
 *    and none added from anywhere else (`create` is not declared by the
 *    second fixture and is not offered; `nightly_purge` is a value no code
 *    names and is offered);
 *  - each choice keeps its declared value and its declared label;
 *  - a document with no declared action options offers nothing, never a list
 *    of the console's own;
 *  - `actionBadgeVariant` keeps the local tones and gives every other action
 *    the neutral `outline`.
 */
import { describe, expect, it } from 'vitest';
import * as auditLogActions from './auditLogActions';
import { actionBadgeVariant, actionFilterOptionsOf } from './auditLogActions';

/**
 * `sys_audit_log.action` as objectstack's `sys-audit-log.object.ts` declares it
 * (`Field.select` over a list of strings, so each label is its value). A
 * fixture, not a mirror: the filter reads whatever the server serves, so this
 * literal never has to follow the server's list again.
 */
const SERVER_DECLARED = [
  'create',
  'read',
  'update',
  'delete',
  'login',
  'logout',
  'login_failed',
  'account_locked',
  'config_change',
  'import',
  'platform_admin_standing_change',
];

/** A served `sys_audit_log` document whose `action` declares these options. */
function auditObject(options: unknown): Record<string, unknown> {
  return {
    name: 'sys_audit_log',
    label: 'Audit Log',
    fields: {
      created_at: { type: 'datetime', label: 'Timestamp' },
      action: { type: 'select', label: 'Action', options },
      user_id: { type: 'lookup', reference: 'sys_user', label: 'User' },
    },
  };
}

describe('actionFilterOptionsOf (objectui#13175)', () => {
  it('offers every declared option of sys_audit_log.action, exactly and in declared order', () => {
    const served = auditObject(SERVER_DECLARED.map((value) => ({ label: value, value })));

    const offered = actionFilterOptionsOf(served);

    expect(offered).toHaveLength(SERVER_DECLARED.length);
    expect(offered.map((o) => o.value)).toEqual(SERVER_DECLARED);
    // The four the hand-kept list could not offer.
    for (const action of ['read', 'platform_admin_standing_change', 'login_failed', 'account_locked']) {
      expect(offered.map((o) => o.value)).toContain(action);
    }
  });

  it('offers only what is declared: an undeclared action is absent and a value no code names is offered', () => {
    const served = auditObject([
      { label: 'Signed in', value: 'login' },
      { label: 'Nightly purge', value: 'nightly_purge' },
    ]);

    expect(actionFilterOptionsOf(served)).toEqual([
      { value: 'login', label: 'Signed in' },
      { value: 'nightly_purge', label: 'Nightly purge' },
    ]);
  });

  it('labels each choice as the server declares it, and a blank label reads as the value', () => {
    const served = auditObject([
      { label: 'Sign-in refused', value: 'login_failed' },
      { label: '  ', value: 'account_locked' },
    ]);

    expect(actionFilterOptionsOf(served)).toEqual([
      { value: 'login_failed', label: 'Sign-in refused' },
      { value: 'account_locked', label: 'account_locked' },
    ]);
  });

  it('offers nothing when no action options are served, never a list of its own', () => {
    expect(actionFilterOptionsOf(undefined)).toEqual([]);
    expect(actionFilterOptionsOf({ name: 'sys_audit_log' })).toEqual([]);
    expect(actionFilterOptionsOf({ name: 'sys_audit_log', fields: {} })).toEqual([]);
    expect(actionFilterOptionsOf(auditObject(undefined))).toEqual([]);
    expect(actionFilterOptionsOf(auditObject([]))).toEqual([]);
  });

  it('skips an option with no value, which a select item cannot carry', () => {
    const served = auditObject([{ label: 'Nothing', value: '' }, null, { label: 'Created', value: 'create' }]);

    expect(actionFilterOptionsOf(served)).toEqual([{ value: 'create', label: 'Created' }]);
  });

  it('the module exports no list of actions', () => {
    for (const [name, value] of Object.entries(auditLogActions)) {
      expect(Array.isArray(value), `${name} is an array`).toBe(false);
    }
  });
});

describe('actionBadgeVariant (objectui#13175)', () => {
  it('keeps the local tone of an action that has one', () => {
    expect(actionBadgeVariant('create')).toBe('default');
    expect(actionBadgeVariant('update')).toBe('secondary');
    expect(actionBadgeVariant('delete')).toBe('destructive');
  });

  it('gives a declared action with no local tone the neutral outline badge', () => {
    for (const action of ['read', 'platform_admin_standing_change', 'login_failed', 'account_locked', 'nightly_purge']) {
      expect(actionBadgeVariant(action)).toBe('outline');
    }
  });

  it('gives a missing action, or one spelled like an Object.prototype member, the neutral badge', () => {
    expect(actionBadgeVariant(undefined)).toBe('outline');
    expect(actionBadgeVariant(null)).toBe('outline');
    expect(actionBadgeVariant('')).toBe('outline');
    expect(actionBadgeVariant('constructor')).toBe('outline');
  });
});
