// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// #9308 fixture 1 — the showcase's demo personas can actually SIGN IN.
//
// ## What was missing, and why "a sys_user row exists" was never the answer
//
// `seed-approval-demo.ts` has provisioned two persona ROWS since #3411/#3409:
// Mei Phone (the submitter who holds no approver position) and Ada Auditor (the
// only holder of the `auditor` position, which backs the `finance` group of the
// per-group 会签 demo). Both were display/routing identities only — enough to
// resolve a notify recipient, enough to route an approval, and not enough to
// open a second session. Every checklist item that needs TWO acting identities
// was blocked on that one gap:
//
//   • approvals.per-group-signoff (P1)          — the two groups must be decided
//     by two DIFFERENT people, or one decision satisfies both tallies at once
//     and "one approval per group" is unobservable.
//   • approvals.viewer-gating-submitter-side (P1) — the submitter must look at
//     their own pending request; as the admin they are also an approver.
//   • approvals.ooo-delegation-reroute (P2)     — the delegate must decide under
//     their OWN bearer token, or the audit's no-laundering clause is vacuous.
//
// ## The non-obvious half this file pins
//
// A password hash is not enough: a persona needs a better-auth ACCOUNT row that
// `findAccountByKey` can actually resolve. This file asserts that the account
// exists under the key sign-in resolves on, and then asserts the thing the
// account exists for: a real sign-in over the real HTTP auth route, and a real
// authenticated request driven with the returned token. Either half alone can
// pass while the feature is broken — a correct-looking account nobody can use,
// or a token minted for an identity that turns out to be the admin.
//
// ## [#17440] Why the ISSUER assertion went away, recorded rather than deleted
//
// This file used to assert `sys_account.issuer` explicitly, and it said why:
//
// > better-auth 1.7 keys account identity on `(issuer, accountId)`, so a
// > credential row whose `issuer` is not the local credential issuer is
// > invisible to `findAccountByKey` — sign-in then fails
// > `INVALID_EMAIL_OR_PASSWORD` behind a "User not found" warn that points at
// > the `sys_user` row, which is fine, instead of at the account, which is not.
// > Four checklist items had that recorded as a knownGap, each rediscovering it.
//
// better-auth 1.7.3 removed the issuer-scoped account identity outright
// (better-auth/better-auth#10909) and `sys_account.issuer` retired with it, so
// that assertion no longer names a field — and the trap it guarded no longer
// exists to be rediscovered a fifth time.
//
// ⛔ The assertion is REPLACED, not dropped. Its job was "the account is
// resolvable under the key sign-in uses", and the key is now
// `(provider_id, account_id)` — so that is what the case below asserts, with
// the admin's own better-auth-minted account as the same positive control the
// issuer case carried. The half that never depended on the key — a real
// sign-in over the real HTTP auth route, driven with the returned token — is
// untouched and is exactly as valuable as before.
//
// ## Why this boot passes `onEnable`
//
// The persona bootstrap is an `onEnable` → `kernel:bootstrapped` hook, and
// `bootStack(showcaseStack)` passes only the DEFAULT export, so the hook never
// runs in the ordinary dogfood boot. Spreading the stack and re-attaching
// `onEnable` is what makes this boot the one a `pnpm dev:showcase` operator
// actually gets (`AppPlugin` resolves the hook owner off the bundle).

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import showcaseStack, { onEnable } from '@objectstack/example-showcase';
import {
  ADMIN_EMAIL,
  PHONE_DEMO_USER,
  AUDITOR_DEMO_USER,
  DEMO_PERSONA_PASSWORD,
} from '@objectstack/example-showcase/security-personas';
import { bootStack, type VerifyStack } from '@objectstack/verify';
import { showcaseAppDefaultSecurity } from './showcase-security.js';

const SYS = { isSystem: true } as const;

/** The showcase bundle WITH its runtime hook — see the header. */
const showcaseBundleWithHook = { ...(showcaseStack as Record<string, unknown>), onEnable };

const rowsOf = (r: unknown): Array<Record<string, unknown>> =>
  Array.isArray(r) ? (r as Array<Record<string, unknown>>) : ((r as { records?: unknown[] })?.records as Array<Record<string, unknown>>) ?? [];

describe('showcase demo personas are real logins (#9308 fixture 1)', () => {
  let stack: VerifyStack;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let ql: any;
  let adminId = '';

  const userByEmail = async (email: string) =>
    rowsOf(await ql.find('sys_user', { where: { email }, limit: 1, context: SYS }))[0];

  const credentialAccountOf = async (userId: string) =>
    rowsOf(
      await ql.find(
        'sys_account',
        { where: { user_id: userId, provider_id: 'credential' }, limit: 1, context: SYS },
      ),
    )[0];

  beforeAll(async () => {
    stack = await bootStack(showcaseBundleWithHook, { security: showcaseAppDefaultSecurity() });
    await stack.signIn();
    ql = await stack.kernel.getServiceAsync('objectql');
    adminId = String((await userByEmail(ADMIN_EMAIL))?.id ?? '');
    expect(adminId, 'the dev admin the persona bootstrap keys off').toBeTruthy();
  }, 300_000);

  afterAll(async () => {
    await stack?.stop?.();
  });

  it('PREMISE: both persona rows exist and are NOT the admin', async () => {
    for (const persona of [PHONE_DEMO_USER, AUDITOR_DEMO_USER]) {
      const row = await userByEmail(persona.email);
      expect(row?.id, `${persona.email} is provisioned as a sys_user`).toBe(persona.id);
      expect(row?.id, `${persona.email} is a SEPARATE identity from the admin`).not.toBe(adminId);
    }
  });

  it('each persona holds a credential account resolvable under the SAME key better-auth uses for the admin', async () => {
    const adminAccount = await credentialAccountOf(adminId);
    // The control: better-auth really does write an account of this shape for
    // the identity it creates itself. Without it the assertions below could
    // all be `undefined === undefined` and read as agreement.
    expect(adminAccount, 'better-auth wrote a credential account for the dev admin').toBeTruthy();
    expect(adminAccount?.provider_id, "and it is keyed under the 'credential' provider").toBe('credential');
    expect(
      String(adminAccount?.account_id ?? ''),
      "and its account id is the admin's own user id — the second half of the key",
    ).toBe(adminId);

    // [#17440] The retired column, asserted ABSENT. Without this the case
    // would still pass on a runtime that kept writing a field the platform no
    // longer declares, which is the shape a half-finished retirement takes.
    expect(
      Object.prototype.hasOwnProperty.call(adminAccount ?? {}, 'issuer'),
      'sys_account.issuer retired with better-auth 1.7.3 — nothing should still be writing it',
    ).toBe(false);

    for (const persona of [PHONE_DEMO_USER, AUDITOR_DEMO_USER]) {
      const account = await credentialAccountOf(persona.id);
      expect(account, `${persona.email} holds a credential account`).toBeTruthy();
      expect(
        account?.provider_id,
        `${persona.email}'s account must sit under the same provider the admin's does, or findAccountByKey never sees it`,
      ).toBe(adminAccount?.provider_id);
      expect(account?.account_id, `${persona.email}'s account is keyed to its own user id`).toBe(persona.id);
    }
  });

  it('each persona SIGNS IN over the real auth route, and the session resolves to that persona', async () => {
    for (const persona of [PHONE_DEMO_USER, AUDITOR_DEMO_USER]) {
      const token = await stack.signIn(persona.email, DEMO_PERSONA_PASSWORD);
      expect(token, `${persona.email} received a session token`).toBeTruthy();

      // A token alone proves the sign-in answered 200. Drive an authenticated
      // request with it and read the identity back: this is what distinguishes
      // "a second session" from "the admin session with a different label".
      const me = await stack.apiAs(token, 'GET', '/auth/get-session');
      expect(me.status, `${persona.email} reaches an authenticated route`).toBeLessThan(300);
      const body = (await me.json()) as { user?: { id?: unknown } };
      expect(
        String(body?.user?.id ?? ''),
        `${persona.email}'s session resolves to their own user id, not the admin's`,
      ).toBe(persona.id);
    }
  });

  it('the two sessions are the DISTINCT identities the 会签 demo needs: Ada holds auditor, Mei holds no approver position', async () => {
    const positionsOf = async (userId: string) =>
      rowsOf(await ql.find('sys_user_position', { where: { user_id: userId }, context: SYS }))
        .map((r) => String(r.position))
        .sort();

    expect(
      await positionsOf(AUDITOR_DEMO_USER.id),
      'Ada backs the finance group of the per-group demo and nothing else',
    ).toEqual(['auditor']);
    expect(
      await positionsOf(PHONE_DEMO_USER.id),
      'Mei is a clean submitter — never one of her own approvers',
    ).toEqual([]);
    expect(
      await positionsOf(adminId),
      'the admin holds the OTHER group, so the two groups resolve to two different people',
    ).toContain('manager');
  });
});
