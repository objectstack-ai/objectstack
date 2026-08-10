// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect, afterEach } from 'vitest';
import { isSupportedRlsExpression, setCelPushdownLimitsModeForTests } from '@objectstack/formula';

import {
  validateRlsPredicateEnforceability,
  RLS_PREDICATE_UNENFORCEABLE,
  RLS_PREDICATE_UNPARSEABLE,
  RLS_PREDICATE_OVER_BUDGET,
} from './validate-rls-predicate-enforceability.js';
import { AUTHORING_RULES, runAuthoringRules } from './authoring-rules.js';

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
    // The message must say what the runtime DOES, not merely "unsupported".
    expect(findings[0].message).toMatch(/DROPS the policy at request time/);
    expect(findings[0].message).toMatch(/RLS_DENY_FILTER/);
    expect(findings[0].message).toMatch(/ZERO rows/);
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
    expect(findings[0].message).toMatch(/PermissionDeniedError/);
    expect(findings[0].message).toMatch(/blanket refusal/);
    expect(findings[0].message).not.toMatch(/ZERO rows/);
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
    // The verdict is unchanged, so the consequence prose must still be there.
    expect(findings[0].message).toMatch(/DROPS the policy at request time/);
    expect(findings[0].message).toMatch(/ZERO rows/);
    // An over-budget predicate is long by definition — the quote is bounded.
    expect(findings[0].message).toContain('...');
    expect(findings[0].message.length).toBeLessThan(OVER_BUDGET.maxAstNodes.length + 1200);
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
    expect(f.message).toMatch(/PermissionDeniedError/);
    expect(f.message).not.toMatch(/ZERO rows/);
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
