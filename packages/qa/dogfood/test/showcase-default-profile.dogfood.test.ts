// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// ADR-0056 D7 — app-declared DEFAULT PROFILE. A permission set marked
// `isDefault: true` becomes the fallback for authenticated users with no explicit
// grants — the app declares its default access posture instead of inheriting the
// built-in `member_default`. Proven on the real showcase: a fresh sign-up governed
// by a custom default profile that grants ONLY `showcase_announcement` can read it
// but is DENIED `showcase_private_note` (which the wildcard `member_default` would
// have allowed) — so the declared default is provably in effect. Foundation for
// SSO/JIT provisioning.

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

  it('and NOT by the built-in member_default wildcard (private_note is denied)', async () => {
    const r = await stack.apiAs(memberToken, 'GET', '/data/showcase_private_note');
    // member_default has a wildcard grant → would be 200. The declared default
    // grants only announcement → this object is denied, proving D7 is in effect.
    expect(r.status, 'default profile does NOT grant private_note').not.toBe(200);
  });
});
