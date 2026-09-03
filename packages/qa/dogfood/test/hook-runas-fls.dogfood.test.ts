// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// [#14010] The card's symptom, end to end, through the real HTTP + security
// stack: a computed column can now be BOTH protected from every hand-written
// channel AND maintained by the hook that owns it.
//
// ## What was measured broken (17.1.0, by the reporting app)
//
//   | | result |
//   | author `editable: false` for the persona | direct PATCH refused, 403 |
//   | …and the hook that maintains the column  | dies: "[Security] Field write
//   |                                          |  denied: not permitted to edit" |
//
// The hook ran as the operator, so the field permission that blocked the
// operator blocked the hook — the guard and the legitimate writer were the same
// door. Under the hook's default `onError: 'abort'` the failure surfaced as the
// TRIGGERING save being refused, which is how it presented downstream: an
// approval that would not save.
//
// ## Why this file boots a real app rather than asserting at the seam
//
// `packages/objectql`'s pins measure the ExecutionContext a hook's `ctx.api`
// presents, and `packages/runtime`'s measure the same for a sandboxed body.
// Both stop one layer short of the claim the ruling is actually about, which is
// about `plugin-security`'s composed middleware: that its `isSystem`
// short-circuit precedes the field-level write check (step 2.5), so elevation
// reaches past a denial the same permission set still enforces on the persona.
// "Who serves this path" is a question about the provisioned runtime, so this
// drives the real one: real REST routes, real SecurityPlugin, real QuickJS body.
//
// ## The four legs, and why the last one is mandatory
//
//  1. the guard is REAL — the persona's own PATCH of the column is refused;
//  2. the persona is not simply locked out — an ordinary column still saves
//     (without this, leg 1 passes for a broken app);
//  3. the DECLARED hook (`runAs: 'system'`, an L2 body) writes the protected
//     column, and the value lands;
//  4. an UNDECLARED hook is still refused, exactly as before this card. That is
//     the zero-migration claim, and it is what stops leg 3 from being read as
//     "field-level security stopped working".
//
// Attribution is asserted alongside leg 3: elevation is authorization, not
// anonymity (#5494), so the elevated write still stamps the OPERATOR.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { bootStack, type VerifyStack } from '@objectstack/verify';
import { hookRunAsFixtureStack, hookRunAsFixtureSecurity } from './fixtures/hook-runas-fixture.js';

const SYS = { isSystem: true } as const;
const MEMBER = 'hook-runas@verify.test';

const recordOf = (b: any) => b?.record ?? b?.data ?? b;

describe('#14010 a hook-maintained column can be protected by editable:false', () => {
  let stack: VerifyStack;
  let ql: any;
  let adminTok: string;
  let memberTok: string;
  let memberId: string;
  let accountId: string;

  beforeAll(async () => {
    stack = await bootStack(hookRunAsFixtureStack, { security: hookRunAsFixtureSecurity() });
    adminTok = await stack.signIn();
    // The first user is the seeded dev admin, so this fresh sign-up is a plain
    // member who falls back to the fixture permission set.
    memberTok = await stack.signUp(MEMBER);
    ql = await stack.kernel.getServiceAsync('objectql');

    const account = await ql.insert(
      'hookrunas_account',
      { name: 'Acme', current_grade: null, note: 'seed' },
      { context: SYS },
    );
    accountId = account.id;
    memberId = (await ql.findOne('sys_user', { where: { email: MEMBER }, context: SYS }))?.id;
    expect(memberId, 'member provisioned').toBeTruthy();
  }, 180_000);

  afterAll(async () => {
    await stack?.stop?.();
  });

  /** The stored row, read with a system context so no read mask is in play. */
  const storedAccount = async () =>
    (await ql.findOne('hookrunas_account', { where: { id: accountId }, context: SYS })) as any;

  it('leg 1 — the persona CANNOT hand-write the computed column (the guard is real)', async () => {
    const res = await stack.apiAs(memberTok, 'PATCH', `/data/hookrunas_account/${accountId}`, {
      current_grade: 'FORGED',
    });
    expect(res.status).toBe(403);
    const body: any = await res.json();
    expect(body?.error?.code ?? body?.code).toBe('PERMISSION_DENIED');
    expect((await storedAccount()).current_grade ?? null).toBeNull();
  }, 60_000);

  it('leg 2 — the same persona CAN write an ordinary column (not simply locked out)', async () => {
    const res = await stack.apiAs(memberTok, 'PATCH', `/data/hookrunas_account/${accountId}`, {
      note: 'member wrote this',
    });
    expect(res.status).toBeLessThan(300);
    expect((await storedAccount()).note).toBe('member wrote this');
  }, 60_000);

  it("leg 3 — a `runAs: 'system'` hook body writes the protected column, and it lands", async () => {
    const res = await stack.apiAs(memberTok, 'POST', '/data/hookrunas_rating', {
      account_id: accountId,
      grade: 'A',
    });
    expect(
      res.status,
      `the member's rating insert must succeed: ${res.status} ${await res.clone().text()}`,
    ).toBeLessThan(300);
    expect(recordOf(await res.json())).toBeTruthy();

    const account = await storedAccount();
    // The whole point of the card: the column the persona may not touch is
    // maintained by the automation that owns it.
    expect(account.current_grade).toBe('A');
    // #5494 — elevation is not anonymity. The elevated write is still the
    // member's: `updated_by` names the operator, not a system principal.
    expect(account.updated_by).toBe(memberId);
  }, 60_000);

  it('leg 4 — an UNDECLARED hook is still refused, exactly as before this card', async () => {
    const before = (await storedAccount()).current_grade;

    const res = await stack.apiAs(memberTok, 'POST', '/data/hookrunas_legacy_rating', {
      account_id: accountId,
      grade: 'Z',
    });

    // The pre-#14010 behaviour, unchanged: the hook's write is refused by the
    // same field-level check, and under the default `onError: 'abort'` that
    // refusal surfaces on the TRIGGERING save — which is exactly how the
    // downstream app experienced it.
    expect(res.status).toBeGreaterThanOrEqual(400);
    const text = await res.text();
    expect(text).toMatch(/not permitted to edit|PERMISSION_DENIED/);
    expect(text).toContain('current_grade');

    // …and nothing moved.
    expect((await storedAccount()).current_grade).toBe(before);
  }, 60_000);
});
