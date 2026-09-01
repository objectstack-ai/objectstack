// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect } from 'vitest';
import { compileCelToFilter } from '@objectstack/formula';
// [#14234] The spec-owned vocabulary the fix-hint quotes back at the author.
// Imported rather than transcribed so a rename in the spec reds this file
// instead of leaving the hint naming values the platform no longer has.
import { OWDModel, ShareRecipientType, ObjectAccessScopeSchema } from '@objectstack/spec/security';

import {
  validateSharingRuleEnforceability,
  SHARING_RULE_UNLOWERABLE_CONDITION,
  SHARING_RULE_RUNTIME_VARIABLE_CONDITION,
  SHARING_RULE_OBJECT_NOT_SHAREABLE,
  SHARING_RULE_OBJECT_CONTROLLED_BY_PARENT,
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

// ── The ANCHOR arm: would a share row on this object ever be consulted? ──
//
// The `condition` arm above judges one field of the rule; this one judges the
// other field that can decide the same question. Every fixture below carries a
// LOWERABLE condition, so any finding here is the anchor arm's alone.

/** A stack with one object at `owd` and one rule anchored on it. */
const anchoredOn = (owd: unknown, extra: Record<string, unknown> = {}) => ({
  objects: [
    {
      name: 'crm_opportunity',
      label: 'Opportunity',
      ...(owd === undefined ? {} : { sharingModel: owd }),
      fields: { name: { type: 'text', label: 'Name' }, amount: { type: 'number', label: 'Amount' } },
      ...extra,
    },
  ],
  sharingRules: [
    {
      name: 'high_value_opps',
      type: 'criteria',
      object: 'crm_opportunity',
      accessLevel: 'read',
      sharedWith: { type: 'position', value: 'sales_manager' },
      condition: 'record.amount > 100000',
    },
  ],
});

describe('validateSharingRuleEnforceability — an anchor no gate would consult goes RED', () => {
  it('flags `public_read_write` — nothing left to widen', () => {
    const findings = validateSharingRuleEnforceability(anchoredOn('public_read_write'));
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({
      severity: 'error',
      rule: SHARING_RULE_OBJECT_NOT_SHAREABLE,
      // The defect is on `object`, not on `condition` — a different field with
      // a different fix, so it gets its own path.
      path: 'sharingRules[0].object',
      where: 'sharing rule "high_value_opps" on object "crm_opportunity"',
    });
    // An author must be able to act on this: it has to name the object, the
    // rule, and WHY the rule cannot take effect.
    expect(findings[0].message).toMatch(/high_value_opps/);
    expect(findings[0].message).toMatch(/crm_opportunity/);
    expect(findings[0].message).toMatch(/sharingModel 'public_read_write'/);
    expect(findings[0].message).toMatch(/SHARING_NOT_ENABLED/);
    // …and both honest fixes, because which one is right is the author's call.
    expect(findings[0].hint).toMatch(/delete it/);
    expect(findings[0].hint).toMatch(/sharingModel: 'private'/);
  });

  it('flags `controlled_by_parent` with its OWN reason and its OWN id', () => {
    const findings = validateSharingRuleEnforceability(
      anchoredOn('controlled_by_parent', {
        fields: {
          name: { type: 'text', label: 'Name' },
          opportunity: { type: 'master_detail', reference: 'crm_account', required: true },
        },
      }),
    );
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({
      severity: 'error',
      rule: SHARING_RULE_OBJECT_CONTROLLED_BY_PARENT,
      path: 'sharingRules[0].object',
    });
    // `effectiveSharingModel` maps this value to 'public' too, so a single-id
    // implementation would hand the author the WRONG fix. The runtime tests
    // `controlled_by_parent` first and answers "share the master record
    // instead"; this arm mirrors that order, and names the master it resolved.
    expect(findings[0].message).toMatch(/derived from its master/i);
    expect(findings[0].message).toMatch(/share the master record instead/);
    expect(findings[0].hint).toMatch(/crm_account/);
  });

  it('flags a SYSTEM object with no OWD — absent resolves to public there (ADR-0090 D1)', () => {
    // The one arm that is not readable off `sharingModel` alone: for `sys_*` /
    // `isSystem` the ABSENCE of an OWD is the public fall-through, and
    // `security-owd-unset` deliberately exempts system objects, so nothing
    // else reports it either.
    const stack = anchoredOn(undefined);
    (stack.objects[0] as Record<string, unknown>).name = 'sys_audit_entry';
    (stack.sharingRules[0] as Record<string, unknown>).object = 'sys_audit_entry';
    const findings = validateSharingRuleEnforceability(stack);
    expect(findings.map((f) => f.rule)).toEqual([SHARING_RULE_OBJECT_NOT_SHAREABLE]);
    expect(findings[0].message).toMatch(/declares no sharingModel and is a system object/);
  });

  it('reports the anchor and the condition INDEPENDENTLY — two fields, two fixes', () => {
    const stack = anchoredOn('public_read_write');
    (stack.sharingRules[0] as Record<string, unknown>).condition = 'has(record.amount)';
    const findings = validateSharingRuleEnforceability(stack);
    expect(findings.map((f) => f.rule).sort()).toEqual(
      [SHARING_RULE_OBJECT_NOT_SHAREABLE, SHARING_RULE_UNLOWERABLE_CONDITION].sort(),
    );
    // Fixing the condition would not make this rule grant anything, and fixing
    // the anchor would not make the condition lower. Suppressing either would
    // hide a defect the author still has to fix.
    expect(new Set(findings.map((f) => f.path))).toEqual(
      new Set(['sharingRules[0].object', 'sharingRules[0].condition']),
    );
  });
});

// ── The direction that matters more: it must NOT fire on correct metadata ──

describe('validateSharingRuleEnforceability — an anchor a gate WOULD consult stays SILENT', () => {
  it.each([
    ['private — the posture sharing exists for', 'private'],
    ['public_read — owner writes, so a share row still widens WRITE', 'public_read'],
  ])('is silent on %s', (_label, owd) => {
    expect(validateSharingRuleEnforceability(anchoredOn(owd))).toEqual([]);
  });

  it('is silent on a CUSTOM object with no OWD — absence fails CLOSED to private', () => {
    // The asymmetry that makes the system-object case above a real arm and
    // this one a false positive if the mirror were sloppy: ADR-0090 D1 sends
    // an unset custom OWD to `private`, where sharing IS enforced.
    expect(validateSharingRuleEnforceability(anchoredOn(undefined))).toEqual([]);
  });

  it('is silent on a retired OWD alias — the runtime fails CLOSED, so the rule is LIVE', () => {
    // `sharingModel: 'read'` is not canonical (ADR-0090 D4). The runtime's
    // fall-through sends an unrecognised value to `private`, NOT to public, so
    // reporting inertness here would be a false positive on top of the
    // `security-owd-alias` error the value already earns.
    expect(validateSharingRuleEnforceability(anchoredOn('read'))).toEqual([]);
  });

  it('is silent when the anchor object is not declared by this stack', () => {
    // Absence of a schema is absence of EVIDENCE of inertness, not evidence of
    // liveness — the object may come from a plugin or an upstream stack. The
    // runtime draws the same line: `assertSharingEnforced` keeps existence a
    // SEPARATE verdict from inertness.
    const stack = anchoredOn('public_read_write');
    (stack.sharingRules[0] as Record<string, unknown>).object = 'not_in_this_stack';
    expect(validateSharingRuleEnforceability(stack)).toEqual([]);
  });

  it('is silent on an owner-less object — `owner_id` is REGISTRY-INJECTED, not authored', () => {
    // `inertGrantReason`'s third arm refuses a grant on an object with no
    // owner field, and it is deliberately NOT mirrored: `owner_id` is injected
    // by the schema registry, so it is absent from authored metadata and
    // present on the runtime schema. Judging it here would fail every object
    // that correctly does not declare it by hand — which is every object in
    // the fixture above, none of which declares `owner_id`.
    const stack = anchoredOn('private');
    expect(Object.keys((stack.objects[0] as { fields: object }).fields)).not.toContain('owner_id');
    expect(validateSharingRuleEnforceability(stack)).toEqual([]);
  });
});

// ── The `private`-case wording pin (#14234) ──────────────────────────
//
// The hint this rule prints used to end in an UNQUALIFIED remedy: "express
// per-user access with … an RLS policy on a permission set". That advice is
// sound on an open OWD and structurally impossible on `private`, which is the
// sharing model an author hitting this rule is most likely to be on.
//
// Measured, not argued. The security layers are AND-composed —
// `security-plugin.ts` returns
// `andComposeLayers(andComposeLayers(filter, cbpFilter), sharingFilter)`, and
// `getReadFilter`'s own prose promises "the same filter the engine middleware
// AND-s into every find". `plugin-sharing`'s `buildReadFilter` returns `null`
// for every model except `private`, so:
//
//   - `public_read` / `public_read_write` → sharing imposes nothing on reads;
//     an RLS policy NARROWS an open baseline, the direction AND expresses.
//   - `private` → sharing has ALREADY withheld the row, and an AND term can
//     only remove rows, never add one back. An RLS "widener" there lints
//     clean, passes every gate and grants nothing — a silent failure at the
//     security boundary.
//
// These legs pin the split. The failure they exist to catch is a REGRESSION TO
// ADVICE THAT CANNOT WORK, which is invisible to every other gate: the hint is
// prose, so nothing else in CI reads a word of it.
describe('SHARING_RULE_RUNTIME_VARIABLE_CONDITION — the hint qualifies its RLS remedy by sharing model', () => {
  const hintOf = (): string => {
    const findings = validateSharingRuleEnforceability(
      ruleWith("record.visibility == 'manager' && record.owner_id == current_user.id"),
    );
    expect(findings).toHaveLength(1);
    expect(findings[0].rule).toBe(SHARING_RULE_RUNTIME_VARIABLE_CONDITION);
    return findings[0].hint;
  };

  it('keeps the WHY verbatim — the most useful part of the diagnostic', () => {
    // Byte-exact. This sentence explains why the condition is refused at all,
    // and it was correct before this card and after it.
    expect(hintOf()).toContain(
      'A criteria sharing rule is MATERIALISED: the seeder compiles ONE static `criteria_json` per ' +
      'rule and the evaluator writes `sys_record_share` rows from it, so there is no "current user" ' +
      'for the condition to read.',
    );
  });

  it('never offers RLS unqualified — the sentence naming `using` names the models it holds for', () => {
    // The load-bearing leg. `rowLevelSecurity[].using` may still be
    // recommended, but only inside a sentence that says WHERE it works; the
    // shipped defect was exactly this recommendation with no model attached.
    const sentences = hintOf().split(/(?<=\.)\s+/);
    const rlsSentences = sentences.filter((s) => s.includes('rowLevelSecurity[].using'));
    expect(rlsSentences.length).toBeGreaterThan(0);
    rlsSentences.forEach((s) => {
      expect(s).toMatch(/public_read/);
    });
  });

  it('states the `private` case: AND-composed layers mean RLS cannot widen', () => {
    const hint = hintOf();
    expect(hint).toMatch(/AND-composed/);
    expect(hint).toMatch(/can only REMOVE rows/);
    // The consequence an author must be told, because it is silent.
    expect(hint).toMatch(/lints clean/);
    expect(hint).toMatch(/grants nothing/);
  });

  it('names the doors that DO widen a private object, and what they key on', () => {
    const hint = hintOf();
    // Widen by OWNER (ADR-0057 D1 depth) …
    expect(hint).toMatch(/readScope/);
    expect(hint).toMatch(/owner_id IN/);
    // … or by an explicit share row, which only a criteria rule writes.
    expect(hint).toMatch(/sys_record_share/);
    // And the property that makes both unusable as a per-record predicate.
    expect(hint).toMatch(/never on a property of the record/);
  });

  it('mentions `position` only as an over-broad-grant WARNING, never as the remedy', () => {
    // The neighbouring temptation is worse than doing nothing: `position`
    // shares every matched row with every holder of that position tenant-wide.
    const hint = hintOf();
    expect(hint).toMatch(/position/);
    expect(hint).toMatch(/over-broad grant/);
    expect(hint).toMatch(/EVERY holder/);
  });

  it('names the open capability gap rather than inventing a mechanism', () => {
    expect(hintOf()).toMatch(/#14103/);
  });
});

// The vocabulary leg. Without it the hint and its expectations above move
// together under a rename and nothing goes red — the failure mode the doctor
// tenancy-hint pin was written to close. Every model and depth the hint names
// is checked against the SPEC-owned enum that declares it.
describe('the hint names REAL sharing-model and depth vocabulary', () => {
  const hint = (): string => {
    const f = validateSharingRuleEnforceability(ruleWith('record.owner_id == current_user.id'));
    return f[0].hint;
  };

  const MODELS_NAMED_BY_THE_HINT = ['private', 'public_read', 'public_read_write'] as const;
  const DEPTHS_NAMED_BY_THE_HINT = ['own', 'own_and_reports', 'unit', 'unit_and_below', 'org'] as const;

  it('every sharing model it names is an `OWDModel` value the spec still declares', () => {
    const declared = new Set<string>(OWDModel.options);
    MODELS_NAMED_BY_THE_HINT.forEach((m) => {
      expect(declared.has(m)).toBe(true);
      expect(hint()).toContain(`\`${m}\``);
    });
  });

  it('every depth scope it names is an `ObjectAccessScope` value the spec still declares', () => {
    const declared = new Set<string>(ObjectAccessScopeSchema.options);
    DEPTHS_NAMED_BY_THE_HINT.forEach((d) => {
      expect(declared.has(d)).toBe(true);
      expect(hint()).toContain(`\`${d}\``);
    });
  });

  it('`position` is a real `ShareRecipientType` — the warning is about a live trap', () => {
    expect(new Set<string>(ShareRecipientType.options).has('position')).toBe(true);
  });
});
