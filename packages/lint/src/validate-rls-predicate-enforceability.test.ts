// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect, afterEach } from 'vitest';
import { compileCelToFilter, isSupportedRlsExpression, setCelPushdownLimitsModeForTests } from '@objectstack/formula';

import { RESERVED_RLS_MEMBERSHIP_KEYS } from '@objectstack/spec/contracts';

import {
  validateRlsPredicateEnforceability as validateRlsPredicateEnforceabilityUnrecorded,
  RLS_PREDICATE_UNENFORCEABLE,
  RLS_PREDICATE_UNPARSEABLE,
  RLS_PREDICATE_OVER_BUDGET,
  RLS_PREDICATE_UNKNOWN_FIELD,
  RLS_PREDICATE_UNKNOWN_USER_VARIABLE,
} from './validate-rls-predicate-enforceability.js';
import { AUTHORING_RULES, runAuthoringRules } from './authoring-rules.js';
import { explainRule } from './rule-explanations.js';

// [#22161] Each finding of the five ids is one verdict sentence; the reasoning
// it used to carry is the id's `os explain` entry. Every call below records
// what it fired, and the last cases in this file hold each recorded verdict to
// one line of at most 200 characters — so the pin covers every firing variant
// this suite exercises, not a chosen few. Run the whole file: those cases read
// what the cases above fired.
const RLS_RULE_IDS: readonly string[] = [
  RLS_PREDICATE_UNENFORCEABLE,
  RLS_PREDICATE_UNPARSEABLE,
  RLS_PREDICATE_OVER_BUDGET,
  RLS_PREDICATE_UNKNOWN_FIELD,
  RLS_PREDICATE_UNKNOWN_USER_VARIABLE,
];
const fired: Array<{ rule: string; message: string }> = [];
const validateRlsPredicateEnforceability: typeof validateRlsPredicateEnforceabilityUnrecorded = (...args) => {
  const findings = validateRlsPredicateEnforceabilityUnrecorded(...args);
  fired.push(...findings);
  return findings;
};

/** The `os explain` text of `rule`, one string. */
const explanationOf = (rule: string): string => explainRule(rule)?.paragraphs.join('\n') ?? '';

const ids = (stack: unknown) => validateRlsPredicateEnforceability(stack).map((f) => f.rule);

/** A complete, spec-shaped permission set with one RLS policy's clause swapped in. */
const policyWith = (clause: 'using' | 'check', source: unknown) => ({
  permissions: [
    {
      name: 'sales_rep',
      label: 'Sales Rep',
      rowLevelSecurity: [
        {
          name: 'own_leads',
          object: 'lead',
          operation: 'select',
          // `using` is required on the schema, so a `check` fixture carries a
          // valid `using` alongside it — otherwise the fixture would be red for
          // a reason the test is not about.
          ...(clause === 'using' ? {} : { using: 'owner_id == current_user.id' }),
          [clause]: source,
        },
      ],
    },
  ],
});

// ── Red: policies that authorize nothing ─────────────────────────────
//
// Every source below passes `RowLevelSecurityPolicySchema` (`using` / `check`
// are `z.string()`), `os validate`, `os build` and `os lint` as they stand
// today. The runtime drops each one and answers "no rows" — which is the whole
// defect (#4983).

describe('validateRlsPredicateEnforceability — predicates the runtime can only drop go RED', () => {
  it('flags a function call, naming the policy, the path and the real consequence', () => {
    const findings = validateRlsPredicateEnforceability(policyWith('using', 'size(record.tags) > 0'));
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({
      severity: 'error',
      rule: RLS_PREDICATE_UNENFORCEABLE,
      path: 'permissions[0].rowLevelSecurity[0].using',
      where: 'permission set "sales_rep" policy "own_leads" on object "lead"',
    });
    // The verdict says what the runtime DOES, not merely "unsupported"…
    expect(findings[0].message).toMatch(/^RLS using is not lowerable \(.+\), so the policy is dropped and grants no access$/);
    // …and `os explain` says how: the drop, the deny sentinel, the zero rows.
    expect(explanationOf(RLS_PREDICATE_UNENFORCEABLE)).toMatch(/DROPS a policy/);
    expect(explanationOf(RLS_PREDICATE_UNENFORCEABLE)).toMatch(/RLS_DENY_FILTER/);
    expect(explanationOf(RLS_PREDICATE_UNENFORCEABLE)).toMatch(/ZERO rows/);
    // …and prescribe the fix that works on THIS surface.
    expect(findings[0].hint).toMatch(/field != null/);
    expect(findings[0].hint).toMatch(/INTERPRETED/);
  });

  it.each([
    ['a cross-object path', "record.account.region == 'EU'"],
    ['arithmetic', 'amount + 1 > 2'],
    ['a bare function call', 'has(record.owner_id)'],
    ['a ternary', "stage == 'won' ? true : false"],
  ])('flags %s as unenforceable', (_label, source) => {
    expect(ids(policyWith('using', source))).toEqual([RLS_PREDICATE_UNENFORCEABLE]);
  });

  it.each([
    ['SQL AND — the bridge covers `=`/`IN` only', 'a = current_user.id AND b = 1'],
    ['a subquery', 'id IN (SELECT id FROM users)'],
  ])('gives %s its own id — the fix is CEL, not a different shape', (_label, source) => {
    const findings = validateRlsPredicateEnforceability(policyWith('using', source));
    expect(findings.map((f) => f.rule)).toEqual([RLS_PREDICATE_UNPARSEABLE]);
    expect(findings[0].hint).toMatch(/canonical CEL/);
    expect(findings[0].hint).toMatch(/`&&` \/ `\|\|`/);
  });

  it('judges `check` with the WRITE-path consequence, not the read one', () => {
    const findings = validateRlsPredicateEnforceability(policyWith('check', 'size(record.tags) > 0'));
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({
      severity: 'error',
      rule: RLS_PREDICATE_UNENFORCEABLE,
      path: 'permissions[0].rowLevelSecurity[0].check',
    });
    // ADR-0058 D4: the post-image check becomes the deny sentinel → every write denied.
    expect(findings[0].message).toMatch(/so the policy is dropped and admits no write$/);
    expect(findings[0].message).not.toMatch(/grants no access/);
    expect(explanationOf(RLS_PREDICATE_UNENFORCEABLE)).toMatch(/PermissionDeniedError/);
    expect(explanationOf(RLS_PREDICATE_UNENFORCEABLE)).toMatch(/blanket refusal/);
  });

  it('reports `using` and `check` on one policy separately', () => {
    const findings = validateRlsPredicateEnforceability({
      permissions: [
        {
          name: 'p',
          rowLevelSecurity: [{ name: 'r', using: 'size(a) > 0', check: 'b + 1 > 2' }],
        },
      ],
    });
    expect(findings.map((f) => f.path)).toEqual([
      'permissions[0].rowLevelSecurity[0].using',
      'permissions[0].rowLevelSecurity[0].check',
    ]);
  });

  it('names each offending policy with its own index', () => {
    const findings = validateRlsPredicateEnforceability({
      permissions: [
        { name: 'ok', rowLevelSecurity: [{ name: 'a', using: 'owner_id == current_user.id' }] },
        {
          name: 'bad',
          rowLevelSecurity: [
            { name: 'fine', using: "status = 'published'" },
            { name: 'fn', using: 'size(tags) > 0' },
          ],
        },
      ],
    });
    expect(findings.map((f) => [f.rule, f.path])).toEqual([
      [RLS_PREDICATE_UNENFORCEABLE, 'permissions[1].rowLevelSecurity[1].using'],
    ]);
  });

  it('judges a DISABLED policy too — it is a landmine, not a dead branch', () => {
    // `getApplicablePolicies` skips `enabled: false`, so the consequence is
    // dormant rather than live. The day someone flips it on is exactly the day
    // nobody re-runs the linter.
    expect(ids({ permissions: [{ name: 'p', rowLevelSecurity: [{ name: 'r', enabled: false, using: 'size(a) > 0' }] }] }))
      .toEqual([RLS_PREDICATE_UNENFORCEABLE]);
  });

  it('accepts the name-keyed permission-set map as well as the array', () => {
    expect(ids({ permissions: { sales: { rowLevelSecurity: [{ name: 'r', using: 'size(a) > 0' }] } } }))
      .toEqual([RLS_PREDICATE_UNENFORCEABLE]);
  });
});

// ── Green: predicates that really do enforce ─────────────────────────
//
// A false positive here is worse than the gap the rule closes: it rejects
// security metadata that enforces correctly today and hands the author a
// "correction" that would break it. The legacy SQL forms are the sharp edge —
// they are CEL syntax ERRORS and perfectly working RLS predicates, because
// `sqlPredicateToCel` bridges them before the compiler sees them.

describe('validateRlsPredicateEnforceability — predicates the runtime DOES compile stay green', () => {
  it.each([
    // Legacy SQL-ish subset, bridged.
    ['owner_id = current_user.id'],
    ["status = 'published'"],
    ['id IN (current_user.org_user_ids)'],
    ['1 = 1'],
    // Canonical CEL.
    ['owner_id == current_user.id'],
    ['organization_id == current_user.organization_id'],
    ['id in current_user.org_user_ids'],
    ['amount > 100'],
    ['region != null'],
    ['a == 1 && b == 2'],
    ["!(stage in ['draft']) || amount >= 1000"],
  ])('accepts %s', (source) => {
    expect(validateRlsPredicateEnforceability(policyWith('using', source))).toEqual([]);
  });

  it('a quoted literal containing `=` or `IN` survives the bridge and stays green', () => {
    // The bridge's sharpest boundary: rewriting inside a string literal would
    // turn a working policy red. This is why the bridge was hoisted rather
    // than copied (#4983).
    expect(validateRlsPredicateEnforceability(policyWith('using', "note = 'a = b'"))).toEqual([]);
    expect(validateRlsPredicateEnforceability(policyWith('using', "note = 'IN transit'"))).toEqual([]);
  });

  /**
   * The measured claim behind shipping this as `error`: every RLS predicate
   * this repo declares today is supported, so the gate turns nothing red.
   * Lifted verbatim from `plugin-security/src/objects/default-permission-sets.ts`
   * (the platform seeds — `everyone` / member / self-service sets),
   * `examples/app-showcase/src/security/permission-sets.ts`, the dogfood
   * fixtures, and `skills/objectstack-data/SKILL.md`'s authoring example.
   */
  it('accepts every RLS predicate declared anywhere in this repo', () => {
    const shipped = [
      // plugin-security default-permission-sets.ts
      'id == current_user.organization_id',
      'id == current_user.id',
      'id in current_user.org_user_ids',
      'user_id == current_user.id',
      'organization_id == current_user.organization_id',
      'created_by == current_user.id',
      // examples/ + dogfood fixtures
      'owner == current_user.email',
      'assignee == current_user.email',
      // skills/objectstack-data/SKILL.md
      'owner_id == current_user.id',
    ];
    for (const source of shipped) {
      expect(validateRlsPredicateEnforceability(policyWith('using', source))).toEqual([]);
      expect(validateRlsPredicateEnforceability(policyWith('check', source))).toEqual([]);
    }
  });

  it('ignores shapes Zod owns rather than inventing a second complaint', () => {
    expect(ids(policyWith('using', undefined))).toEqual([]);
    expect(ids(policyWith('using', ''))).toEqual([]);
    expect(ids(policyWith('using', '   '))).toEqual([]);
    expect(ids(policyWith('using', 42))).toEqual([]);
  });

  it('is a no-op on a stack that declares no RLS', () => {
    expect(validateRlsPredicateEnforceability({})).toEqual([]);
    expect(validateRlsPredicateEnforceability(undefined)).toEqual([]);
    expect(validateRlsPredicateEnforceability({ permissions: [] })).toEqual([]);
    expect(validateRlsPredicateEnforceability({ permissions: [{ name: 'p' }] })).toEqual([]);
  });

  it('reads only `permissions` — no alias branch that no spec-valid stack can reach', () => {
    // `rowLevelSecurity` is declared on `PermissionSetSchema` alone (ObjectSchema
    // has no such key) and `permissions` is the one stack key StackSchema
    // declares for permission sets. `permissionSets` / `objects[].rls` are
    // rejected by name, so reading them here would be the #4984 defect: a branch
    // that only ever fires on metadata the schema already refuses.
    expect(ids({ permissionSets: [{ name: 'p', rowLevelSecurity: [{ name: 'r', using: 'size(a) > 0' }] }] })).toEqual([]);
    expect(ids({ objects: [{ name: 'o', rowLevelSecurity: [{ name: 'r', using: 'size(a) > 0' }] }] })).toEqual([]);
  });
});

// ── The predicate is the runtime's, not a model of it ────────────────

describe('validateRlsPredicateEnforceability — the verdict IS the RLSCompiler\'s verdict', () => {
  const corpus = [
    'owner_id = current_user.id',
    "status = 'published'",
    'id IN (current_user.org_user_ids)',
    '1 = 1',
    'owner_id == current_user.id',
    'amount > 100',
    'region != null',
    'a == 1 && b == 2',
    "note = 'a = b'",
    'size(record.tags) > 0',
    'amount + 1 > 2',
    "record.account.region == 'EU'",
    'id IN (SELECT id FROM users)',
    'a = current_user.id AND b = 1',
  ];

  it('agrees with `isSupportedRlsExpression` on every source, in both directions', () => {
    for (const source of corpus) {
      // This is the exact function `RLSCompiler.compileFilter` consults to
      // decide whether a dropped policy earns its "DROPPED (no enforcement)"
      // WARN — same function, same package, same input.
      const runtimeWouldEnforce = isSupportedRlsExpression(source);
      const lintIsClean = validateRlsPredicateEnforceability(policyWith('using', source)).length === 0;
      expect({ source, lintIsClean }).toEqual({ source, lintIsClean: runtimeWouldEnforce });
    }
  });

  /**
   * The "before" half of the proof, kept mechanical rather than asserted in
   * prose. #4983's complaint is that an unenforceable RLS policy passes the
   * WHOLE toolchain, so it is not enough to show the new rule goes red — it
   * must also be shown that nothing else ever did. If some future rule grows to
   * cover this shape, this test fails and someone decides which of the two owns
   * it, instead of the stack quietly acquiring a duplicate diagnostic.
   */
  it('no OTHER author-time rule sees this — which is exactly why the gate was missing', () => {
    const offending = {
      objects: [
        {
          name: 'lead',
          label: 'Lead',
          sharingModel: 'private',
          fields: {
            name: { type: 'text', label: 'Name' },
            owner_id: { type: 'text', label: 'Owner' },
            tags: { type: 'text', label: 'Tags' },
          },
        },
      ],
      permissions: [
        {
          name: 'sales_rep',
          label: 'Sales Rep',
          rowLevelSecurity: [
            { name: 'own_leads', object: 'lead', operation: 'select', using: 'size(record.tags) > 0' },
          ],
        },
      ],
    };

    const findings = runAuthoringRules('validate', { normalized: offending, parsed: offending });
    expect(findings.map((f) => f.rule)).toEqual([RLS_PREDICATE_UNENFORCEABLE]);

    // And the fixture really did travel through every rule — a registry that
    // silently stopped running would satisfy the assertion above vacuously.
    expect(AUTHORING_RULES.filter((r) => r.commands.includes('validate')).length).toBeGreaterThan(20);
  });

  it('runs identically on the normalized tier — `using` / `check` are plain strings in both', () => {
    const stack = policyWith('using', 'size(record.tags) > 0');
    expect(runAuthoringRules('lint', { normalized: stack }).map((f) => f.rule))
      .toContain(RLS_PREDICATE_UNENFORCEABLE);
  });
});

// ── Over budget is not a dialect mistake (#6778) ─────────────────────
//
// The pushdown compiler collapses a `DEFAULT_LIMITS` overrun into
// `reason: 'parse-error'` deliberately — it is the reason every consumer
// already routes to its deny path. Correct for the runtime, whose only
// decision is deny-or-not; wrong for an authoring diagnostic, whose job is to
// name the edit. Before #6778 an 80-term conjunction — valid, lowerable CEL
// that is merely too big — was reported under `rls-predicate-unparseable`,
// whose hint explains SQL-vs-CEL syntax confusion.
//
// These cases run at BOTH positions of `cel-pushdown-limits.ts`'s dated GA
// switch, because the two positions are where the whole question lives: during
// 17.0.0-rc.x the grace window admits an over-limit predicate and this rule
// must stay silent; at the v17 GA flip the same predicate is refused and must
// be told the truth about why.

/** Over one `DEFAULT_LIMITS` bound each, and nothing else wrong with them. */
const OVER_BUDGET = {
  maxAstNodes: Array.from({ length: 80 }, (_, i) => `record.f${i} == ${i}`).join(' && '),
  maxDepth: '('.repeat(40) + 'record.a == 1' + ')'.repeat(40),
  maxListElements: `record.x in [${Array.from({ length: 100 }, (_, i) => i).join(', ')}]`,
} as const;

/** Genuinely not CEL — the class `rls-predicate-unparseable` was written for. */
const NOT_CEL = {
  'SQL AND': 'a = current_user.id AND b = 1',
  'a subquery': 'id IN (SELECT id FROM users)',
  'a stray operator': 'record.stage ==',
} as const;

describe('validateRlsPredicateEnforceability — a bounds overrun is its own id (#6778)', () => {
  afterEach(() => {
    // A suite must not leak a mode into the next file.
    setCelPushdownLimitsModeForTests('rc-grace')();
  });

  const atGa = <T>(fn: () => T): T => {
    const restore = setCelPushdownLimitsModeForTests('fail-closed');
    try {
      return fn();
    } finally {
      restore();
    }
  };

  // ── The shipped position: nothing changes today ───────────────────
  it.each(Object.entries(OVER_BUDGET))(
    'stays silent on an over-%s predicate during the rc grace window — no behaviour change today',
    (_limit, source) => {
      // The grace window admits it (it still compiles and WARNs), so
      // `isSupportedRlsExpression` is true and the rule never fires.
      expect(isSupportedRlsExpression(source)).toBe(true);
      expect(validateRlsPredicateEnforceability(policyWith('using', source))).toEqual([]);
    },
  );

  // ── The GA position: the whole point of the card ──────────────────
  it('at the GA flip, an over-budget predicate reports over-budget — naming the bound and its value', () => {
    const findings = atGa(() => validateRlsPredicateEnforceability(policyWith('using', OVER_BUDGET.maxAstNodes)));
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({
      severity: 'error',
      rule: RLS_PREDICATE_OVER_BUDGET,
      path: 'permissions[0].rowLevelSecurity[0].using',
      where: 'permission set "sales_rep" policy "own_leads" on object "lead"',
    });
    // The bound and the budget are the two facts "shrink it to fit" needs.
    expect(findings[0].message).toMatch(/maxAstNodes/);
    expect(findings[0].message).toMatch(/platform limit 256/);
    expect(findings[0].message).toMatch(/Exceeded maxAstNodes \(256\)/);
    // The verdict is unchanged, so the consequence must still be there.
    expect(findings[0].message).toMatch(/so the policy is dropped and grants no access$/);
    expect(explanationOf(RLS_PREDICATE_OVER_BUDGET)).toMatch(/ZERO rows/);
    // An over-budget predicate is long by definition — the finding does not
    // echo it; its `path` locates it.
    expect(findings[0].message).not.toContain('record.f0 == 0');
    expect(findings[0].message.length).toBeLessThanOrEqual(200);
  });

  it('prescribes shrinking, and never sends the author to check their dialect', () => {
    const [f] = atGa(() => validateRlsPredicateEnforceability(policyWith('using', OVER_BUDGET.maxAstNodes)));
    // The real remedies.
    expect(f.hint).toMatch(/field in \[a, b, …\]/);
    expect(f.hint).toMatch(/current_user\.<key>/);
    expect(f.hint).toMatch(/[Dd]enormalise/);
    expect(f.hint).toMatch(/hook or action body/);
    // Splitting is only sound on a top-level `||`; policies are OR-ed, so
    // splitting an `&&` would WIDEN access. Saying so is the point of the hint.
    expect(f.hint).toMatch(/never split a top-level `&&`/);
    expect(f.hint).toMatch(/WIDEN access/);
    // …and explicitly NOT the SQL-vs-CEL prose this class used to get.
    expect(f.hint).toMatch(/no syntax or dialect error/);
    expect(f.hint).not.toMatch(/canonical CEL \(ADR-0058 D1\)/);
    expect(f.hint).not.toMatch(/rather than SQL `AND` \/ `OR`/);
    expect(f.hint).not.toMatch(/LIKE/);
  });

  it('names the bound that was actually blown, not a hard-coded one', () => {
    // Reading `limit` / `limitValue` off the sister entrance's payload rather
    // than assuming `maxAstNodes` is what makes the hint worth reading: an
    // author told to shorten the wrong axis edits the wrong thing.
    const [depth] = atGa(() => validateRlsPredicateEnforceability(policyWith('using', OVER_BUDGET.maxDepth)));
    expect(depth.rule).toBe(RLS_PREDICATE_OVER_BUDGET);
    expect(depth.message).toMatch(/maxDepth/);
    expect(depth.message).toMatch(/platform limit 32/);
    expect(depth.message).not.toMatch(/maxAstNodes/);

    const [list] = atGa(() => validateRlsPredicateEnforceability(policyWith('using', OVER_BUDGET.maxListElements)));
    expect(list.rule).toBe(RLS_PREDICATE_OVER_BUDGET);
    expect(list.message).toMatch(/maxListElements/);
    expect(list.message).toMatch(/platform limit 64/);
    expect(list.message).not.toMatch(/maxAstNodes/);
  });

  it('carries the WRITE-path consequence when the over-budget clause is `check`', () => {
    const [f] = atGa(() => validateRlsPredicateEnforceability(policyWith('check', OVER_BUDGET.maxAstNodes)));
    expect(f).toMatchObject({
      rule: RLS_PREDICATE_OVER_BUDGET,
      path: 'permissions[0].rowLevelSecurity[0].check',
    });
    expect(f.message).toMatch(/so the policy is dropped and admits no write$/);
    expect(f.message).not.toMatch(/grants no access/);
  });

  // ── The discrimination, which IS the card ─────────────────────────
  //
  // A split that cannot be shown to separate the two classes is decoration.
  // Both halves are pinned in one table so a future change that collapses them
  // — in either direction — goes red here rather than silently mislabelling
  // one class again.
  it('discriminates over-budget from not-CEL at the GA position, in both directions', () => {
    const expected: Array<[string, string, string]> = [
      ...Object.entries(OVER_BUDGET).map(
        ([limit, src]) => [`over ${limit}`, src, RLS_PREDICATE_OVER_BUDGET] as [string, string, string],
      ),
      ...Object.entries(NOT_CEL).map(
        ([label, src]) => [label, src, RLS_PREDICATE_UNPARSEABLE] as [string, string, string],
      ),
    ];
    const actual = atGa(() =>
      expected.map(([label, src]) => [label, ids(policyWith('using', src))] as const),
    );
    expect(actual).toEqual(expected.map(([label, , rule]) => [label, [rule]]));
  });

  it('a predicate that is BOTH unparseable and huge is unparseable — syntax is judged first', () => {
    // 80 SQL `AND` terms: over `maxAstNodes` in size, but the bridge does not
    // cover `AND`, so it is not CEL at all. Shortening it would not help; the
    // author has to rewrite it, so the syntax id is the useful one. The parse
    // never reaches a bounds fault because it throws on `AND` first.
    const source = Array.from({ length: 80 }, (_, i) => `f${i} = ${i}`).join(' AND ');
    expect(source.length).toBeGreaterThan(OVER_BUDGET.maxAstNodes.length / 2);
    expect(atGa(() => ids(policyWith('using', source)))).toEqual([RLS_PREDICATE_UNPARSEABLE]);
  });

  it('leaves the unenforceable class alone — an over-budget check never steals a shape fault', () => {
    // Reported at BOTH switch positions: this class does not involve the parse
    // bounds at all, so neither position may re-route it.
    for (const source of ['size(record.tags) > 0', "record.account.region == 'EU'", 'amount + 1 > 2']) {
      expect(ids(policyWith('using', source))).toEqual([RLS_PREDICATE_UNENFORCEABLE]);
      expect(atGa(() => ids(policyWith('using', source)))).toEqual([RLS_PREDICATE_UNENFORCEABLE]);
    }
  });

  // ── The red/green boundary is untouched ───────────────────────────
  it('refuses exactly what it refused before — only the explanation moved', () => {
    // #6778 is explicitly NOT a behaviour change. The rule's verdict is still
    // `isSupportedRlsExpression`, so lint-clean must remain that function's own
    // answer at BOTH switch positions, over-budget sources included.
    const corpus = [
      ...Object.values(OVER_BUDGET),
      ...Object.values(NOT_CEL),
      'owner_id == current_user.id',
      "status = 'published'",
      'size(record.tags) > 0',
    ];
    for (const mode of ['rc-grace', 'fail-closed'] as const) {
      const restore = setCelPushdownLimitsModeForTests(mode);
      try {
        for (const source of corpus) {
          const lintIsClean = validateRlsPredicateEnforceability(policyWith('using', source)).length === 0;
          expect({ mode, source: source.slice(0, 40), lintIsClean }).toEqual({
            mode,
            source: source.slice(0, 40),
            lintIsClean: isSupportedRlsExpression(source),
          });
        }
      } finally {
        restore();
      }
    }
  });

  it('reaches the author through the real registry, not just a direct call', () => {
    const stack = policyWith('using', OVER_BUDGET.maxAstNodes);
    expect(atGa(() => runAuthoringRules('validate', { normalized: stack, parsed: stack }).map((f) => f.rule)))
      .toEqual([RLS_PREDICATE_OVER_BUDGET]);
  });
});

// ── #16119: the REFERENCE half — a predicate that lowers but points at nothing

/**
 * The card's site, reproduced: hotcrm's `opportunity_private_owner_only` on
 * `crm_opportunity`, whose shipped `using` is
 * `is_private == false || owner_id == current_user.id`.
 *
 * The object is declared here because that is the whole point — the three shape
 * ids never needed one, and these two cannot exist without it.
 */
const CRM_OPPORTUNITY = {
  name: 'crm_opportunity',
  label: 'Opportunity',
  ownership: 'user',
  fields: [
    { name: 'name', type: 'text' },
    { name: 'is_private', type: 'boolean' },
    { name: 'owner_id', type: 'user', reference: 'sys_user' },
    { name: 'assigned_to_id', type: 'user', reference: 'sys_user' },
    { name: 'amount', type: 'number' },
    { name: 'status', type: 'text' },
    { name: 'organization_id', type: 'text' },
  ],
};

/** The card's site with one clause swapped, over a stack that DECLARES the object. */
const siteWith = (clause: 'using' | 'check', source: unknown, object = 'crm_opportunity') => ({
  objects: [CRM_OPPORTUNITY],
  permissions: [
    {
      name: 'sales_manager',
      label: 'Sales Manager',
      rowLevelSecurity: [
        {
          name: 'opportunity_private_owner_only',
          object,
          operation: 'all',
          ...(clause === 'using' ? {} : { using: 'true' }),
          [clause]: source,
        },
      ],
    },
  ],
});

describe('validateRlsPredicateEnforceability — the four injections at ONE site (#16119)', () => {
  /**
   * The card's measurement, restated as a table so the two halves stay
   * comparable. The two CONTROLS must keep firing under their EXISTING ids and
   * must NOT acquire either new one — a rule that swallowed them would look
   * like an improvement and would be a regression of #4983/#6778.
   */
  it.each([
    ['CONTROL — not pushdownable', 'billing_address.country == "US"', [RLS_PREDICATE_UNENFORCEABLE]],
    ['CONTROL — unparseable', 'is_private == = false', [RLS_PREDICATE_UNPARSEABLE]],
    ['was SILENT — unknown field', 'is_private_nope == false || owner_id == current_user.id', [RLS_PREDICATE_UNKNOWN_FIELD]],
    ['was SILENT — unknown user variable', 'is_private == false || owner_id == current_user.nope', [RLS_PREDICATE_UNKNOWN_USER_VARIABLE]],
  ])('%s', (_label, source, expected) => {
    expect(validateRlsPredicateEnforceability(siteWith('using', source)).map((f) => f.rule)).toEqual(expected);
  });

  it('leaves the shipped predicate at that site silent — the negative control', () => {
    // Without this, an always-fires implementation satisfies the table above.
    expect(ids(siteWith('using', 'is_private == false || owner_id == current_user.id'))).toEqual([]);
  });

  it('is disjoint from the three SHAPE ids by construction', () => {
    // A shape fault never earns a reference id and vice versa: the reference
    // pass only runs where `isSupportedRlsExpression` already said yes.
    for (const source of ['size(record.tags) > 0', 'a = current_user.id AND b = 1', 'is_private == = false']) {
      const rules = ids(siteWith('using', source));
      expect(rules).not.toContain(RLS_PREDICATE_UNKNOWN_FIELD);
      expect(rules).not.toContain(RLS_PREDICATE_UNKNOWN_USER_VARIABLE);
      expect(rules).toHaveLength(1);
    }
  });

  /**
   * The "before" half, mechanical rather than asserted in prose — the same
   * construction #4983's own test uses. If some future rule grows to cover
   * these shapes, this fails and someone decides which of the two owns it.
   */
  it('NOTHING else in the whole rule table reports either miss', () => {
    for (const source of [
      'is_private_nope == false || owner_id == current_user.id',
      'is_private == false || owner_id == current_user.nope',
    ]) {
      const stack = siteWith('using', source);
      const findings = runAuthoringRules('lint', { normalized: stack, parsed: stack });
      const mine = findings.filter(
        (f) => f.rule === RLS_PREDICATE_UNKNOWN_FIELD || f.rule === RLS_PREDICATE_UNKNOWN_USER_VARIABLE,
      );
      expect(mine).toHaveLength(1);
      // Every other finding the table produces is about something else entirely
      // (the object declares no `sharingModel`), and is identical for the
      // SHIPPED predicate — so it is background, not a second report of this.
      const others = findings.filter((f) => !f.rule.startsWith('rls-predicate')).map((f) => f.rule);
      const shipped = siteWith('using', 'is_private == false || owner_id == current_user.id');
      const baseline = runAuthoringRules('lint', { normalized: shipped, parsed: shipped }).map((f) => f.rule);
      expect(others).toEqual(baseline);
    }
  });
});

describe('validateRlsPredicateEnforceability — the messages name the COST, not just the miss', () => {
  it('says the object disappears for every holder of the set (unknown field)', () => {
    const [f] = validateRlsPredicateEnforceability(siteWith('using', 'is_private_nope == false'));
    expect(f.rule).toBe(RLS_PREDICATE_UNKNOWN_FIELD);
    expect(f.where).toBe('permission set "sales_manager" policy "opportunity_private_owner_only" on object "crm_opportunity"');
    expect(f.path).toBe('permissions[0].rowLevelSecurity[0].using');
    expect(f.severity).toBe('error');
    // ⚠️ ONE direction, and the pin says so on purpose. This block used to
    // assert the opposite — that the field half had a fail-OPEN leg decided by
    // position — which was true of the runtime at the time and is now false:
    // column existence is judged on the COMPILED predicate, so position and
    // polarity are normalised away before the check runs. An author told "one
    // of these directions is fail-OPEN" would now harden against a hole that
    // no longer exists, and would not fix the name.
    // [#22161] The account of WHY is `os explain`'s now; it is pinned there.
    const why = explanationOf(RLS_PREDICATE_UNKNOWN_FIELD);
    expect(why).not.toMatch(/fail-OPEN/);
    expect(why).toMatch(/judges column existence on the COMPILED predicate/);
    expect(why).toMatch(/the position and the polarity it is written in make no difference/);
    // …and every shape the old text split across two directions is named in
    // the one direction, so an author recognises their own predicate in it.
    expect(why).toMatch(/`field != x`/);
    expect(why).toMatch(/any arm after the first/);
    // ⛔ …and NOT by citing a tracker id. This string reaches authors,
    // operators and generated surfaces, none of whom can resolve `#NNNN`
    // (`check:doc-authoring`); the id lives in the adjacent `//` comment, which
    // the reader who CAN resolve it is already reading. Pinned here so the next
    // author does not re-add it and learn this from CI instead.
    expect(f.message).not.toMatch(/#\d{3,}/);
    expect(f.hint).not.toMatch(/#\d{3,}/);
    expect(why).not.toMatch(/#\d{3,}/);
    // the cost, which is the same cost the variable half carries
    expect(f.message).toMatch(/The policy is dropped and grants no access\.$/);
    expect(why).toMatch(/DROP the policy at request time/);
    expect(why).toMatch(/RLS_DENY_FILTER/);
    expect(why).toMatch(/ZERO rows/);
    expect(why).toMatch(/disappears for every holder of the permission set/);
    // ⛔ …and NOT the three claims the rewritten text retired. The
    // cross-tenant sentence went with them: it was there to bound a leak
    // reading that the text no longer makes, and a denial needs no such
    // disclaimer. Overstating the old defect was the risk; restating a bound
    // on a defect the text does not describe is just noise.
    expect(why).not.toMatch(/leaves the policy KEPT/);
    expect(why).not.toMatch(/DEFEATED/);
    expect(why).not.toMatch(/driver-sql is NOT MEASURED/);
    // …and the miss itself, with the platform's own "did you mean".
    expect(f.message).toMatch(/"is_private_nope" is not a field on object "crm_opportunity"/);
    expect(f.message).toMatch(/Did you mean "is_private"\?/);
    // The hint lists the columns that DO exist and names the rename story.
    expect(f.hint).toMatch(/Fields on "crm_opportunity": amount, assigned_to_id/);
    expect(f.hint).toMatch(/RENAMED/);
  });

  it('says the same for an unresolved `current_user.*`, and prescribes the §7.3.1 route', () => {
    const [f] = validateRlsPredicateEnforceability(siteWith('using', 'owner_id == current_user.nope'));
    expect(f.rule).toBe(RLS_PREDICATE_UNKNOWN_USER_VARIABLE);
    expect(f.message).toMatch(/reads `current_user\.nope`, which nothing pre-resolves/);
    expect(f.message).toMatch(/in a scalar position no request can ever fill, so the policy is dropped/);
    // The variable half really is fail-closed in EVERY position — the compiler
    // refuses it under `!` and in a trailing `||` arm alike — so unlike the
    // field half it may say so without qualification.
    const why = explanationOf(RLS_PREDICATE_UNKNOWN_USER_VARIABLE);
    expect(why).toMatch(/unresolved-variable` for it in EVERY position/);
    expect(why).toMatch(/disappears for every holder of the permission set/);
    expect(why).not.toMatch(/fail-OPEN/);
    expect(f.hint).toMatch(/IRlsMembershipResolver/);
    expect(f.hint).toMatch(/never compared with `==`/);
  });

  it('names the WRITE consequence on a `check` clause, not the read one', () => {
    const [f] = validateRlsPredicateEnforceability(siteWith('check', 'nope_field == 1'));
    expect(f.rule).toBe(RLS_PREDICATE_UNKNOWN_FIELD);
    expect(f.path).toBe('permissions[0].rowLevelSecurity[0].check');
    expect(f.message).toMatch(/The policy is dropped and admits no write\.$/);
    // ⚠️ The write leg says the SAME thing the read leg does — one direction —
    // and it is the leg whose old text was not merely stale but misattributed:
    // it credited a fail-closed to the `extractTargetField` safety net, and
    // `computeWriteCheckFilter` never had one. The vacuous-permit sentence
    // survives in `os explain` as an explicit statement about an OLDER runtime,
    // so an operator reading it against a deployment that predates the guard
    // is not told the wrong thing.
    const why = explanationOf(RLS_PREDICATE_UNKNOWN_FIELD);
    expect(why).toMatch(/PermissionDeniedError/);
    expect(why).toMatch(/On a runtime older than that compiled-predicate guard a `check` miss failed OPEN/);
    expect(why).toMatch(/PERMITTED exactly the writes the policy was written to refuse/);
    expect(f.message).not.toMatch(/ZERO/);
  });
});

/**
 * What each kernel-resolved key holds on every request. Read off the resolver,
 * not off any list: `compileFilter` builds its `current_user` context in
 * `plugin-security/src/rls-compiler.ts` from `ExecutionContext` (`id` ←
 * `userId`, `organization_id` ← `tenantId`, the rest by name), and
 * `ExecutionContextSchema` declares `userId`, `tenantId` and `email` as strings
 * and `positions`, `org_user_ids` and `accessible_org_ids` as string arrays;
 * `resolveAuthzContext` produces the same types.
 */
const KERNEL_KEY_RUNTIME_TYPE: Record<string, 'scalar' | 'array'> = {
  id: 'scalar',
  organization_id: 'scalar',
  email: 'scalar',
  positions: 'array',
  org_user_ids: 'array',
  accessible_org_ids: 'array',
};

describe('validateRlsPredicateEnforceability — the `current_user` set is DERIVED, not transcribed', () => {
  /**
   * The known set is {@link RESERVED_RLS_MEMBERSHIP_KEYS} from
   * `@objectstack/spec/contracts` — the contract that declares which
   * `current_user.*` keys the kernel owns and an `IRlsMembershipResolver` may
   * therefore never supply. Asserting the BEHAVIOUR against that import (rather
   * than a literal list retyped here) is what makes this rule follow the
   * platform: a key added to the contract stops being reported the same day,
   * with no edit in this package.
   *
   * ⛔ The card's own five-name list is hotcrm's local guard, and
   * `RLSUserContextSchema` in `packages/spec/src/security/rls.zod.ts` is a
   * different, stale shape (`tenantId`, `department`, `attributes`) the RLS
   * compiler never binds — neither is the authority.
   */
  it('never reports a kernel-resolved key as UNKNOWN — in its own position it is clean, in the other it is a type fault', () => {
    expect(RESERVED_RLS_MEMBERSHIP_KEYS.length).toBeGreaterThan(0);
    for (const key of RESERVED_RLS_MEMBERSHIP_KEYS) {
      // ⚠️ BOTH positions, asserted separately and by the key's RUNTIME type.
      // Until #19951 this pinned `[]` for both, which was the rule's blind spot
      // written down: the position the key's type cannot fill (`== <a set>`,
      // `in <one value>`) is dropped by the runtime on every request. That
      // position is now `rls-predicate-unenforceable` — and still never
      // `rls-predicate-unknown-user-variable`, which is what "derived, not
      // transcribed" means for the kernel's own keys.
      const type = KERNEL_KEY_RUNTIME_TYPE[key];
      const scalar = ids(siteWith('using', `owner_id == current_user.${key}`));
      const member = ids(siteWith('using', `owner_id in current_user.${key}`));
      expect({ key, scalar, member }).toEqual({
        key,
        scalar: type === 'scalar' ? [] : [RLS_PREDICATE_UNENFORCEABLE],
        member: type === 'array' ? [] : [RLS_PREDICATE_UNENFORCEABLE],
      });
    }
  });

  it('reports a key the contract does not name — the firing control beside that zero', () => {
    for (const key of ['nope', 'roles', 'organizationId', 'department', 'tenantId']) {
      expect(RESERVED_RLS_MEMBERSHIP_KEYS).not.toContain(key);
      expect(ids(siteWith('using', `owner_id == current_user.${key}`))).toEqual([
        RLS_PREDICATE_UNKNOWN_USER_VARIABLE,
      ]);
    }
  });
});

describe('validateRlsPredicateEnforceability — each kernel key is probed with its RUNTIME type (#19886)', () => {
  /**
   * The CEL lowering refuses `==` / `!=` against a list (#19886), so a probe of
   * the wrong type silences the reference half: an array bound to `id` made
   * every `field == current_user.id` policy compile to nothing here, and its
   * field and variable checks never ran. Each key is therefore probed with the
   * type `RLSCompiler.compileFilter` hands the compiler at runtime — the table
   * {@link KERNEL_KEY_RUNTIME_TYPE} says where that is read from.
   */
  const RUNTIME_TYPE = KERNEL_KEY_RUNTIME_TYPE;

  it('covers exactly the kernel-resolved keys the contract names', () => {
    expect(Object.keys(RUNTIME_TYPE).sort()).toEqual([...RESERVED_RLS_MEMBERSHIP_KEYS].sort());
  });

  it.each(Object.entries(RUNTIME_TYPE).filter(([, type]) => type === 'scalar'))(
    'a SCALAR key (%s) lowers under `==`, so the field check still runs',
    (key) => {
      expect(ids(siteWith('using', `owner_id_nope == current_user.${key}`))).toEqual([RLS_PREDICATE_UNKNOWN_FIELD]);
      expect(ids(siteWith('check', `owner_id_nope != current_user.${key}`))).toEqual([RLS_PREDICATE_UNKNOWN_FIELD]);
    },
  );

  it.each(Object.entries(RUNTIME_TYPE).filter(([, type]) => type === 'array'))(
    'a MEMBERSHIP key (%s) lowers under `in`, so the field check still runs',
    (key) => {
      expect(ids(siteWith('using', `owner_id_nope in current_user.${key}`))).toEqual([RLS_PREDICATE_UNKNOWN_FIELD]);
      expect(ids(siteWith('check', `!(owner_id_nope in current_user.${key})`))).toEqual([
        RLS_PREDICATE_UNKNOWN_FIELD,
      ]);
    },
  );
});

describe('validateRlsPredicateEnforceability — the bare `current_user` root is reported on both clauses (#19959)', () => {
  /**
   * The CEL lowering refuses `==` / `!=` against the variable ROOT — the whole
   * caller context object, not one value — in both compile modes, so the shape
   * verdict this rule reads (`isSupportedRlsExpression`) reports it before any
   * request. Until then the reference pass bound the root to its probe object,
   * the predicate lowered, and a `check` so written admitted every write at
   * runtime while this rule said nothing.
   */
  it.each([
    'owner_id != current_user',
    'owner_id == current_user',
    '!(owner_id == current_user)',
    'current_user != owner_id',
    "current_user != 'guest'",
  ])('%s', (source) => {
    for (const clause of ['using', 'check'] as const) {
      const findings = validateRlsPredicateEnforceability(siteWith(clause, source));
      expect(findings.map((f) => [f.rule, f.path])).toEqual([
        [RLS_PREDICATE_UNENFORCEABLE, `permissions[0].rowLevelSecurity[0].${clause}`],
      ]);
    }
  });

  it('CONTROL — a key of the root stays clean on both clauses', () => {
    expect(ids(siteWith('using', 'owner_id != current_user.id'))).toEqual([]);
    expect(ids(siteWith('check', 'owner_id == current_user.id'))).toEqual([]);
  });
});

describe('validateRlsPredicateEnforceability — the refusals the SHAPE check cannot see are reported (#19951)', () => {
  /**
   * Every source below passes `isSupportedRlsExpression`, `os validate` and this
   * rule as they stood, and none of them enforces what it says. Measured through
   * the real `SecurityPlugin` + ObjectQL + driver-sql:
   *
   *  - TYPE faults — a `current_user` value of the wrong type for its position.
   *    The compiler refuses the position on every request, `RLSCompiler` drops
   *    the policy: a `using` read returns zero rows (with only a per-request
   *    "DENY (fail closed)" WARN) and a `check` write is refused with 403.
   *  - NULL comparands — the shared filter faces refuse a `null` list member and
   *    a `null` ordering bound by ruling. They compile, and `RLSCompiler` runs
   *    the same faces on the compiled filter (#20212), so it drops the policy
   *    exactly as it drops a TYPE fault: zero rows with the per-request WARN on
   *    a `using` read, a 403 on a `check` write.
   */
  const TYPE_FAULTS: ReadonlyArray<readonly [string, string]> = [
    [
      'record.assigned_to_id != current_user.org_user_ids',
      'replace `record.assigned_to_id != current_user.org_user_ids` with `!(record.assigned_to_id in current_user.org_user_ids)`',
    ],
    [
      '!(record.assigned_to_id == current_user.org_user_ids)',
      'replace `record.assigned_to_id == current_user.org_user_ids` with `record.assigned_to_id in current_user.org_user_ids`',
    ],
    [
      'record.assigned_to_id in current_user.id',
      'replace `record.assigned_to_id in current_user.id` with `record.assigned_to_id == current_user.id`',
    ],
    ['record.assigned_to_id in current_user', '`record.assigned_to_id in current_user.org_user_ids`'],
    ['record.assigned_to_id.startsWith(current_user)', '`record.assigned_to_id.startsWith(current_user.id)`'],
    ['record.assigned_to_id.contains(current_user)', '`record.assigned_to_id.contains(current_user.email)`'],
    ['record.assigned_to_id.endsWith(current_user)', '`record.assigned_to_id.endsWith(current_user.organization_id)`'],
    [
      'record.assigned_to_id.startsWith(current_user.org_user_ids)',
      'the membership test `record.assigned_to_id in current_user.org_user_ids`',
    ],
  ];

  const NULL_COMPARANDS: ReadonlyArray<readonly [string, string]> = [
    [
      "record.status in ['open', null]",
      'replace `record.status in ["open", null]` with `(record.status in ["open"] || record.status == null)`',
    ],
    ['record.status in [null]', 'replace `record.status in [null]` with `record.status == null`'],
    [
      "!(record.status in ['open', null])",
      'replace `record.status in ["open", null]` with `(record.status in ["open"] || record.status == null)`',
    ],
    ['record.status > null', 'replace `record.status > null` with `record.status != null`'],
    ['record.status >= null', 'replace `record.status >= null` with `record.status != null`'],
    ['record.status < null', 'replace `record.status < null` with `record.status != null`'],
    ['record.status <= null', 'replace `record.status <= null` with `record.status != null`'],
  ];

  it.each([...TYPE_FAULTS, ...NULL_COMPARANDS])('%s — one finding per clause, with the pasteable rewrite', (source, rewrite) => {
    // Why it was silent: the shape verdict this rule reads says yes.
    expect(isSupportedRlsExpression(source)).toBe(true);
    for (const clause of ['using', 'check'] as const) {
      const findings = validateRlsPredicateEnforceability(siteWith(clause, source));
      expect(findings.map((f) => [f.rule, f.path])).toEqual([
        [RLS_PREDICATE_UNENFORCEABLE, `permissions[0].rowLevelSecurity[0].${clause}`],
      ]);
      expect(findings[0].hint).toContain(rewrite);
    }
  });

  it('a TYPE fault names the reference, what it holds, and a DROP with the clause’s own consequence', () => {
    const [using] = validateRlsPredicateEnforceability(siteWith('using', TYPE_FAULTS[0][0]));
    expect(using.message).toBe(
      'RLS using: `current_user.org_user_ids` is a membership set, a list on every request, used where one value ' +
        'belongs, so the policy is dropped and grants no access',
    );

    const [check] = validateRlsPredicateEnforceability(siteWith('check', 'record.assigned_to_id in current_user.id'));
    expect(check.message).toBe(
      'RLS check: `current_user.id` holds ONE value on every request, used where a set belongs, so the policy is ' +
        'dropped and admits no write',
    );

    const [root] = validateRlsPredicateEnforceability(siteWith('using', 'record.assigned_to_id in current_user'));
    expect(root.message).toContain('`current_user` alone is the whole caller context object');

    const why = explanationOf(RLS_PREDICATE_UNENFORCEABLE);
    expect(why).toMatch(/drops the policy on every request/);
    expect(why).toMatch(/per-request "DENY \(fail closed\)" WARN/);
    expect(why).toMatch(/RLS_DENY_FILTER/);
    expect(why).toMatch(/PermissionDeniedError/);
  });

  it('a NULL comparand is reported as a DROP with the clause’s own consequence, as the runtime drops it', () => {
    const [using] = validateRlsPredicateEnforceability(siteWith('using', NULL_COMPARANDS[2][0]));
    expect(using.message).toMatch(/^RLS using lowers to a refused comparand \(Operator "\$in" on field "status" /);
    expect(using.message).toMatch(/so the policy is dropped and grants no access$/);

    const [check] = validateRlsPredicateEnforceability(siteWith('check', NULL_COMPARANDS[2][0]));
    expect(check.message).toMatch(/so the policy is dropped and admits no write$/);
    expect(explanationOf(RLS_PREDICATE_UNENFORCEABLE)).toMatch(
      /runs that check on every compiled policy filter before any backend sees it/,
    );
  });

  it('rewrites EVERY site the fault lands in, in one finding', () => {
    const findings = validateRlsPredicateEnforceability(
      siteWith('using', 'record.assigned_to_id != current_user.org_user_ids && record.owner_id != current_user.org_user_ids'),
    );
    expect(findings.map((f) => f.rule)).toEqual([RLS_PREDICATE_UNENFORCEABLE]);
    expect(findings[0].hint).toContain('`!(record.assigned_to_id in current_user.org_user_ids)`');
    expect(findings[0].hint).toContain('`!(record.owner_id in current_user.org_user_ids)`');
  });

  it('CONTROLS — the literal list keeps its one shape finding, and every spelling the hints point at is clean', () => {
    expect(ids(siteWith('using', "record.status != ['closed', 'archived']"))).toEqual([RLS_PREDICATE_UNENFORCEABLE]);
    for (const source of [
      'record.assigned_to_id == current_user.id',
      '!(record.assigned_to_id in current_user.org_user_ids)',
      'record.assigned_to_id in current_user.org_user_ids',
      'record.assigned_to_id.startsWith(current_user.id)',
      "(record.status in ['open'] || record.status == null)",
      'record.status == null',
      'record.status != null',
    ]) {
      for (const clause of ['using', 'check'] as const) {
        expect({ source, clause, rules: ids(siteWith(clause, source)) }).toEqual({ source, clause, rules: [] });
      }
    }
  });

  it('CONTROL — a refusal that depends on WHICH caller asks is a probe artefact and stays silent', () => {
    // Load-bearing: the compiler really does refuse this for the probe's value.
    // The runtime answers it PER CALLER — no restriction for the one it names,
    // a refusal for every other — so no probe value can stand for the request,
    // and reporting "refused" would be reporting the lint's own probe.
    const named = "current_user.email == 'ops@acme.com'";
    expect(compileCelToFilter(named, { variables: { current_user: { email: 'ops@acme.com' } } })).toEqual({
      ok: true,
      filter: {},
    });
    expect(compileCelToFilter(named, { variables: { current_user: { email: 'rep@acme.com' } } })).toMatchObject({
      ok: false,
      reason: 'unsupported',
    });
    for (const source of [named, `${named} || record.owner_id == current_user.id`]) {
      expect(isSupportedRlsExpression(source)).toBe(true);
      for (const clause of ['using', 'check'] as const) {
        expect({ source, clause, rules: ids(siteWith(clause, source)) }).toEqual({ source, clause, rules: [] });
      }
    }
  });

  it('reaches `os validate` through the real rule table', () => {
    const stack = siteWith('using', TYPE_FAULTS[0][0]);
    const rls = runAuthoringRules('validate', { normalized: stack, parsed: stack })
      .filter((f) => f.rule.startsWith('rls-predicate'))
      .map((f) => f.rule);
    expect(rls).toEqual([RLS_PREDICATE_UNENFORCEABLE]);
  });
});

describe('validateRlsPredicateEnforceability — §7.3.1 membership keys stay UNKNOWABLE', () => {
  /**
   * The false-positive this rule exists on the edge of. An app stages arbitrary
   * keys into `ExecutionContext.rlsMembership` and references them as
   * `field in current_user.<key>`; `RowLevelSecurityPolicySchema` documents the
   * pattern and the EXISTING `rls-predicate-unparseable` hint recommends it. In
   * an `in` position an unknown key is indistinguishable from a correct one, so
   * it must never be reported.
   *
   * It is decidable in the other positions only because the merge is array-only
   * (`compileFilter` stages an entry `if (Array.isArray(value))`), so the sole
   * value an app-staged key can ever hold is an array — which a scalar position
   * cannot use, on any request.
   */
  it.each([
    ['a team set', 'assigned_to_id in current_user.team_member_ids'],
    ['a territory set', 'owner_id in current_user.territory_account_ids'],
    ['the spec doc example', 'assigned_to_id in current_user.team_ids'],
    ['bridged from legacy SQL', 'assigned_to_id IN (current_user.team_member_ids)'],
    ['composed with a real clause', 'is_private == false || assigned_to_id in current_user.team_member_ids'],
  ])('%s is silent', (_label, source) => {
    expect(ids(siteWith('using', source))).toEqual([]);
  });

  it('a key used in BOTH positions takes the membership answer (the conservative direction)', () => {
    expect(ids(siteWith('using', 'owner_id in current_user.zzz && status == current_user.zzz'))).toEqual([]);
  });
});

describe('validateRlsPredicateEnforceability — the graph\'s three skips, not this rule\'s', () => {
  it('skips an object this stack does not define', () => {
    expect(ids(siteWith('using', 'whatever == current_user.id', 'not_in_this_stack'))).toEqual([]);
  });

  it('skips an object that declares no readable field map', () => {
    const stack = {
      objects: [{ name: 'ext_thing', label: 'Ext', external: true }],
      permissions: [
        { name: 'p', rowLevelSecurity: [{ name: 'r', object: 'ext_thing', using: 'whatever == current_user.id' }] },
      ],
    };
    expect(ids(stack)).toEqual([]);
  });

  it('skips a registry-injected system column', () => {
    // `created_at` appears in no authored `fields` and is real at runtime.
    expect(ids(siteWith('using', 'created_at != null'))).toEqual([]);
    // …and `owner_id` resolves through the declared map on an `ownership: user`
    // object, so the injected path and the declared path agree here.
    expect(ids(siteWith('using', 'owner_id == current_user.id'))).toEqual([]);
  });

  it('skips a policy that names no object at all', () => {
    const stack = {
      objects: [CRM_OPPORTUNITY],
      permissions: [{ name: 'p', rowLevelSecurity: [{ name: 'r', using: 'whatever == current_user.id' }] }],
    };
    expect(ids(stack)).toEqual([]);
  });
});

describe('validateRlsPredicateEnforceability — the reference pass never throws', () => {
  it.each([
    ['an empty stack', {}],
    ['objects but no permissions', { objects: [CRM_OPPORTUNITY] }],
    ['a permission set with no policies', { objects: [CRM_OPPORTUNITY], permissions: [{ name: 'p' }] }],
    ['a null member in `objects`', { objects: [null, CRM_OPPORTUNITY], permissions: [] }],
    ['a null member in `rowLevelSecurity`', { objects: [CRM_OPPORTUNITY], permissions: [{ name: 'p', rowLevelSecurity: [null] }] }],
  ])('%s', (_label, stack) => {
    expect(() => validateRlsPredicateEnforceability(stack)).not.toThrow();
    expect(validateRlsPredicateEnforceability(stack)).toEqual([]);
  });

  it('still resolves through the name-keyed map spelling of `objects`', () => {
    const stack = {
      objects: { crm_opportunity: { fields: { is_private: { name: 'is_private', type: 'boolean' } } } },
      permissions: [
        { name: 'p', rowLevelSecurity: [{ name: 'r', object: 'crm_opportunity', using: 'nope_field == 1' }] },
      ],
    };
    expect(ids(stack)).toEqual([RLS_PREDICATE_UNKNOWN_FIELD]);
  });
});

describe('validateRlsPredicateEnforceability — the once-fail-OPEN field shapes are reported too', () => {
  /**
   * The half the card's escalation clause did not name. It asked for a
   * fail-OPEN *variable*, and the compiler refuses those in every position; the
   * hole was field-shaped instead.
   *
   * `extractTargetField` matched only a LEADING `field ==` / `=` / `in`, so for
   * each shape below the safety net returned `null`, the policy was KEPT, and
   * the phantom column lowered to a negated constraint that a row without that
   * column satisfies (`noValueSatisfiesNegation`). Measured on the runtime of
   * the day: 3 of 3 rows, against 1 of 3 for the real narrowing and 0 of 3 for
   * the same phantom column in a positive position — read path and write path
   * alike, the write path being the worse one because it had no
   * field-existence net at all.
   *
   * ⚠️ The runtime has since been repaired: `RLSCompiler.compileFilter` judges
   * column existence on the COMPILED predicate, which both faces pass through,
   * so all five shapes now fail CLOSED. That does NOT retire these cases —
   * `noValueSatisfiesNegation` is deliberately unchanged, so the shapes are
   * still exactly the ones whose miss used to invert, and DETECTING them is
   * still this rule's job. A rule that only caught the leading position would
   * satisfy the card and miss the half that was dangerous.
   */
  it.each([
    ['a bare negation', 'nope_a != "x"'],
    ['a negated equality', '!(nope_b == 1)'],
    ['a negated membership', "!(nope_c in ['a'])"],
    ['a trailing `||` arm behind a REAL leading field', 'is_private == false || nope_d != "x"'],
    ['a trailing `&&` arm behind a REAL leading field', 'is_private == false && nope_e != "x"'],
  ])('%s is reported', (_label, source) => {
    expect(ids(siteWith('using', source))).toEqual([RLS_PREDICATE_UNKNOWN_FIELD]);
  });

  it('the shipped predicate in the same shapes stays silent — the negative control', () => {
    for (const source of ['is_private != true', '!(is_private == true)', 'is_private == false || owner_id != "x"']) {
      expect(ids(siteWith('using', source))).toEqual([]);
    }
  });
});

describe('validateRlsPredicateEnforceability — the field set is read off the COMPILER\'s output', () => {
  it.each([
    ['a leading miss (the safety net\'s own position)', 'nope_one == 1', 1],
    ['a trailing miss (past the safety net)', 'is_private == false || nope_two == 1', 1],
    ['a miss on the right of a field-to-field comparison', 'owner_id == nope_three', 1],
    ['a miss inside a membership test', "nope_four in ['a', 'b']", 1],
    ['a miss inside a string method', "nope_five.startsWith('AC')", 1],
    ['a miss under a negation', '!(nope_six == 1)', 1],
    ['two distinct misses in one predicate', 'nope_seven == 1 && nope_eight == 2', 2],
  ])('%s', (_label, source, expected) => {
    const findings = validateRlsPredicateEnforceability(siteWith('using', source));
    expect(findings.map((f) => f.rule)).toEqual(new Array(expected).fill(RLS_PREDICATE_UNKNOWN_FIELD));
  });

  it('reports one finding per missing NAME, not one per occurrence', () => {
    expect(ids(siteWith('using', 'nope_dup == 1 || nope_dup == 2'))).toEqual([RLS_PREDICATE_UNKNOWN_FIELD]);
  });

  it('reports both halves when a predicate carries both misses', () => {
    expect(ids(siteWith('using', 'nope_field == current_user.nope_var'))).toEqual([
      RLS_PREDICATE_UNKNOWN_FIELD,
      RLS_PREDICATE_UNKNOWN_USER_VARIABLE,
    ]);
  });
});

describe('[#22161] one-line verdicts — the five ids', () => {
  it('every verdict the cases above fired is one line of at most 200 characters', () => {
    // The coverage control first: each id fired at least once, so the shape
    // assertion below cannot pass over an empty record.
    expect([...new Set(fired.map((f) => f.rule))].sort()).toEqual([...RLS_RULE_IDS].sort());
    for (const f of fired) {
      expect(f.message, f.rule).not.toContain('\n');
      expect(f.message.length, `${f.rule}: ${f.message}`).toBeLessThanOrEqual(200);
    }
  });

  // What each verdict stopped saying, which `os explain RULE_ID` now prints.
  const MOVED: Record<string, readonly string[]> = {
    [RLS_PREDICATE_UNENFORCEABLE]: ['pushdown subset', 'One WARN line', 'ZERO rows', 'single-record INSERT check', 'PERMISSION_DENIED', 'analytics query'],
    [RLS_PREDICATE_UNPARSEABLE]: ['legacy SQL bridge', '`IN` to `in`', 'ZERO rows', 'PermissionDeniedError', 'rls-predicate-over-budget'],
    [RLS_PREDICATE_OVER_BUDGET]: ['maxAstNodes', 'no syntax or dialect error', 'ZERO rows', 'PermissionDeniedError'],
    [RLS_PREDICATE_UNKNOWN_FIELD]: ['RENAME', 'COMPILED predicate', 'ZERO rows', 'failed OPEN'],
    [RLS_PREDICATE_UNKNOWN_USER_VARIABLE]: ['§7.3.1 membership sets', 'ARRAYS', 'EVERY position', 'never reported'],
  };

  it('covers exactly the five ids', () => {
    expect(Object.keys(MOVED).sort()).toEqual([...RLS_RULE_IDS].sort());
  });

  it.each([...RLS_RULE_IDS])('`os explain %s` carries what its verdict no longer says', (rule) => {
    const explanation = explainRule(rule);
    expect(explanation, `no \`os explain ${rule}\` entry`).toBeDefined();
    const text = explanation!.paragraphs.join('\n');
    for (const fact of MOVED[rule]) expect(text, `${rule} explanation names ${fact}`).toContain(fact);
  });

  it('the explanations name exactly the kernel-resolved `current_user` keys, each with its runtime type', () => {
    // The explanation module imports nothing, so the keys are written out
    // there; this holds them to the contract and to this file's type table.
    expect(explanationOf(RLS_PREDICATE_UNKNOWN_USER_VARIABLE)).toContain(
      `The kernel-resolved \`current_user\` keys are exactly ${[...RESERVED_RLS_MEMBERSHIP_KEYS].sort().join(', ')}.`,
    );
    const spell = (keys: string[]) =>
      keys.sort().map((k) => `\`${k}\``).reduce((acc, k, i, all) => (i === 0 ? k : `${acc}${i === all.length - 1 ? ' and ' : ', '}${k}`), '');
    const ofType = (type: 'scalar' | 'array') =>
      Object.entries(KERNEL_KEY_RUNTIME_TYPE).filter(([, t]) => t === type).map(([k]) => k);
    expect(explanationOf(RLS_PREDICATE_UNENFORCEABLE)).toContain(
      `the membership sets ${spell(ofType('array'))} as LISTS and ${spell(ofType('scalar'))} as one value each`,
    );
  });
});
