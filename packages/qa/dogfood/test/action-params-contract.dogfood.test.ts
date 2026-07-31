// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// ADR-0104 D2 — action param contract enforced at dispatch, over real HTTP.
//
// The showcase `showcase_action_param_gallery` action (on field-zoo) declares
// a required `p_text`, an option-bearing `p_priority` select, and an inline
// lookup `p_account`. Its body echoes the received param keys. We drive the
// real `/actions/:object/:action` route to prove the declared contract is
// enforced BEFORE the body runs:
//   - default (strict since 17.0, #3438): a malformed bag is rejected 400
//     before the handler runs; a conformant bag passes.
//   - escape hatch (OS_ALLOW_LAX_ACTION_PARAMS=1): the same malformed bag is
//     accepted again, for the operator who must keep an integration
//     dispatching while they fix its caller.
//
// The duals are this way round on purpose. Under warn-first the strict path was
// the one nobody reached without setting a variable; now the DEFAULT path is
// what every caller hits, so it is what the gate must prove — and the hatch,
// which is the branch nobody sets, is exactly the kind of thing that rots
// unnoticed unless a test drives it.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import showcaseStack from '@objectstack/example-showcase';
import { bootStack, type VerifyStack } from '@objectstack/verify';

const ACTION_PATH = '/actions/showcase_field_zoo/showcase_action_param_gallery';

describe('dogfood: action param contract enforced at dispatch (ADR-0104 D2)', () => {
  let stack: VerifyStack;
  let token: string;

  beforeAll(async () => {
    stack = await bootStack(showcaseStack);
    token = await stack.signIn();
  }, 60_000);

  afterAll(async () => {
    delete process.env.OS_ALLOW_LAX_ACTION_PARAMS;
    await stack?.stop();
  });

  // A bag that violates the declaration three ways: missing required `p_text`,
  // a `p_priority` outside its options, and an undeclared `bogus` key.
  const badBag = { p_priority: 'NOT_AN_OPTION', bogus: 123 };
  const goodBag = { p_text: 'Hello', p_priority: 'high' };

  it('default: a malformed param bag is rejected 400 before the handler runs', async () => {
    delete process.env.OS_ALLOW_LAX_ACTION_PARAMS;
    const res = await stack.apiAs(token, 'POST', ACTION_PATH, { params: badBag });
    expect(res.status).toBe(400);
    const text = await res.text();
    expect(text).toMatch(/p_text/);       // required
    expect(text).toMatch(/p_priority/);   // bad option
    expect(text).toMatch(/bogus/);        // unknown key
  });

  it('default: a conformant bag passes (dispatcher built-in keys are allowlisted)', async () => {
    delete process.env.OS_ALLOW_LAX_ACTION_PARAMS;
    const res = await stack.apiAs(token, 'POST', ACTION_PATH, { params: goodBag });
    expect(res.status, `expected pass, got ${res.status}: ${await res.clone().text()}`).toBeLessThan(300);
  });

  it('escape hatch: OS_ALLOW_LAX_ACTION_PARAMS=1 accepts the malformed bag again', async () => {
    process.env.OS_ALLOW_LAX_ACTION_PARAMS = '1';
    try {
      const res = await stack.apiAs(token, 'POST', ACTION_PATH, { params: badBag });
      expect(res.status, `expected pass-through, got ${res.status}: ${await res.clone().text()}`).toBeLessThan(300);
    } finally {
      delete process.env.OS_ALLOW_LAX_ACTION_PARAMS;
    }
  });
});
