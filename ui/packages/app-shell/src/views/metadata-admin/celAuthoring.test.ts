// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect, afterEach } from 'vitest';
import {
  lintCelPredicate,
  introspectCelScope,
  testRunCelPredicate,
  inferCelValueType,
  __setCelFormulaLoader,
  type CelLintIssue,
} from './celAuthoring';
import { tFormat } from './i18n';
import { isSupportedRlsExpression } from '@objectstack/formula';
import { validateRlsPredicateEnforceability } from '@objectstack/lint';

const HINT = { objectName: 'account', fields: ['organization_id', 'owner_id', 'status', 'amount'] };

/**
 * What a finding reads in English: the producer's message as written, or the
 * en row of an advisory the lint words itself (objectui#10862).
 */
const en = (i: CelLintIssue): string => (i.messageKey ? tFormat(i.messageKey, 'en-US', i.messageVars) : i.message);

afterEach(() => __setCelFormulaLoader(undefined));

/**
 * These run against the REAL `@objectstack/formula` engine (the same parser the
 * server uses) — the whole point of the bridge is that the GUI and the server
 * reach the identical verdict, so mocking the engine would test nothing.
 */
describe('celAuthoring · lintCelPredicate (real engine)', () => {
  it('is clean for a valid bare-field predicate', async () => {
    expect(await lintCelPredicate('organization_id == current_user.organization_id', HINT)).toEqual([]);
  });

  it('reports a parse error (blocking) for malformed CEL', async () => {
    const issues = await lintCelPredicate('organization_id ==', HINT);
    expect(issues.some((i) => i.severity === 'error')).toBe(true);
  });

  it('flags the single-brace map-literal footgun as an error', async () => {
    const issues = await lintCelPredicate('{status} == "open"', HINT);
    expect(issues.some((i) => i.severity === 'error')).toBe(true);
  });

  it('warns (non-blocking) on an unknown-field near miss', async () => {
    const issues = await lintCelPredicate('organizaton_id == 1', HINT);
    expect(issues.some((i) => i.severity === 'warning')).toBe(true);
    expect(issues.some((i) => i.severity === 'error')).toBe(false);
  });

  // objectui#13061 — an RLS clause the runtime cannot lower is the server's
  // ERROR, in the server's words. One verdict per clause, both clauses.
  for (const clause of ['using', 'check'] as const) {
    it(`rates a ${clause.toUpperCase()} clause the runtime cannot lower an error, worded by @objectstack/lint`, async () => {
      const source = 'upper(status) == "OPEN"';
      expect(isSupportedRlsExpression(source)).toBe(false);
      const [rule] = validateRlsPredicateEnforceability({ permissions: [{ rowLevelSecurity: [{ [clause]: source }] }] });
      expect(rule?.severity).toBe('error');
      expect(await lintCelPredicate(source, { ...HINT, clause })).toEqual([{ severity: 'error', message: rule.message }]);
    });
  }

  it('gives no lowerability verdict where no RLS clause is named', async () => {
    const issues = await lintCelPredicate('upper(status) == "OPEN"', HINT);
    expect(issues.some((i) => i.severity === 'error')).toBe(false);
  });

  it('is clean for empty input', async () => {
    expect(await lintCelPredicate('', HINT)).toEqual([]);
    expect(await lintCelPredicate('   ', HINT)).toEqual([]);
  });
});

describe('celAuthoring · lintCelPredicate in record scope (field conditional rules, #1582)', () => {
  const RULE_HINT = { ...HINT, scope: 'record' as const };

  it('is clean for a record.<field> predicate', async () => {
    expect(await lintCelPredicate('record.status == "open"', RULE_HINT)).toEqual([]);
  });

  it('flags a BARE field reference as an error with the record.<field> fix', async () => {
    const issues = await lintCelPredicate('status == "open"', RULE_HINT);
    expect(issues.some((i) => i.severity === 'error' && /record\.status/.test(i.message))).toBe(true);
  });

  it('flags an unknown record.<field> as an error with did-you-mean', async () => {
    const issues = await lintCelPredicate('record.statu == "open"', RULE_HINT);
    expect(issues.some((i) => i.severity === 'error' && /did you mean/i.test(i.message))).toBe(true);
  });

  it('checks previous.<field> refs against the catalog too', async () => {
    expect(await lintCelPredicate('record.status != previous.status', RULE_HINT)).toEqual([]);
    const issues = await lintCelPredicate('previous.statu == "x"', RULE_HINT);
    expect(issues.some((i) => i.severity === 'error')).toBe(true);
  });

  it('accepts the master-detail parent.* root without flagging it bare', async () => {
    expect(await lintCelPredicate('parent.status == "paid"', RULE_HINT)).toEqual([]);
  });
});

/**
 * objectui#8972 — the wrong-layer `data.*` advisory.
 *
 * The engine's own `SCOPE_ROOTS` carries `data`, so every assertion in here
 * that a finding EXISTS is an assertion about this module, not about
 * `@objectstack/formula`: measured on `@objectstack/formula@17.4.0`,
 * `validateExpression('predicate', "data.status == 'x'", { scope: 'record' })`
 * answers `{ ok: true, errors: [], warnings: [] }`.
 *
 * Three of the five pins below are LIVE CONTROLS rather than true-positive
 * pins, and they are the reason this is a WARNING and not an error. Each one
 * describes a world the advisory must NOT create, so each one stays green
 * across both legs of the ablation.
 */
describe('celAuthoring · the wrong-layer `data.*` advisory (objectui#8972)', () => {
  const RULE_HINT = { ...HINT, scope: 'record' as const };

  it('TRUE POSITIVE — a record-scope `data.*` predicate now warns, naming `record` as the fix', async () => {
    const issues = await lintCelPredicate("data.status == 'x'", RULE_HINT);
    const advisory = issues.filter((i) => /\bdata\b/.test(en(i)) && /Re-root/.test(en(i)));
    expect(advisory).toHaveLength(1);
    expect(advisory[0].severity).toBe('warning');
    expect(en(advisory[0])).toMatch(/`record`/);
  });

  it('LIVE CONTROL — the ACCEPT SET is not narrowed: the same predicate raises no error', async () => {
    // Every save gate on this tier counts `severity === 'error'` and nothing
    // else, so "zero errors" IS "still accepted". Deliberately asserts ONLY
    // that: it is green with the advisory and green without it, and reddens on
    // exactly one change — promoting the advisory to `error`. That is the
    // falsifiable form of WARN-not-REFUSE, and mixing the presence of the
    // warning into it would turn the control into a second true-positive pin.
    const issues = await lintCelPredicate("data.status == 'x'", RULE_HINT);
    expect(issues.filter((i) => i.severity === 'error')).toEqual([]);
  });

  it('LIVE CONTROL — the canonical spelling stays completely clean', async () => {
    // `rowPredicateCanon.test.ts` pins the detector returning null for this;
    // this pins that the wiring does not turn it into a finding anyway.
    expect(await lintCelPredicate("record.status == 'x'", RULE_HINT)).toEqual([]);
  });

  it('LIVE CONTROL — a FLATTENED (RLS) predicate is untouched, bare identifiers included', async () => {
    // The detector's other arm would fire on all three genuine RLS predicates
    // in this repo. The advisory is gated on `scope: 'record'` and passes
    // `row = null`, so neither arm can reach this tier.
    expect(await lintCelPredicate('organization_id == current_user.organization_id', HINT)).toEqual([]);
    expect(await lintCelPredicate("data.status == 'x'", HINT)).toEqual([]);
  });

  it('adds nothing on top of a parse error, and stands down on a non-CEL dialect', async () => {
    const broken = await lintCelPredicate('data.status ==', RULE_HINT);
    expect(broken.some((i) => i.severity === 'error')).toBe(true);
    expect(broken.some((i) => /Re-root/.test(en(i)))).toBe(false);
    // A legacy `${…}` string is not CEL; the detector stands down and so must
    // this — classifying it belongs to its own dialect's rules.
    const legacy = await lintCelPredicate('${data.status}', RULE_HINT);
    expect(legacy.some((i) => /Re-root/.test(en(i)))).toBe(false);
  });
});

describe('celAuthoring · lintCelPredicate role "value" (formula expressions, #1582 follow-up)', () => {
  const FORMULA_HINT = { ...HINT, scope: 'record' as const, role: 'value' as const };

  it('is clean for a record-namespaced value expression (non-boolean is the point)', async () => {
    expect(await lintCelPredicate('record.amount * 0.2', FORMULA_HINT)).toEqual([]);
  });

  it('flags a BARE field reference as an error with the record.<field> fix', async () => {
    const issues = await lintCelPredicate('amount * 0.2', FORMULA_HINT);
    expect(issues.some((i) => i.severity === 'error' && /record\.amount/.test(i.message))).toBe(true);
  });

  it('flags an unknown record.<field> as an error with did-you-mean', async () => {
    const issues = await lintCelPredicate('record.amout * 0.2', FORMULA_HINT);
    expect(issues.some((i) => i.severity === 'error' && /did you mean/i.test(i.message))).toBe(true);
  });

  it('reports a parse error (blocking) for malformed CEL', async () => {
    const issues = await lintCelPredicate('record.amount *', FORMULA_HINT);
    expect(issues.some((i) => i.severity === 'error')).toBe(true);
  });
});

describe('celAuthoring · inferCelValueType (real engine)', () => {
  const FIELDS = { fields: ['amount', 'name', 'start_date', 'end_date'] };

  it('proves number for literal-pinned arithmetic', async () => {
    expect(await inferCelValueType('record.amount * 0.2', FIELDS)).toBe('number');
  });

  it('proves number for a numeric stdlib return', async () => {
    expect(await inferCelValueType('daysBetween(record.start_date, record.end_date) + 1', FIELDS)).toBe('number');
  });

  it('proves text for a string-returning stdlib call', async () => {
    expect(await inferCelValueType('upper(record.name)', FIELDS)).toBe('text');
  });

  it('proves boolean for a comparison', async () => {
    expect(await inferCelValueType('record.amount > 100', FIELDS)).toBe('boolean');
  });

  it('is unknown for dyn-over-dyn arithmetic (could be concatenation)', async () => {
    expect(await inferCelValueType('record.amount + record.name', FIELDS)).toBe('unknown');
  });

  it('is null (no affordance) for empty input', async () => {
    expect(await inferCelValueType('', FIELDS)).toBeNull();
    expect(await inferCelValueType('   ', FIELDS)).toBeNull();
  });
});

describe('celAuthoring · introspectCelScope (real engine)', () => {
  it('returns the object fields, scope roots, and stdlib functions', async () => {
    const scope = await introspectCelScope(HINT);
    expect(scope.fields).toContain('organization_id');
    expect(scope.roots).toContain('current_user');
    expect(scope.roots).toContain('record');
    expect(scope.functions).toContain('has');
  });

  it('honors a roots override (field rules bind record/previous/parent only)', async () => {
    const scope = await introspectCelScope({ ...HINT, scope: 'record', roots: ['record', 'previous', 'parent'] });
    expect(scope.roots).toEqual(['record', 'previous', 'parent']);
    expect(scope.functions).toContain('has');
  });
});

describe('celAuthoring · testRunCelPredicate (real engine)', () => {
  const sample = {
    record: { organization_id: 'org-1', status: 'open', amount: 500 },
    currentUser: { id: 'u1', organization_id: 'org-1', positions: ['sales'] },
  };

  it('ALLOWS when a bare-field predicate is satisfied', async () => {
    expect(await testRunCelPredicate('organization_id == current_user.organization_id', sample)).toEqual({
      status: 'allow',
    });
  });

  it('DENIES when the predicate is not satisfied', async () => {
    const out = await testRunCelPredicate('organization_id == current_user.organization_id', {
      ...sample,
      record: { ...sample.record, organization_id: 'org-X' },
    });
    expect(out).toEqual({ status: 'deny' });
  });

  it('supports the record.* namespaced form and membership', async () => {
    expect(await testRunCelPredicate('record.status == "open"', sample)).toEqual({ status: 'allow' });
    expect(await testRunCelPredicate('"sales" in current_user.positions', sample)).toEqual({ status: 'allow' });
  });

  it('reports a runtime error for a missing key (self-correcting message)', async () => {
    const out = await testRunCelPredicate('current_user.nope == 1', sample);
    expect(out.status).toBe('error');
    if (out.status === 'error') expect(out.message).toMatch(/nope/);
  });

  it('flags a non-boolean result as a "value" outcome', async () => {
    const out = await testRunCelPredicate('amount', sample);
    expect(out.status).toBe('value');
    if (out.status === 'value') expect(out.value).toBe(500);
  });
});

describe('celAuthoring · graceful degradation', () => {
  it('lint returns [] when the engine is unavailable', async () => {
    __setCelFormulaLoader(() => Promise.resolve(null));
    expect(await lintCelPredicate('organization_id ==', HINT)).toEqual([]);
  });

  it('introspect falls back to metadata fields when the engine is unavailable', async () => {
    __setCelFormulaLoader(() => Promise.resolve(null));
    const scope = await introspectCelScope(HINT);
    expect(scope.fields).toEqual(HINT.fields);
    expect(scope.roots).toEqual([]);
  });

  it('test-run reports "unavailable" when the engine cannot load', async () => {
    __setCelFormulaLoader(() => Promise.resolve(null));
    expect(await testRunCelPredicate('true', { record: {}, currentUser: {} })).toEqual({
      status: 'unavailable',
    });
  });

  it('type inference reports null (no affordance) when the engine is unavailable', async () => {
    __setCelFormulaLoader(() => Promise.resolve(null));
    expect(await inferCelValueType('record.amount * 0.2', { fields: ['amount'] })).toBeNull();
  });

  it('swallows a loader that throws', async () => {
    __setCelFormulaLoader(() => {
      throw new Error('boom');
    });
    expect(await lintCelPredicate('x == 1', HINT)).toEqual([]);
    expect(await testRunCelPredicate('true', { record: {}, currentUser: {} })).toEqual({
      status: 'unavailable',
    });
    expect(await inferCelValueType('1 + 1')).toBeNull();
  });
});
