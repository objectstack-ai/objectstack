// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// Checklist item `records-forms.action-param-widgets` (#26573): the two api
// clauses, at the dispatch door of the booted showcase —
// `POST /api/v1/actions/showcase_field_zoo/showcase_action_param_gallery`.
//
//   acceptance[2], negative[1] — the declared param contract is enforced
//     BEFORE the body runs: a malformed bag is refused 400 and its answer
//     carries no body output; the conformant bag passes and the body echoes
//     the keys it received.
//   acceptance[3] (its server half) — a bag missing ONLY the required
//     `p_text` is refused server-side, naming `p_text`, and the body never ran.
//
// `action-params-contract.dogfood.test.ts` already proves the refusal status
// of a three-way malformed bag; what it does not read is whether the body ran,
// and it never sends a bag whose ONLY fault is the missing required param.
// The gallery action's body has no side effect: it returns
// `{ ok: true, received: Object.keys(input) }`. So "the body ran" is
// observable in exactly one place, its `received` echo, and every refusal
// below asserts that echo is absent. The dialog half of acceptance[3] and
// the dom clauses (acceptance[0], [1], negative[0]) stay browser legs.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { type VerifyStack } from '@objectstack/verify';
import { bootShowcase } from './showcase-boot.js';

const ACTION_PATH = '/actions/showcase_field_zoo/showcase_action_param_gallery';

type Answer = { status: number; json: any; text: string };

describe('records-forms.action-param-widgets — the param contract at the dispatch door', () => {
  let stack: VerifyStack;
  let token = '';

  const dispatch = async (params: Record<string, unknown>): Promise<Answer> => {
    const res = await stack.apiAs(token, 'POST', ACTION_PATH, { params });
    const text = await res.text();
    let json: any = {};
    try { json = JSON.parse(text); } catch { /* not JSON */ }
    return { status: res.status, json, text };
  };

  beforeAll(async () => {
    delete process.env.OS_ALLOW_LAX_ACTION_PARAMS;
    stack = await bootShowcase();
    token = await stack.signIn();
  }, 180_000);

  afterAll(async () => {
    await stack?.stop();
  });

  it('acceptance[2]: the conformant bag passes and the body echoes the keys it received', async () => {
    const ok = await dispatch({ p_text: 'Hello', p_priority: 'high' });
    expect(ok.status, ok.text).toBe(200);
    expect(ok.text).toContain('received');
    expect(ok.text).toContain('p_text');
    expect(ok.text).toContain('p_priority');
  });

  it('acceptance[2], negative[1]: a malformed bag is refused 400 and the body never ran', async () => {
    const bad = await dispatch({ p_text: 'Hello', p_priority: 'NOT_AN_OPTION', bogus: 123 });
    expect(bad.status, bad.text).toBe(400);
    expect(bad.text).toMatch(/p_priority/);
    expect(bad.text).toMatch(/bogus/);
    expect(bad.text, 'the refusal carries the body\'s echo').not.toContain('received');
  });

  it('acceptance[3]: a bag missing only the required p_text is refused server-side, naming it, and the body never ran', async () => {
    const missing = await dispatch({ p_priority: 'high' });
    expect(missing.status, missing.text).toBe(400);
    expect(missing.text).toMatch(/p_text/);
    expect(missing.text, 'the refusal carries the body\'s echo').not.toContain('received');
  });
});
