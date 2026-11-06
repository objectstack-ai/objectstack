/**
 * Which param dialogs carry a host-composed companion (objectstack#30205).
 *
 * The platform's `ban_user` action on `sys_user` carries the user's
 * assigned-work panel; every other action — the same object's other actions
 * and another object's `ban_user` — carries none. A row that names no record
 * carries none either, since there is no user to describe.
 */
import { describe, it, expect } from 'vitest';
import { resolveParamDialogCompanion } from './actionDialogCompanion';

describe('resolveParamDialogCompanion (objectstack#30205)', () => {
  it('gives the ban dialog the user-assigned-work panel for the row it runs on', () => {
    expect(resolveParamDialogCompanion('sys_user', 'ban_user', { id: 'u_lee', name: 'Lee' }))
      .toEqual({ kind: 'user-assigned-work', userId: 'u_lee' });
  });

  it('reads a numeric id as its string', () => {
    expect(resolveParamDialogCompanion('sys_user', 'ban_user', { id: 42 }))
      .toEqual({ kind: 'user-assigned-work', userId: '42' });
  });

  it('CONTROL: another action on sys_user carries none', () => {
    expect(resolveParamDialogCompanion('sys_user', 'unban_user', { id: 'u_lee' })).toBeUndefined();
    expect(resolveParamDialogCompanion('sys_user', 'set_password', { id: 'u_lee' })).toBeUndefined();
  });

  it('CONTROL: an action named ban_user on another object carries none', () => {
    expect(resolveParamDialogCompanion('crm_contact', 'ban_user', { id: 'c1' })).toBeUndefined();
    expect(resolveParamDialogCompanion(undefined, 'ban_user', { id: 'u_lee' })).toBeUndefined();
  });

  it('carries none when the row names no record', () => {
    expect(resolveParamDialogCompanion('sys_user', 'ban_user', undefined)).toBeUndefined();
    expect(resolveParamDialogCompanion('sys_user', 'ban_user', { id: '' })).toBeUndefined();
    expect(resolveParamDialogCompanion('sys_user', 'ban_user', { name: 'Lee' })).toBeUndefined();
  });
});
