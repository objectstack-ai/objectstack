// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#20158] The rule's contract with the ENGINE JUDGE it is handed — what it
 * asks, when it asks, and how it reports the answer.
 *
 * The judge here is a recording double, on purpose: this package may not load
 * the engine (it is spec-only by contract), and what these cases pin is the
 * rule's side of the seam — the object, the lowered filter, the verb and the
 * context it hands over, and the finding it builds from a refusal. The
 * engine's own verdicts over the fifteen read-scope classes, through BOTH
 * doors, are pinned in `packages/cli/test/rls-policy-authoring-admission.test.ts`,
 * which holds a real engine.
 */

import { describe, expect, it } from 'vitest';
import type { EngineFilterJudgement, EngineFilterJudgementOptions } from '@objectstack/spec/contracts';

import {
  validateRlsPredicateEnforceability as validateRlsPredicateEnforceabilityUnrecorded,
  RLS_PREDICATE_UNENFORCEABLE,
} from './validate-rls-predicate-enforceability.js';
import { AUTHORING_RULES, runAuthoringRules } from './authoring-rules.js';
import { runRuntimeAuthoringRules, runtimeAuthoringRulesFor } from './runtime-gate.js';
import { explainRule } from './rule-explanations.js';

// [#22161] Each finding is one verdict sentence; the reasoning it used to
// carry is the id's `os explain` entry. Every call below records what it
// fired, and the last case in this file holds each recorded verdict to one
// line of at most 200 characters. Run the whole file: that case reads what the
// cases above fired.
const fired: Array<{ rule: string; message: string }> = [];
const validateRlsPredicateEnforceability: typeof validateRlsPredicateEnforceabilityUnrecorded = (...args) => {
  const findings = validateRlsPredicateEnforceabilityUnrecorded(...args);
  fired.push(...findings);
  return findings;
};

interface JudgeCall {
  object: string;
  where: unknown;
  options: EngineFilterJudgementOptions | undefined;
}

/** A judge that records every question and answers with `verdict`. */
function recordingJudge(verdict: EngineFilterJudgement = { ok: true }) {
  const calls: JudgeCall[] = [];
  const judgeFilter = (object: string, where: unknown, options?: EngineFilterJudgementOptions) => {
    calls.push({ object, where, options });
    return verdict;
  };
  return { calls, judgeFilter };
}

const REFUSAL: EngineFilterJudgement = {
  ok: false,
  code: 'INVALID_FILTER',
  status: 400,
  message: "find('deal'): filter on 'amount' aims the text operator $startsWith at a declared number field.",
};

const deal = {
  name: 'deal',
  label: 'Deal',
  fields: {
    owner: { type: 'text', label: 'Owner' },
    amount: { type: 'number', label: 'Amount' },
    close_date: { type: 'date', label: 'Close date' },
  },
};

/** One permission set, one policy on `deal`, with the clause and operation swapped in. */
const stackWith = (policy: Record<string, unknown>) => ({
  objects: [deal],
  permissions: [
    {
      name: 'sales',
      label: 'Sales',
      rowLevelSecurity: [{ name: 'p', object: 'deal', operation: 'select', ...policy }],
    },
  ],
});

describe('validateRlsPredicateEnforceability — the engine judge is an INPUT (#20158)', () => {
  it('without a judge, a clause only the engine refuses stays clean — the rule answers as it did before', () => {
    expect(validateRlsPredicateEnforceability(stackWith({ using: "amount.startsWith('5')" }))).toEqual([]);
  });

  it('asks the judge about the lowered read scope: the policy object, the lowered filter, `find`, no context', () => {
    const { calls, judgeFilter } = recordingJudge();
    validateRlsPredicateEnforceability(stackWith({ using: "amount.startsWith('5')" }), { judgeFilter });
    expect(calls).toEqual([
      { object: 'deal', where: { amount: { $startsWith: '5' } }, options: { operation: 'find' } },
    ]);
  });

  it('turns a refusal into ONE rls-predicate-unenforceable finding that quotes the engine\'s verdict', () => {
    const { judgeFilter } = recordingJudge(REFUSAL);
    const findings = validateRlsPredicateEnforceability(stackWith({ using: "amount.startsWith('5')" }), {
      judgeFilter,
    });
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({
      severity: 'error',
      rule: RLS_PREDICATE_UNENFORCEABLE,
      path: 'permissions[0].rowLevelSecurity[0].using',
      where: 'permission set "sales" policy "p" on object "deal"',
    });
    const refusal = REFUSAL as Extract<EngineFilterJudgement, { ok: false }>;
    expect(findings[0].message).toBe(`RLS using (${refusal.code} / ${refusal.status}): ${refusal.message}`);
  });

  it('[#22161] quotes the verdict half of the engine\'s leading sentence, never its reasoning or remedy', () => {
    const { judgeFilter } = recordingJudge({
      ok: false,
      code: 'INVALID_FIELD',
      status: 400,
      message:
        "find('deal') filters on 'amount', a virtual field — no driver materialises it. The predicate was not applied. " +
        "Denormalise the value onto 'deal'.",
    });
    const [finding] = validateRlsPredicateEnforceability(stackWith({ using: "amount.startsWith('5')" }), { judgeFilter });
    expect(finding.message).toBe("RLS using (INVALID_FIELD / 400): find('deal') filters on 'amount', a virtual field");
    // What the refusal costs is the `os explain` entry's.
    expect(explainRule(RLS_PREDICATE_UNENFORCEABLE)?.paragraphs.join('\n')).toContain(
      'every analytics query over the object that this policy scopes is refused',
    );
  });

  it('prescribes by the engine CODE: a placeholder is sent to `current_user`, a field to denormalisation', () => {
    const hintFor = (code: string) => {
      const { judgeFilter } = recordingJudge({ ok: false, code, status: 400, message: 'refused.' });
      return validateRlsPredicateEnforceability(stackWith({ using: 'owner == current_user.id' }), { judgeFilter })[0]
        .hint;
    };
    expect(hintFor('FILTER_TOKEN_UNKNOWN')).toMatch(/Write `owner == current_user\.id`/);
    expect(hintFor('FILTER_TOKEN_UNRESOLVED')).toMatch(/Write `owner == current_user\.id`/);
    expect(hintFor('INVALID_FIELD')).toMatch(/Denormalise the value/);
    expect(hintFor('INVALID_FILTER')).toMatch(/a text operator .* only on a field that holds a string/);
  });

  it('judges ONLY the read scope: `using` on a `select` / `all` policy — never a `check`, never another operation', () => {
    const judged = (policy: Record<string, unknown>) => {
      const { calls, judgeFilter } = recordingJudge();
      validateRlsPredicateEnforceability(stackWith(policy), { judgeFilter });
      return calls.length;
    };
    expect(judged({ operation: 'select', using: 'owner == current_user.id' })).toBe(1);
    expect(judged({ operation: 'all', using: 'owner == current_user.id' })).toBe(1);
    expect(judged({ operation: 'insert', using: 'owner == current_user.id' })).toBe(0);
    expect(judged({ operation: 'update', using: 'owner == current_user.id' })).toBe(0);
    expect(judged({ operation: 'delete', using: 'owner == current_user.id' })).toBe(0);
    // The `using` beside a `check` is judged; the `check` never is.
    expect(judged({ operation: 'all', using: 'owner == current_user.id', check: 'owner == current_user.id' })).toBe(1);
  });

  it('one defect, one finding: a clause another pass already refused is not handed to the judge', () => {
    const { calls, judgeFilter } = recordingJudge(REFUSAL);
    const findings = validateRlsPredicateEnforceability(stackWith({ using: 'no_such_field == current_user.id' }), {
      judgeFilter,
    });
    expect(calls).toEqual([]);
    expect(findings.map((f) => f.rule)).toEqual(['rls-predicate-unknown-field']);
  });

  it('binds an app-staged membership key to [] for the judge, and keeps a kernel key\'s runtime-typed probe', () => {
    // The measured artefact: with the probe STRING standing in for an app's
    // set, `close_date in current_user.holidays` reaches the temporal door as
    // `$in: ['__objectstack_lint_probe__']` and is refused — about the probe,
    // not about the policy. The set's members are app data, so the judge sees
    // an empty set instead.
    const app = recordingJudge();
    validateRlsPredicateEnforceability(stackWith({ using: 'close_date in current_user.holidays' }), {
      judgeFilter: app.judgeFilter,
    });
    expect(app.calls.map((c) => c.where)).toEqual([{ close_date: { $in: [] } }]);

    // A kernel key holds what `ExecutionContext` declares on every request, so
    // its probe is a faithful stand-in and is left alone.
    const kernel = recordingJudge();
    validateRlsPredicateEnforceability(stackWith({ using: 'owner in current_user.org_user_ids' }), {
      judgeFilter: kernel.judgeFilter,
    });
    expect(kernel.calls.map((c) => c.where)).toEqual([{ owner: { $in: ['__objectstack_lint_probe__'] } }]);
  });
});

describe('the judge reaches the rule through BOTH run signatures (#20158)', () => {
  it('`runAuthoringRules` hands `judgeFilter` to the rule on every CLI command', () => {
    for (const command of ['validate', 'build', 'lint'] as const) {
      const { judgeFilter } = recordingJudge(REFUSAL);
      const stack = stackWith({ using: "amount.startsWith('5')" });
      const findings = runAuthoringRules(command, { normalized: stack, parsed: stack, judgeFilter });
      expect(
        findings.filter((f) => f.rule === RLS_PREDICATE_UNENFORCEABLE).map((f) => f.path),
        `os ${command}`,
      ).toEqual(['permissions[0].rowLevelSecurity[0].using']);
    }
  });

  it('the rule now runs at the runtime publish gate for `permission` writes', () => {
    const entry = AUTHORING_RULES.find((r) => r.name === 'validateRlsPredicateEnforceability');
    expect(entry?.surfaces).toEqual(['cli', 'runtime-publish']);
    expect(entry?.runtimeTypes).toEqual(['permission']);
    expect(runtimeAuthoringRulesFor('permission').map((r) => r.name)).toContain('validateRlsPredicateEnforceability');
  });

  it('`runRuntimeAuthoringRules` hands `judgeFilter` to the rule, and attributes only what the WRITE adds', () => {
    const { calls, judgeFilter } = recordingJudge(REFUSAL);
    const written = stackWith({ using: "amount.startsWith('5')" }).permissions[0];
    const result = runRuntimeAuthoringRules({
      type: 'permission',
      item: written,
      context: { objects: [deal], permissions: [] },
      judgeFilter,
    });
    expect(result.rulesRun).toContain('validateRlsPredicateEnforceability');
    expect(result.errors.filter((f) => f.rule === RLS_PREDICATE_UNENFORCEABLE).map((f) => f.path)).toEqual([
      'permissions.sales.rowLevelSecurity[0].using',
    ]);
    // Asked once for the candidate pass; the baseline carries no policy.
    expect(calls).toHaveLength(1);

    // A SIBLING set's refused policy is somebody else's pre-existing condition
    // (#4463 D4): it is judged in both passes and cancels in the differential.
    const sibling = { ...stackWith({ using: "amount.startsWith('6')" }).permissions[0], name: 'other' };
    const clean = runRuntimeAuthoringRules({
      type: 'permission',
      item: stackWith({ using: 'owner == current_user.id' }).permissions[0],
      context: { objects: [deal], permissions: [sibling] },
      judgeFilter: (object, where, options) =>
        JSON.stringify(where).includes('$startsWith') ? REFUSAL : recordingJudge().judgeFilter(object, where, options),
    });
    expect(clean.errors.filter((f) => f.rule === RLS_PREDICATE_UNENFORCEABLE)).toEqual([]);
  });

  it('without `judgeFilter` the runtime gate still runs the rule, and a judge-only class passes it', () => {
    const result = runRuntimeAuthoringRules({
      type: 'permission',
      item: stackWith({ using: "amount.startsWith('5')" }).permissions[0],
      context: { objects: [deal], permissions: [] },
    });
    expect(result.rulesRun).toContain('validateRlsPredicateEnforceability');
    expect(result.errors.filter((f) => f.rule.startsWith('rls-predicate-'))).toEqual([]);
  });
});

describe('[#22161] one-line verdicts', () => {
  it('every verdict the cases above fired is one line of at most 200 characters', () => {
    // The coverage control first: the cases above fired the engine verdict, so
    // the shape assertion cannot pass over an empty record.
    expect(fired.some((f) => f.message.startsWith('RLS using (INVALID_FILTER / 400): '))).toBe(true);
    for (const f of fired) {
      expect(f.message, f.rule).not.toContain('\n');
      expect(f.message.length, `${f.rule}: ${f.message}`).toBeLessThanOrEqual(200);
    }
  });
});
