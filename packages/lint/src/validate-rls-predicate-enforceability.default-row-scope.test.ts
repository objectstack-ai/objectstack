// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#24452] An object's DEFAULT row scope (`ObjectSchema.defaultRowScope`) is
 * judged by the same passes as a permission set's `rowLevelSecurity[]` policy.
 *
 * The default is one policy of the permission-set entry shape without
 * `object`, the declaring object implied. The security plugin's row-policy
 * collection applies it when the caller's held sets carry no row policy for the
 * object and operation, and hands it to the same `RLSCompiler` an authored
 * policy reaches: a `using` that does not lower is dropped with the same WARN
 * and fails closed to `RLS_DENY_FILTER`. Before this file the authoring lint
 * walked `permissions[].rowLevelSecurity[]` only, so that default passed
 * `os validate` and the author learned of it when rows disappeared.
 *
 * What is pinned:
 *
 * - a default whose `using` (or `check`) does not lower is reported at
 *   authoring time, at `objects[N].defaultRowScope.<clause>`, naming the
 *   object's default and never a permission set;
 * - CONTROL: a default that lowers, and an object with no default, report
 *   nothing;
 * - parity: the same predicate on a permission-set policy and on a default
 *   earns the same rule, severity, message and hint — one judge, two sources;
 * - the engine's read-scope pass reaches a default as it reaches a policy,
 *   with the declaring object as its target;
 * - the registry door (`runAuthoringRules`) carries it, and `os explain`
 *   words the drop for both sources.
 *
 * Every object fixture passes `ObjectSchema` first, so no case here exercises
 * a shape an author cannot write.
 */

import { describe, expect, it } from 'vitest';
import type { EngineFilterJudgement, EngineFilterJudgementOptions } from '@objectstack/spec/contracts';
import { ObjectSchema } from '@objectstack/spec/data';

import {
  validateRlsPredicateEnforceability,
  RLS_PREDICATE_UNENFORCEABLE,
  RLS_PREDICATE_UNKNOWN_FIELD,
  RLS_PREDICATE_UNKNOWN_USER_VARIABLE,
  RLS_PREDICATE_UNPARSEABLE,
} from './validate-rls-predicate-enforceability.js';
import { runAuthoringRules } from './authoring-rules.js';
import { explainRule } from './rule-explanations.js';

const LEAD_FIELDS = {
  owner_id: { type: 'text', label: 'Owner' },
  status: { type: 'text', label: 'Status' },
  amount: { type: 'number', label: 'Amount' },
} as const;

/** A `lead` object, parsed by `ObjectSchema`, declaring `scope` as its default row scope. */
function leadWithScope(scope: Record<string, unknown> | undefined): Record<string, unknown> {
  const result = ObjectSchema.safeParse({
    name: 'lead',
    label: 'Lead',
    fields: LEAD_FIELDS,
    ...(scope ? { defaultRowScope: scope } : {}),
  });
  if (!result.success) {
    throw new Error(
      'object fixture is not spec-valid: ' +
        result.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`).join('; '),
    );
  }
  return result.data as unknown as Record<string, unknown>;
}

const stackWithScope = (scope: Record<string, unknown> | undefined) => ({ objects: [leadWithScope(scope)] });

const selectScope = (using: string) => ({ name: 'lead_default', operation: 'select', using });

/** `os explain` text of `rule`, one string. */
const explanationOf = (rule: string): string => explainRule(rule)?.paragraphs.join('\n') ?? '';

describe('validateRlsPredicateEnforceability — an object default row scope that cannot lower is RED (#24452)', () => {
  it('reports a `using` that does not lower, at the default, naming the object and not a permission set', () => {
    const findings = validateRlsPredicateEnforceability(stackWithScope(selectScope('size(record.tags) > 0')));
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({
      severity: 'error',
      rule: RLS_PREDICATE_UNENFORCEABLE,
      where: 'default row scope "lead_default" of object "lead"',
      path: 'objects[0].defaultRowScope.using',
    });
    expect(findings[0].message).toMatch(
      /^RLS using is not lowerable \(.+\), so the policy is dropped and grants no access$/,
    );
    // No permission set carries a default, so no part of the finding says one does.
    expect(`${findings[0].where} ${findings[0].message} ${findings[0].hint}`).not.toMatch(/permission set/i);
  });

  it('reports a `check` that does not lower, with the write-path consequence', () => {
    const findings = validateRlsPredicateEnforceability(
      stackWithScope({ name: 'lead_writes', operation: 'insert', check: 'amount + 1 > 2' }),
    );
    expect(findings.map((f) => [f.rule, f.path, f.severity])).toEqual([
      [RLS_PREDICATE_UNENFORCEABLE, 'objects[0].defaultRowScope.check', 'error'],
    ]);
    expect(findings[0].message).toMatch(/admits no write$/);
  });

  it('reads the name-keyed map shape of `objects` too', () => {
    const findings = validateRlsPredicateEnforceability({
      objects: { lead: leadWithScope(selectScope("record.account.region == 'EU'")) },
    });
    expect(findings.map((f) => [f.rule, f.path, f.where])).toEqual([
      [RLS_PREDICATE_UNENFORCEABLE, 'objects[0].defaultRowScope.using', 'default row scope "lead_default" of object "lead"'],
    ]);
  });

  it('CONTROL: a default that lowers, and an object with no default, report nothing', () => {
    expect(validateRlsPredicateEnforceability(stackWithScope(selectScope('owner_id == current_user.id')))).toEqual([]);
    expect(
      validateRlsPredicateEnforceability(
        stackWithScope({ name: 'lead_all', operation: 'all', using: "status == 'open' || owner_id = current_user.id" }),
      ),
    ).toEqual([]);
    expect(validateRlsPredicateEnforceability(stackWithScope(undefined))).toEqual([]);
  });
});

describe('validateRlsPredicateEnforceability — one judge, two sources (#24452)', () => {
  // The same predicate, on the same object, once as a permission set's policy
  // and once as the object's default. Every pass that can fire on a default
  // must answer identically; only `where` and `path` say which source it is.
  it.each([
    ['outside the pushdown subset', 'size(record.tags) > 0', RLS_PREDICATE_UNENFORCEABLE],
    ['not CEL even after the SQL bridge', 'owner_id = current_user.id AND status = 1', RLS_PREDICATE_UNPARSEABLE],
    ['a column the object does not declare', 'stauts == "open"', RLS_PREDICATE_UNKNOWN_FIELD],
    ['a `current_user` key nothing resolves', 'owner_id == current_user.nope', RLS_PREDICATE_UNKNOWN_USER_VARIABLE],
    ['a list-holding key under `==`', 'owner_id == current_user.org_user_ids', RLS_PREDICATE_UNENFORCEABLE],
  ])('%s: the default earns the verdict the permission-set policy earns', (_label, using, rule) => {
    const asPolicy = validateRlsPredicateEnforceability({
      objects: [leadWithScope(undefined)],
      permissions: [
        {
          name: 'sales_rep',
          label: 'Sales Rep',
          rowLevelSecurity: [{ name: 'lead_default', object: 'lead', operation: 'select', using }],
        },
      ],
    });
    const asDefault = validateRlsPredicateEnforceability(stackWithScope(selectScope(using)));

    expect(asPolicy.map((f) => f.rule)).toEqual([rule]);
    const verdict = ({ severity, rule: id, message, hint }: (typeof asPolicy)[number]) => ({ severity, id, message, hint });
    expect(asDefault.map(verdict)).toEqual(asPolicy.map(verdict));
    expect(asDefault.map((f) => f.path)).toEqual(['objects[0].defaultRowScope.using']);
    expect(asPolicy.map((f) => f.path)).toEqual(['permissions[0].rowLevelSecurity[0].using']);
  });

  it('judges both sources in one stack, permission sets first', () => {
    const findings = validateRlsPredicateEnforceability({
      objects: [leadWithScope(selectScope('size(record.tags) > 0'))],
      permissions: [
        {
          name: 'sales_rep',
          label: 'Sales Rep',
          rowLevelSecurity: [{ name: 'own', object: 'lead', operation: 'select', using: 'has(record.owner_id)' }],
        },
      ],
    });
    expect(findings.map((f) => f.path)).toEqual([
      'permissions[0].rowLevelSecurity[0].using',
      'objects[0].defaultRowScope.using',
    ]);
  });
});

describe('validateRlsPredicateEnforceability — the engine judges a default read scope with its object (#24452)', () => {
  const REFUSAL: EngineFilterJudgement = {
    ok: false,
    code: 'INVALID_FILTER',
    status: 400,
    message: "find('lead'): filter on 'amount' aims the text operator $startsWith at a declared number field.",
  };

  function recordingJudge(verdict: EngineFilterJudgement) {
    const calls: Array<{ object: string; options: EngineFilterJudgementOptions | undefined }> = [];
    const judgeFilter = (object: string, _where: unknown, options?: EngineFilterJudgementOptions) => {
      calls.push({ object, options });
      return verdict;
    };
    return { calls, judgeFilter };
  }

  it('hands a `select` default `using` to the judge with the declaring object, and reports its refusal there', () => {
    const { calls, judgeFilter } = recordingJudge(REFUSAL);
    const findings = validateRlsPredicateEnforceability(
      stackWithScope(selectScope("amount.startsWith('1')")),
      { judgeFilter: judgeFilter as never },
    );
    expect(calls).toEqual([{ object: 'lead', options: { operation: 'find' } }]);
    expect(findings).toEqual([
      expect.objectContaining({
        severity: 'error',
        rule: RLS_PREDICATE_UNENFORCEABLE,
        path: 'objects[0].defaultRowScope.using',
        where: 'default row scope "lead_default" of object "lead"',
        message: expect.stringMatching(/^RLS using \(INVALID_FILTER \/ 400\): /),
      }),
    ]);
  });

  it('CONTROL: a default outside the read scope is not handed to the judge', () => {
    const { calls, judgeFilter } = recordingJudge(REFUSAL);
    const findings = validateRlsPredicateEnforceability(
      stackWithScope({ name: 'lead_updates', operation: 'update', using: "amount.startsWith('1')" }),
      { judgeFilter: judgeFilter as never },
    );
    expect(calls).toEqual([]);
    expect(findings).toEqual([]);
  });
});

describe('validateRlsPredicateEnforceability — the registry door and `os explain` carry the default (#24452)', () => {
  it('`runAuthoringRules` reports the default under the rule\'s own id', () => {
    const stack = stackWithScope(selectScope('size(record.tags) > 0'));
    const rls = runAuthoringRules('validate', { normalized: stack, parsed: stack }).filter((f) =>
      f.rule.startsWith('rls-predicate-'),
    );
    expect(rls.map((f) => [f.rule, f.path, f.severity])).toEqual([
      [RLS_PREDICATE_UNENFORCEABLE, 'objects[0].defaultRowScope.using', 'error'],
    ]);
  });

  it('`os explain` words the dropped `using` for both sources', () => {
    for (const rule of [RLS_PREDICATE_UNENFORCEABLE, RLS_PREDICATE_UNKNOWN_FIELD, RLS_PREDICATE_UNKNOWN_USER_VARIABLE]) {
      const why = explanationOf(rule);
      // A permission set's policy: the holders of THAT set lose the object.
      expect(why).toMatch(/the object disappears for every holder of the permission set that carries the policy/);
      // A default: applied alone, so a drop always denies the callers it applies to, and no one else.
      expect(why).toMatch(/An object's `defaultRowScope` is applied only when the caller's permission sets carry no row policy/);
      expect(why).toMatch(/so it is always the only applicable policy/);
      expect(why).toMatch(/a caller whose permission set carries its own row policy for the object is not affected/);
    }
    expect(explanationOf(RLS_PREDICATE_UNENFORCEABLE)).toMatch(
      /a permission set's `rowLevelSecurity` entry and an object's `defaultRowScope`/,
    );
  });
});
