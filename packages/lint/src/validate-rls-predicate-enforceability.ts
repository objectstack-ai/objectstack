// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #4983 — ADR-0056 D4's RLS authoring gate, finally wired.
 *
 * `isSupportedRlsExpression`'s TSDoc has always said why it exists: "exposed so
 * an authoring-time gate (`objectstack compile`) can REJECT a predicate the
 * runtime would silently drop … A `false` here means 'this predicate will never
 * enforce'." Until this file it had no non-test consumer anywhere in the repo —
 * the function written to fix declared-but-never-read was itself declared and
 * never read. This rule is that consumer.
 *
 * ## The consequence being gated (measured, not inferred)
 *
 * `permissions[].rowLevelSecurity[].using` / `.check` is an authorable surface
 * (`PermissionSetSchema.rowLevelSecurity`). Follow one unlowerable predicate
 * through `plugin-security`:
 *
 *  1. `RLSCompiler.compileExpression` bridges the legacy SQL-ish subset and
 *     hands the result to `compileCelToFilter`, which returns `!ok`, so the
 *     method returns `null` and the policy contributes NO filter.
 *  2. `compileFilter` notices (`!isSupportedRlsExpression(predicate)`) and logs
 *     ONE `warn`: "policy '…' … has an uncompilable predicate … and was DROPPED
 *     (no enforcement)". That line, at request time, is the entire signal.
 *  3. **Read path (`using`).** If it was the only applicable policy for that
 *     object+operation, `compileFilter` returns `RLS_DENY_FILTER` —
 *     `{ id: '__rls_deny__:00000000-0000-0000-0000-000000000000' }` — which the
 *     caller AND's onto the where clause. Every `select` / `update` / `delete`
 *     on that object then matches zero rows. If other policies also applied,
 *     this one is simply dropped out of the OR and the access it was written to
 *     grant does not exist.
 *  4. **Write path (`check`, ADR-0058 D4).** `computeWriteCheckFilter` collects
 *     only the policies that declare a `check`; the same drop makes the
 *     post-image predicate the deny sentinel, `matchesFilterCondition` fails,
 *     and the write raises `PermissionDeniedError`.
 *
 * So this is not a hole — the runtime fails CLOSED, which is why it has been
 * survivable. It is a policy that reads as an authorization and behaves as a
 * blanket refusal, with nothing at authoring time pointing at the line that
 * caused it: `os validate`, `os build` and `os lint` are all green today.
 *
 * ## Why the verdict cannot drift from the runtime's
 *
 * Same construction as `validate-sharing-rule-enforceability.ts` (#4698/#4985),
 * and for the same reason: the rule does not model the consumer, guess at it,
 * or grep for it. It calls the consumer's OWN decision procedure —
 * `isSupportedRlsExpression` — on the same input. `compileFilter` calls that
 * exact function to decide whether a dropped policy is an authoring mistake
 * (warn) or the intentional "context variable absent" path (silent), so
 * `false` here and "DROPPED (no enforcement)" there are the same boolean.
 *
 * That was impossible until #4983. The predicate first bridges the legacy
 * SQL-ish subset through `sqlPredicateToCel` (`=` → `==`, `IN` → `in`), and
 * BOTH functions lived in `plugin-security` — a runtime `@objectstack/lint` may
 * never import ("Depends on @objectstack/spec; never on a runtime"). The only
 * other door was copying the bridge, which is the worst option available: its
 * boundary conditions (quoted literals are never rewritten; canonical CEL
 * passes through unchanged) ARE this rule's red/green line, so a fork drifting
 * by one character makes the linter reject policies the runtime executes
 * correctly — the false-positive direction, which is worse than the gap. #4983
 * hoisted both into `@objectstack/formula`, verbatim; this rule and the
 * RLSCompiler now read one definition.
 *
 * ## Why `error`
 *
 * The bar `lint-flow-patterns.ts` states: gate when no reading of the metadata
 * behaves as written. There is none here. The author wrote a row filter; the
 * runtime has no filter to apply and answers "no rows" (or "denied") to
 * everything the policy governs. Measured before shipping: every `using` /
 * `check` declared anywhere in this repo — `plugin-security`'s
 * `default-permission-sets.ts` seeds, the examples, the dogfood fixtures — is
 * supported, so the gate turns nothing red that works today. That corpus is
 * pinned in the tests rather than asserted here.
 *
 * ## The three ids, and why not one
 *
 * The consequence is identical, the FIX is not, and allowlists / `--json`
 * consumers key on the id:
 *
 *  - {@link RLS_PREDICATE_UNENFORCEABLE} — the predicate parses as CEL and is
 *    outside the pushdown subset: a function call (`size(...)`, `has(...)`),
 *    arithmetic, a ternary, a cross-object path (`record.account.region`). Fix
 *    = rewrite it inside the subset, or denormalise the value onto this object.
 *  - {@link RLS_PREDICATE_UNPARSEABLE} — it does not parse as CEL even after
 *    the legacy SQL bridge: SQL `AND` / `OR` / `LIKE`, a subquery, a stray
 *    operator. Fix = write CEL (`&&`, `||`), which is a different edit.
 *  - {@link RLS_PREDICATE_OVER_BUDGET} — it is syntactically perfect CEL that
 *    overruns a {@link DEFAULT_LIMITS} parse bound (`maxAstNodes` 256,
 *    `maxDepth` 32, …). Fix = shrink or split the predicate; there is no
 *    dialect error to correct.
 *
 * ## Why the third id (#6778), and why it is not a behaviour change
 *
 * The pushdown compiler collapses a bounds overrun into `reason: 'parse-error'`
 * **on purpose** — `cel-to-filter.ts` says so at the call site: it is "the
 * reason every consumer of this compiler already routes to its deny path", and
 * a fourth reason would be a new branch none of them have. That is right for
 * the RUNTIME, whose only decision is deny-or-not. It is wrong for an AUTHORING
 * diagnostic, whose whole job is to name the edit: until #6778 an 80-term
 * conjunction — valid, lowerable CEL that is merely too big — was reported
 * under `rls-predicate-unparseable`, whose hint explains SQL-vs-CEL syntax
 * confusion. The verdict was correct and the sign-post pointed at the wrong
 * repair.
 *
 * So the split is made HERE, in the explanation, and never in the verdict. The
 * red/green boundary is still exactly `isSupportedRlsExpression` — untouched —
 * and this rule reaches for {@link parseCelToAstWithReason}, the same
 * reason-carrying entrance `cel-to-filter.ts` itself parses through, only to
 * ask which KIND of refusal the consumer just produced. Identical inputs are
 * refused before and after; one class of them is told the truth about why.
 *
 * It is deliberately mode-agnostic with respect to `cel-pushdown-limits.ts`'s
 * dated GA switch, and does not read it. During 17.0.0-rc.x an over-limit
 * predicate is admitted by the grace window, so `isSupportedRlsExpression` is
 * `true` and this rule never fires at all (measured: zero findings). At the v17
 * GA flip the same predicate is refused and lands here. The one rc-grace case
 * that DOES reach this branch — a bounds fault whose unbounded reparse also
 * fails, so the grace window has no AST to admit — is a genuine bounds refusal
 * and is correctly reported as one. Re-deriving the switch here instead would
 * be modelling the consumer, which this file's whole construction refuses.
 *
 * `overrun.measured` is `null` on this path and that is by the producer's
 * design, not an omission: `parseCelToAstWithReason` only measures when the
 * caller passes `admitOverLimit`, "because measuring means re-parsing a source
 * we have just decided is too big". That option is documented as the grace
 * window's alone and as disappearing at GA, so a lint rule must not reach for
 * it to decorate a message. The bound and its value — which is what "shrink it
 * to fit" needs — are always present.
 *
 * Unlike the sharing-rule gate, syntax is reported HERE rather than deferred to
 * `validateStackExpressions`: that rule does not walk `rowLevelSecurity` at all,
 * so deferring would defer to nobody. It also could not judge this field
 * correctly if it did — `owner_id = current_user.id` is a CEL syntax error and a
 * perfectly working RLS predicate, because the bridge rewrites it first.
 *
 * ## Scope
 *
 * `permissions[].rowLevelSecurity[]` only. `rowLevelSecurity` is declared on
 * `PermissionSetSchema` and nowhere else — `ObjectSchema` has no such key — and
 * `permissions` is the one stack key `StackSchema` declares for permission sets.
 * Walking `objects[].rowLevelSecurity` or `permissionSets` "just in case" would
 * add a branch that no spec-valid stack can ever reach: exactly the #4984 defect,
 * where a red line read rejected aliases and was therefore inert for every stack
 * the schema accepts. Alias tolerance belongs at the schema's refusal, not in a
 * consumer (Prime Directive #12).
 *
 * A policy with `enabled: false` IS judged, on purpose. `getApplicablePolicies`
 * skips it today, so the consequence described above is dormant rather than
 * live — but a switched-off policy that can never enforce is a policy that will
 * grant nothing on the day someone switches it on, and that is precisely the
 * moment nobody re-runs the linter.
 */

import {
  isPushdownableCel,
  isSupportedRlsExpression,
  parseCelToAstWithReason,
  sqlPredicateToCel,
} from '@objectstack/formula';
import type { CelBoundsOverrun } from '@objectstack/formula';

/** A predicate outside the pushdown subset — the policy enforces nothing. */
export const RLS_PREDICATE_UNENFORCEABLE = 'rls-predicate-unenforceable';
/** A predicate that does not parse as CEL even after the legacy SQL bridge. */
export const RLS_PREDICATE_UNPARSEABLE = 'rls-predicate-unparseable';
/** Valid CEL that overruns a platform parse bound (`maxAstNodes`, `maxDepth`, …). */
export const RLS_PREDICATE_OVER_BUDGET = 'rls-predicate-over-budget';

export type RlsPredicateSeverity = 'error' | 'warning';

export interface RlsPredicateFinding {
  severity: RlsPredicateSeverity;
  /** Diagnostic rule id (`rls-predicate-*`). */
  rule: string;
  /** Human-readable location, e.g. `permission set "sales" policy "own_leads"`. */
  where: string;
  /** Config path, e.g. `permissions[2].rowLevelSecurity[0].using`. */
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

const PUSHDOWN_SUBSET =
  'The lowerable subset is: `==` `!=` `>` `<` `>=` `<=`, `in`, `&&` `||` `!`, `== null` / `!= null`, ' +
  'and the string methods `startsWith` / `endsWith` / `contains` — over SINGLE-column field paths ' +
  '(ADR-0058 D2), compared against a literal or a `current_user.*` value.';

/**
 * The overrun behind a `parse-error`, or `null` when the refusal was a genuine
 * syntax fault.
 *
 * Asked of {@link parseCelToAstWithReason} — the SAME reason-carrying entrance
 * `cel-to-filter.ts` parses through — on the SAME bridged source, so `bounds`
 * here and the `bounds` that produced the consumer's refusal are one verdict on
 * one input. It is graded by error class plus structured `code`, never prose
 * (#6223), so a rephrasing upstream cannot silently re-route a diagnostic.
 *
 * Called only after {@link isSupportedRlsExpression} has already returned
 * `false` AND the reason is `parse-error`: it never widens or narrows what is
 * reported, it only decides which of two explanations a refusal gets.
 */
function boundsOverrunOf(bridged: string): CelBoundsOverrun | null {
  // No `admitOverLimit`: that option is the rc-grace window's alone (and goes
  // away with it), and buying `measured` costs an unbounded re-parse of a
  // source already known to be too big.
  const parsed = parseCelToAstWithReason(bridged);
  return !parsed.ok && parsed.kind === 'bounds' ? parsed.overrun : null;
}

/**
 * An over-budget predicate is by definition long, so the diagnostic quotes a
 * bounded prefix rather than the whole source — the same 200-char courtesy
 * `cel-to-filter.ts`'s grace WARN extends for the same reason.
 */
function quote(source: string): string {
  return source.length > 200 ? `${source.slice(0, 197)}...` : source;
}

/** What the runtime does with a predicate it cannot compile, per clause. */
function consequence(clause: 'using' | 'check'): string {
  const dropped =
    'so `RLSCompiler` DROPS the policy at request time (one WARN line — "has an uncompilable predicate ' +
    '… and was DROPPED (no enforcement)" — is the only signal, and nothing reports it at authoring time). ';
  return clause === 'using'
    ? dropped +
        'When it is the only applicable policy for that object and operation, `compileFilter` returns the ' +
        '`RLS_DENY_FILTER` sentinel instead, which is AND-ed onto the where clause: every select / update / ' +
        'delete on the object matches ZERO rows. When other policies also apply, this one just vanishes ' +
        'from the OR and grants none of the access it appears to.'
    : dropped +
        'On the ADR-0058 D4 write path that leaves the post-image `check` as the `RLS_DENY_FILTER` ' +
        'sentinel, which no record can satisfy: every insert / update the policy governs fails with ' +
        '`PermissionDeniedError`. The policy reads as a write rule and behaves as a blanket refusal.';
}

/**
 * Gate every stack-declared RLS predicate on the ONE thing the runtime does
 * with it: lower it to a FilterCondition (ADR-0056 D4).
 *
 * Pure `(stack) => Finding[]`; tolerates the normalized and the parsed tier
 * (`using` / `check` are plain `z.string()`, identical in both).
 */
export function validateRlsPredicateEnforceability(stack: unknown): RlsPredicateFinding[] {
  const findings: RlsPredicateFinding[] = [];
  const cfg = (stack ?? {}) as AnyRec;

  asArray(cfg.permissions).forEach((ps, psIndex) => {
    asArray(ps.rowLevelSecurity).forEach((policy, pIndex) => {
      for (const clause of ['using', 'check'] as const) {
        const source = str(policy[clause]);
        // Absent / blank is Zod's to judge (`using` is required on the schema);
        // inventing a second complaint about the shape here would be the
        // double-report this rule avoids for everything else.
        if (!source.trim()) continue;

        // ── The verdict. This is the consumer's own function, not a model of
        // it: `RLSCompiler.compileFilter` calls the SAME `isSupportedRlsExpression`
        // to decide whether a dropped policy warrants its WARN. There is no
        // heuristic here to drift.
        if (isSupportedRlsExpression(source)) continue;

        // ── The explanation. Re-derived only to tell the author WHICH fix they
        // need; the red/green boundary above never consults it. (Both agree by
        // construction — pinned in both directions in this rule's tests.)
        const bridged = sqlPredicateToCel(source);
        const why = isPushdownableCel(bridged);
        const detail = why.ok ? '' : why.detail;
        const parseError = !why.ok && why.reason === 'parse-error';
        // A bounds overrun and a syntax fault both arrive as `parse-error` (the
        // runtime deliberately collapses them — see this file's docblock), so
        // the two are separated here, and only here.
        const overrun = parseError ? boundsOverrunOf(bridged) : null;

        const psName = str(ps.name) || String(psIndex);
        const policyName = str(policy.name) || String(pIndex);
        const object = str(policy.object);
        const where =
          `permission set "${psName}" policy "${policyName}"` + (object ? ` on object "${object}"` : '');
        const path = `permissions[${psIndex}].rowLevelSecurity[${pIndex}].${clause}`;

        if (overrun) {
          // `limit` is null only for a bounds fault this package cannot NAME
          // (unreachable on cel-js 8.0.0). Degrade honestly rather than guess a
          // key, which would send the author to shorten the wrong axis.
          const bound = overrun.limit ?? 'an unnamed platform CEL bound';
          const budget = overrun.limitValue !== null ? ` (platform limit ${overrun.limitValue})` : '';
          const measured = overrun.measured !== null ? `, this predicate measures ${overrun.measured}` : '';
          findings.push({
            severity: 'error',
            rule: RLS_PREDICATE_OVER_BUDGET,
            where,
            path,
            message:
              `RLS ${clause} \`${quote(source)}\` is syntactically valid, lowerable CEL but overruns the ` +
              `platform parse bound ${bound}${budget}${measured} (${overrun.summary}), ` +
              consequence(clause),
            hint:
              `There is no syntax or dialect error to correct here — the predicate is well-formed CEL and ` +
              `is simply too large for ${bound}${budget}, so the fix is to make it smaller or to move the ` +
              `work off the predicate. (1) Collapse a long \`field == a || field == b || …\` chain into a ` +
              `single \`field in [a, b, …]\`, which is far fewer AST nodes (\`maxListElements\` is 64, so a ` +
              `very large set needs option 2). (2) Pre-resolve the set into a membership key the runtime ` +
              `exposes and test \`field in current_user.<key>\` (ADR-0105 D11) — one comparison whatever ` +
              `the set size. (3) Denormalise a repeated sub-expression onto this object as a ` +
              `formula/rollup field and test that single column. (4) Split a TOP-LEVEL \`||\` across ` +
              `several \`rowLevelSecurity\` policies: applicable policies are OR-ed, so that is ` +
              `equivalent — but never split a top-level \`&&\` this way, which would WIDEN access rather ` +
              `than preserve it. Logic genuinely this large is not a row filter: move it to a hook or ` +
              `action body (\`ScriptBody { language: 'js' }\`, the L2 sandboxed surface).`,
          });
          continue;
        }

        if (parseError) {
          findings.push({
            severity: 'error',
            rule: RLS_PREDICATE_UNPARSEABLE,
            where,
            path,
            message:
              `RLS ${clause} \`${source}\` does not parse as CEL even after the legacy SQL bridge ` +
              `(\`=\` → \`==\`, \`IN\` → \`in\`) has been applied (${detail}), ` + consequence(clause),
            hint:
              'Author the predicate in canonical CEL (ADR-0058 D1). The bridge covers only the historic ' +
              'SQL subset — a bare `=` and `IN` — so everything else must already be CEL: combine with ' +
              '`&&` / `||` rather than SQL `AND` / `OR`, negate with `!`, and use `startsWith` / ' +
              '`endsWith` / `contains` rather than `LIKE`. A subquery has no CEL spelling at all: RLS ' +
              'cannot join (ADR-0055), so pre-resolve the set into a membership key the runtime exposes ' +
              '(`field in current_user.<key>`, ADR-0105 D11) or denormalise the value onto this object.',
          });
          continue;
        }

        findings.push({
          severity: 'error',
          rule: RLS_PREDICATE_UNENFORCEABLE,
          where,
          path,
          message:
            `RLS ${clause} \`${source}\` is outside the pushdown subset the runtime can compile ` +
            `(${detail}), ` + consequence(clause),
          hint:
            'Rewrite the predicate inside the lowerable subset. ' + PUSHDOWN_SUBSET + ' Three traps in ' +
            'particular: (1) a function call — `size(record.tags) > 0`, `has(record.x)` — is correct in an ' +
            'object VALIDATION rule, which is INTERPRETED, and wrong here, where the predicate is ' +
            'COMPILED to a filter; write the null test as `field != null`. (2) A related-record path ' +
            '(`record.account.region`) is a join, which the compiler refuses by design (ADR-0055) — ' +
            'denormalise the value onto this object (a formula/rollup field) and test that column. ' +
            '(3) Arithmetic on a column (`amount * 2 > 100`) never lowers — precompute it into a field, ' +
            'or compare the column against the literal directly.',
        });
      }
    });
  });

  return findings;
}
