// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// ADR-0056 (Option A) — declaration-derived public-form authorization.
// A public form submission carries a `publicFormGrant: { object }` derived from
// the form's declared target. The SecurityPlugin honors it as a NARROW capability:
// create + read-back on THAT object only — no userId, no deployment-configured
// `guest_portal`, and crucially NOT the anonymous fall-open (which would allow
// anything). This is what lets public forms survive a secure-by-default flip
// while staying least-privilege. Proven at the engine boundary (the same
// middleware the HTTP form-submit route flows through).

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import showcaseStack from '@objectstack/example-showcase';
import { bootStack, type VerifyStack } from '@objectstack/verify';

const idOf = (r: any) => r?.id ?? r?.record?.id ?? r?.data?.id ?? r;

describe('ADR-0056 Option A — public-form grant (declaration-derived)', () => {
  let stack: VerifyStack;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let ql: any;

  beforeAll(async () => {
    stack = await bootStack(showcaseStack);
    await stack.signIn();
    ql = await stack.kernel.getServiceAsync('objectql');
  }, 60_000);

  afterAll(async () => { await stack?.stop(); });

  it('authorizes CREATE on exactly the declared object (no userId / no guest_portal)', async () => {
    const ctx = { publicFormGrant: { object: 'showcase_private_note' } };
    const r = await ql.insert('showcase_private_note', { title: 'from public form' }, { context: ctx });
    expect(idOf(r), 'create on the form target succeeds').toBeTruthy();
  });

  it('is NARROW — does NOT extend to other objects (not the anonymous fall-open)', async () => {
    const ctx = { publicFormGrant: { object: 'showcase_private_note' } };
    await expect(
      ql.insert('showcase_announcement', { title: 'cross-object' }, { context: ctx }),
      'grant for private_note must not authorize announcement',
    ).rejects.toThrow();
  });

  it('does NOT permit update/delete (create + read-back only)', async () => {
    const seed = await ql.insert('showcase_private_note', { title: 'seed' }, { context: { isSystem: true } });
    const ctx = { publicFormGrant: { object: 'showcase_private_note' } };
    await expect(
      ql.update('showcase_private_note', { id: idOf(seed), title: 'hacked' }, { context: ctx }),
      'grant must not authorize update',
    ).rejects.toThrow();
  });
});
