// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// ADR-0056 D7 — app-declared DEFAULT PROFILE. A permission set marked
// `isDefault: true` becomes the fallback for authenticated users with no explicit
// grants — the app declares its default access posture instead of inheriting the
// built-in `member_default`. Proven on the real showcase: a fresh sign-up governed
// by a custom default profile that grants ONLY `showcase_announcement` can read
// it, and does NOT hold what the built-in baseline grants — so the declared
// default is provably IN FORCE and the built-in one is provably OUT. Foundation
// for SSO/JIT provisioning.
//
// [#6964] The denial half of that proof was REPLACED WHOLESALE, not re-worded.
// It used to read `showcase_private_note` and justify `not.toBe(200)` with
// "`member_default` has a wildcard grant → would be 200". #5491 (PR #6684)
// removed that wildcard, so the counterfactual expired and the case passed
// because NOTHING IS PRODUCED. Measured on this exact stack, one fresh sign-up
// per wiring:
//
//   fallback=member_default          announcement=403 private_note=403 sys_user_preference=200
//   fallback=showcase_demo_default   announcement=200 private_note=403 sys_user_preference=403
//   fallback=showcase_member_default announcement=200 private_note=200 sys_user_preference=403
//
// Row 1 is the world the old case claimed to exclude, and `private_note` is 403
// there too — it held identically either way. The surviving discriminator runs
// the other way round: name an object ONLY the built-in baseline grants, so
// `sys_user_preference` is 200 if and only if the built-in baseline governs.
//
// [#7555] The `sys_user_preference=403` in rows 2 and 3 was the DEFECT, not the
// contract: it measured a named fallback set DISPLACING `member_default`, which
// ADR-0090 D5 forbids ("baseline ∪ explicit, always") and which cost every
// member of a baseline-declaring app the whole platform floor. Rows 2 and 3 now
// read `sys_user_preference=200`.
//
// The pair below is therefore red in both directions: the first case goes red if
// the declared default is not in force, the second if it DISPLACES the built-in
// one instead of composing with it.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import showcaseStack from '@objectstack/example-showcase';
import { bootStack, type VerifyStack } from '@objectstack/verify';
import { SecurityPlugin, securityDefaultPermissionSets } from '@objectstack/plugin-security';
import { PermissionSetSchema } from '@objectstack/spec/security';

// App-declared default profile — grants ONLY announcement (no wildcard).
const demoDefault = PermissionSetSchema.parse({
  name: 'showcase_demo_default',
  label: 'Demo Default Profile',
  isDefault: true, // ← the D7 marker: this is the fallback for unprovisioned users
  objects: {
    showcase_announcement: { allowRead: true, allowCreate: true, allowEdit: true, allowDelete: false },
  },
});

describe('showcase: app-declared default profile (ADR-0056 D7)', () => {
  let stack: VerifyStack;
  let memberToken: string;

  beforeAll(async () => {
    stack = await bootStack(showcaseStack, {
      // NOTE: no `fallbackPermissionSet` passed — it MUST resolve from `isDefault`.
      security: new SecurityPlugin({
        defaultPermissionSets: [...securityDefaultPermissionSets, demoDefault],
      }),
    });
    await stack.signIn();
    memberToken = await stack.signUp('d7-member@verify.test');
  }, 60_000);

  afterAll(async () => { await stack?.stop(); });

  it('a fresh sign-up is governed by the app-declared default (grants announcement)', async () => {
    const r = await stack.apiAs(memberToken, 'GET', '/data/showcase_announcement');
    expect(r.status, 'default profile grants announcement read').toBe(200);
  });

  it('AND by the built-in member_default baseline — the two COMPOSE (#7555)', async () => {
    // `sys_user_preference` is granted by `member_default` and by nothing else
    // here (`default-permission-sets.ts`: allowRead/allowCreate/allowEdit, with a
    // `sys_user_preference_self` RLS carve-out). So it is 200 exactly when the
    // built-in baseline governs — the counterfactual `showcase_private_note` used
    // to carry before #5491 removed the wildcard that made it discriminating.
    //
    // [#7555] The DIRECTION flipped, the discriminator did not. `not.toBe(200)`
    // pinned the displacement — an app declaring `isDefault` silently cost its
    // members the entire platform floor, which is why the QA run behind #7555
    // found all 10 built-in Account nav entries served and 7/7 of the objects
    // behind them answering 403. ADR-0090 D5 rules the baseline additive
    // ("baseline ∪ explicit, always"), so the platform set still governs.
    const r = await stack.apiAs(memberToken, 'GET', '/data/sys_user_preference');
    expect(r.status, 'the platform baseline COMPOSES with the declared default, it is not replaced by it').toBe(200);
  });
});
