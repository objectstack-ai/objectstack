// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The write rule of `sys_user_preference`, a user's own per-user key-value
 * state (pinned list views, recent items, the console's remembered UI state).
 *
 * **The owner is fixed when the preference is saved.** An update that sends a
 * `user_id` other than the stored one is refused `403 PERMISSION_DENIED`, for
 * every caller but the system: a member, an organization administrator and a
 * platform administrator alike. An update that echoes the stored owner saves.
 * The rule, and why the object's row scope alone does not hold it, is
 * `owner-fixed-rule.ts`'s, shared with `sys_personal_view`.
 *
 * What it leaves alone: a create is the row scope's (a preference created in
 * another member's name is refused there, pinned over REST as `[member-create]`
 * in `user-preference-owner-fixed.dogfood.test.ts`); the console's preference writer
 * (`userState.ts` in `@object-ui/data-objectstack`) updates `value` only and
 * creates in the caller's own name; a system write is never judged, and no
 * shipped system writer moves a preference. A system write includes
 * app-authored automation elevated to system (a `runAs: 'system'` flow, a
 * hook's `runAs: 'system'` api or `ctx.api.sudo()`, an action body's
 * `ctx.api`; the family plugin-security's `flow-system-identity-write-refusal.ts`
 * names), so an app's automation can move one.
 *
 * Registered by every plugin that registers the object (`AuthPlugin`, and
 * `IdentityObjectsPlugin` on a kernel without it), so the rule travels with the
 * table.
 */

import { assertOwnerUnchanged } from './owner-fixed-rule.js';

/** The object these hooks guard. */
export const USER_PREFERENCE_OBJECT = 'sys_user_preference';

/** How the shared owner rule names this object's rows. */
const USER_PREFERENCE_SUBJECT = { label: 'User preference', noun: 'preference' } as const;

export interface UserPreferenceHooksOptions {
  packageId: string;
  logger?: { info(msg: string): void };
}

/**
 * Register the rule on an ObjectQL engine. Re-binding after hot reload
 * follows the engine's standard contract: `engine.unregisterHooksByPackage(packageId)` first.
 */
export function registerUserPreferenceHooks(engine: any, opts: UserPreferenceHooksOptions): void {
  const ownerIsFixed = async (ctx: any): Promise<void> => {
    if (ctx?.object !== USER_PREFERENCE_OBJECT) return;
    assertOwnerUnchanged(ctx, USER_PREFERENCE_SUBJECT);
  };
  engine.registerHook('beforeUpdate', ownerIsFixed, { object: USER_PREFERENCE_OBJECT, packageId: opts.packageId });
  opts.logger?.info('[UserPreferenceHooks] sys_user_preference hook registered: a preference\'s owner never changes');
}
