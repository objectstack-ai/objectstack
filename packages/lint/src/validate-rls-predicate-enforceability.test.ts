// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect } from 'vitest';
import { isSupportedRlsExpression } from '@objectstack/formula';

import {
  validateRlsPredicateEnforceability,
  RLS_PREDICATE_UNENFORCEABLE,
  RLS_PREDICATE_UNPARSEABLE,
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
