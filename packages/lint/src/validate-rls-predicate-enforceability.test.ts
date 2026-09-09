// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect, afterEach } from 'vitest';
import { isSupportedRlsExpression, setCelPushdownLimitsModeForTests } from '@objectstack/formula';

import { RESERVED_RLS_MEMBERSHIP_KEYS } from '@objectstack/spec/contracts';

import {
  validateRlsPredicateEnforceability,
  RLS_PREDICATE_UNENFORCEABLE,
  RLS_PREDICATE_UNPARSEABLE,
  RLS_PREDICATE_OVER_BUDGET,
  RLS_PREDICATE_UNKNOWN_FIELD,
  RLS_PREDICATE_UNKNOWN_USER_VARIABLE,
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
    // ⚠️ BOTH directions, because they are not the same and the fail-OPEN one is
    // the dangerous half: an author told "this denies everything" about a
    // predicate that in fact matches everything hardens the wrong thing.
    expect(f.message).toMatch(/one of the two directions is fail-OPEN/);
    // ⛔ …and NOT by citing a tracker id. This string reaches authors,
    // operators and generated surfaces, none of whom can resolve `#NNNN`
    // (`check:doc-authoring`); the id lives in the adjacent `//` comment, which
    // the reader who CAN resolve it is already reading. Pinned here so the next
    // author does not re-add it and learn this from CI instead.
    expect(f.message).not.toMatch(/#\d{3,}/);
    expect(f.hint).not.toMatch(/#\d{3,}/);
    // closed leg — the LEADING position the safety net recognises
    expect(f.message).toMatch(/fails CLOSED/);
    expect(f.message).toMatch(/RLS_DENY_FILTER/);
    expect(f.message).toMatch(/ZERO rows/);
    // open leg — a negation or any arm after the first
    expect(f.message).toMatch(/leaves the policy KEPT/);
    expect(f.message).toMatch(/SATISFIES the negated constraint/);
    expect(f.message).toMatch(/DEFEATED/);
    // …and the limits, stated rather than overstated
    expect(f.message).toMatch(/NOT a cross-tenant leak/);
    expect(f.message).toMatch(/driver-sql is NOT MEASURED/);
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
    expect(f.message).toMatch(/scalar position, so no request can ever supply it/);
    // The variable half really is fail-closed in EVERY position — the compiler
    // refuses it under `!` and in a trailing `||` arm alike — so unlike the
    // field half it may say so without qualification.
    expect(f.message).toMatch(/unresolved-variable` in EVERY position/);
    expect(f.message).toMatch(/DISAPPEARS for every holder of this permission set/);
    expect(f.message).not.toMatch(/fail-OPEN/);
    expect(f.hint).toMatch(/IRlsMembershipResolver/);
    expect(f.hint).toMatch(/never compared with `==`/);
  });

  it('names the WRITE consequence on a `check` clause, not the read one', () => {
    const [f] = validateRlsPredicateEnforceability(siteWith('check', 'nope_field == 1'));
    expect(f.rule).toBe(RLS_PREDICATE_UNKNOWN_FIELD);
    expect(f.path).toBe('permissions[0].rowLevelSecurity[0].check');
    expect(f.message).toMatch(/PermissionDeniedError/);
    // The write path has the SAME asymmetry, measured against the same controls:
    // a positive phantom constraint refuses the post-image, a negated one is
    // satisfied vacuously and permits the write the policy was written to refuse.
    expect(f.message).toMatch(/permits exactly the writes it was written to refuse/);
    expect(f.message).not.toMatch(/select \/ update \/ delete matches ZERO/);
  });
});

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
  it('accepts every kernel-resolved key in BOTH positions', () => {
    expect(RESERVED_RLS_MEMBERSHIP_KEYS.length).toBeGreaterThan(0);
    for (const key of RESERVED_RLS_MEMBERSHIP_KEYS) {
      // ⚠️ BOTH, asserted separately. An `a.length === 0 || b.length === 0`
      // here would pass on whichever position happened to be silent, and this
      // rule is silent in both — so the disjunction pinned nothing about
      // position at all and would have survived a position-blind rewrite.
      const scalar = ids(siteWith('using', `owner_id == current_user.${key}`));
      const member = ids(siteWith('using', `owner_id in current_user.${key}`));
      expect({ key, scalar, member }).toEqual({ key, scalar: [], member: [] });
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

describe('validateRlsPredicateEnforceability — the fail-OPEN field shapes are reported too', () => {
  /**
   * The half the card's escalation clause did not name. It asked for a
   * fail-OPEN *variable*, and the compiler refuses those in every position; the
   * hole is field-shaped instead.
   *
   * `extractTargetField` matches only a LEADING `field ==` / `=` / `in`, so for
   * each shape below the safety net returns `null`, the policy is KEPT, and the
   * phantom column lowers to a negated constraint that a row without that
   * column satisfies (`noValueSatisfiesNegation`). Measured: 3 of 3 rows,
   * against 1 of 3 for the real narrowing and 0 of 3 for the same phantom
   * column in a positive position — read path and write path alike.
   *
   * The runtime repair is #17042 and is deliberately NOT attempted here. What
   * this rule owes is that the miss is REPORTED in these positions too, which
   * is what these cases pin: a rule that only caught the leading position would
   * satisfy the card and miss the dangerous half entirely.
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
