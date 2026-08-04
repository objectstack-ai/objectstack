// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #4698 — "declared but never read", made decidable for ONE surface.
 *
 * The issue behind this file reported three shapes that pass `os validate`,
 * `os lint`, `tsc` and a full test suite while the runtime never reads them.
 * The useful invariant it names is the ledger discipline's: **a key that
 * nothing reads should not validate clean.** The hard part is not the
 * sentiment, it is the PREDICATE — "is this key read?" is only a lint question
 * when the answer is computable from the authored metadata alone. Most of the
 * time it is not: a repo-wide grep for a reader is famously not evidence of
 * absence (#4604), and a consumer can live in another package, another repo, or
 * a plugin nobody has installed yet (#4914).
 *
 * A sharing rule's `condition` is the case where the predicate is EXACT, and
 * that is the whole reason this rule exists and its neighbours are deferred:
 *
 *   The one runtime consumer of a stack-declared `sharingRules[].condition` is
 *   `bootstrapDeclaredSharingRules` (plugin-sharing), and the ONLY thing it
 *   does with the key is hand it to `compileCelToFilter(condition, { variables:
 *   {} })`. A condition that does not lower is not degraded, not partially
 *   applied and not deferred — the rule is SKIPPED (ADR-0049: never seeded as a
 *   permissive match-all), so it never reaches `sys_sharing_rule` and grants
 *   nothing at all. The only trace is one WARN line at boot.
 *
 * So this rule does not model the consumer, guess at it, or grep for it. It
 * calls the consumer's own decision procedure, from the same package
 * (`@objectstack/formula`), on the same input, with the same options. The
 * verdict is bit-identical to the seeder's by construction — there is no
 * heuristic to drift and no false positive that is not also a real skip.
 *
 * ## Why `error`
 *
 * `SharingRuleSchema`'s own docblock makes the claim this rule enforces: "The
 * whole authorable surface is enforced — nothing here validates and then
 * silently does nothing (ADR-0078)." Until now that sentence held for every
 * part of the shape EXCEPT the one field carrying the author's intent. There is
 * no reading under which an unlowerable condition does what it says: the grant
 * does not exist. Per the severity bar `lint-flow-patterns.ts` states — gate
 * when no reading of the metadata behaves as written — that is an `error`, not
 * a warning. It fails closed (the recipient under-sees rather than over-sees),
 * which is why it was survivable, not why it is acceptable.
 *
 * Measured before shipping: every sharing-rule condition and RLS predicate
 * declared anywhere in this repo (examples, platform permission sets) lowers
 * cleanly, so the gate turns nothing red that works today.
 *
 * ## The two ids, and why not one
 *
 * `compileCelToFilter` fails for three reasons; two of them are authoring
 * mistakes with DIFFERENT fixes, so they get different ids rather than one id
 * with a branchy message (allowlists and `--json` consumers key on the id):
 *
 *  - `unsupported` → {@link SHARING_RULE_UNLOWERABLE_CONDITION}. The shape is
 *    outside the pushdown subset: a function call (`has(...)`, `size(...)`),
 *    arithmetic, a ternary, or a cross-object path (`record.account.region`).
 *    This is the issue's measured instance — an author following the guidance
 *    that is correct for object VALIDATIONS (where `has()` is interpreted, not
 *    lowered) writes silently inert security metadata.
 *  - `unresolved-variable` → {@link SHARING_RULE_RUNTIME_VARIABLE_CONDITION}.
 *    The condition reads `current_user.*`. Criteria sharing rules are
 *    MATERIALIZED — the seeder compiles one static `criteria_json` per rule and
 *    the evaluator writes `sys_record_share` grants from it — so there is no
 *    "current user" at compile time and the compiler correctly refuses. The fix
 *    is a different mechanism (RLS / an ownership-shaped grant), not a
 *    different spelling, which is exactly why it earns its own id.
 *  - `parse-error` → deliberately NOT reported here. CEL syntax is
 *    `validateStackExpressions`' surface and it already gates this same field
 *    (`stack.sharingRules[].condition`). Reporting it twice, in two
 *    vocabularies, would make the second report noise — and the first one is
 *    the better message, because it is written about syntax.
 *
 * ## What this rule deliberately does NOT do
 *
 *  - **It does not re-implement `isMatchAllCriteria`.** The seeder's second
 *    guard (skip a condition that lowers to a filter constraining nothing)
 *    lives in `plugin-sharing`, and `@objectstack/lint` never depends on a
 *    runtime. Copying it here would fork the one definition of "this predicate
 *    constrains nothing" that `rule-criteria.ts` exists to be. It is also
 *    unreachable from this door: every AST the compiler lowers yields a
 *    concrete field predicate, so a lowering CEL condition cannot produce a
 *    match-all filter. `matchAllIsUnreachable` in the tests pins that claim
 *    against the compiler rather than asserting it in prose.
 *  - **It does not judge RLS `using` / `check`** — its sibling rule
 *    `validate-rls-predicate-enforceability.ts` does (#4983). Same class, same
 *    compiler, but a different decision procedure: RLS asks
 *    `isSupportedRlsExpression`, which first bridges the legacy SQL-ish subset
 *    through `sqlPredicateToCel`. Both used to live in `plugin-security`, so
 *    judging RLS from here meant importing a runtime (forbidden) or copying the
 *    bridge (forking the predicate — the thing this file's opening paragraph
 *    refuses to do). #4983 hoisted both into `@objectstack/formula` and then
 *    wrote the gate against the hoisted predicate, which is why the split is
 *    two rules over two surfaces and still exactly two definitions.
 *  - **It does not look at flow / hook `condition`s.** Those are INTERPRETED by
 *    the CEL engine, not lowered to a filter, so the whole language is in scope
 *    there and non-pushdownability means nothing. Reusing this predicate on
 *    them would reject working metadata — the false-positive direction that is
 *    worse than the gap.
 */

import { compileCelToFilter } from '@objectstack/formula';

/** A `condition` outside the pushdown subset — the rule is never seeded. */
export const SHARING_RULE_UNLOWERABLE_CONDITION = 'sharing-rule-unlowerable-condition';
/** A `condition` reading `current_user.*` — unresolvable when grants are materialized. */
export const SHARING_RULE_RUNTIME_VARIABLE_CONDITION = 'sharing-rule-runtime-variable-condition';

export type SharingRuleEnforceabilitySeverity = 'error' | 'warning';

export interface SharingRuleEnforceabilityFinding {
  severity: SharingRuleEnforceabilitySeverity;
  /** Diagnostic rule id (`sharing-rule-*`). */
  rule: string;
  /** Human-readable location, e.g. `sharing rule "high_value_opps" on object "opportunity"`. */
  where: string;
  /** Config path, e.g. `sharingRules[2].condition`. */
  path: string;
  /** What is wrong. */
  message: string;
  /** How to fix it. */
  hint: string;
}

type AnyRec = Record<string, unknown>;

/** Coerce a collection (array or name-keyed map) to an array of records. */
function asArray(v: unknown): AnyRec[] {
  if (Array.isArray(v)) return v as AnyRec[];
  if (v && typeof v === 'object') {
    return Object.entries(v as AnyRec).map(([name, def]) => ({ name, ...(def as AnyRec) }));
  }
  return [];
}

function str(v: unknown): string {
  return typeof v === 'string' ? v : '';
}

/**
 * The `condition` value in the shape the compiler takes.
 *
 * Both authoring tiers reach this rule: `os lint` runs it on the NORMALIZED
 * stack, where a bare string is still a bare string, while `os validate` /
 * `os build` run it after `ExpressionInputSchema` has wrapped that string into
 * `{ dialect: 'cel', source }`. `compileCelToFilter` accepts either, so the
 * verdict does not depend on which tier asked — the property the wiring guard's
 * `input: 'parsed'` entries all have to satisfy.
 *
 * Anything else (a number, an envelope with no `source`) is returned as `null`:
 * the shape is Zod's to reject, and inventing a second complaint about it here
 * would just be the double-report this file avoids for syntax.
 */
function toCompilerInput(condition: unknown): string | { source?: string } | null {
  if (typeof condition === 'string') return condition.trim() ? condition : null;
  if (condition && typeof condition === 'object') {
    const source = (condition as AnyRec).source;
    if (typeof source === 'string' && source.trim()) return { source };
  }
  return null;
}

/** What the author sees quoted back at them. */
function sourceOf(condition: unknown): string {
  const input = toCompilerInput(condition);
  if (typeof input === 'string') return input;
  return str(input?.source);
}

const PUSHDOWN_SUBSET =
  'The lowerable subset is: `==` `!=` `>` `<` `>=` `<=`, `in`, `&&` `||` `!`, `== null` / `!= null`, ' +
  'and the string methods `startsWith` / `endsWith` / `contains` — over SINGLE-column `record.<field>` ' +
  'paths (ADR-0058 D2).';

/**
 * Gate stack-declared sharing rules on the ONE thing their runtime consumer
 * does with `condition`: lower it to a `criteria_json` filter.
 *
 * Pure `(stack) => Finding[]`; tolerates the normalized and the parsed tier.
 */
export function validateSharingRuleEnforceability(stack: unknown): SharingRuleEnforceabilityFinding[] {
  const findings: SharingRuleEnforceabilityFinding[] = [];
  const cfg = (stack ?? {}) as AnyRec;

  asArray(cfg.sharingRules).forEach((rule, index) => {
    const input = toCompilerInput(rule.condition);
    if (input === null) return;

    // The seeder's exact call: `compileCelToFilter(r.condition, { variables: {} })`
    // in `bootstrap-declared-sharing-rules.ts`. Same function, same options —
    // so `ok === false` here means "this rule will be skipped at boot", not
    // "this rule looks suspicious".
    const result = compileCelToFilter(input, { variables: {} });
    if (result.ok) return;
    // Syntax belongs to `validateStackExpressions`, which already gates this
    // same field with a message written about syntax.
    if (result.reason === 'parse-error') return;

    const name = str(rule.name) || String(index);
    const object = str(rule.object);
    const where = `sharing rule "${name}"${object ? ` on object "${object}"` : ''}`;
    const path = `sharingRules[${index}].condition`;
    const source = sourceOf(rule.condition);
    const skipped =
      'so `bootstrapDeclaredSharingRules` SKIPS the rule at boot: it is never written to ' +
      '`sys_sharing_rule`, no `sys_record_share` grant is ever materialised, and the only signal is one ' +
      'WARN line in the boot log. The rule is declared and grants nothing (ADR-0049: an unlowerable ' +
      'condition is never seeded as a permissive match-all).';

    if (result.reason === 'unresolved-variable') {
      findings.push({
        severity: 'error',
        rule: SHARING_RULE_RUNTIME_VARIABLE_CONDITION,
        where,
        path,
        message:
          `Sharing-rule condition \`${source}\` reads a runtime variable (${result.detail}), ` + skipped,
        hint:
          'A criteria sharing rule is MATERIALISED: the seeder compiles ONE static `criteria_json` per ' +
          'rule and the evaluator writes `sys_record_share` rows from it, so there is no "current user" ' +
          'for the condition to read. Express per-user access with the mechanism that runs per request ' +
          'instead — an RLS policy on a permission set (`rowLevelSecurity[].using`, where ' +
          '`current_user.*` IS resolved), or the record-ownership path. Keep this rule for the part of ' +
          'the predicate that is a property of the RECORD (e.g. `record.stage == \'closed_won\'`) and ' +
          'name the audience through `sharedWith`.',
      });
      return;
    }

    findings.push({
      severity: 'error',
      rule: SHARING_RULE_UNLOWERABLE_CONDITION,
      where,
      path,
      message:
        `Sharing-rule condition \`${source}\` is outside the pushdown subset the runtime can compile ` +
        `(${result.detail}), ` + skipped,
      hint:
        'Rewrite the predicate inside the lowerable subset. ' + PUSHDOWN_SUBSET + ' Two traps in ' +
        'particular: (1) `has(record.x)` is correct in an object VALIDATION rule, which is INTERPRETED, ' +
        'and wrong here, where the condition is COMPILED — write the null test as `record.x != null`; ' +
        '(2) a related-record path (`record.account.region`) is a join, which the compiler refuses by ' +
        'design (ADR-0055) — denormalise the value onto this object (a formula/rollup field) and test ' +
        'that column, or share the related object instead.',
    });
  });

  return findings;
}
