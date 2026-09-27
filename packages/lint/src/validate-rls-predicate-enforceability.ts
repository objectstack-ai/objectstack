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
 *  4. **Write path (`check`, ADR-0058 D4).** `computeWriteCheckFilter` takes
 *     its set from `writeCheckPolicies`, per single-record insert / by-id
 *     update and per caller (an array insert and a `multi: true` update never
 *     reach it): the applicable policies that declare a `check` when any does
 *     (a USING-only sibling then adds nothing), otherwise every applicable
 *     policy with a `using`, that `using` compiled as its check. So an
 *     unlowerable `check` on an `insert` / `update` / `all` policy reaches this
 *     path, and so does an unlowerable `using` on one whenever no applicable
 *     policy for that operation declares a `check`. When nothing else in the
 *     set compiles, the same drop makes the post-image predicate the deny
 *     sentinel, `matchesFilterCondition` fails, and the write raises
 *     `PermissionDeniedError`; when something else compiles, it alone decides.
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
 *
 * ## The engine's own admission of the read scope (#20158, #19995 ruling C)
 *
 * A predicate can pass every pass above and still be a filter the ENGINE
 * refuses to run: a text operator aimed at a number field, a date field
 * compared against a value its storage cannot read, a filter on a virtual
 * (formula) field, a `{placeholder}` string. The lowering accepts all of them,
 * because they are about what the object's fields ARE, which the CEL compiler
 * does not know. ADR-0058 D2 makes each an authoring-time error.
 *
 * The verdict is the engine's, never a model of it: the caller hands this rule
 * the engine's judge-only method (`IObjectQLEngine.judgeFilter`) as an INPUT,
 * and the rule calls it on the lowered read scope. The runtime publish gate
 * hands in the live engine's method; the CLI commands hand in the method of an
 * engine built from the stack's own objects with no driver (the admission
 * reads the `where`, the registry's field map and the context, nothing else).
 * One rule, two doors, one function answering. Without the input the pass is
 * skipped, and the rule answers exactly what it answered before the input
 * existed.
 *
 * - **What is judged:** the `using` clause of a policy whose operation is part
 *   of the object's READ SCOPE — `select` or `all`, the two
 *   `getApplicablePolicies` matches for a read. A `check` is matched in memory
 *   against a post-image and never reaches the engine's `where` admission, so
 *   judging it here would model a consumer it does not have.
 * - **With what values:** the reference pass's probe, except that a
 *   `current_user.*` key the kernel does NOT resolve (an app-staged §7.3.1
 *   membership set) is bound to `[]` for this pass only. The probe's string
 *   stands for a kernel value faithfully (an id is never a date), but an
 *   app-staged set holds app data this rule cannot know: measured,
 *   `close_date in current_user.holidays` lowered with the probe string is
 *   refused by the temporal door, while with `[]` it is admitted.
 * - **With what context:** none. A `{placeholder}` string in a predicate
 *   therefore answers `FILTER_TOKEN_UNRESOLVED` (known) or
 *   `FILTER_TOKEN_UNKNOWN` (unknown) — the engine's own semantics for a filter
 *   judged with no caller. An RLS predicate names the caller as `current_user.*`.
 * - **When:** only when every pass above left this clause clean, so one
 *   defect earns one finding.
 *
 * The finding keeps the id {@link RLS_PREDICATE_UNENFORCEABLE} and quotes the
 * engine's message verbatim, with its code and status: at authoring time the
 * text is the author's own, so nothing is withheld.
 */

import type { EngineFilterJudgement, IObjectQLEngine } from '@objectstack/spec/contracts';
import {
  compileCelToFilter,
  isPushdownableCel,
  isSupportedRlsExpression,
  parseCelToAstWithReason,
  sqlPredicateToCel,
} from '@objectstack/formula';
import type { CelBoundsOverrun } from '@objectstack/formula';
import { RESERVED_RLS_MEMBERSHIP_KEYS } from '@objectstack/spec/contracts';
import { assertListComparandShapes, normalizeFilterComparandTypes } from '@objectstack/spec/data';
import { ExecutionContextSchema } from '@objectstack/spec/kernel';
import {
  describeFieldPathVerdict,
  indexObjectGraph,
  isUnjudgeable,
  listNames,
  recordsOf,
  resolveFieldPath,
  suggestName,
  type ObjectGraph,
} from './object-graph.js';

/** A predicate outside the pushdown subset — the policy enforces nothing. */
export const RLS_PREDICATE_UNENFORCEABLE = 'rls-predicate-unenforceable';
/** A predicate that does not parse as CEL even after the legacy SQL bridge. */
export const RLS_PREDICATE_UNPARSEABLE = 'rls-predicate-unparseable';
/** Valid CEL that overruns a platform parse bound (`maxAstNodes`, `maxDepth`, …). */
export const RLS_PREDICATE_OVER_BUDGET = 'rls-predicate-over-budget';
/**
 * A predicate whose SHAPE is fine but which names a field the policy's object
 * does not declare — the reference half of the same failure (#16119).
 */
export const RLS_PREDICATE_UNKNOWN_FIELD = 'rls-predicate-unknown-field';
/**
 * A predicate referencing a `current_user.*` value nothing pre-resolves — the
 * variable half of the same failure (#16119).
 */
export const RLS_PREDICATE_UNKNOWN_USER_VARIABLE = 'rls-predicate-unknown-user-variable';

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

/**
 * The INSERT half of a dropped `using`, appended to every `using` consequence
 * below. The ADR-0058 D4 write check takes its set from `writeCheckPolicies`:
 * when no applicable policy for the insert declares a `check`, every applicable
 * policy's `using` is compiled as its check, so the same drop reaches the
 * single-record insert too. Measured through the real `SecurityPlugin` on an
 * `insert` and an `all` policy, for all three kinds of drop (an unlowerable shape, an unresolved
 * `current_user.*`, an undeclared column): with nothing else compiling in that
 * set, every single-record insert is refused (403); with another applicable
 * policy's `using` compiling, that one alone decides; with a declared `check`
 * beside it, the declared check alone decides and this `using` takes no part.
 */
const USING_INSERT_CONSEQUENCE =
  ' On an `insert` or `all` policy the same `using` is also the single-record INSERT check ' +
  'whenever no applicable policy for the insert declares a `check` (ADR-0058 D4): when nothing ' +
  'else in that set compiles, every single-record insert it governs fails with ' +
  "`PermissionDeniedError`; when another policy's `using` compiles, that one alone decides the insert.";

/**
 * Qualifies every `check` consequence below. The write check OR-combines the
 * declared checks of all the applicable policies for the operation, so a
 * dropped `check` is a blanket refusal only when no other declared `check` in
 * that set compiles (measured: beside a compiling declared `check`, that one
 * alone decided; beside a USING-only sibling, every single-record insert was
 * refused, because a USING-only sibling takes no part once any policy declares
 * a `check`).
 */
const CHECK_SET_QUALIFIER =
  ' That holds when no other applicable policy for the operation declares a `check` that compiles; ' +
  'when one does, that `check` alone decides and this one contributes nothing.';

/** How an UNCOMPILABLE predicate is dropped: the runtime's own WARN names the predicate. */
const DROPPED_UNCOMPILABLE =
  'so `RLSCompiler` DROPS the policy at request time (one WARN line — "has an uncompilable predicate ' +
  '… and was DROPPED (no enforcement)" — is the only signal, and nothing reports it at authoring time). ';

/**
 * How a predicate the compiler refuses PER REQUEST is dropped. The shape check
 * `compileFilter` consults passes (the refused value exists only per request),
 * so it never logs the "uncompilable predicate" line: it collects the policy as
 * that request's denial and WARNs only when that denial is what the request gets.
 */
const DROPPED_EVERY_REQUEST =
  'so `RLSCompiler` DROPS the policy on EVERY request (a request that resolves no value drops it too). The ' +
  'shape check passes, so the "uncompilable predicate" WARN is never logged; the only signal is a per-request ' +
  '"DENY (fail closed)" WARN, emitted only when nothing else applicable compiles, and nothing reports it at ' +
  'authoring time. ';

/** What the runtime does with a predicate it cannot compile, per clause. */
function consequence(clause: 'using' | 'check', dropped: string = DROPPED_UNCOMPILABLE): string {
  return clause === 'using'
    ? dropped +
        'When it is the only applicable policy for that object and operation, `compileFilter` returns the ' +
        '`RLS_DENY_FILTER` sentinel instead, which is AND-ed onto the where clause: every select / update / ' +
        'delete on the object matches ZERO rows. When other policies also apply, this one just vanishes ' +
        'from the OR and grants none of the access it appears to.' +
        USING_INSERT_CONSEQUENCE
    : dropped +
        'On the ADR-0058 D4 write path that leaves the post-image `check` as the `RLS_DENY_FILTER` ' +
        'sentinel, which no record can satisfy: every single-record insert and by-id update the policy ' +
        'governs fails with `PermissionDeniedError`. The policy reads as a write rule and behaves as a ' +
        'blanket refusal.' +
        CHECK_SET_QUALIFIER;
}

/* ────────────────────────────────────────────────────────────────────────────
 * #16119 — the REFERENCE half. The three ids above judge a predicate's SHAPE
 * (does it parse, does it lower, does it fit the bounds) and nothing judges
 * what it POINTS AT, so `is_private_nope == false || owner_id == current_user.id`
 * and `is_private == false || owner_id == current_user.nope` were both reported
 * by NOTHING — measured at the same site, in the same run, that reported the two
 * shape faults twice.
 *
 * Both were invisible, and they are NOT the same failure. The card measured
 * both as fail-CLOSED and that reading is right for the shapes it measured; it
 * does not generalise. An unresolved `current_user.*` really is refused by the
 * compiler in every position, so that half always fails closed: the authored
 * narrowing becomes a blanket refusal and every holder of the permission set
 * loses the object. A missing FIELD takes its direction from POSITION, and one
 * of the two is fail-OPEN:
 *
 *  - Leading `field ==` / `=` / `in` — the only shape `extractTargetField`
 *    recognises — is dropped by the field-existence safety net and arms the
 *    deny sentinel. Fail closed.
 *  - A negation (`nope != "x"`, `!(nope == 1)`, `!(nope in ['a'])`) or any arm
 *    after the first is NOT recognised, so the policy is KEPT and the phantom
 *    column lowers to a negated constraint that a row without that column
 *    SATISFIES (`noValueSatisfiesNegation`: `$ne` / `$nin` / `$notContains`).
 *    The narrowing is DEFEATED — measured at 3 of 3 rows against a 1-of-3 real
 *    narrowing and a 0-of-3 phantom positive, on the read path and on the
 *    write path's `matchesFilterCondition` alike. ⛔ Not a cross-tenant leak:
 *    tenancy is a separate layer and holds. The runtime half is #17042 and is
 *    NOT this rule's to fix — this rule reports the miss, in both directions.
 *
 * Either way it is what a column RENAME leaves behind, with lint and CI green.
 *
 * ## Why this is a SECOND pair of ids and not a widening of the three above
 *
 * Same disposition `security-fls-unknown-field` took beside
 * `security-fls-unqualified-key`: those ids say *unenforceable* / *unparseable*
 * and are correct inside that scope, the prescriptions differ (rewrite the
 * predicate / fix the name / pre-resolve the variable), and an author who
 * suppresses one must not thereby suppress the other. These run only where the
 * shape check PASSED, so the guards are disjoint by construction — a predicate
 * is judged by the shape pass or by the reference pass, never both.
 *
 * The reference pass ALSO reports under {@link RLS_PREDICATE_UNENFORCEABLE}
 * (#19951), for the two refusals the shape check cannot see because they
 * depend on a value, and whose fix is a rewrite of the predicate rather than a
 * name: a `current_user` value of the wrong TYPE for its position (see
 * {@link attributeTypeFault}), and a lowered comparand the shared filter faces
 * refuse (see {@link sharedFaceRefusal}). Same id, because the author's edit is
 * the same kind — rewrite the predicate inside the enforceable subset — and an
 * allowlist keyed on it already means "this predicate enforces nothing".
 */

/**
 * The `current_user.*` keys the platform itself resolves, read from the
 * contract that declares them rather than transcribed.
 *
 * {@link RESERVED_RLS_MEMBERSHIP_KEYS} (`@objectstack/spec/contracts`) is the
 * list `IRlsMembershipResolver` is forbidden to supply *because the kernel
 * already owns them* — "keys … must not collide with the named context fields
 * (`id`, `organization_id`, `positions`, `org_user_ids`, `accessible_org_ids`,
 * `email`) — the compiler never lets a membership key clobber those." That is
 * the same set `RLSCompiler.compileFilter` builds its `RLSUserContext` from,
 * and it is in `@objectstack/spec`, which this package may read (the RLS
 * compiler itself is a runtime it may not).
 *
 * ⛔ Deliberately NOT hotcrm's five-name guard, and ⛔ not `RLSUserContextSchema`
 * in `packages/spec/src/security/rls.zod.ts` — that schema still spells the org
 * key `tenantId` and carries `department` / `attributes` the RLS compiler never
 * binds, so reading it would judge authored policies against a shape the
 * runtime does not have.
 */
const PRERESOLVED_USER_KEYS: ReadonlySet<string> = new Set(RESERVED_RLS_MEMBERSHIP_KEYS);

/**
 * Probe values bound in place of the real request context.
 *
 * Each kernel-resolved key is bound to a value of the type it HOLDS at runtime
 * (see {@link kernelKeyProbe}): a scalar for a scalar key, an array for a
 * membership set. The compiler's verdict on a position then matches the
 * runtime's — `==` / `!=` refuse an array (#19886) and `in` requires one — so a
 * well-formed predicate compiles without a request, and a predicate the runtime
 * drops for a type mismatch does not compile here either. The SCALAR is also
 * the discriminator described on {@link userVariableIsScalarPositioned}.
 */
const PROBE_ARRAY: readonly string[] = ['__objectstack_lint_probe__'];
const PROBE_SCALAR = '__objectstack_lint_probe__';

/**
 * The kernel keys `RLSCompiler.compileFilter` copies from an `ExecutionContext`
 * field of a DIFFERENT name (`id: executionContext.userId`,
 * `organization_id: executionContext.tenantId`). Every other kernel key is
 * copied from the field of its own name.
 */
const KERNEL_KEY_RENAMED_FROM: Readonly<Record<string, string>> = {
  id: 'userId',
  organization_id: 'tenantId',
};

/**
 * The probe for one kernel-resolved key: whatever its `ExecutionContext` field
 * accepts. The type is asked of the declaring schema (`ExecutionContextSchema`,
 * `@objectstack/spec/kernel`) rather than transcribed here — if that field takes
 * an array the key is a membership set, otherwise it is a scalar.
 *
 * A key with no declared field keeps the array probe this pass used for every
 * key before #19886; the test that pins the key-binding table goes red first.
 */
function kernelKeyProbe(key: string): unknown {
  const field = KERNEL_KEY_RENAMED_FROM[key] ?? key;
  const declared = (ExecutionContextSchema.shape as Record<string, { safeParse(v: unknown): { success: boolean } }>)[
    field
  ];
  if (!declared) return PROBE_ARRAY;
  return declared.safeParse(PROBE_ARRAY).success ? PROBE_ARRAY : PROBE_SCALAR;
}

/** `variable "current_user.nope" is undefined` → `current_user.nope`. */
function unresolvedVariablePath(detail: string): string | null {
  const m = /variable "([^"]+)"/.exec(detail);
  return m ? m[1] : null;
}

type UserProbe = Record<string, unknown>;

function baseUserProbe(): UserProbe {
  const probe: UserProbe = {};
  for (const key of PRERESOLVED_USER_KEYS) probe[key] = kernelKeyProbe(key);
  return probe;
}

function compileWithProbe(bridged: string, probe: UserProbe) {
  return compileCelToFilter(bridged, { variables: { current_user: probe } });
}

/**
 * Is this `current_user.<key>` reference in a position only a SCALAR can fill?
 *
 * This is the whole reason the variable rule can exist without false-positiving
 * the platform's own documented feature. §7.3.1 dynamic membership lets an app
 * stage ARBITRARY keys into `ExecutionContext.rlsMembership` and reference them
 * as `field in current_user.<key>` — the existing `rls-predicate-unparseable`
 * hint *recommends exactly that shape* — so a key this linter has never heard of
 * is, in an `in` position, indistinguishable from a correct §7.3.1 reference and
 * must NOT be reported (the object graph's `unknowable` discipline, one axis
 * over).
 *
 * What makes the other positions decidable is that the merge is array-only:
 * `compileFilter` stages a membership entry only `if (Array.isArray(value))`,
 * and it never lets one clobber a named field. So the complete set of values
 * `current_user.<unknown key>` can EVER hold at runtime is "some array" — and an
 * array is the one thing a scalar position cannot use. A key compared with
 * `==` / `!=` / `<` / `>` or handed to `startsWith` therefore resolves to
 * nothing on every request there will ever be.
 *
 * The question is asked of the COMPILER, not of a model of it: bind the key to
 * a scalar and re-run `compileCelToFilter`. If the predicate still lowers, the
 * key sat in a scalar position; if the compiler refuses (`in` requires an
 * array/list on the right), it sat in a membership position and is left alone.
 * A key used in BOTH positions in one predicate takes the membership answer and
 * is skipped — the conservative direction for a new rule.
 */
function userVariableIsScalarPositioned(bridged: string, probe: UserProbe, path: string): boolean {
  const scalarProbe: UserProbe = { ...probe };
  setProbePath(scalarProbe, path, PROBE_SCALAR);
  const res = compileWithProbe(bridged, scalarProbe);
  if (res.ok) return true;
  // Still unresolved, but about a DIFFERENT variable: this one resolved as a
  // scalar before the compiler reached the next miss.
  if (res.reason === 'unresolved-variable') return unresolvedVariablePath(res.detail) !== path;
  return false;
}

/** Bind `current_user.a.b` inside the probe, creating the intermediate records. */
function setProbePath(probe: UserProbe, path: string, value: unknown): void {
  const segments = path.split('.').slice(1); // drop the `current_user` root
  if (segments.length === 0) return;
  let cursor: UserProbe = probe;
  for (let i = 0; i < segments.length - 1; i++) {
    const next = cursor[segments[i]];
    const rec = next && typeof next === 'object' && !Array.isArray(next) ? (next as UserProbe) : {};
    cursor[segments[i]] = rec;
    cursor = rec;
  }
  cursor[segments[segments.length - 1]] = value;
}

/** Is this whole path exactly one pre-resolved key (`current_user.id`)? */
function isPreresolvedPath(path: string): boolean {
  const segments = path.split('.');
  return segments.length === 2 && segments[0] === 'current_user' && PRERESOLVED_USER_KEYS.has(segments[1]);
}

/**
 * Compile the predicate against a probe context, reporting each unresolvable
 * `current_user.*` reference on the way, and return the lowered filter — whose
 * KEYS are the field paths the runtime will push down (ADR-0055: every one a
 * single column).
 *
 * The loop exists because `resolveValue` throws on the FIRST miss it reaches, so
 * each discovered key is bound to a probe value before the next compile. Bounded
 * rather than `while (true)`: a linter must terminate on input it did not
 * anticipate, and stopping early only costs a finding.
 */
function resolveReferences(bridged: string): {
  filter: Record<string, unknown> | null;
  unresolvedScalars: string[];
  /** The probe as the last compile saw it — every discovered key bound. */
  probe: UserProbe;
  /** The compiler's `detail` when that compile was refused `unsupported`. */
  refusal: string | null;
} {
  const probe = baseUserProbe();
  const unresolvedScalars: string[] = [];
  const stop = (refusal: string | null = null) => ({ filter: null, unresolvedScalars, probe, refusal });
  for (let pass = 0; pass < 32; pass++) {
    const res = compileWithProbe(bridged, probe);
    if (res.ok) return { filter: res.filter as Record<string, unknown>, unresolvedScalars, probe, refusal: null };
    if (res.reason !== 'unresolved-variable') {
      // [#19951] The predicate passed `isSupportedRlsExpression`, so a shape
      // refusal here was produced by a VALUE — a membership set under `==` /
      // `!=` or handed to `startsWith`, a one-value key on the right of `in`,
      // the whole `current_user` object where one value or one set belongs —
      // or by a constant comparison whose fold depends on WHICH value the
      // probe holds. The caller decides which ({@link attributeTypeFault}):
      // only the first recurs on every request.
      return stop(res.reason === 'unsupported' ? res.detail : null);
    }
    const path = unresolvedVariablePath(res.detail);
    if (!path || !path.startsWith('current_user.') || isPreresolvedPath(path)) {
      return stop();
    }
    if (userVariableIsScalarPositioned(bridged, probe, path)) {
      unresolvedScalars.push(path);
      setProbePath(probe, path, PROBE_SCALAR);
    } else {
      // A membership position — an app-staged §7.3.1 key is indistinguishable
      // from a typo here, so this is `unknowable`, never a finding.
      setProbePath(probe, path, PROBE_ARRAY);
    }
  }
  return stop();
}

/** Collect every `{ $field: '<path>' }` reference nested anywhere under a value. */
function collectFieldRefs(value: unknown, out: Set<string>): void {
  if (Array.isArray(value)) {
    for (const item of value) collectFieldRefs(item, out);
    return;
  }
  if (!value || typeof value !== 'object') return;
  for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
    if (key === '$field' && typeof nested === 'string' && nested) out.add(nested);
    else collectFieldRefs(nested, out);
  }
}

/**
 * The field paths a lowered FilterCondition addresses.
 *
 * Read off the COMPILER'S OWN OUTPUT rather than re-walked from the source:
 * every producer of a field key in `cel-to-filter.ts` (`emit`, `lowerMembership`,
 * `lowerStringMethod`) writes the path as the condition's key, so this reads
 * exactly the columns the driver will be handed. A second parse of the predicate
 * here would be the fork this file's docblock refuses.
 */
function filterFieldPaths(filter: Record<string, unknown> | null): Set<string> {
  const fields = new Set<string>();
  const walk = (node: unknown): void => {
    if (Array.isArray(node)) {
      for (const item of node) walk(item);
      return;
    }
    if (!node || typeof node !== 'object') return;
    for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
      if (key === '$and' || key === '$or' || key === '$not') {
        walk(value);
        continue;
      }
      if (key.startsWith('$')) continue;
      fields.add(key);
      collectFieldRefs(value, fields);
    }
  };
  walk(filter);
  return fields;
}

/* ────────────────────────────────────────────────────────────────────────────
 * #19951 — the refusals the SHAPE check cannot see.
 *
 * `isSupportedRlsExpression` judges shape with every `current_user` value
 * replaced by a placeholder, so two refusals pass it and land per request:
 *
 *  1. A `current_user` value of the wrong TYPE for its position:
 *     `record.reviewer_id != current_user.org_user_ids` (a membership set under
 *     `!=`), `record.x in current_user.id` (one value on the right of `in`),
 *     `record.x in current_user` / `record.x.startsWith(current_user)` (the
 *     whole context object). The compiler refuses each on EVERY request, and
 *     `RLSCompiler` drops the policy — measured through the real plugin: zero
 *     rows on a `using` read, 403 on a `check` write. This pass used to stop at
 *     that refusal and report nothing.
 *  2. A lowered comparand the shared filter faces refuse by ruling — a `null`
 *     list member (`x in ['a', null]`) or a `null` ordering bound (`x > null`).
 *     Those compile; the RLS layer does not pass its own filter through the
 *     faces, so the backend answers with semantics the platform left undefined.
 */

/**
 * The value standing in for the OTHER runtime type in a one-reference swap.
 *
 * It begins with {@link PROBE_SCALAR}, so a constant ORDERING fold
 * (`current_user.id > 'm'`) reads the same after the swap — `[SWAP_SCALAR]`
 * coerces to this string too — and it is never equal to the probe, so an
 * equality fold between two references cannot turn true by the swap. Both
 * keep a VALUE-dependent refusal refused, which is what the discriminator needs.
 */
const SWAP_SCALAR = `${PROBE_SCALAR}swap`;

/** A lowered field position, read off the compiler's output. */
interface LoweredSite {
  field: string;
  /** `==` for an implicit equality, otherwise the lowered operator (`$ne`, `$in`, `$startsWith`, …). */
  op: string;
  operand: unknown;
}

/** Every lowered field position whose operand satisfies `hit`, in walk order. */
function loweredSites(filter: unknown, hit: (op: string, operand: unknown) => boolean): LoweredSite[] {
  const sites: LoweredSite[] = [];
  const walk = (node: unknown): void => {
    if (Array.isArray(node)) {
      for (const item of node) walk(item);
      return;
    }
    if (!node || typeof node !== 'object') return;
    for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
      if (key === '$and' || key === '$or' || key === '$not') {
        walk(value);
        continue;
      }
      if (key.startsWith('$')) continue;
      if (value && typeof value === 'object' && !Array.isArray(value)) {
        for (const [op, operand] of Object.entries(value as Record<string, unknown>)) {
          if (hit(op, operand)) sites.push({ field: key, op, operand });
        }
      } else if (hit('==', value)) {
        sites.push({ field: key, op: '==', operand: value });
      }
    }
  };
  walk(filter);
  return sites;
}

/** What one `current_user` reference holds on every request. */
type RuntimeHolding = 'list' | 'one value' | 'context object';

interface TypeFault {
  /** The reference whose runtime TYPE the position cannot take (`current_user.org_user_ids`, `current_user`). */
  variable: string;
  holds: RuntimeHolding;
  /** Where the swapped value landed once the predicate lowered — what the prescription rewrites. */
  sites: LoweredSite[];
}

/**
 * Does ONE `current_user` reference's runtime TYPE cause this refusal — so it
 * recurs on every request — or is the refusal an artefact of the probe's VALUES?
 *
 * Asked of the COMPILER, the way {@link userVariableIsScalarPositioned} asks
 * it: rebind one reference to a value of the OTHER type and compile again. If
 * that one swap makes the predicate lower, the refusal was that reference's
 * TYPE, and the type is not the probe's to choose — a kernel key holds what
 * `ExecutionContextSchema` declares on every request ({@link kernelKeyProbe}),
 * and the bare root is the whole context object on every request — so the
 * runtime refuses the same position every time.
 *
 * What no single swap cures stays SILENT, and that is the probe-artefact class:
 * a constant comparison with no field (`current_user.email == 'ops@acme.com'`)
 * folds on the VALUE, lowering to "no restriction" for the one caller it names
 * and refused for every other caller — a per-caller policy the probe cannot
 * stand for ({@link SWAP_SCALAR} keeps that fold refused under every swap). It
 * is also the answer for a predicate with two type faults, which no single swap
 * cures: the conservative direction for a new finding.
 *
 * The cure must also LAND: the swapped value is found in a lowered field
 * position, which is what the prescription names.
 */
function attributeTypeFault(bridged: string, probe: UserProbe): TypeFault | null {
  const swaps: Array<{ variable: string; holds: RuntimeHolding; context: unknown; marker: unknown }> = [];
  for (const key of PRERESOLVED_USER_KEYS) {
    const isList = Array.isArray(probe[key]);
    const marker = isList ? SWAP_SCALAR : [SWAP_SCALAR];
    swaps.push({
      variable: `current_user.${key}`,
      holds: isList ? 'list' : 'one value',
      context: { ...probe, [key]: marker },
      marker,
    });
  }
  // The root, twice: as a list that still carries every key (so a
  // `current_user.id` beside `x in current_user` keeps resolving), and as one
  // string (a string method's argument).
  const rootAsList = Object.assign([SWAP_SCALAR], probe);
  swaps.push({ variable: 'current_user', holds: 'context object', context: rootAsList, marker: rootAsList });
  swaps.push({ variable: 'current_user', holds: 'context object', context: SWAP_SCALAR, marker: SWAP_SCALAR });

  for (const swap of swaps) {
    const res = compileCelToFilter(bridged, { variables: { current_user: swap.context } });
    if (!res.ok) continue;
    const sites = loweredSites(res.filter, (_op, operand) => operand === swap.marker);
    if (sites.length > 0) return { variable: swap.variable, holds: swap.holds, sites };
  }
  return null;
}

/** The kernel keys that hold `holding` on every request, from their declared types. */
function kernelKeysHolding(holding: 'list' | 'one value'): string[] {
  return [...PRERESOLVED_USER_KEYS]
    .filter((key) => Array.isArray(kernelKeyProbe(key)) === (holding === 'list'))
    .sort();
}

/** The lowered string-method operators, back to the CEL method an author writes. */
const STRING_METHOD_OF: ReadonlyMap<string, string> = new Map([
  ['$startsWith', 'startsWith'],
  ['$endsWith', 'endsWith'],
  ['$contains', 'contains'],
]);

/** The pasteable rewrite for one lowered site of a type fault. */
function typeFaultRewrite(fault: TypeFault, site: LoweredSite): string {
  const f = `record.${site.field}`;
  const v = fault.variable;
  const method = STRING_METHOD_OF.get(site.op);
  const oneValueKeys = kernelKeysHolding('one value');
  if (fault.holds === 'list') {
    if (site.op === '==') return `replace \`${f} == ${v}\` with \`${f} in ${v}\``;
    if (site.op === '$ne') return `replace \`${f} != ${v}\` with \`!(${f} in ${v})\``;
    if (method) {
      return (
        `replace \`${f}.${method}(${v})\` with the membership test \`${f} in ${v}\`, or pass one value: ` +
        oneValueKeys.map((key) => `\`${f}.${method}(current_user.${key})\``).join(' / ')
      );
    }
  }
  if (fault.holds === 'one value' && site.op === '$in') {
    return (
      `replace \`${f} in ${v}\` with \`${f} == ${v}\` (and \`!(${f} in ${v})\` with \`${f} != ${v}\`); for a ` +
      `set, name a membership key: ` +
      kernelKeysHolding('list').map((key) => `\`${f} in current_user.${key}\``).join(' / ')
    );
  }
  if (fault.holds === 'context object') {
    if (site.op === '$in') {
      return (
        `replace \`${f} in current_user\` with the key that holds the set: ` +
        kernelKeysHolding('list').map((key) => `\`${f} in current_user.${key}\``).join(' / ') +
        `, or an app-staged §7.3.1 set \`${f} in current_user.<key>\``
      );
    }
    if (method) {
      return (
        `replace \`${f}.${method}(current_user)\` with the key that holds the string: ` +
        oneValueKeys.map((key) => `\`${f}.${method}(current_user.${key})\``).join(' / ')
      );
    }
  }
  return `rewrite the comparison on \`${f}\` so \`${v}\` sits where its value fits`;
}

const HOLDING_SENTENCE: Readonly<Record<RuntimeHolding, (variable: string) => string>> = {
  list: (v) =>
    `\`${v}\` is a membership set: \`ExecutionContext\` declares it, and the kernel resolves it, as a LIST on ` +
    'every request, so no request can ever put one value in this position.',
  'one value': (v) =>
    `\`${v}\` holds ONE value: \`ExecutionContext\` declares it, and the kernel resolves it, as a scalar on ` +
    'every request, so no request can ever put a list in this position.',
  'context object': () =>
    '`current_user` alone is the whole caller context object on every request, never one value and never one set.',
};

/** The one-sentence rule each holding breaks, leading its hint. */
const HOLDING_RULE: Readonly<Record<RuntimeHolding, string>> = {
  list:
    '`==` / `!=` compare ONE value and a string method takes ONE string; a membership set is tested with `in` — ' +
    '"one of these" is `x in set`, "none of these" is `!(x in set)`.',
  'one value': '`in` tests membership in a SET; one value is compared with `==` / `!=`.',
  'context object': '`current_user` is the caller context, not a value: name the key that holds what you mean.',
};

/**
 * The verdict of the shared filter faces on this predicate's LOWERED filter —
 * `assertListComparandShapes` and `normalizeFilterComparandTypes`
 * (`@objectstack/spec/data`), the same pair the analytics read-scope compiler
 * runs on every RLS read scope (`assertReadScopeComparandsRunnable`), the
 * engine runs on every caller-supplied filter and, since #20212, `RLSCompiler`
 * runs on every compiled policy filter, which drops a policy they refuse.
 *
 * Graded by the refusal's `code` (`INVALID_FILTER`), never by its prose (#6223);
 * the returned message is quoted, never parsed.
 *
 * Not a probe artefact: the faces accept a string and a list of strings by
 * construction, and those are the only values the probe binds — so a refusal
 * here is about a comparand the AUTHOR wrote, and recurs on every request. A
 * probe that bound a nested record (a `current_user.a.b` path) is not judged.
 */
function sharedFaceRefusal(filter: Record<string, unknown>, probe: UserProbe, clause: string): string | null {
  if (!Object.values(probe).every((v) => typeof v === 'string' || Array.isArray(v))) return null;
  try {
    assertListComparandShapes(filter, undefined, clause);
    normalizeFilterComparandTypes(filter, undefined, clause);
    return null;
  } catch (err) {
    if ((err as { code?: unknown } | null)?.code !== 'INVALID_FILTER') return null;
    return err instanceof Error ? err.message : String(err);
  }
}

/** The lowered ordering operators, back to the CEL operator an author writes. */
const ORDERING_SYMBOL: ReadonlyMap<string, string> = new Map([
  ['$gt', '>'],
  ['$gte', '>='],
  ['$lt', '<'],
  ['$lte', '<='],
]);

/** A CEL literal for one list member — a JSON string literal is valid CEL. */
function celLiteral(value: unknown): string {
  return typeof value === 'string' ? JSON.stringify(value) : String(value);
}

/**
 * The pasteable rewrites for a face refusal: every lowered `null` list member
 * and `null` ordering bound, rewritten with the null predicate. Each is a LOCAL
 * replacement, correct under any enclosing `!`, `&&` or `||` — `!(x in ['a'] ||
 * x == null)` is exactly "none of these, and has a value".
 */
function nullComparandRewrites(filter: Record<string, unknown>): string[] {
  const rewrites: string[] = [];
  for (const site of loweredSites(filter, (op, operand) =>
    (op === '$in' && Array.isArray(operand) && operand.includes(null)) ||
    (ORDERING_SYMBOL.has(op) && operand === null))) {
    const f = `record.${site.field}`;
    if (site.op === '$in') {
      const list = site.operand as unknown[];
      const written = `${f} in [${list.map(celLiteral).join(', ')}]`;
      const rest = list.filter((member) => member !== null);
      rewrites.push(
        rest.length === 0
          ? `replace \`${written}\` with \`${f} == null\``
          : `replace \`${written}\` with \`(${f} in [${rest.map(celLiteral).join(', ')}] || ${f} == null)\` ` +
              `to keep matching a missing value, or drop the member: \`${f} in [${rest.map(celLiteral).join(', ')}]\``,
      );
    } else {
      rewrites.push(
        `replace \`${f} ${ORDERING_SYMBOL.get(site.op)} null\` with \`${f} != null\` (has a value) or ` +
          `\`${f} == null\` (has none), or compare against a real bound`,
      );
    }
  }
  return rewrites;
}

/** The leading sentence of a quoted refusal, so an author sees its point and not its whole essay. */
function firstSentence(message: string): string {
  const cut = message.indexOf('. ');
  return cut === -1 ? message : message.slice(0, cut);
}

/**
 * How a face-refused comparand is dropped at request time. [#20212]
 * `RLSCompiler.compileFilter` runs the same two faces on every compiled policy
 * filter, for `using` and `check` alike, so the policy joins the per-request
 * denial route before any backend or the in-process `check` evaluator sees the
 * comparand: the same drop, WARN and per-clause consequence as a TYPE fault.
 */
const DROPPED_FACE_REFUSED =
  'so `RLSCompiler` DROPS the policy on EVERY request: it runs that same check on every compiled policy ' +
  'filter, before any backend sees it. The shape check passes, so the "uncompilable predicate" WARN is never ' +
  'logged; the only signal is a per-request "DENY (fail closed)" WARN, emitted only when nothing else ' +
  'applicable compiles. ';

/**
 * What a reference miss costs at request time, per clause. Measured, not inferred.
 *
 * ⚠️ This text was rewritten once, and the reason it was wrong is worth keeping:
 * it said the field half had TWO directions — fail-closed in the leading
 * position `extractTargetField` recognises, fail-OPEN everywhere else — and it
 * attributed the WRITE leg's fail-closed to that same safety net. Both halves
 * were wrong to leave standing. The runtime now judges column existence on the
 * COMPILED predicate, inside `RLSCompiler.compileFilter`, which both the read
 * layer and the ADR-0058 D4 write gate pass through: position and polarity are
 * normalised away before the check runs, so a miss fails CLOSED everywhere, on
 * both clauses. And the write path never had an `extractTargetField` net to
 * credit — `computeWriteCheckFilter` compiled `check` with no field-existence
 * check at all, which is why a negated miss there PERMITTED the write until the
 * compiler-side guard landed.
 *
 * ⇒ Both KINDS now have one direction each, and it is the same direction. What
 * this text still owes an author is that the miss is not a harmless typo: it
 * turns the policy into a blanket refusal for every holder of the set.
 */
function referenceConsequence(clause: 'using' | 'check', kind: 'field' | 'variable'): string {
  if (kind === 'variable') {
    const dropped =
      'The pushdown compiler answers `unresolved-variable` in EVERY position — including under `!` and in ' +
      'a trailing `||` arm — so `RLSCompiler` DROPS the policy at request time, and one WARN line is the ' +
      'only signal. ';
    return clause === 'using'
      ? dropped +
          'When it is the only applicable policy for that object and operation the layer falls back to the ' +
          '`RLS_DENY_FILTER` sentinel, which is AND-ed onto the where clause: every select / update / ' +
          'delete matches ZERO rows, so the object DISAPPEARS for every holder of this permission set — ' +
          'not because they were denied, but because the narrowing they were granted resolves to nothing. ' +
          'When other policies also apply, this one vanishes from the OR and grants none of the access it ' +
          'appears to.' +
          USING_INSERT_CONSEQUENCE
      : dropped +
          'On the ADR-0058 D4 write path that leaves the post-image `check` unsatisfiable: every ' +
          'single-record insert and by-id update the policy governs fails with `PermissionDeniedError`. ' +
          'The policy reads as a write rule and behaves as a blanket refusal for every holder of this ' +
          'permission set.' +
          CHECK_SET_QUALIFIER;
  }

  // ── The FIELD half. ONE direction, in every position and every polarity,
  // since the runtime moved the column check onto the COMPILED predicate. The
  // tracker id stays HERE and never in the returned string, because that string
  // reaches authors, operators and generated surfaces, none of whom can resolve
  // `#NNNN` (`check:doc-authoring`, maintainer ruling 2026-08-12).
  const dropped =
    '`RLSCompiler` judges column existence on the COMPILED predicate, so the position and the polarity ' +
    'you wrote it in make no difference — a leading `field ==`, a negation (`field != x`, ' +
    '`!(field == x)`, `!(field in [...])`) and any arm after the first all lower to the same tree and ' +
    'all DROP the policy at request time, with one WARN line as the only signal. ';
  return clause === 'using'
    ? dropped +
        'When it is the only applicable policy for that object and operation the layer falls back to the ' +
        '`RLS_DENY_FILTER` sentinel: every select / update / delete matches ZERO rows, so the object ' +
        'DISAPPEARS for every holder of this permission set — not because they were denied, but because ' +
        'the narrowing they were granted names a column that is not there. When other policies also ' +
        'apply, this one vanishes from the OR and grants none of the access it appears to.' +
        USING_INSERT_CONSEQUENCE
    : dropped +
        'On the ADR-0058 D4 write path that leaves the post-image `check` unsatisfiable: every ' +
        'single-record insert and by-id update the policy governs fails with `PermissionDeniedError`. ' +
        'The policy reads as a write rule and behaves as a blanket refusal for every holder of this ' +
        'permission set.' +
        CHECK_SET_QUALIFIER +
        ' ⚠️ On a runtime older ' +
        'than that guard this clause failed OPEN rather than closed — the write path had no ' +
        'field-existence check at all, so a negated miss was satisfied VACUOUSLY by the post-image and ' +
        'PERMITTED exactly the writes the policy was written to refuse, on every driver. Fix the name ' +
        'rather than relying on either behaviour.';
}

/**
 * The engine's judge-only filter admission, as the caller hands it in
 * (`IObjectQLEngine.judgeFilter`, bound to its engine).
 */
type FilterJudge = NonNullable<IObjectQLEngine['judgeFilter']>;

/**
 * The policy operations whose `using` is part of an object's READ SCOPE: the
 * two `RLSCompiler.getApplicablePolicies` matches for a read (`find` / `count`
 * / `aggregate` map to `select`, and `all` applies to every operation).
 */
const READ_SCOPE_OPERATIONS: ReadonlySet<string> = new Set(['select', 'all']);

/**
 * The probe the engine judges with: every kernel-resolved key keeps its
 * type-faithful probe, and every other key (an app-staged §7.3.1 membership
 * set, the only other thing `current_user.*` can hold) is bound to `[]`.
 *
 * `[]` because the set's MEMBERS are app data: the probe string is a faithful
 * stand-in for a kernel value (a user id or an email is never a date), but not
 * for a value an app stages, and the engine's temporal door judges members.
 * Measured: `close_date in current_user.holidays` lowered with the probe
 * string is refused (`INVALID_FILTER`), with `[]` it is admitted. A kernel key
 * is left alone, so `close_date in current_user.org_user_ids` still reaches the
 * door with a value of the type every request holds.
 */
function engineJudgeProbe(probe: UserProbe): { probe: UserProbe; rebound: boolean } {
  const bound: UserProbe = {};
  let rebound = false;
  for (const [key, value] of Object.entries(probe)) {
    if (PRERESOLVED_USER_KEYS.has(key)) {
      bound[key] = value;
    } else {
      bound[key] = [];
      rebound = true;
    }
  }
  return { probe: bound, rebound };
}

/**
 * The engine's verdict on this predicate's lowered read scope, or `null` when
 * it admits it or the predicate has no lowering to judge.
 *
 * Asked of the ENGINE, through the method the caller handed in — the same
 * function the engine runs before any driver is resolved (`judgeFilter`). No
 * context is passed: at authoring time there is no caller.
 */
function engineRefusal(
  judge: FilterJudge,
  object: string,
  bridged: string,
  filter: Record<string, unknown>,
  probe: UserProbe,
): Extract<EngineFilterJudgement, { ok: false }> | null {
  const { probe: judged, rebound } = engineJudgeProbe(probe);
  // A kernel key the reference pass had to re-bind as a nested record (a
  // `current_user.id.x` path) holds a value no request holds, so a verdict
  // on it would be about the probe. Same guard as {@link sharedFaceRefusal}.
  if (!Object.values(judged).every((v) => typeof v === 'string' || Array.isArray(v))) return null;
  let where: Record<string, unknown> = filter;
  if (rebound) {
    const res = compileWithProbe(bridged, judged);
    if (!res.ok) return null;
    where = res.filter as Record<string, unknown>;
  }
  const verdict = judge(object, where, { operation: 'find' });
  return verdict.ok ? null : verdict;
}

/**
 * What an engine-refused read scope does at request time. The analytics face
 * composes the read scope into the `where` it hands the engine, so the same
 * admission that produced this verdict refuses the query there.
 */
const ENGINE_REFUSED_CONSEQUENCE =
  'This clause is part of the object\'s row-level READ SCOPE, and the analytics face hands the read ' +
  'scope to this same engine admission before it runs a query: every analytics query over the object ' +
  'that this policy scopes is refused.';

/** The prescription for an engine refusal, keyed by the engine's `code` (never by its prose). */
function engineRefusalHint(code: string): string {
  if (code === 'FILTER_TOKEN_UNKNOWN' || code === 'FILTER_TOKEN_UNRESOLVED') {
    return (
      'A `{…}` placeholder is saved-filter syntax, and an RLS predicate does not use it: the predicate ' +
      `is CEL, and the caller's values are the \`current_user\` keys (${listNames(PRERESOLVED_USER_KEYS)}). ` +
      'Write `owner == current_user.id`, not `owner == \'{current_user_id}\'`.'
    );
  }
  if (code === 'INVALID_FIELD') {
    return (
      'A row filter reaches only the stored columns of its own object. Denormalise the value the engine ' +
      'names onto this object (a stored field, written when the source changes) and test that column.'
    );
  }
  return (
    'Rewrite the comparison the engine names so it can run: a text operator (`startsWith` / `endsWith` / ' +
    '`contains`) only on a field that holds a string, and a date or datetime field only against a value ' +
    'its storage can read. ' + PUSHDOWN_SUBSET
  );
}

/**
 * The reference pass: every finding a SHAPE-VALID predicate earns.
 *
 * Ordered fields-then-variables and deduplicated per name, so a predicate
 * naming one missing column twice earns one finding rather than one per
 * occurrence.
 */
function referenceFindings(
  graph: ObjectGraph,
  source: string,
  clause: 'using' | 'check',
  where: string,
  path: string,
  object: string,
  /**
   * [#20158] The engine's judge, when this clause is a read scope the caller
   * can have judged — `undefined` otherwise (no judge handed in, a `check`, a
   * policy outside the read scope, or no object named).
   */
  judge?: FilterJudge,
): RlsPredicateFinding[] {
  const findings: RlsPredicateFinding[] = [];
  const bridged = sqlPredicateToCel(source);
  const { filter, unresolvedScalars, probe, refusal } = resolveReferences(bridged);

  for (const fieldPath of filterFieldPaths(filter)) {
    const verdict = resolveFieldPath(graph, object, fieldPath);
    if (isUnjudgeable(verdict) || !verdict) continue;
    const account = describeFieldPathVerdict(verdict, fieldPath, `RLS ${clause} predicate field`);
    if (!account) continue;
    findings.push({
      severity: 'error',
      rule: RLS_PREDICATE_UNKNOWN_FIELD,
      where,
      path,
      message:
        `RLS ${clause} \`${quote(source)}\` lowers correctly but does not name a real column: ` +
        `${account.message} ` + referenceConsequence(clause, 'field'),
      hint:
        `${account.detail} Point the predicate at a column the object really declares, or delete the ` +
        `policy if the narrowing is gone — a policy naming a column that does not exist is not ` +
        `protection either way: it is an outage in one position and an open door in the other. If the ` +
        `field was RENAMED, this policy has been wrong since that rename — check WHICH way before you ` +
        `judge the blast radius, because a negated or non-leading miss has been granting, not denying. ` +
        `If the value was meant to live on another object, RLS cannot join to it (ADR-0055) — ` +
        `denormalise it onto "${object}" (a formula/rollup field) and test that column instead.`,
    });
  }

  for (const variablePath of unresolvedScalars) {
    const key = variablePath.slice('current_user.'.length);
    findings.push({
      severity: 'error',
      rule: RLS_PREDICATE_UNKNOWN_USER_VARIABLE,
      where,
      path,
      message:
        `RLS ${clause} \`${quote(source)}\` reads \`${variablePath}\`, which nothing pre-resolves. The ` +
        `kernel-resolved \`current_user\` keys are exactly ${listNames(PRERESOLVED_USER_KEYS)}, and the ` +
        `only other keys that can EVER appear are §7.3.1 membership sets, which the runtime stages as ` +
        `ARRAYS and which are therefore usable only as \`field in current_user.<key>\` — this reference ` +
        `is in a scalar position, so no request can ever supply it. ` +
        referenceConsequence(clause, 'variable'),
      hint:
        `Use one of the pre-resolved context values (${listNames(PRERESOLVED_USER_KEYS)})${suggestName(
          key,
          PRERESOLVED_USER_KEYS,
        )} — \`current_user.organization_id\` is the tenant, \`current_user.id\` the acting user, ` +
        `\`current_user.email\` their unique address. If "${key}" is meant to be an app-resolved set, it ` +
        `must be staged into \`ExecutionContext.rlsMembership\` by an \`IRlsMembershipResolver\` that ` +
        `DECLARES the key, and it can then only be tested with \`in\` (\`<field> in ${variablePath}\`), ` +
        `never compared with \`==\`: the runtime stages membership sets as arrays and never as scalars.`,
    });
  }

  // [#19951] The refusals the shape check cannot see (the block above
  // {@link attributeTypeFault}). A refusal no single type swap cures — the
  // probe-artefact class — reports nothing.
  const fault = refusal !== null ? attributeTypeFault(bridged, probe) : null;
  if (refusal !== null && fault) {
    findings.push({
      severity: 'error',
      rule: RLS_PREDICATE_UNENFORCEABLE,
      where,
      path,
      message:
        `RLS ${clause} \`${quote(source)}\` passes the shape check, but the compiler refuses it for the value ` +
        `\`${fault.variable}\` holds on every request (${refusal}). ${HOLDING_SENTENCE[fault.holds](fault.variable)} ` +
        consequence(clause, DROPPED_EVERY_REQUEST),
      hint:
        `${HOLDING_RULE[fault.holds]} In this predicate: ` +
        `${fault.sites.map((site) => typeFaultRewrite(fault, site)).join('; ')}.`,
    });
  }

  const faced = filter ? sharedFaceRefusal(filter, probe, clause) : null;
  if (filter && faced !== null) {
    const rewrites = nullComparandRewrites(filter);
    findings.push({
      severity: 'error',
      rule: RLS_PREDICATE_UNENFORCEABLE,
      where,
      path,
      message:
        `RLS ${clause} \`${quote(source)}\` lowers, but to a comparand the platform's shared filter check ` +
        `refuses (${firstSentence(faced)}), ${consequence(clause, DROPPED_FACE_REFUSED)}`,
      hint:
        rewrites.length > 0
          ? '`null` has no place inside a list or opposite an ordering operator — the platform refuses both in ' +
            'every filter it is sent, because no two backends agree on what they match. Test for no value with ' +
            `\`== null\` and for a value with \`!= null\`: ${rewrites.join('; ')}.`
          : 'Rewrite the comparand the check names inside the lowerable subset. ' + PUSHDOWN_SUBSET,
    });
  }

  // [#20158] The engine's own admission of the lowered read scope — run only
  // on a clause every pass above left clean, so one defect earns one finding.
  // The verdict and its sentence are the engine's; this rule adds the clause,
  // the object and what the refusal costs.
  const refused = judge && filter && findings.length === 0
    ? engineRefusal(judge, object, bridged, filter, probe)
    : null;
  if (refused) {
    findings.push({
      severity: 'error',
      rule: RLS_PREDICATE_UNENFORCEABLE,
      where,
      path,
      message:
        `RLS ${clause} \`${quote(source)}\` lowers, but the engine refuses to run the lowered filter on ` +
        `"${object}" (${refused.code} / ${refused.status}): ${refused.message} ${ENGINE_REFUSED_CONSEQUENCE}`,
      hint: engineRefusalHint(refused.code),
    });
  }

  return findings;
}

/**
 * Gate every stack-declared RLS predicate on the ONE thing the runtime does
 * with it: lower it to a FilterCondition (ADR-0056 D4).
 *
 * Pure `(stack, options) => Finding[]`; tolerates the normalized and the parsed
 * tier (`using` / `check` are plain `z.string()`, identical in both).
 *
 * @param options.judgeFilter [#20158] The engine's judge-only filter admission
 *   (`IObjectQLEngine.judgeFilter`, bound to its engine). Present, every
 *   read-scope `using` that the passes above leave clean is judged by it — see
 *   this file's header. Absent, that pass is skipped and nothing else changes.
 */
export function validateRlsPredicateEnforceability(
  stack: unknown,
  options: { judgeFilter?: IObjectQLEngine['judgeFilter'] } = {},
): RlsPredicateFinding[] {
  const findings: RlsPredicateFinding[] = [];
  const cfg = (stack ?? {}) as AnyRec;

  // [#16119] The object graph for the reference pass, built ONCE: `indexObjectGraph`
  // walks every object's whole field map, and a stack with N permission sets would
  // otherwise pay for that walk N times to answer the same question. It is the
  // SHARED index every field-existence rule in this package resolves through, so
  // the three skips (an object this stack does not define, an object with no
  // readable field map, registry-injected system columns) are the graph's and not
  // re-derived here.
  const graph: ObjectGraph = indexObjectGraph(cfg);

  recordsOf(cfg.permissions).forEach((ps, psIndex) => {
    recordsOf(ps.rowLevelSecurity).forEach((policy, pIndex) => {
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
        const psNameEarly = str(ps.name) || String(psIndex);
        const policyNameEarly = str(policy.name) || String(pIndex);
        const objectEarly = str(policy.object);
        const whereEarly =
          `permission set "${psNameEarly}" policy "${policyNameEarly}"` +
          (objectEarly ? ` on object "${objectEarly}"` : '');
        const pathEarly = `permissions[${psIndex}].rowLevelSecurity[${pIndex}].${clause}`;

        if (isSupportedRlsExpression(source)) {
          // [#16119] The shape is fine, so the REFERENCE pass owns this predicate.
          // Disjoint from everything below by construction: the three shape ids
          // only ever run on predicates this branch has already returned from.
          // [#20158] The engine judges the READ SCOPE only: a `using` on a
          // `select` / `all` policy that names its object.
          const judge =
            clause === 'using' && objectEarly && READ_SCOPE_OPERATIONS.has(str(policy.operation))
              ? options.judgeFilter
              : undefined;
          findings.push(
            ...referenceFindings(graph, source, clause, whereEarly, pathEarly, objectEarly, judge),
          );
          continue;
        }

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

        const where = whereEarly;
        const path = pathEarly;

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
