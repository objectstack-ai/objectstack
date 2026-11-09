/**
 * Which param dialogs carry a host-composed companion (objectstack#30205).
 *
 * The platform's `ban_user` action on `sys_user` carries the user's
 * assigned-work panel; every other action — the same object's other actions
 * and another object's `ban_user` — carries none. A row that names no record
 * carries none either, since there is no user to describe.
 */
import { describe, it, expect } from 'vitest';
import { resolveParamDialogCompanion, judgeActionPreflight } from './actionDialogCompanion';

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

describe('resolveParamDialogCompanion — the declared preflight read (objectstack#31808)', () => {
  const PARAMS = [
    { name: 'version', label: 'Version', type: 'text' },
    { name: 'token', label: 'Token', type: 'text', required: true },
  ];
  const PREFLIGHT = {
    read: { url: '/api/v1/plan?version=${param.version}' },
    path: 'data',
    seed: [{ param: 'token', path: 'verdict.findingSet' }],
  };

  it('an action declaring `preflight` gets the declared kind, judged ok, with the filler', () => {
    const fill = () => null;
    expect(resolveParamDialogCompanion('crm_package', 'install', { id: 'p1' }, {
      preflight: PREFLIGHT as never,
      params: PARAMS,
      interpolateRead: fill,
    })).toEqual({ kind: 'preflight', judged: { ok: true, preflight: PREFLIGHT }, interpolateRead: fill });
  });

  it('the ban action keeps its panel, beside a read it also declares', () => {
    expect(resolveParamDialogCompanion('sys_user', 'ban_user', { id: 'u_lee' }, { preflight: PREFLIGHT as never, params: PARAMS }))
      .toMatchObject({ kind: 'preflight', hostChrome: { kind: 'user-assigned-work', userId: 'u_lee' } });
  });

  it('CONTROL: without `preflight` the ban action resolves exactly as before', () => {
    expect(resolveParamDialogCompanion('sys_user', 'ban_user', { id: 'u_lee' }, { params: PARAMS }))
      .toEqual({ kind: 'user-assigned-work', userId: 'u_lee' });
    expect(resolveParamDialogCompanion('crm_package', 'install', { id: 'p1' }, { params: PARAMS })).toBeUndefined();
  });
});

describe('judgeActionPreflight — the stored block, re-judged by the spec (objectstack#31808)', () => {
  const PARAMS = [{ name: 'version', label: 'Version', type: 'text' }, { name: 'token', label: 'Token', type: 'text' }];

  it('refuses another origin with the spec\'s own message', () => {
    const judged = judgeActionPreflight({ read: { url: 'https://evil.example/plan' } }, PARAMS);
    expect(judged.ok).toBe(false);
    expect(!judged.ok && judged.refusal).toContain('preflight.read.url');
  });

  it('refuses a hole naming no declared param, judged against the params the dialog collects', () => {
    const judged = judgeActionPreflight({ read: { url: '/api/v1/plan?x=${param.missing}' } }, PARAMS);
    expect(judged.ok).toBe(false);
    expect(!judged.ok && judged.refusal).toContain('missing');
  });

  it('refuses a seed onto a param that has another source (a `carryOver` one)', () => {
    const judged = judgeActionPreflight(
      { read: { url: '/api/v1/plan' }, seed: [{ param: 'token', path: 'a' }] },
      [PARAMS[0], { ...PARAMS[1], carryOver: true }],
    );
    expect(judged.ok).toBe(false);
  });

  it('refuses a GET-only read declared with another method', () => {
    expect(judgeActionPreflight({ read: { url: '/api/v1/plan', method: 'POST' } }, PARAMS).ok).toBe(false);
  });

  it('accepts a field-backed param named by `field`', () => {
    const judged = judgeActionPreflight(
      { read: { url: '/api/v1/plan?s=${param.status}' } },
      [{ field: 'status' } as never],
    );
    expect(judged.ok).toBe(true);
  });
});
