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
// the other way round: name an object ONLY the built-in baseline grants. The
// same run settles the risk that would have killed that idea — a NAMED fallback
// set REPLACES `member_default` rather than merging additively on top of it, so
// `sys_user_preference` is 200 if and only if the built-in baseline governs.
//
// The pair below is therefore red in both directions: the first case goes red if
// the declared default is not in force, the second if the built-in one still is.

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

  it('and NOT by the built-in member_default baseline (its own explicit grant is absent)', async () => {
    // `sys_user_preference` is granted by `member_default` and by nothing else
    // here (`default-permission-sets.ts`: allowRead/allowCreate/allowEdit, with a
    // `sys_user_preference_self` RLS carve-out). So it is 200 exactly when the
    // built-in baseline governs — the counterfactual `showcase_private_note` used
    // to carry before #5491 removed the wildcard that made it discriminating.
    const r = await stack.apiAs(memberToken, 'GET', '/data/sys_user_preference');
    expect(r.status, 'the built-in baseline is REPLACED by the declared default, not merged with it').not.toBe(200);
  });
});
