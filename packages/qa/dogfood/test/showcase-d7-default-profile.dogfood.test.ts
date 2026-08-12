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
// other way round: name an object ONLY the built-in baseline grants, so
// `sys_user_preference` is 200 if and only if the built-in baseline governs.
//
// [#7555] The `sys_user_preference=403` in rows 2 and 3 above was the DEFECT,
// not the contract. Those rows measured a named fallback set DISPLACING
// `member_default`, and #7555 measured what that costs a real member: all 10
// built-in Account nav entries served, 7/7 of the objects behind them 403. The
// baseline now COMPOSES (ADR-0090 D5, "baseline ∪ explicit, always"), so rows 2
// and 3 read `sys_user_preference=200` and the file's pair is red in both
// directions still — announcement for the declared half, preference for the
// platform half.

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

const SYS = { isSystem: true } as const;

describe('showcase: app-declared default profile, CLI-wired (ADR-0056 D7)', () => {
  let stack: VerifyStack;
  let memberToken: string;
  let ql: any;

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
    ql = await stack.kernel.getServiceAsync('objectql');
  }, 60_000);

  afterAll(async () => { await stack?.stop(); });

  it('appDefaultPermissionSetName extracts the showcase default profile from stack metadata', () => {
    expect(appDefault).toBe('showcase_member_default');
  });

  it('a fresh member is governed by the app-declared default (reads announcements)', async () => {
    const r = await stack.apiAs(memberToken, 'GET', '/data/showcase_announcement');
    expect(r.status, 'declared default grants announcement read').toBe(200);
  });

  it('AND by the built-in member_default baseline — the two COMPOSE (#7555)', async () => {
    // `sys_user_preference` is granted by `member_default` and by nothing else
    // here (`default-permission-sets.ts`: allowRead/allowCreate/allowEdit, with a
    // `sys_user_preference_self` RLS carve-out), and `showcase_member_default`
    // names no `sys_*` object at all. So it is 200 exactly when the built-in
    // baseline governs — which is the discrimination `showcase_contact` lost when
    // #5491 removed the wildcard that used to make a denial informative.
    //
    // [#7555] The DIRECTION flipped, the discriminator did not. This case used
    // to demand `not.toBe(200)`, pinning "a NAMED fallback set REPLACES
    // `member_default`" — the exact defect #7555 reports: every member of an app
    // that declares a default lost the whole platform floor, so all 10 built-in
    // Account nav entries were served and 7/7 of the objects behind them 403'd.
    // ADR-0090 D5 rules the baseline additive ("baseline ∪ explicit, always"),
    // so the platform set must still govern alongside the declared one, and this
    // object is still the one that says whether it does.
    const r = await stack.apiAs(memberToken, 'GET', '/data/sys_user_preference');
    expect(r.status, 'the platform baseline COMPOSES with the declared default, it is not replaced by it').toBe(200);
  });

  it('and the explain surface tells the same story: BOTH sets are bound to the everyone anchor (#7555)', async () => {
    // The runtime composing while the anchor carried only the app's set would
    // make `security/explain` — and the Setup UI reading the same join table —
    // report a narrower default than every request actually applies. The join
    // table takes many rows per position; the boot binding writes one per
    // baseline name.
    const everyone = await ql.findOne('sys_position', { where: { name: 'everyone' }, context: SYS });
    expect(everyone?.id, 'everyone anchor seeded').toBeTruthy();
    const bound: string[] = [];
    for (const name of ['showcase_member_default', 'member_default']) {
      const set = await ql.findOne('sys_permission_set', { where: { name }, context: SYS });
      if (!set?.id) continue;
      const row = await ql.findOne('sys_position_permission_set', {
        where: { position_id: everyone.id, permission_set_id: set.id }, context: SYS,
      });
      if (row) bound.push(name);
    }
    expect(bound, 'everyone ← app baseline AND platform baseline').toEqual([
      'showcase_member_default',
      'member_default',
    ]);
  });
});
