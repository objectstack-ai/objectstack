// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #7309 — one decision, one dialog, across the identity objects.
 *
 * The shared console action runner chains confirmation THEN param collection,
 * both awaited (objectui `packages/core/src/actions/ActionRunner.ts`). An action
 * declaring `confirmText` *and* `params` therefore shows the user TWO sequential
 * dialogs for one click, and nothing is sent until the second — while the first
 * one already reads as "the action ran". The maintainer's 2026-08-10 ruling on
 * #7278 (shipped in PR #7592) is to carry the confirm question in the action's
 * top-level `description` (#7367), which the param dialog renders under its
 * title, and to drop `confirmText`. #7309 sweeps that across the 14 remaining
 * in-repo action sites, all of them here in `identity/`.
 *
 * **What these tests pin is the user-visible consequence, not the key spelling.**
 * The risk of this change is not that a `confirmText` survives somewhere — it is
 * that a genuine warning QUIETLY DISAPPEARS from a destructive action while every
 * "no `confirmText` anywhere" grep stays green. `ban_user`, `delete_my_account`
 * and `rotate_client_secret` are the surfaces where that would cost the most, so
 * the wording is pinned verbatim, phrase by phrase, in the negative direction:
 * deleting the question instead of moving it must go RED here.
 *
 * The converse is pinned too. `confirmText` stays CORRECT for a param-LESS
 * action, where the confirm is the only dialog there is — so this file also
 * asserts that the sweep did not over-apply and strip those.
 */

import { describe, expect, it } from 'vitest';
import { SysUser } from './sys-user.object.js';
import { SysOauthApplication } from './sys-oauth-application.object.js';
import { SysTwoFactor } from './sys-two-factor.object.js';
import { SysAccount } from './sys-account.object.js';
import { SysOrganization } from './sys-organization.object.js';
import { SysSsoProvider } from './sys-sso-provider.object.js';
import { SysTeamMember } from './sys-team-member.object.js';

const OBJECTS = [
  ['sys_user', SysUser],
  ['sys_oauth_application', SysOauthApplication],
  ['sys_two_factor', SysTwoFactor],
  ['sys_account', SysAccount],
  ['sys_organization', SysOrganization],
  ['sys_sso_provider', SysSsoProvider],
  ['sys_team_member', SysTeamMember],
] as const;

const actionsOf = (obj: any): any[] => (obj?.actions ?? []) as any[];
const collects = (a: any) => Array.isArray(a.params) && a.params.length > 0;

const byName = (obj: any, name: string) => {
  const a = actionsOf(obj).find((x) => x.name === name);
  if (!a) throw new Error(`action ${name} not declared`);
  return a;
};

/** The 14 sites #7309 converted: object → action names. */
const CONVERTED: Record<string, string[]> = {
  sys_user: ['ban_user', 'delete_my_account', 'disable_two_factor', 'generate_backup_codes'],
  sys_oauth_application: [
    'enable_oauth_application', 'disable_oauth_application',
    'rotate_client_secret', 'delete_oauth_application',
  ],
  sys_two_factor: ['disable_two_factor', 'regenerate_backup_codes'],
  sys_account: ['unlink_account'],
  sys_organization: ['change_slug'],
  sys_sso_provider: ['delete_sso_provider'],
  sys_team_member: ['remove_team_member'],
};

describe('#7309 — an action that collects params opens ONE dialog', () => {
  it.each(OBJECTS)('%s declares no action pairing `confirmText` with `params`', (_name, obj) => {
    const doubled = actionsOf(obj)
      .filter((a) => a.confirmText && collects(a))
      .map((a) => a.name);
    expect(
      doubled,
      'these actions would open a confirm dialog and THEN a param dialog for one decision — '
        + "move the question to the action's top-level `description` (#7278/#7309). "
        + 'NB: the top-level key, never `ai.description` (the LLM-facing tool contract).',
    ).toEqual([]);
  });

  it.each(OBJECTS)('%s: every param-collecting action still ASKS its question', (name, obj) => {
    // The half a "no confirmText" grep cannot see. An action that collected
    // params and used to warn must still carry human-readable dialog copy;
    // dropping the key without rehoming the sentence lands here.
    for (const action of CONVERTED[name] ?? []) {
      const a = byName(obj, action);
      expect(collects(a), `${name}.${action} should still collect params`).toBe(true);
      expect(a.confirmText, `${name}.${action}.confirmText should be gone`).toBeUndefined();
      expect(
        typeof a.description === 'string' && a.description.trim().length > 0,
        `${name}.${action}: the confirm question was dropped, not moved — the user now gets a `
          + 'param dialog with no warning at all. Restore it on `description`.',
      ).toBe(true);
    }
  });

  it('the question is human dialog copy, never armed as an AI tool description', () => {
    // `ai.description` is the LLM-facing contract (≥40 chars, required when
    // `ai.exposed`) — the same word one level down. Putting the question there
    // would arm a tool description while the dialog fell back to its generic line.
    for (const [name, obj] of OBJECTS) {
      for (const action of CONVERTED[name] ?? []) {
        expect(byName(obj, action).ai?.description, `${name}.${action}.ai.description`).toBeUndefined();
      }
    }
  });
});

describe('#7309 — the destructive warnings survived the move, word for word', () => {
  // Pinned verbatim because these are the surfaces where a silently vanished
  // warning costs the most. A reworded warning is a decision someone should make
  // deliberately; a deleted one should never be an accident.
  it('sys_user.ban_user still says the user is signed out and locked out', () => {
    const a = byName(SysUser, 'ban_user');
    expect(a.description).toBe(
      'Ban this user? They will be signed out and unable to sign in until unbanned.',
    );
    expect(a.description).toContain('signed out');
    expect(a.description).toContain('unable to sign in');
  });

  it('sys_user.delete_my_account still says it cannot be undone', () => {
    const a = byName(SysUser, 'delete_my_account');
    expect(a.description).toContain('cannot be undone');
    expect(a.description).toContain('sessions will be terminated');
  });

  it('sys_oauth_application.rotate_client_secret keeps its finality + shown-once warning', () => {
    // Three dialogs for one click collapse to two, and the survivor pair is the
    // right one: ONE param dialog (question + `client_id`), then the post-run
    // `resultDialog` that reveals the new secret. The reveal is not a second
    // pre-run decision, so it is not part of the #7278 defect — but the "shown
    // only once" warning has to reach the user BEFORE they commit, which is
    // exactly what riding `description` preserves.
    const a = byName(SysOauthApplication, 'rotate_client_secret');
    expect(a.description).toContain('stop working immediately');
    expect(a.description).toContain('shown only once');
    expect(a.confirmText).toBeUndefined();
    expect(a.resultDialog, 'the post-run secret reveal must stay').toBeDefined();
    expect(collects(a)).toBe(true);
  });

  it('sys_user.disable_two_factor still warns the account gets less secure', () => {
    expect(byName(SysUser, 'disable_two_factor').description).toContain('less secure');
  });

  it('sys_oauth_application.delete_oauth_application still warns tokens are invalidated', () => {
    const a = byName(SysOauthApplication, 'delete_oauth_application');
    expect(a.description).toContain('invalidated');
    expect(a.description).toContain('cannot be undone');
  });

  it('sys_two_factor.regenerate_backup_codes still warns old codes stop working', () => {
    expect(byName(SysTwoFactor, 'regenerate_backup_codes').description).toContain('stop working');
  });
});

describe('#7309 — the sweep did not over-apply', () => {
  // `confirmText` is the RIGHT key for an action with no params: there is no
  // second dialog to fold the question into, and stripping it would delete the
  // only warning the user ever sees. These three are the param-less neighbours
  // that sit in the same files as converted actions.
  it.each([
    ['sys_organization', SysOrganization, 'delete_organization'],
    ['sys_organization', SysOrganization, 'leave_organization'],
    ['sys_user', SysUser, 'impersonate_user'],
  ] as const)('%s.%s keeps `confirmText` — it has no param dialog to fold into', (_n, obj, action) => {
    const a = byName(obj, action);
    expect(collects(a), `${action} is expected to be param-less`).toBe(false);
    expect(a.confirmText, `${action} lost its only warning`).toBeTruthy();
  });
});
