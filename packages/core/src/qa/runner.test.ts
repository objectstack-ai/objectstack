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
import type { TargetServices, TestExecutionAdapter } from './adapter.js';

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

// A result used to carry `scenarioId` and nothing else an author wrote: the
// suite's `name` and each scenario's `name` were parsed and read by nothing, so a
// careful human-readable title came back as the terse id in every report. These
// pin the names onto BOTH result envelopes — the completed run and the
// setup-failure early return — because a report prints the names of the
// scenarios that failed at least as often as of the ones that passed.
describe('TestRunner — results carry the suite and scenario names the author wrote', () => {
  const step: QA.TestStep = {
    name: 'step-1',
    action: { type: 'api_call', target: '/api/v1/health' },
  };

  /** An adapter whose every action throws — drives the setup-failure envelope. */
  class ThrowingAdapter implements TestExecutionAdapter {
    async execute(): Promise<unknown> {
      throw new Error('target unreachable');
    }
  }

  const suite: QA.TestSuite = {
    name: 'Accounts smoke',
    scenarios: [
      {
        id: 'acct-create',
        name: 'An account can be created',
        description: 'Fails when the data API refuses a plain insert.',
        steps: [step],
      },
      { id: 'acct-read', name: 'An account reads back', steps: [step] },
    ],
  };

  it('runSuite stamps suiteName, scenarioName and description on every result', async () => {
    const results = await new TestRunner(new StubAdapter({ ok: true })).runSuite(suite);

    expect(results.map((r) => [r.suiteName, r.scenarioId, r.scenarioName, r.description])).toEqual([
      ['Accounts smoke', 'acct-create', 'An account can be created', 'Fails when the data API refuses a plain insert.'],
      ['Accounts smoke', 'acct-read', 'An account reads back', undefined],
    ]);
    expect(results.every((r) => r.passed)).toBe(true);
  });

  it('the setup-failure envelope carries the names too', async () => {
    const [result] = await new TestRunner(new ThrowingAdapter()).runSuite({
      name: 'Setup suite',
      scenarios: [{ id: 'with-setup', name: 'Setup that cannot run', setup: [step], steps: [step] }],
    });

    expect(result.passed).toBe(false);
    expect(String(result.error)).toContain('Setup failed');
    expect(result.suiteName).toBe('Setup suite');
    expect(result.scenarioName).toBe('Setup that cannot run');
  });

  it('runScenario on a lone scenario names the scenario and no suite', async () => {
    const result = await new TestRunner(new StubAdapter({ ok: true })).runScenario(suite.scenarios[1]);

    expect(result.scenarioName).toBe('An account reads back');
    expect(result.suiteName).toBeUndefined();
  });
});

// `TestScenario.requires` is ENFORCED (ADR-0049; the `qa-runner` family's fifth
// key, ruled B). Before any step runs — setup included — `params` is judged
// against the runner's environment and `services` against the target's
// discovery `services`; an unmet entry makes the scenario SKIPPED with a reason,
// its own verdict, never passed. These pin the runner half; `os test`'s printing
// and exit posture are pinned in packages/cli/test/qa-requires-skip-run.test.ts.
describe('TestRunner — `requires` is judged before the first step', () => {
  const step: QA.TestStep = { name: 'step-1', action: { type: 'api_call', target: '/api/v1/health' } };

  /** A discovery `services` map as both producers answer it (ADR-0076 D12). */
  const SERVICES = {
    data: { enabled: true, status: 'available', route: '/api/v1/data' },
    auth: { enabled: true, status: 'available', route: '/api/v1/auth' },
    ai: { enabled: false, status: 'unavailable', message: 'no implementation ships' },
    metadata: { enabled: true, status: 'degraded', route: '/api/v1/meta' },
  };

  /** Records every action it runs, and answers `readTargetServices` from a canned reading. */
  class TargetAdapter implements TestExecutionAdapter {
    executed: string[] = [];
    serviceReads = 0;
    constructor(private reading: TargetServices | (() => TargetServices)) {}
    async execute(action: QA.TestAction): Promise<unknown> {
      this.executed.push(action.target);
      return { ok: true };
    }
    async readTargetServices(): Promise<TargetServices> {
      this.serviceReads += 1;
      return typeof this.reading === 'function' ? this.reading() : this.reading;
    }
  }

  const served = () => new TargetAdapter({ services: SERVICES, source: 'GET /api/v1/discovery advertised services' });

  const scenario = (requires: QA.TestScenario['requires']): QA.TestScenario => ({
    id: 'needs-things',
    name: 'Needs things',
    setup: [{ name: 'setup-1', action: { type: 'api_call', target: '/setup' } }],
    steps: [step],
    requires,
  });

  it('an unmet `services` entry skips — no step runs, setup included — and lists the declared services', async () => {
    const adapter = served();
    const result = await new TestRunner(adapter, { env: {} }).runScenario(scenario({ services: ['ai'] }));

    expect(result.status).toBe('skipped');
    expect(result.passed).toBe(false);
    expect(result.steps).toEqual([]);
    expect(adapter.executed).toEqual([]);
    expect(result.skipped!.unmet).toEqual([
      { key: 'services', name: 'ai', detail: expect.stringContaining('not available on the target') },
    ]);
    // `metadata` is declared but degraded, `ai` disabled: only the two that are
    // enabled AND available are what the target "declares available".
    expect(result.skipped!.availableServices).toEqual(['auth', 'data']);
    expect(result.skipped!.reason).toContain("'ai'");
    expect(result.skipped!.reason).toContain('auth, data');
  });

  it('a met `services` entry runs — CONTROL', async () => {
    const adapter = served();
    const result = await new TestRunner(adapter, { env: {} }).runScenario(scenario({ services: ['data', 'auth'] }));

    expect(result.status).toBe('passed');
    expect(result.passed).toBe(true);
    expect(result.skipped).toBeUndefined();
    expect(adapter.executed).toEqual(['/setup', '/api/v1/health']);
  });

  it('`enabled` alone is not enough: a degraded service is unmet, and so is one the target does not declare', async () => {
    const result = await new TestRunner(served(), { env: {} }).runScenario(scenario({ services: ['metadata', 'search'] }));

    expect(result.status).toBe('skipped');
    expect(result.skipped!.unmet.map((u) => [u.name, u.detail])).toEqual([
      ['metadata', expect.stringContaining('status: degraded')],
      ['search', 'not declared by the target'],
    ]);
  });

  it('an unmet `params` entry skips naming the variable; set and non-empty, it runs', async () => {
    const needsToken = scenario({ params: ['OS_QA_TOKEN'] });

    const unset = await new TestRunner(served(), { env: {} }).runScenario(needsToken);
    expect(unset.status).toBe('skipped');
    expect(unset.skipped!.unmet).toEqual([
      { key: 'params', name: 'OS_QA_TOKEN', detail: expect.stringContaining('not set') },
    ]);
    expect(unset.skipped!.reason).toContain("requires.params 'OS_QA_TOKEN'");
    // No service was required, so no service list is attached.
    expect(unset.skipped!.availableServices).toBeUndefined();

    // An unconfigured CI secret arrives as an empty string: unmet too.
    const empty = await new TestRunner(served(), { env: { OS_QA_TOKEN: '' } }).runScenario(needsToken);
    expect(empty.status).toBe('skipped');
    expect(empty.skipped!.unmet[0]!.detail).toContain('empty');

    const adapter = served();
    const set = await new TestRunner(adapter, { env: { OS_QA_TOKEN: 'tok' } }).runScenario(needsToken);
    expect(set.status).toBe('passed');
    expect(adapter.executed).toEqual(['/setup', '/api/v1/health']);
  });

  it('every unmet entry is reported, params before services', async () => {
    const result = await new TestRunner(served(), { env: {} }).runScenario(
      scenario({ params: ['A', 'B'], services: ['data', 'ai'] }),
    );
    expect(result.skipped!.unmet.map((u) => `${u.key}:${u.name}`)).toEqual(['params:A', 'params:B', 'services:ai']);
  });

  it('asks the target only when a service is required', async () => {
    const adapter = served();
    await new TestRunner(adapter, { env: { X: '1' } }).runScenario(scenario({ params: ['X'] }));
    await new TestRunner(adapter, { env: {} }).runScenario(scenario(undefined));
    expect(adapter.serviceReads).toBe(0);
  });

  it('a target whose services cannot be read declares none: the requirement is unmet and says why', async () => {
    const adapter = new TargetAdapter({ source: 'GET http://x/api/v1/discovery answered 404' });
    const result = await new TestRunner(adapter, { env: {} }).runScenario(scenario({ services: ['data'] }));

    expect(result.status).toBe('skipped');
    expect(result.skipped!.unmet[0]!.detail).toContain('answered 404');
    expect(result.skipped!.availableServices).toEqual([]);
    expect(adapter.executed).toEqual([]);
  });

  it('an adapter that cannot report its target skips a service requirement rather than running it', async () => {
    const result = await new TestRunner(new StubAdapter({ ok: true }), { env: {} }).runScenario(
      scenario({ services: ['data'] }),
    );
    expect(result.status).toBe('skipped');
    expect(result.skipped!.unmet[0]!.detail).toContain('does not report');
  });

  it('runSuite stamps the suite name on a skipped result too, and the verdicts stay distinct', async () => {
    const results = await new TestRunner(served(), { env: {} }).runSuite({
      name: 'Mixed',
      scenarios: [
        { id: 'runs', name: 'Runs', steps: [step] },
        { id: 'skips', name: 'Skips', steps: [step], requires: { services: ['ai'] } },
      ],
    });
    expect(results.map((r) => [r.suiteName, r.scenarioId, r.status, r.passed])).toEqual([
      ['Mixed', 'runs', 'passed', true],
      ['Mixed', 'skips', 'skipped', false],
    ]);
  });

  it('a failed scenario says `failed` — skipped is not a kind of failure', async () => {
    class ThrowingTarget extends TargetAdapter {
      override async execute(): Promise<unknown> {
        throw new Error('boom');
      }
    }
    const result = await new TestRunner(
      new ThrowingTarget({ services: SERVICES, source: 'x' }),
      { env: {} },
    ).runScenario({ id: 'f', name: 'F', steps: [step], requires: { services: ['data'] } });
    expect(result.status).toBe('failed');
    expect(result.skipped).toBeUndefined();
  });
});
