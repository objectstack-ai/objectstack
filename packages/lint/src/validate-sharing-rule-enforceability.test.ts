// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect } from 'vitest';
import { compileCelToFilter } from '@objectstack/formula';

import {
  validateSharingRuleEnforceability,
  SHARING_RULE_UNLOWERABLE_CONDITION,
  SHARING_RULE_RUNTIME_VARIABLE_CONDITION,
} from './validate-sharing-rule-enforceability.js';
import { AUTHORING_RULES, runAuthoringRules } from './authoring-rules.js';

const ids = (stack: unknown) => validateSharingRuleEnforceability(stack).map((f) => f.rule);

/** A complete, spec-shaped sharing rule with the condition swapped in. */
const ruleWith = (condition: unknown) => ({
  sharingRules: [
    {
      name: 'high_value_opps',
      type: 'criteria',
      object: 'opportunity',
      accessLevel: 'read',
      sharedWith: { type: 'team', value: 'deal_desk' },
      condition,
    },
  ],
});

// ── Red: declared, schema-valid, and never read ──────────────────────
//
// Every source below parses as CEL and passes `SharingRuleSchema`. The seeder
// still drops the rule on the floor, which is the whole defect (#4698).

describe('validateSharingRuleEnforceability — the declared-but-never-read cases go RED', () => {
  it('flags `has(...)` — the measured instance from the issue (hotcrm#621/#633)', () => {
    const findings = validateSharingRuleEnforceability(
      ruleWith("has(record.owner_id) && record.stage == 'closed_won'"),
    );
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({
      severity: 'error',
      rule: SHARING_RULE_UNLOWERABLE_CONDITION,
      // The declaration site is named, not just the rule.
      path: 'sharingRules[0].condition',
      where: 'sharing rule "high_value_opps" on object "opportunity"',
    });
    // It must say what actually happens at boot, not merely "unsupported".
    expect(findings[0].message).toMatch(/SKIPS the rule at boot/);
    expect(findings[0].message).toMatch(/never written to `sys_sharing_rule`/);
    // …and prescribe the fix that works on THIS surface.
    expect(findings[0].hint).toMatch(/record\.x != null/);
    expect(findings[0].hint).toMatch(/INTERPRETED/);
  });

  it.each([
    ['a bare function call', 'size(record.tags) > 0'],
    ['arithmetic', 'record.amount * 2 > 100'],
    ['a cross-object path', "record.account.region == 'EU'"],
    ['a ternary', "record.stage == 'won' ? true : false"],
  ])('flags %s', (_label, source) => {
    expect(ids(ruleWith(source))).toEqual([SHARING_RULE_UNLOWERABLE_CONDITION]);
  });

  it('gives `current_user.*` its own id — the fix is a different mechanism, not a respelling', () => {
    const findings = validateSharingRuleEnforceability(ruleWith('record.owner_id == current_user.id'));
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({
      severity: 'error',
      rule: SHARING_RULE_RUNTIME_VARIABLE_CONDITION,
      path: 'sharingRules[0].condition',
    });
    expect(findings[0].message).toMatch(/current_user\.id/);
    // Points at the surface where `current_user.*` IS resolved.
    expect(findings[0].hint).toMatch(/rowLevelSecurity\[\]\.using/);
  });

  it('reports the parsed tier identically — the envelope `ExpressionInputSchema` produces', () => {
    expect(ids(ruleWith({ dialect: 'cel', source: 'size(record.tags) > 0' })))
      .toEqual([SHARING_RULE_UNLOWERABLE_CONDITION]);
  });

  it('names each offending rule separately, with its own index', () => {
    const findings = validateSharingRuleEnforceability({
      sharingRules: [
        { name: 'ok', object: 'a', condition: "record.stage == 'won'" },
        { name: 'fn', object: 'b', condition: 'has(record.x)' },
        { name: 'var', object: 'c', condition: 'record.owner == current_user.id' },
      ],
    });
    expect(findings.map((f) => [f.rule, f.path])).toEqual([
      [SHARING_RULE_UNLOWERABLE_CONDITION, 'sharingRules[1].condition'],
      [SHARING_RULE_RUNTIME_VARIABLE_CONDITION, 'sharingRules[2].condition'],
    ]);
  });
});

// ── Green: conditions that really are read ───────────────────────────
//
// A false positive here is worse than the gap the rule closes: it rejects
// security metadata that enforces correctly today and hands the author a
// "correction" that would break it.

describe('validateSharingRuleEnforceability — conditions the runtime DOES read stay green', () => {
  it.each([
    ["record.health == 'red'"],
    ["record.health == 'red' && record.budget > 100000"],
    ['record.done == false'],
    ["record.stage in ['closed_won', 'closed_lost']"],
    ['record.closed_at == null'],
    ["record.name.startsWith('ACME')"],
    ["!(record.stage in ['draft']) || record.amount >= 1000"],
  ])('accepts %s', (source) => {
    expect(validateSharingRuleEnforceability(ruleWith(source))).toEqual([]);
  });

  it('accepts every sharing-rule condition the bundled examples declare', () => {
    // Lifted verbatim from examples/app-showcase/src/security/sharing-rules.ts
    // and examples/app-crm. The gate must not turn shipped apps red.
    const shipped = [
      "record.health == 'red'",
      "record.health == 'red' && record.budget > 100000",
      "record.status == 'new'",
      'record.done == false',
    ];
    for (const source of shipped) {
      expect(validateSharingRuleEnforceability(ruleWith(source))).toEqual([]);
    }
  });

  it('leaves CEL SYNTAX errors to validateStackExpressions — no double report', () => {
    // Parses nowhere, but this rule stays silent: `expression-invalid` already
    // gates the same field with a message written about syntax.
    expect(compileCelToFilter('record.stage ==', { variables: {} })).toMatchObject({ reason: 'parse-error' });
    expect(validateSharingRuleEnforceability(ruleWith('record.stage =='))).toEqual([]);
  });

  it('ignores shapes Zod owns rather than inventing a second complaint', () => {
    expect(ids(ruleWith(undefined))).toEqual([]);
    expect(ids(ruleWith(''))).toEqual([]);
    expect(ids(ruleWith('   '))).toEqual([]);
    expect(ids(ruleWith(42))).toEqual([]);
    expect(ids(ruleWith({ dialect: 'cel' }))).toEqual([]);
  });

  it('is a no-op on a stack that declares no sharing rules', () => {
    expect(validateSharingRuleEnforceability({})).toEqual([]);
    expect(validateSharingRuleEnforceability(undefined)).toEqual([]);
    expect(validateSharingRuleEnforceability({ sharingRules: [] })).toEqual([]);
  });

  it('checks inactive rules too — the seeder compiles the condition regardless of `active`', () => {
    // `bootstrapDeclaredSharingRules` carries `active` through to `defineRule`;
    // it does not skip the compile. A rule that is off today and unlowerable is
    // still a rule that will grant nothing the day someone switches it on.
    expect(ids({ sharingRules: [{ name: 'r', object: 'o', active: false, condition: 'has(record.x)' }] }))
      .toEqual([SHARING_RULE_UNLOWERABLE_CONDITION]);
  });
});

// ── The predicate is the consumer's, not a model of it ───────────────

describe('validateSharingRuleEnforceability — the verdict IS the seeder\'s verdict', () => {
  const corpus = [
    "record.health == 'red'",
    "record.health == 'red' && record.budget > 100000",
    'record.done == false',
    "record.stage in ['a', 'b']",
    'record.closed_at != null',
    'has(record.owner_id)',
    'size(record.tags) > 0',
    'record.amount * 2 > 100',
    "record.account.region == 'EU'",
    'record.owner_id == current_user.id',
  ];

  it('agrees with `compileCelToFilter({ variables: {} })` on every source, in both directions', () => {
    for (const source of corpus) {
      // This is exactly the call `bootstrap-declared-sharing-rules.ts` makes.
      const seederWouldSeed = compileCelToFilter(source, { variables: {} }).ok;
      const lintIsClean = validateSharingRuleEnforceability(ruleWith(source)).length === 0;
      expect({ source, lintIsClean }).toEqual({ source, lintIsClean: seederWouldSeed });
    }
  });

  /**
   * The "before" half of the proof, kept mechanical rather than asserted in
   * prose. #4698's complaint is that the offending stack passes the WHOLE
   * toolchain, so it is not enough to show the new rule goes red — it must also
   * be shown that nothing else ever did. Running the full author-time registry
   * over the fixture and demanding that every OTHER rule stays silent is that
   * statement, and unlike a comment it keeps holding: if some future rule grows
   * to cover this shape, this test fails and someone has to decide which of the
   * two owns it, instead of the stack quietly acquiring a duplicate diagnostic.
   */
  it('no OTHER author-time rule sees this — which is exactly why the gate was missing', () => {
    const offending = {
      objects: [
        {
          name: 'opportunity',
          label: 'Opportunity',
          sharingModel: 'private',
          fields: {
            name: { type: 'text', label: 'Name' },
            owner_id: { type: 'text', label: 'Owner' },
            stage: { type: 'text', label: 'Stage' },
          },
        },
      ],
      sharingRules: [
        {
          name: 'closed_won_to_deal_desk',
          type: 'criteria',
          object: 'opportunity',
          accessLevel: 'read',
          sharedWith: { type: 'team', value: 'deal_desk' },
          condition: "has(record.owner_id) && record.stage == 'closed_won'",
        },
      ],
    };

    const findings = runAuthoringRules('validate', { normalized: offending, parsed: offending });
    expect(findings.map((f) => f.rule)).toEqual([SHARING_RULE_UNLOWERABLE_CONDITION]);

    // And the fixture really did travel through every rule — a registry that
    // silently stopped running would satisfy the assertion above vacuously.
    expect(AUTHORING_RULES.filter((r) => r.commands.includes('validate')).length).toBeGreaterThan(20);
  });

  it('a match-all filter is unreachable from a lowering condition (so lint need not re-check it)', () => {
    // The seeder's SECOND guard is `isMatchAllCriteria(f)`, which lives in
    // plugin-sharing — a runtime `@objectstack/lint` must not import. This
    // pins the claim in the module docblock that duplicating it would be dead
    // code: every condition the compiler lowers yields a concrete predicate.
    for (const source of corpus) {
      const result = compileCelToFilter(source, { variables: {} });
      if (!result.ok) continue;
      expect(Object.keys(result.filter as Record<string, unknown>).length).toBeGreaterThan(0);
    }
  });
});
