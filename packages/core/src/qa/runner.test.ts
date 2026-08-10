// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// #7256 — the `contains` assertion used to SILENTLY PASS when the actual value was
// neither an array nor a string. The `case 'contains':` block handled the two
// evaluable shapes and had no `else`, so `undefined` (a typo'd `field` path, or a
// response shape that moved), `null`, a number or an object fell out of the switch
// throwing nothing, and the scenario reported ✅. A suite asserting `contains`
// against a field the result does not have was asserting NOTHING, and CI believed it.
//
// These pin both halves of the fix: the three non-evaluable shapes now fail LOUD with
// a message that names the runtime type and says which of the fixture or the assertion
// is the suspect, and the two evaluable shapes keep their pre-existing behaviour in
// BOTH directions (a match still passes, a miss still fails).

import { describe, it, expect } from 'vitest';
import * as QA from '@objectstack/spec/qa';
import { TestRunner } from './runner.js';
import type { TestExecutionAdapter } from './adapter.js';

/** An adapter that hands the runner one fixed result — the assertion is the unit under test. */
class StubAdapter implements TestExecutionAdapter {
  constructor(private result: unknown) {}
  async execute(): Promise<unknown> {
    return this.result;
  }
}

/** Run one assertion against one canned adapter result, through the public runner surface. */
async function runAssertion(
  result: unknown,
  assertion: QA.TestAssertion,
): Promise<{ passed: boolean; error: string }> {
  const runner = new TestRunner(new StubAdapter(result));
  const [outcome] = await runner.runSuite({
    name: 'contains-pins',
    scenarios: [
      {
        id: 'scenario-1',
        name: 'single assertion',
        steps: [
          {
            name: 'step-1',
            action: { type: 'api_call', target: '/api/v1/accounts' },
            assertions: [assertion],
          },
        ],
      },
    ],
  });
  const error = outcome.error;
  return {
    passed: outcome.passed,
    error: error instanceof Error ? error.message : String(error ?? ''),
  };
}

const containsAcme: QA.TestAssertion = {
  field: 'body.data.items',
  operator: 'contains',
  expectedValue: 'acme',
};

describe("TestRunner — `contains` against a non-array/non-string actual fails loud (#7256)", () => {
  it('fails when the field path resolves to nothing (the filed case: a missing path)', async () => {
    const { passed, error } = await runAssertion({ body: { data: {} } }, containsAcme);

    expect(passed).toBe(false);
    // Names the field, the operator and the runtime type...
    expect(error).toContain('body.data.items');
    expect(error).toContain("'contains'");
    expect(error).toContain('got undefined');
    // ...and points at the FIXTURE, because the path is what did not resolve.
    expect(error).toContain('absent from the result');
  });

  it('fails when the whole response shape is missing, not just the leaf', async () => {
    const { passed, error } = await runAssertion(undefined, containsAcme);

    expect(passed).toBe(false);
    expect(error).toContain('got undefined');
  });

  it('fails when the field path resolves to null', async () => {
    const { passed, error } = await runAssertion({ body: { data: { items: null } } }, containsAcme);

    expect(passed).toBe(false);
    expect(error).toContain('got null');
    // `null` is not reported as `object` — the author needs to see which one it is.
    expect(error).not.toContain('got object');
    expect(error).toContain('resolved to null');
  });

  it('fails when the field path resolves to a number', async () => {
    const { passed, error } = await runAssertion({ body: { data: { items: 42 } } }, containsAcme);

    expect(passed).toBe(false);
    expect(error).toContain('got number');
    // The path resolved fine here, so the ASSERTION is the suspect, not the fixture.
    expect(error).toContain('array membership and string substrings only');
  });

  it('fails when the field path resolves to an object', async () => {
    const { passed, error } = await runAssertion(
      { body: { data: { items: { acme: true } } } },
      containsAcme,
    );

    expect(passed).toBe(false);
    expect(error).toContain('got object');
    expect(error).toContain('array membership and string substrings only');
  });

  it('fails when the field path resolves to a boolean', async () => {
    const { passed, error } = await runAssertion({ body: { data: { items: false } } }, containsAcme);

    expect(passed).toBe(false);
    expect(error).toContain('got boolean');
  });

  it('every non-evaluable shape reports the same failure, not a pass', async () => {
    const nonEvaluable: unknown[] = [undefined, null, 0, 42, false, true, { acme: true }];

    for (const value of nonEvaluable) {
      const { passed, error } = await runAssertion({ body: { data: { items: value } } }, containsAcme);
      expect(passed, `contains against ${String(value)} must not pass`).toBe(false);
      expect(error).toContain("cannot be evaluated by 'contains'");
    }
  });
});

describe('TestRunner — `contains` keeps its behaviour on the two evaluable shapes (#7256)', () => {
  it('passes when the array contains the expected member', async () => {
    const { passed } = await runAssertion({ body: { data: { items: ['acme', 'globex'] } } }, containsAcme);

    expect(passed).toBe(true);
  });

  it('fails when the array does not contain the expected member', async () => {
    const { passed, error } = await runAssertion({ body: { data: { items: ['globex'] } } }, containsAcme);

    expect(passed).toBe(false);
    expect(error).toContain('array does not contain acme');
    // Still the membership failure, NOT the new inapplicable-shape failure.
    expect(error).not.toContain("cannot be evaluated by 'contains'");
  });

  it('passes when the string contains the expected substring', async () => {
    const { passed } = await runAssertion({ body: { data: { items: 'acme corp' } } }, containsAcme);

    expect(passed).toBe(true);
  });

  it('fails when the string does not contain the expected substring', async () => {
    const { passed, error } = await runAssertion({ body: { data: { items: 'globex corp' } } }, containsAcme);

    expect(passed).toBe(false);
    expect(error).toContain('string does not contain acme');
    expect(error).not.toContain("cannot be evaluated by 'contains'");
  });

  it('an empty array is evaluable — it simply does not contain the member', async () => {
    const { passed, error } = await runAssertion({ body: { data: { items: [] } } }, containsAcme);

    expect(passed).toBe(false);
    expect(error).toContain('array does not contain acme');
  });

  it('an empty string is evaluable — every string contains the empty substring', async () => {
    const { passed } = await runAssertion(
      { body: { data: { items: '' } } },
      { field: 'body.data.items', operator: 'contains', expectedValue: '' },
    );

    expect(passed).toBe(true);
  });
});

describe('TestRunner — the sibling operators are unchanged by #7256', () => {
  it('`equals` still compares unconditionally, including against a missing path', async () => {
    const { passed, error } = await runAssertion(
      { body: {} },
      { field: 'body.status', operator: 'equals', expectedValue: 'active' },
    );

    expect(passed).toBe(false);
    expect(error).toContain('expected active');
  });

  it('`is_null` still passes on a missing path — absence is what it asserts', async () => {
    const { passed } = await runAssertion(
      { body: {} },
      { field: 'body.status', operator: 'is_null', expectedValue: null },
    );

    expect(passed).toBe(true);
  });

  it('`not_null` still fails on a missing path', async () => {
    const { passed } = await runAssertion(
      { body: {} },
      { field: 'body.status', operator: 'not_null', expectedValue: null },
    );

    expect(passed).toBe(false);
  });

  // `not_contains` / `gt` / `gte` / `lt` / `lte` / `error` are declared in
  // `TestAssertionTypeSchema` and have no branch in the runner. That is a DIFFERENT
  // defect from #7256 (a declared operator the engine refuses is annoying but honest,
  // where a silent pass is a lie), and it is pinned here so a later implementation is
  // a deliberate change rather than an accident.
  it('a declared-but-unimplemented operator is refused, not silently passed', async () => {
    const { passed, error } = await runAssertion(
      { body: { data: { items: ['globex'] } } },
      { field: 'body.data.items', operator: 'not_contains', expectedValue: 'acme' },
    );

    expect(passed).toBe(false);
    expect(error).toContain('Unknown assertion operator: not_contains');
  });
});
