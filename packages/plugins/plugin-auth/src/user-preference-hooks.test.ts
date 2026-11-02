// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `sys_user_preference`'s write rule — the owner (`user_id`) is fixed when the
 * preference is saved — judged on the hook `AuthPlugin` and
 * `IdentityObjectsPlugin` register (`user-preference-hooks.ts`, on the shared
 * `owner-fixed-rule.ts`), with the hook context the engine hands it.
 *
 * The rule is held on its own here, for every non-system caller whatever its
 * permission sets: which callers reach the hook over REST, and what the row
 * scope answers first, is the HTTP face's
 * (`packages/qa/dogfood/test/user-preference-owner-fixed.dogfood.test.ts`).
 *
 * Refusals are asserted on the ADR-0112 pair (`code` + `status`) and on a
 * message that names the row and the owner column and echoes no other user's
 * id.
 */

import { describe, it, expect } from 'vitest';

import { USER_PREFERENCE_OBJECT, registerUserPreferenceHooks } from './user-preference-hooks.js';

const ALICE = 'usr_owner_placeholder';
const BOB = 'usr_other_placeholder';
const ROW = 'pref_row_placeholder';

type Hook = (ctx: any) => Promise<void>;

/** The hooks the registrar binds, by event, with the options it bound them under. */
function registered(): { hooks: Record<string, Hook[]>; options: any[] } {
  const hooks: Record<string, Hook[]> = {};
  const options: any[] = [];
  registerUserPreferenceHooks(
    { registerHook: (event: string, fn: Hook, opts: any) => { (hooks[event] ??= []).push(fn); options.push({ event, ...opts }); } },
    { packageId: 'test.user-preference' },
  );
  return { hooks, options };
}

/** A `beforeUpdate` context as the engine builds one on the by-id path. */
const updateCtx = (data: Record<string, unknown>, session: Record<string, unknown> = { userId: ALICE }) => ({
  object: USER_PREFERENCE_OBJECT,
  input: { id: ROW, data },
  previous: { id: ROW, user_id: ALICE, key: 'ui.recent', value: ['a'] },
  session,
});

const refusalOf = async (run: Promise<unknown>): Promise<any> => run.then(() => undefined, (e: unknown) => e);

describe('registration', () => {
  it('binds one beforeUpdate hook on sys_user_preference, and nothing on create or delete', () => {
    const { hooks, options } = registered();
    expect(Object.keys(hooks)).toEqual(['beforeUpdate']);
    expect(options).toEqual([{ event: 'beforeUpdate', object: USER_PREFERENCE_OBJECT, packageId: 'test.user-preference' }]);
  });
});

describe('a preference\'s owner is fixed when it is saved', () => {
  it.each([
    ['an organization member', { userId: ALICE, positions: ['org_member'] }],
    ['an organization administrator', { userId: 'usr_org_admin_placeholder', permissions: ['organization_admin'] }],
    ['a platform administrator', { userId: 'usr_platform_admin_placeholder', permissions: ['admin_full_access'] }],
  ])('%s cannot hand a preference to another user: 403 PERMISSION_DENIED', async (_who, session) => {
    const [hook] = registered().hooks.beforeUpdate;
    const err = await refusalOf(hook(updateCtx({ user_id: BOB }, session)));
    expect({ code: err?.code, status: err?.status }).toEqual({ code: 'PERMISSION_DENIED', status: 403 });
  });

  it('the refusal names the row and the owner column, and echoes no other user\'s id', async () => {
    const [hook] = registered().hooks.beforeUpdate;
    const err = await refusalOf(hook(updateCtx({ user_id: BOB, value: ['b'] })));
    expect(err?.status).toBe(403);
    expect(String(err?.message)).toContain(ROW);
    expect(String(err?.message)).toContain('user_id');
    expect(String(err?.message)).not.toContain(BOB);
  });

  it('clearing the owner is a change of owner too', async () => {
    const [hook] = registered().hooks.beforeUpdate;
    const err = await refusalOf(hook(updateCtx({ user_id: null })));
    expect({ code: err?.code, status: err?.status }).toEqual({ code: 'PERMISSION_DENIED', status: 403 });
  });
});

describe('controls: what the rule leaves alone', () => {
  it('an update that echoes the stored owner is no change', async () => {
    const [hook] = registered().hooks.beforeUpdate;
    await expect(hook(updateCtx({ user_id: ALICE, value: ['b'] }))).resolves.toBeUndefined();
  });

  it('an update that does not send the owner is not judged', async () => {
    const [hook] = registered().hooks.beforeUpdate;
    await expect(hook(updateCtx({ value: ['b'] }))).resolves.toBeUndefined();
  });

  it('a system write is not judged: the platform\'s own writers may move a preference', async () => {
    const [hook] = registered().hooks.beforeUpdate;
    await expect(hook(updateCtx({ user_id: BOB }, { isSystem: true }))).resolves.toBeUndefined();
  });

  it('another object is not this rule\'s', async () => {
    const [hook] = registered().hooks.beforeUpdate;
    await expect(hook({ ...updateCtx({ user_id: BOB }), object: 'sys_other' })).resolves.toBeUndefined();
  });
});
