// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// SHOWCASE proof for ADR-0056 D7 — the app-declared default profile, wired the
// way the CLI wires it. The showcase declares `showcase_member_default` with
// `isDefault: true`; `appDefaultPermissionSetName(stack.permissions)` (the helper the
// CLI calls) extracts its name, and passing it as the SecurityPlugin
// `fallbackPermissionSet` makes a fresh sign-up governed by THAT profile instead
// of the built-in `member_default`. Read-mostly default ⇒ the member can read
// announcements, and does NOT hold what the built-in baseline grants — proving
// the app's declared default is in force and the built-in one is not.
//
// [#6964] The denial half of that proof was REPLACED WHOLESALE, not re-worded.
// It used to read `showcase_contact` and justify `not.toBe(200)` with
// "`member_default` has a wildcard grant → would be 200". #5491 (PR #6684)
// removed that wildcard, so the counterfactual expired and the case passed
// because NOTHING IS PRODUCED. Measured on this exact stack, one fresh sign-up
// per wiring:
//
//   fallback=member_default          announcement=403 contact=403 sys_user_preference=200
//   fallback=showcase_demo_default   announcement=200 contact=403 sys_user_preference=403
//   fallback=showcase_member_default announcement=200 contact=403 sys_user_preference=403
//
// Row 1 is the world the old case claimed to exclude, and `showcase_contact` is
// 403 there too — it held identically either way, so it could not tell "the
// declared default is in force" from "no default is in force at all", which is
// the one thing this file exists to tell. The surviving discriminator runs the
// other way round: name an object ONLY the built-in baseline grants. The same
// run settles the risk that would have killed that idea — a NAMED fallback set
// REPLACES `member_default` rather than merging additively on top of it, so
// `sys_user_preference` is 200 if and only if the built-in baseline governs.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import showcaseStack from '@objectstack/example-showcase';
import { bootStack, type VerifyStack } from '@objectstack/verify';
import { SecurityPlugin, securityDefaultPermissionSets, appDefaultPermissionSetName } from '@objectstack/plugin-security';
import { PermissionSetSchema, type PermissionSet } from '@objectstack/spec/security';

// Mirror the CLI: pull the app-declared default profile (name + object) off the
// stack metadata via the same helper the CLI uses.
const stackPerms = ((showcaseStack as { permissions?: unknown[] }).permissions ?? []) as Array<{ name?: string }>;
const appDefault = appDefaultPermissionSetName(stackPerms);
const declaredDefault = stackPerms.find((p) => p?.name === appDefault) as unknown;

describe('showcase: app-declared default profile, CLI-wired (ADR-0056 D7)', () => {
  let stack: VerifyStack;
  let memberToken: string;

  beforeAll(async () => {
    // The full CLI boot loads stack permission sets into the metadata service, so
    // `fallbackPermissionSet: <name>` resolves there. The lightweight harness does
    // not seed permission metadata, so we hand the declared default to the plugin
    // directly — then wire it by NAME exactly as the CLI's appDefaultPermissionSetName
    // path does (constructor uses the explicit name, not its own isDefault scan).
    stack = await bootStack(showcaseStack, {
      security: new SecurityPlugin({
        defaultPermissionSets: [...securityDefaultPermissionSets, PermissionSetSchema.parse(declaredDefault) as PermissionSet],
        fallbackPermissionSet: appDefault,
      }),
    });
    await stack.signIn();
    memberToken = await stack.signUp('d7-showcase-member@verify.test');
  }, 60_000);

  afterAll(async () => { await stack?.stop(); });

  it('appDefaultPermissionSetName extracts the showcase default profile from stack metadata', () => {
    expect(appDefault).toBe('showcase_member_default');
  });

  it('a fresh member is governed by the app-declared default (reads announcements)', async () => {
    const r = await stack.apiAs(memberToken, 'GET', '/data/showcase_announcement');
    expect(r.status, 'declared default grants announcement read').toBe(200);
  });

  it('and NOT by the built-in member_default baseline (its own explicit grant is absent)', async () => {
    // `sys_user_preference` is granted by `member_default` and by nothing else
    // here (`default-permission-sets.ts`: allowRead/allowCreate/allowEdit, with a
    // `sys_user_preference_self` RLS carve-out), and `showcase_member_default`
    // names no `sys_*` object at all. So it is 200 exactly when the built-in
    // baseline governs — which is the discrimination `showcase_contact` lost when
    // #5491 removed the wildcard that used to make a denial informative.
    const r = await stack.apiAs(memberToken, 'GET', '/data/sys_user_preference');
    expect(r.status, 'the built-in baseline is REPLACED by the declared default, not merged with it').not.toBe(200);
  });
});
