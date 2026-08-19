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
 * ## The second consumer: the rule's ANCHOR object (#9698)
 *
 * `condition` is not the only field of a declared sharing rule with an exact
 * predicate. `object` has one too, and a different consumer:
 * `SharingRuleService.reconcile` hands each resolved row to
 * `SharingService.grant`, whose `assertNotInertGrant` pre-flight (ADR-0111 D7)
 * REFUSES a grant whose `sys_record_share` row no gate could ever consult. Two
 * of `inertGrantReason`'s arms are decidable before anything boots — the
 * anchor object's effective sharing model being `public`, and its being a
 * `controlled_by_parent` detail — and {@link anchorFindings} reports exactly
 * those two, mirroring the runtime's own function rather than modelling it.
 *
 * The two halves of this file are therefore the two halves of one question,
 * "will this declared grant ever exist?", answered over the two fields that
 * can decide it. They are reported independently: an inert anchor and an
 * unlowerable condition are different defects on different fields with
 * different fixes, and fixing one does not reveal the other any earlier.
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
 * The anchor arm's severity is the same verdict on a stronger runtime fact —
 * `assertNotInertGrant` does not skip and log, it THROWS — but its blast
 * radius was NOT zero, and that is recorded rather than smoothed over.
 * Measured across every sharing rule declared in this repo at the time it
 * landed: 5 declarations, of which 3 fire, ALL of them in `examples/app-crm`,
 * whose three rules are anchored on `public_read_write` objects and have
 * therefore been failing their boot backfill on every boot of that app. Those
 * three are repaired in the same change (see the changeset). The remaining 2
 * — `examples/app-showcase`'s, both on `private` objects — stay silent, which
 * is the direction that had to be proven and not merely hoped for.
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
/** The anchor object's OWD is already the widest — sharing has nothing to widen. */
export const SHARING_RULE_OBJECT_NOT_SHAREABLE = 'sharing-rule-object-not-shareable';
/** The anchor object is a master-detail DETAIL — its shares belong to its master. */
export const SHARING_RULE_OBJECT_CONTROLLED_BY_PARENT = 'sharing-rule-object-controlled-by-parent';

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
 * The object's effective sharing model, as `SharingService` computes it.
 *
 * A point-for-point mirror of `effectiveSharingModel` in
 * `packages/plugins/plugin-sharing/src/sharing-service.ts` — same four
 * recognised values, same `null` fall-through, same fail-CLOSED default. It is
 * copied rather than imported for the reason stated at the head of this file:
 * `@objectstack/lint` never depends on a runtime. The same discipline (and the
 * same justification) already governs `resolveCbpRelation` in
 * `validate-security-posture.ts`, which mirrors plugin-security's copy.
 *
 * ## Why the mirror cannot drift into a false positive
 *
 * Every input this function reads is AUTHORED metadata, and none of it is
 * resolved, defaulted or injected between the authoring tier and the runtime:
 *
 *  - `sharingModel` is `z.enum([...]).optional()` on `ObjectSchema` with **no
 *    `.default()`**, so "authored `private`" and "absent" stay distinguishable
 *    after parsing. (This is exactly the distinction a `.default()` erases —
 *    the trap that made a neighbouring one-line tightening reject 96
 *    declarations instead of 1.)
 *  - The runtime's `schema?.security?.sharingModel` fallback is unreachable
 *    for any stack an author can ship: `ObjectSchema` is strict and declares no
 *    `security` key, so a stack nesting the OWD there is REFUSED, not stripped.
 *    `owdOf` in `validate-security-posture.ts` records the same finding.
 *  - `isSystem` / the `sys_` name prefix are authored too. `isSystem` carries
 *    `.default(false)`, which is why this reads `=== true` exactly as the
 *    runtime does — the default and the explicit `false` are the same verdict.
 *
 * So the linter and the service answer from the same bytes. What this function
 * deliberately does NOT model is the part of the runtime verdict that is not in
 * the metadata — see the `## What this rule deliberately does NOT do` section.
 */
function effectiveSharingModelOf(obj: AnyRec): 'private' | 'read' | 'public' {
  const m = obj.sharingModel;
  if (m === 'private') return 'private';
  if (m === 'public_read') return 'read';
  if (m === 'public_read_write' || m === 'controlled_by_parent') return 'public';
  if (m == null) {
    const isSystem = obj.isSystem === true || str(obj.name).startsWith('sys_');
    return isSystem ? 'public' : 'private';
  }
  // Fails CLOSED, like the runtime: an unrecognised value (a retired ADR-0090
  // D4 alias such as `read`/`full`) resolves to `private`, which means sharing
  // IS enforced there and the rule is live. Reporting it would be a false
  // positive — and the value itself is already `security-owd-alias`' finding.
  return 'private';
}

/** The master a `controlled_by_parent` detail derives its access from, if named. */
function masterOf(obj: AnyRec): string | undefined {
  for (const f of asArray(obj.fields)) {
    if (f.type === 'master_detail') {
      const ref = f.reference;
      if (typeof ref === 'string' && ref) return ref;
    }
  }
  return undefined;
}

/**
 * The rule's ANCHOR arm: would a `sys_record_share` row on `rule.object` ever
 * be consulted?
 *
 * This is the second runtime consumer of a declared sharing rule, and it
 * refuses for reasons the `condition` arm above cannot see.
 * `SharingRuleService.reconcile` calls `SharingService.grant` per resolved
 * row; `grant` runs `assertNotInertGrant`, which THROWS
 * `SHARING_NOT_ENABLED` when `inertGrantReason` names one (ADR-0111 D7). Two
 * of that function's arms are decidable from authored metadata alone, and they
 * are the two this arm reports.
 *
 * ## Why the boot WARN is not the diagnostic
 *
 * The refusal surfaces as one WARN per rule inside the boot diagnostics block
 * — but only for a rule whose criteria matched at least one seeded row.
 * Measured on the stock showcase: THREE rules were in this state and only TWO
 * warned. The third's compound condition matched nothing, so `reconcile` built
 * an empty desired set, never reached `grant`, and never threw. It was exactly
 * as dead as the other two and produced no diagnostic at all. The WARN is a
 * function of the DATA; the defect is a property of the DECLARATION, which is
 * why it belongs here.
 *
 * ## Two ids, because the two arms are not the same failure
 *
 * Measured against a real `SharingService` over an in-memory engine (grant +
 * `buildReadFilter`, all three postures), the arms differ in the direction
 * that decides the wording:
 *
 *  - **`public` OWD** → grant refused, `buildReadFilter` returns `null`, zero
 *    share rows. Nothing is filtered, so the intended audience already reads
 *    every row — and so does everyone else. Nobody UNDER-sees; the harm is
 *    that the declaration advertises a restriction that does not exist.
 *  - **`controlled_by_parent`** → grant refused with a DIFFERENT reason
 *    ("share the master record instead"), and the detail's visibility comes
 *    from its master's path (ADR-0055), not from this rule. Here the author
 *    genuinely believes a grant exists when it does not, and the intended
 *    recipient may see nothing.
 *
 * Different cause, different fix, different thing to tell the author — so two
 * ids, the same reasoning that split the two `condition` ids above.
 *
 * ## What this arm deliberately does NOT do
 *
 *  - **It does not judge the `owner_id` arm.** `inertGrantReason` also refuses
 *    an object with no owner field, but `owner_id` is INJECTED by the schema
 *    registry (`packages/objectql/src/registry.ts`) — absent from authored
 *    metadata by design, present on the runtime schema. Asserting it here
 *    would fail every object that correctly does not declare it by hand. The
 *    same exclusion, for the same reason, is written into the showcase's own
 *    guard.
 *  - **It does not judge the `bypassObjects` or federated-anchor arms.** The
 *    bypass set is plugin CONFIGURATION (`SharingPluginOptions.bypassObjects`
 *    plus a built-in list), not stack metadata, so it is not in this door's
 *    input at all; the federated phantom-anchor arm is a provenance test over
 *    an injected column, i.e. the `owner_id` exclusion one layer in.
 *  - **It does not report an unresolvable `rule.object`.** A name this stack
 *    does not declare is absence of EVIDENCE, not evidence of inertness — the
 *    object may be contributed by a plugin or an upstream stack. The runtime
 *    draws the same line: `assertSharingEnforced` treats existence as a
 *    SEPARATE verdict from inertness, and deliberately does not hard-fail the
 *    rule evaluator's system-context pass on an unregistered name.
 */
function anchorFindings(
  rule: AnyRec,
  index: number,
  objectsByName: Map<string, AnyRec>,
): SharingRuleEnforceabilityFinding[] {
  const object = str(rule.object);
  if (!object) return [];
  const target = objectsByName.get(object);
  if (!target) return [];

  const name = str(rule.name) || String(index);
  const where = `sharing rule "${name}" on object "${object}"`;
  const path = `sharingRules[${index}].object`;
  const owd = target.sharingModel;

  // Mirrors `inertGrantReason`'s own order: the `controlled_by_parent` test
  // runs FIRST and returns its own reason, before the `effectiveSharingModel`
  // test that also maps that value to `public`. Same order here, so the author
  // gets the specific fix-it rather than the generic one.
  if (owd === 'controlled_by_parent') {
    const master = masterOf(target);
    return [{
      severity: 'error',
      rule: SHARING_RULE_OBJECT_CONTROLLED_BY_PARENT,
      where,
      path,
      message:
        `Sharing rule "${name}" is anchored on object "${object}", which declares ` +
        `sharingModel 'controlled_by_parent'. A detail record has no record-level access of its own — ` +
        `its visibility is DERIVED from its master (ADR-0055), so it holds no shares to widen. ` +
        `\`SharingService.assertNotInertGrant\` refuses the grant with ` +
        `SHARING_NOT_ENABLED ("'${object}' is controlled by its parent (master-detail); share the ` +
        `master record instead"), so the rule's boot backfill fails, no \`sys_record_share\` row is ` +
        `ever written, and the recipients this rule names get whatever the MASTER grants them — ` +
        `which may be nothing. The grant is declared and does not exist.`,
      hint:
        `Move the rule onto the MASTER object` +
        (master ? ` — "${object}" derives from "${master}" through its master_detail field, so share ` +
          `"${master}" and the detail rows follow` : `, and share that instead; the detail rows follow`) +
        `. If "${object}" is meant to carry a record-level baseline of its own, that is a different ` +
        `decision: change its sharingModel to 'private' (owner + shares) or 'public_read', and this ` +
        `rule becomes enforceable where it stands.`,
    }];
  }

  if (effectiveSharingModelOf(target) !== 'public') return [];

  // The remaining way to reach `public`: an explicit `public_read_write`, or an
  // absent OWD on a SYSTEM object (ADR-0090 D1 keeps the pre-existing public
  // fall-through for `isSystem` / `sys_*`; a CUSTOM object with no OWD fails
  // closed to `private`, so it is NOT reported here).
  const declared =
    owd === 'public_read_write'
      ? `declares sharingModel 'public_read_write'`
      : `declares no sharingModel and is a system object (\`isSystem: true\` or a \`sys_\` name), ` +
        `which ADR-0090 D1 resolves to public`;

  return [{
    severity: 'error',
    rule: SHARING_RULE_OBJECT_NOT_SHAREABLE,
    where,
    path,
    message:
      `Sharing rule "${name}" is anchored on object "${object}", which ${declared}. Its effective ` +
      `sharing model is therefore \`public\`, and sharing only ever WIDENS an OWD baseline — on the ` +
      `widest baseline there is nothing left to widen. \`SharingService.assertNotInertGrant\` refuses ` +
      `the grant with SHARING_NOT_ENABLED ("'${object}' is not under record-sharing enforcement"), so ` +
      `the rule's boot backfill fails and no \`sys_record_share\` row is ever written. Measured: ` +
      `\`buildReadFilter\` returns \`null\` for this object, i.e. NO record-level filter at all — every ` +
      `principal already reads every row, so this rule advertises a restriction that does not exist.`,
    hint:
      `Decide which half is wrong. If the ACCESS is right — everyone should read and write these ` +
      `records — the rule is dead metadata: delete it (ADR-0049 enforce-or-remove). If the RULE is ` +
      `right — only the named audience should reach these records — then "${object}"'s OWD is the ` +
      `defect: set sharingModel: 'private' (owner + shares) or 'public_read', and this rule starts ` +
      `enforcing. Do NOT re-home the rule onto another public object; that moves the inertness ` +
      `instead of removing it.`,
  }];
}

/**
 * Gate stack-declared sharing rules on the two things their runtime consumers
 * do with them: lower the `condition` to a `criteria_json` filter, and write a
 * `sys_record_share` row on the `object` the rule is anchored to.
 *
 * Pure `(stack) => Finding[]`; tolerates the normalized and the parsed tier.
 */
export function validateSharingRuleEnforceability(stack: unknown): SharingRuleEnforceabilityFinding[] {
  const findings: SharingRuleEnforceabilityFinding[] = [];
  const cfg = (stack ?? {}) as AnyRec;

  const objectsByName = new Map<string, AnyRec>();
  for (const obj of asArray(cfg.objects)) {
    const name = str(obj.name);
    if (name) objectsByName.set(name, obj);
  }

  asArray(cfg.sharingRules).forEach((rule, index) => {
    anchorFindings(rule, index, objectsByName).forEach((f) => findings.push(f));

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
