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

  // ── [#12160] The ADR-0126 §8 activation door, on the REAL mount ───────────
  //
  // `POST /actions/_activation/:object/:action` is NOT a registered pattern.
  // Nothing mounts it: a 3-segment activation path is matched by
  // `/api/v1/actions/:object/:action/:recordId` with `_activation` bound to
  // `:object`, and it only reaches the activation arm because that mount
  // rebuilds the dispatch path from its matched params, byte for byte. The
  // route ledger says so with `servedBy`, and #7526's parity gate holds that
  // declaration to the live router.
  //
  // What the ledger row CANNOT say is that the arm still answers, and that is
  // the half worth pinning here: the unit suites drive `handleActionsRequest`
  // directly, so they would stay green if the mount ever stopped forwarding
  // the path faithfully (passing structured params instead, say) and every
  // activation call started being served as an INVOCATION of an action named
  // after the object segment. These two assertions fail the moment that
  // happens, because both messages are ones only the activation arm produces.
  describe('[#12160] the reserved `_activation` segment survives the real mount', () => {
    it('the 2-segment shape answers the activation door, not an invocation', async () => {
      const res = await stack.apiAs(token, 'POST', '/actions/_activation/showcase_mark_done', {});
      const text = await res.text();

      // The invocation path's answer for this URL would be a 404 naming a
      // missing DECLARATION (`add \`defineAction\``) for action
      // `showcase_mark_done` on object `_activation`.
      expect(res.status, text).toBe(400);
      expect(text).toContain('/actions/_activation/:object/:action');
    });

    it('the 3-segment shape reaches the activation door for a real object', async () => {
      const res = await stack.apiAs(
        token, 'POST', '/actions/_activation/showcase_task/no_such_action', { enabled: false },
      );
      const text = await res.text();

      expect(res.status, text).toBe(404);
      // The activation door's own wording — the invocation door's 404 for an
      // undeclared action says `add \`defineAction\`` instead, so this
      // distinguishes "my arm ran" from "swallowed by the sibling".
      expect(text).toContain('nothing to switch off');
      expect(text).not.toContain('defineAction');
    });
  });
});
