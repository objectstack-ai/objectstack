import { describe, it, expect } from 'vitest';
import {
  TestContextSchema,
  TestActionTypeSchema,
  TestActionSchema,
  TestAssertionTypeSchema,
  TestAssertionSchema,
  TestStepSchema,
  TestScenarioSchema,
  TestSuiteSchema,
  type TestScenario,
} from './testing.zod';
import { CORE_SERVICE_PROVIDER } from '../system/core-services.zod';

describe('TestContextSchema', () => {
  it('should accept a valid context record', () => {
    expect(() => TestContextSchema.parse({ userId: '123', debug: true })).not.toThrow();
  });

  it('should accept an empty record', () => {
    expect(() => TestContextSchema.parse({})).not.toThrow();
  });

  it('should reject non-object values', () => {
    expect(() => TestContextSchema.parse('invalid')).toThrow();
  });
});

describe('TestActionTypeSchema', () => {
  it('should accept all valid action types', () => {
    const types = ['create_record', 'update_record', 'delete_record', 'read_record', 'query_records', 'api_call', 'run_script', 'wait'];
    types.forEach(t => {
      expect(() => TestActionTypeSchema.parse(t)).not.toThrow();
    });
  });

  it('should reject invalid action type', () => {
    expect(() => TestActionTypeSchema.parse('invalid_type')).toThrow();
  });
});

describe('TestActionSchema', () => {
  it('should accept minimal valid action', () => {
    const action = { type: 'create_record', target: 'account' };
    const result = TestActionSchema.parse(action);
    expect(result.type).toBe('create_record');
    expect(result.target).toBe('account');
    expect(result.payload).toBeUndefined();
    expect(result.user).toBeUndefined();
  });

  it('should accept full action with all optional fields', () => {
    const action = {
      type: 'api_call',
      target: '/api/v1/accounts',
      payload: { name: 'Test Account' },
      user: 'admin',
    };
    expect(() => TestActionSchema.parse(action)).not.toThrow();
  });

  it('should reject action without target', () => {
    expect(() => TestActionSchema.parse({ type: 'create_record' })).toThrow();
  });

  it('should reject action with invalid type', () => {
    expect(() => TestActionSchema.parse({ type: 'bad_type', target: 'x' })).toThrow();
  });
});

describe('TestAssertionTypeSchema', () => {
  it('should accept all valid assertion types', () => {
    const types = ['equals', 'not_equals', 'contains', 'not_contains', 'is_null', 'not_null', 'gt', 'gte', 'lt', 'lte', 'error'];
    types.forEach(t => {
      expect(() => TestAssertionTypeSchema.parse(t)).not.toThrow();
    });
  });

  it('should reject invalid assertion type', () => {
    expect(() => TestAssertionTypeSchema.parse('unknown')).toThrow();
  });
});

describe('TestAssertionSchema', () => {
  it('should accept a valid assertion', () => {
    const assertion = { field: 'body.status', operator: 'equals', expectedValue: 'active' };
    const result = TestAssertionSchema.parse(assertion);
    expect(result.field).toBe('body.status');
    expect(result.operator).toBe('equals');
    expect(result.expectedValue).toBe('active');
  });

  it('should reject assertion without field', () => {
    expect(() => TestAssertionSchema.parse({ operator: 'equals', expectedValue: 1 })).toThrow();
  });

  it('should reject assertion with invalid operator', () => {
    expect(() => TestAssertionSchema.parse({ field: 'x', operator: 'invalid', expectedValue: 1 })).toThrow();
  });
});

describe('TestStepSchema', () => {
  const minimalStep = {
    name: 'Create account',
    action: { type: 'create_record', target: 'account' },
  };

  it('should accept minimal step', () => {
    const result = TestStepSchema.parse(minimalStep);
    expect(result.name).toBe('Create account');
    expect(result.description).toBeUndefined();
    expect(result.assertions).toBeUndefined();
    expect(result.capture).toBeUndefined();
  });

  it('should accept step with all optional fields', () => {
    const step = {
      ...minimalStep,
      description: 'Creates a new account record',
      assertions: [{ field: 'body.id', operator: 'not_null', expectedValue: null }],
      capture: { newId: 'body.id' },
    };
    expect(() => TestStepSchema.parse(step)).not.toThrow();
  });

  it('should reject step without name', () => {
    expect(() => TestStepSchema.parse({ action: { type: 'read_record', target: 'x' } })).toThrow();
  });

  it('should reject step without action', () => {
    expect(() => TestStepSchema.parse({ name: 'step1' })).toThrow();
  });
});

describe('TestScenarioSchema', () => {
  const minimalScenario = {
    id: 'sc-001',
    name: 'Account CRUD Test',
    steps: [{ name: 'step1', action: { type: 'create_record', target: 'account' } }],
  };

  it('should accept minimal scenario', () => {
    const result = TestScenarioSchema.parse(minimalScenario);
    expect(result.id).toBe('sc-001');
    expect(result.name).toBe('Account CRUD Test');
    expect(result.steps).toHaveLength(1);
    expect(result.description).toBeUndefined();
    expect(result.tags).toBeUndefined();
    expect(result.setup).toBeUndefined();
    expect(result.teardown).toBeUndefined();
    expect(result.requires).toBeUndefined();
  });

  it('should accept full scenario with all optional fields', () => {
    const scenario = {
      ...minimalScenario,
      description: 'Tests full CRUD lifecycle',
      tags: ['critical', 'regression'],
      setup: [{ name: 'setup-data', action: { type: 'run_script', target: 'seed' } }],
      teardown: [{ name: 'cleanup', action: { type: 'delete_record', target: 'account' } }],
      requires: {
        params: ['API_KEY'],
        services: ['data', 'auth'],
      },
    };
    expect(() => TestScenarioSchema.parse(scenario)).not.toThrow();
  });

  it('should reject scenario without steps', () => {
    expect(() => TestScenarioSchema.parse({ id: 'sc-001', name: 'Test' })).toThrow();
  });

  it('should reject scenario without id', () => {
    expect(() => TestScenarioSchema.parse({ name: 'Test', steps: [] })).toThrow();
  });
});

describe('TestSuiteSchema', () => {
  it('should accept a valid test suite', () => {
    const suite = {
      name: 'CRM Test Suite',
      scenarios: [{
        id: 'sc-001',
        name: 'Account Test',
        steps: [{ name: 'step1', action: { type: 'read_record', target: 'account' } }],
      }],
    };
    const result = TestSuiteSchema.parse(suite);
    expect(result.name).toBe('CRM Test Suite');
    expect(result.scenarios).toHaveLength(1);
  });

  it('should accept suite with empty scenarios', () => {
    expect(() => TestSuiteSchema.parse({ name: 'Empty Suite', scenarios: [] })).not.toThrow();
  });

  it('should reject suite without name', () => {
    expect(() => TestSuiteSchema.parse({ scenarios: [] })).toThrow();
  });

  it('should reject suite without scenarios', () => {
    expect(() => TestSuiteSchema.parse({ name: 'Suite' })).toThrow();
  });
});

/**
 * `requires` is ENFORCED (ADR-0049; the `qa-runner` family's `requires` key,
 * ruled B): core's TestRunner judges it before a scenario's first step, and an
 * unmet entry makes the scenario SKIPPED with its reason. The runner half is
 * pinned in `packages/core/src/qa/runner.test.ts`; this half pins the contract
 * an author writes against — `services` is the target's own vocabulary, closed
 * at parse, and `plugins` is a tombstone that carries its prescription.
 *
 * On the assertion set: a schema refusal raises a `ZodError` whose issues carry
 * `code` and `path` but no ADR-0112 `status` — that envelope belongs to the API
 * error surface. So these pins assert refusal, the issue `code`, the `path`
 * naming the key, and the prescription.
 */
describe('TestScenarioSchema.requires', () => {
  const scenario = (requires: unknown) => ({
    id: 'sc-req',
    name: 'Requires',
    steps: [{ name: 'step1', action: { type: 'api_call', target: '/api/v1/health' } }],
    requires,
  });

  it('accepts `params` and `services` — the two judged keys — and keeps them', () => {
    const r = TestScenarioSchema.safeParse(scenario({ params: ['OS_QA_TOKEN'], services: ['ai', 'analytics'] }));
    expect(r.success).toBe(true);
    if (!r.success) return;
    expect(r.data.requires).toEqual({ params: ['OS_QA_TOKEN'], services: ['ai', 'analytics'] });
  });

  it('closes `services` over the discovery service keys: a misspelling is refused at parse, located', () => {
    const r = TestScenarioSchema.safeParse(scenario({ services: ['analytic'] }));
    expect(r.success).toBe(false);
    if (r.success) return;
    const issue = r.error.issues.find((i) => i.path.join('.') === 'requires.services.0');
    expect(issue, 'the refusal must locate `requires.services.0`').toBeDefined();
    expect(issue!.code).toBe('invalid_value');
  });

  // Unanchored, because a thrown `ZodError`'s message is the JSON of its issues;
  // the key-first house convention is asserted on the issue message itself.
  const PLUGINS_PRESCRIPTION =
    /`scenarios\[\]\.requires\.plugins` was removed in @objectstack\/spec 17\.5\.0 \(ADR-0049 enforce-or-remove\).*nothing ever checked it.*Delete the key and name the service the scenario needs in `requires\.services`.*Plugin → service: .*@objectstack\/plugin-auth → auth/s;

  for (const plugins of [['crm'], ['@objectstack/plugin-auth'], []]) {
    it(`refuses \`requires.plugins: ${JSON.stringify(plugins)}\` at its path, with the prescription`, () => {
      const r = TestScenarioSchema.safeParse(scenario({ plugins }));
      expect(r.success).toBe(false);
      if (r.success) return;
      const issue = r.error.issues.find((i) => i.path.join('.') === 'requires.plugins');
      expect(issue, 'the refusal must locate `requires.plugins`').toBeDefined();
      expect(issue!.code).toBe('invalid_type');
      expect(issue!.message).toMatch(PLUGINS_PRESCRIPTION);
      expect(issue!.message.startsWith('`scenarios[].requires.plugins` was removed')).toBe(true);
    });
  }

  it('the suite door refuses it THROUGH `scenarios`, located at the scenario', () => {
    const r = TestSuiteSchema.safeParse({ name: 'Suite', scenarios: [scenario({ plugins: ['crm'] })] });
    expect(r.success).toBe(false);
    if (r.success) return;
    const issue = r.error.issues.find((i) => i.path.join('.') === 'scenarios.0.requires.plugins');
    expect(issue, 'the refusal must locate `scenarios.0.requires.plugins`').toBeDefined();
    expect(issue!.message).toMatch(PLUGINS_PRESCRIPTION);
  });

  it('fails tsc at the authoring site: the input type is `never`', () => {
    const authored: TestScenario = {
      id: 'sc-typed',
      name: 'Typed',
      steps: [],
      // @ts-expect-error — `plugins` is a retiredKey() tombstone: its input type is `never`.
      requires: { plugins: ['crm'] },
    };
    // The parse channel agrees with the type channel on the same literal.
    expect(() => TestScenarioSchema.parse(authored)).toThrow(PLUGINS_PRESCRIPTION);
  });

  it('the prescription maps every provider package discovery names to its service', () => {
    const r = TestScenarioSchema.safeParse(scenario({ plugins: ['x'] }));
    expect(r.success).toBe(false);
    if (r.success) return;
    const message = r.error.issues.find((i) => i.path.join('.') === 'requires.plugins')!.message;
    for (const [slot, pkg] of Object.entries(CORE_SERVICE_PROVIDER)) {
      if (pkg === null || slot === 'file-storage') continue;
      expect(message, `${pkg} → ${slot} must be in the mapping`).toMatch(new RegExp(`${pkg.replace(/[/.]/g, '\\$&')} → [a-z/ -]*\\b${slot}\\b`));
    }
    // The deprecated alias is not taught to a converting author.
    expect(message).not.toContain('file-storage');
  });
});
