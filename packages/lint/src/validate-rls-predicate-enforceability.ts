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
 * Two declared surfaces, and nothing else:
 *
 * - `permissions[].rowLevelSecurity[]`. `rowLevelSecurity` is declared on
 *   `PermissionSetSchema` and nowhere else — `ObjectSchema` has no such key —
 *   and `permissions` is the one stack key `StackSchema` declares for
 *   permission sets.
 * - `objects[].defaultRowScope` (#24452). `ObjectSchema.defaultRowScope` is ONE
 *   policy of the same shape without `object` (`DefaultRowScopeSchema`), the
 *   declaring object implied. The security plugin's row-policy collection
 *   applies it when the caller's held sets carry no row policy for the object
 *   and operation, and from there it takes the path a held policy takes: the
 *   same `RLSCompiler`, the same drop, the same `RLS_DENY_FILTER`. So it is
 *   judged by the same passes ({@link judgePolicy}), with the declaring object
 *   as its target, at the same severity. Its findings name the object's
 *   default, never a permission set, because no permission set carries it.
 *
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
 * engine's verdict with its code and status: at authoring time the text is the
 * author's own, so nothing is withheld. [#22161] It quotes the verdict half of
 * the engine's leading sentence ({@link refusalVerdict}), as it does for the
 * shared filter check; the engine's reasoning and remedy are the `os explain`
 * entry's and the hint's.
 *
 * ## A field compared with a field that holds a list or an object (#19886)
 *
 * `record.status != record.tags`, with `tags` a `json` field or a `multiple`
 * lookup, lowers to `{ status: { $ne: { $field: 'tags' } } }` — a legal shape,
 * because the lowering knows the predicate's text and not the object's field
 * types. The engine's admission does not judge a `{ $field }` reference against
 * the referenced column's type either. Measured before this arm: every cell of
 * `==` / `!=` / `!(==)` / `>` / `<=`, against a `json`, `address`,
 * `multiselect`, `multiple` lookup and `multiple` user field, in both operand
 * orders, on every clause and operation, was clean at `os validate` and at the
 * save door. The runtime refuses every one of them: the write check refuses the
 * comparison per record when the compared column holds a list or an object
 * (`INVALID_FILTER` / 400, nothing stored), and driver-sql refuses a
 * cross-field comparison against such a column by its DECLARED type, so a read
 * the `using` scopes answers 400 and a by-id update or delete it scopes 403.
 *
 * This rule holds what neither of those holds: the declared field map
 * ({@link ObjectGraph}). So it judges by declared type, as driver-sql does, and
 * reads the spec's own value-shape classes rather than a list of its own —
 * {@link STRUCTURED_JSON_TYPES} (a structured JSON payload) and
 * {@link isMultiValueField} (an inherently-multi option type, or a
 * multi-capable type flagged `multiple: true`), the two driver-sql builds its
 * JSON-column set and its multi-valued test from. It runs on every clause, and
 * before the engine's pass, so the engine never judges a clause this arm
 * already refused: one defect, one finding.
 *
 * ## A field compared with a field of another comparison class (#20347)
 *
 * `record.status != record.amount` (text vs number) and
 * `record.status != record.photo` (text vs a single image) lower to legal
 * `{ status: { $ne: { $field: … } } }` shapes and hold no list, so the arm above
 * lets them through. Measured before this arm, through the real plugin-security
 * and ObjectQL on driver-sql, for those two and for `record.status !=
 * record.is_open` (a formula field): `os validate` reported them valid; the
 * read their `using` scopes answered `INVALID_FILTER` / 400 (driver-sql
 * compiles a column-to-column comparison only between two columns of ONE
 * comparison class, and refuses the file family and formula fields outright)
 * and a by-id update or delete it scopes `PERMISSION_DENIED` / 403; and an
 * insert their `check` judges — or their `using`, standing in as the check —
 * was ADMITTED and stored. The in-process write check had no class rule then
 * and compared the two raw values; since #20355 it refuses the comparison by
 * the same classification (`INVALID_FILTER` / 400), so every insert or update
 * it judges is refused and nothing is stored. One policy, three answers.
 *
 * This arm refuses the comparison where it is written, by the same rule the
 * read applies: {@link crossFieldComparisonVerdict} (`@objectstack/spec/data`),
 * the classification lifted from driver-sql, which now delegates to it
 * through `crossFieldColumnVerdict`. Only `comparable` passes; `cross-class` and `no-class` (a file
 * field, a formula field) are refused, and `unjudged` — a declared type outside
 * `FieldType` — is Zod's to reject, not this arm's. A comparison either side of
 * which holds a list or an object stays the arm above's, so no comparison is
 * reported twice. It runs on every clause, beside the arm above and ahead of
 * the engine's pass: one defect, one finding.
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
import {
  CROSS_FIELD_COMPARISON_CLASSES,
  CROSS_FIELD_COMPARISON_TYPE_CLASSES,
  STRUCTURED_JSON_TYPES,
  assertListComparandShapes,
  crossFieldComparisonVerdict,
  isMultiValueField,
  normalizeFilterComparandTypes,
  type CrossFieldColumnVerdict,
  type CrossFieldComparisonClass,
} from '@objectstack/spec/data';
import { ExecutionContextSchema } from '@objectstack/spec/kernel';
import {
  RELATIONSHIP_FIELD_TYPES,
  describeFieldPathVerdict,
  indexObjectGraph,
  isUnjudgeable,
  listNames,
  recordsOf,
  resolveFieldPath,
  suggestName,
  type GraphField,
  type ObjectGraph,
} from './object-graph.js';
import {
  declaredMembershipKeysOf,
  objectsDeclaringKey,
  stackObjectNamesOf,
  type MembershipKeyOwners,
} from './validate-membership-key-declarations.js';

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
/**
 * [#25234 refusal 11] A policy testing a declared membership key against a
 * column whose values can never be the key's: a column that references another
 * object, a column that is no reference, or the `id` of another object.
 */
export const RLS_PREDICATE_MEMBERSHIP_KEY_TARGET = 'rls-predicate-membership-key-target';

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

/*
 * [#22161] The `fix:` lines. Each finding's `hint` is one remedy sentence of
 * at most 200 characters, and what the hints used to enumerate — the lowerable
 * subset and its three traps, the rule each holding breaks with the other
 * rewrites a site admits, the comparison classes with their types, the four
 * ways to shrink an oversized predicate, the declared fields of the object,
 * what each kernel key holds and how an app stages a membership set, the
 * legacy SQL bridge's reach and the subquery route — is each id's
 * `os explain` entry (`rule-explanations.ts`), held to its source by this
 * file's tests. A predicate with several faulty sites gets the first site's
 * rewrite and a count of the rest.
 */

/** Rewrite into the lowerable subset — the shape arm of `rls-predicate-unenforceable`. */
const LOWERABLE_REWRITE =
  'Rewrite the predicate inside the lowerable subset (comparisons, `in`, `&&` `||` `!`, null tests and string ' +
  'methods over single-column fields); write `has(record.x)` as `record.x != null`';

/** A refused comparand with no `null` in it — the shared-face arm's other half. */
const COMPARAND_REWRITE =
  'Rewrite the comparand the verdict names inside the lowerable subset: a literal or a `current_user.*` value ' +
  'compared with a single-column field';

/** `rls-predicate-over-budget`: the four ways to shrink, in one line; the `&&` warning is never dropped. */
const OVER_BUDGET_FIX =
  'Make the predicate smaller: collapse an `||` chain into `field in [a, b, …]`, test a membership key ' +
  '`field in current_user.<key>`, or split a top-level `||` across policies (never a top-level `&&`)';

/**
 * `rls-predicate-unparseable`: the SQL-to-CEL translations in one line. What the
 * legacy bridge covers, and why a subquery has no CEL spelling, are the explanation's.
 */
const UNPARSEABLE_FIX =
  'Author the predicate in canonical CEL: `&&` / `||` for AND / OR, `!` for NOT, `startsWith` / `endsWith` / ' +
  '`contains` for LIKE; pre-resolve a subquery into a membership key';

/** `rls-predicate-unknown-field`: the verdict's "Did you mean" names the nearest declared column. */
const UNKNOWN_FIELD_FIX =
  'Point the predicate at a column the object declares (denormalise a value from another object onto it ' +
  'first), or delete the policy if the narrowing is gone';

/** `x (and N more)` — the first of several faulty sites' rewrites, and a count of the rest. */
function firstAndCount(items: readonly string[]): string {
  return `${items[0]}${items.length > 1 ? ` (and ${items.length - 1} more)` : ''}`;
}

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

/* ────────────────────────────────────────────────────────────────────────────
 * [#22161] The verdict clauses. Every finding of the five ids prints one
 * verdict sentence; what a dropped policy, a refused comparison or an engine
 * refusal does at request time — and the measurements behind it — is each id's
 * `os explain` entry (`rule-explanations.ts`, the "Row-level security and
 * sharing rules" block). The finding does not echo the predicate: its `path`
 * names the clause, and the predicate is author text of any length.
 * ──────────────────────────────────────────────────────────────────────────── */

/**
 * A judged predicate: a row policy's `using` or `check`, or [#25234] a
 * membership key's `filter`, which the security plugin compiles the same way
 * and AND-s into the roster read that resolves the key.
 */
type Clause = 'using' | 'check' | 'filter';

/** How a finding names the judged predicate. */
const CLAUSE_LABEL: Readonly<Record<Clause, string>> = {
  using: 'RLS using',
  check: 'RLS check',
  filter: 'membership key filter',
};

/** What a dropped policy no longer does, per clause. */
const DROPPED_OUTCOME: Readonly<Record<'using' | 'check', string>> = {
  using: 'grants no access',
  check: 'admits no write',
};

/**
 * What a refused membership key filter costs: the security plugin compiles it
 * before the roster read, and a filter that does not compile leaves the key
 * unresolved, so every policy reading the key fails closed.
 */
const FILTER_DROPPED = 'the key never resolves and every policy reading it matches no rows';

/** The clause that closes every verdict whose policy the runtime drops. */
function droppedClause(clause: Clause): string {
  if (clause === 'filter') return `so ${FILTER_DROPPED}`;
  return `so the policy is dropped and ${DROPPED_OUTCOME[clause]}`;
}

/** The same outcome as a sentence, after a verdict that ends one of its own. */
function droppedSentence(clause: Clause): string {
  if (clause === 'filter') return `So ${FILTER_DROPPED}.`;
  return `The policy is dropped and ${DROPPED_OUTCOME[clause]}.`;
}

/**
 * The verdict half of a quoted refusal: the text up to the first ` — `, where
 * the producer's own elaboration or suggested rewrite begins. That half is the
 * `fix:` line's and the `os explain` entry's job, and keeping it would carry
 * the verdict past one line. A refusal with no ` — ` is quoted whole.
 *
 * Exported for `validate-sharing-rule-enforceability.ts`, which quotes the
 * same compiler.
 */
export function refusalVerdict(detail: string): string {
  const cut = detail.indexOf(' — ');
  return cut === -1 ? detail : detail.slice(0, cut);
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

/**
 * [#25234] What the stack, and at the runtime publish gate the deployment,
 * says about `current_user.*` keys beyond the kernel's: the membership keys
 * objects declare (`ObjectSchema.membershipKeys`) and the keys the registered
 * code resolver owns.
 *
 * A declared key is no longer an unknown: the security plugin stages it as a
 * LIST on every request it resolves (`stageDeclaredMembershipKeys`), so the
 * probe binds it as one ({@link membershipKeyProbe}). Under `==` it then earns
 * the type fault a kernel list key earns (refusal 13), and under `in` its sites
 * can be traced back to it (refusal 11).
 */
interface MembershipKeyContext {
  /** Every key an object declares — the stack's, plus the deployment's at the runtime gate. */
  declared: ReadonlySet<string>;
  /**
   * Key → the object its values reference: the target of the declaring
   * object's `valueField`. Present only when one object the stack carries
   * declares the key and that column is a judgeable reference.
   */
  targetOf: ReadonlyMap<string, string>;
  /**
   * The registered resolver's keys, stated by the runtime publish gate.
   * Absent on the CLI, where a self-hosted resolver may own any key, so a key
   * nothing here owns stays `unknowable` in a membership position.
   */
  resolverKeys?: ReadonlySet<string>;
}

const NO_MEMBERSHIP_KEYS: MembershipKeyContext = { declared: new Set(), targetOf: new Map() };

/** The prefix of a declared key's probe member — see {@link membershipKeyProbe}. */
const MEMBERSHIP_PROBE_PREFIX = `${PROBE_SCALAR}membership:`;

/**
 * A declared membership key's probe: a one-member list whose member names the
 * key, so a lowered `in` site can be traced back to the key it tests. A list
 * because that is what the key holds on every request.
 */
function membershipKeyProbe(key: string): readonly string[] {
  return [`${MEMBERSHIP_PROBE_PREFIX}${key}`];
}

/** The declared key a lowered operand is the probe of, or `null`. */
function membershipKeyOfOperand(operand: unknown): string | null {
  if (!Array.isArray(operand) || operand.length !== 1 || typeof operand[0] !== 'string') return null;
  return operand[0].startsWith(MEMBERSHIP_PROBE_PREFIX) ? operand[0].slice(MEMBERSHIP_PROBE_PREFIX.length) : null;
}

/** Is this a declared key the kernel does not already own? */
function isDeclaredKey(membership: MembershipKeyContext, key: string): boolean {
  return membership.declared.has(key) && !PRERESOLVED_USER_KEYS.has(key);
}

function baseUserProbe(membership: MembershipKeyContext = NO_MEMBERSHIP_KEYS): UserProbe {
  const probe: UserProbe = {};
  for (const key of PRERESOLVED_USER_KEYS) probe[key] = kernelKeyProbe(key);
  for (const key of membership.declared) if (isDeclaredKey(membership, key)) probe[key] = membershipKeyProbe(key);
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
function resolveReferences(bridged: string, membership: MembershipKeyContext = NO_MEMBERSHIP_KEYS): {
  filter: Record<string, unknown> | null;
  unresolvedScalars: string[];
  /**
   * [#25234] The `current_user.KEY` references in a membership position that
   * no kernel key or declaration owns — `unknowable` on the CLI, judged
   * against the registered resolver's keys at the runtime gate (refusal 12).
   */
  unresolvedMemberships: string[];
  /** The probe as the last compile saw it — every discovered key bound. */
  probe: UserProbe;
  /** The compiler's `detail` when that compile was refused `unsupported`. */
  refusal: string | null;
} {
  const probe = baseUserProbe(membership);
  const unresolvedScalars: string[] = [];
  const unresolvedMemberships: string[] = [];
  const stop = (refusal: string | null = null) => ({
    filter: null,
    unresolvedScalars,
    unresolvedMemberships,
    probe,
    refusal,
  });
  for (let pass = 0; pass < 32; pass++) {
    const res = compileWithProbe(bridged, probe);
    if (res.ok) {
      return { filter: res.filter as Record<string, unknown>, unresolvedScalars, unresolvedMemberships, probe, refusal: null };
    }
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
      // from a typo here, so this is `unknowable`, never a finding — unless
      // the runtime gate states who owns every key ({@link MembershipKeyContext}).
      unresolvedMemberships.push(path);
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
function attributeTypeFault(
  bridged: string,
  probe: UserProbe,
  membership: MembershipKeyContext = NO_MEMBERSHIP_KEYS,
): TypeFault | null {
  const swaps: Array<{ variable: string; holds: RuntimeHolding; context: unknown; marker: unknown }> = [];
  // [#25234] A declared key holds a list on every request it resolves, as a
  // kernel list key does, so it is swapped the same way (refusal 13).
  const owned = [...PRERESOLVED_USER_KEYS, ...[...membership.declared].filter((k) => isDeclaredKey(membership, k))];
  for (const key of owned) {
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

/** The lowered string-method operators, back to the CEL method an author writes. */
const STRING_METHOD_OF: ReadonlyMap<string, string> = new Map([
  ['$startsWith', 'startsWith'],
  ['$endsWith', 'endsWith'],
  ['$contains', 'contains'],
]);

/**
 * The pasteable rewrite for one lowered site of a type fault — [#22161] the
 * primary one only, for the one-line `fix:`. The alternatives a site also
 * admits (pass one value instead of the set to a string method; name a
 * membership key, or an app-staged §7.3.1 set, for a set) are the
 * explanation's, beside the kernel keys by what each holds.
 */
function typeFaultRewrite(fault: TypeFault, site: LoweredSite): string {
  const f = `record.${site.field}`;
  const v = fault.variable;
  const method = STRING_METHOD_OF.get(site.op);
  if (fault.holds === 'list') {
    if (site.op === '==') return `replace \`${f} == ${v}\` with \`${f} in ${v}\``;
    if (site.op === '$ne') return `replace \`${f} != ${v}\` with \`!(${f} in ${v})\``;
    if (method) return `replace \`${f}.${method}(${v})\` with the membership test \`${f} in ${v}\``;
  }
  if (fault.holds === 'one value' && site.op === '$in') {
    return `replace \`${f} in ${v}\` with \`${f} == ${v}\``;
  }
  if (fault.holds === 'context object') {
    // Which key is the author's to name: the explanation lists the kernel
    // keys by what each holds, so the rewrite names the slot, not a guess.
    if (site.op === '$in') {
      return `replace \`${f} in current_user\` with the membership key that holds the set: \`${f} in current_user.<key>\``;
    }
    if (method) {
      return (
        `replace \`${f}.${method}(current_user)\` with the key that holds the string: ` +
        `\`${f}.${method}(current_user.<key>)\``
      );
    }
  }
  return `rewrite the comparison on \`${f}\` so \`${v}\` sits where its value fits`;
}

/**
 * What the reference holds and where it was used — the type-fault verdict.
 * That `ExecutionContext` declares, and the kernel resolves, each kernel key
 * with this type on every request is the `os explain` entry's.
 */
const HOLDING_VERDICT: Readonly<Record<RuntimeHolding, (variable: string) => string>> = {
  list: (v) => `\`${v}\` is a membership set, a list on every request, used where one value belongs`,
  'one value': (v) => `\`${v}\` holds ONE value on every request, used where a set belongs`,
  'context object': () =>
    '`current_user` alone is the whole caller context object, used where one value or one set belongs',
};

// [#22161] The one-sentence rule each holding breaks led the hint until the
// hint became one line; it is the `rls-predicate-unenforceable` explanation's
// now, which `os explain` prints.

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
              'to keep matching a missing value',
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
 * The lowered field-to-field operators, back to the CEL operator an author
 * writes. They are the six `cel-to-filter.ts` emits with a `{ $field }`
 * comparand, and the six the write check and driver-sql refuse against a
 * list-holding column.
 */
const FIELD_COMPARISON_SYMBOL: ReadonlyMap<string, string> = new Map([
  ['$eq', '=='],
  ['$ne', '!='],
  ...ORDERING_SYMBOL,
]);

/**
 * Is the field declared to hold a list or an object (see this file's header
 * for the two spec classes)?
 */
function holdsListOrObject(meta: GraphField | undefined): boolean {
  const type = meta?.type;
  if (!type) return false;
  return STRUCTURED_JSON_TYPES.has(type) || isMultiValueField({ type, multiple: meta.multiple === true });
}

/** One lowered comparison between two columns, at least one of which holds a list or an object. */
export interface ListHoldingComparison {
  /** The comparison as the author wrote it, back in CEL. */
  written: string;
  /** The column(s) of the comparison declared to hold a list or an object. */
  holders: string[];
}

/**
 * Every lowered `{ $field }` comparison in which either column is declared to
 * hold a list or an object, read off the COMPILER'S OUTPUT and resolved against
 * the object graph. A column the graph cannot answer for (an object outside the
 * stack, no field map, a name it does not declare) is not judged here; the
 * reference pass above owns an unknown name.
 *
 * Exported for `validate-sharing-rule-enforceability.ts`, which judges the same
 * class on a sharing rule's lowered `condition`: one classification, two rules.
 */
export function listHoldingComparisons(
  graph: ObjectGraph,
  object: string,
  filter: Record<string, unknown>,
): ListHoldingComparison[] {
  const found = new Map<string, ListHoldingComparison>();
  const sites = loweredSites(filter, (op, operand) =>
    FIELD_COMPARISON_SYMBOL.has(op) &&
    !!operand && typeof operand === 'object' && !Array.isArray(operand) &&
    typeof (operand as Record<string, unknown>).$field === 'string');
  for (const site of sites) {
    const referenced = (site.operand as { $field: string }).$field;
    const holders: string[] = [];
    for (const name of new Set([site.field, referenced])) {
      const verdict = resolveFieldPath(graph, object, name);
      if (verdict?.kind === 'ok' && holdsListOrObject(verdict.meta)) holders.push(name);
    }
    if (holders.length === 0) continue;
    const written = `record.${site.field} ${FIELD_COMPARISON_SYMBOL.get(site.op)} record.${referenced}`;
    found.set(written, { written, holders });
  }
  return [...found.values()];
}

/** The comparisons after the first, which a verdict counts rather than quotes. */
function moreComparisons(count: number): string {
  return count > 1 ? ` (and ${count - 1} more)` : '';
}

/**
 * [#22161] The list-holding verdict, after its subject: the first comparison,
 * the column(s) in it that hold a list or an object, and a count of the rest.
 * Why such a column is not one comparable value, and what the refusal costs,
 * is the `os explain` entry's. Shared with the sharing-rule arm.
 */
export function listHoldingVerdict(comparisons: readonly ListHoldingComparison[]): string {
  const [first] = comparisons;
  const holders = first.holders.map((name) => `\`${name}\``).join(' and ');
  return (
    `compares \`${first.written}\`, where ${holders} ${first.holders.length > 1 ? 'hold' : 'holds'} a list ` +
    `or an object${moreComparisons(comparisons.length)}`
  );
}

/**
 * What a refused field-to-field comparison costs, per clause — the list-holding
 * and the cross-class arm alike. Measured through the real plugin-security on
 * driver-sql, every clause and operation (this file's header); the full account
 * is the `os explain` entry's.
 */
const REFUSED_COMPARISON: Readonly<Record<Clause, string>> = {
  using: 'so the SQL drivers refuse every read it scopes (INVALID_FILTER / 400)',
  check: 'so the write check refuses the writes it judges (INVALID_FILTER / 400)',
  filter: 'so the roster read is refused (INVALID_FILTER / 400) and the key never resolves',
};

/* ────────────────────────────────────────────────────────────────────────────
 * #20347 — a field compared with a field of ANOTHER comparison class (see the
 * header). The classification is the spec's; this block only names it.
 * ──────────────────────────────────────────────────────────────────────────── */

/** How one comparison class reads in a sentence. */
const CLASS_PHRASE: Readonly<Record<CrossFieldComparisonClass, string>> = {
  numeric: 'a number',
  text: 'text',
  boolean: 'a boolean',
  date: 'a date',
  datetime: 'a datetime',
  time: 'a time of day',
};

/** A single-valued column with no class, as a noun (a list or an object is the arm above's). */
const NO_CLASS_NOUN: Readonly<Record<'file' | 'formula', string>> = {
  file: 'a file field',
  formula: 'a formula field',
};

/**
 * Every comparison class with the declared types it holds, read off the spec's
 * class table — so a type added to one of its value-class sets later is listed
 * here without a change to this file.
 */
export const CROSS_FIELD_CLASS_LISTING: string = CROSS_FIELD_COMPARISON_CLASSES.map((cls) => {
  const types = CROSS_FIELD_COMPARISON_TYPE_CLASSES
    .filter((row) => row.verdict.kind === 'class' && row.verdict.class === cls)
    .flatMap((row) => [...row.types]);
  return `${CLASS_PHRASE[cls]} only with ${CLASS_PHRASE[cls]} (${types.map((t) => `\`${t}\``).join(', ')})`;
}).join('; ');

/** A declared column the graph answers for, with the slice the classification reads. */
function declaredColumn(
  graph: ObjectGraph,
  object: string,
  name: string,
): { name: string; type: string; multiple?: boolean; meta: GraphField } | null {
  const verdict = resolveFieldPath(graph, object, name);
  if (verdict?.kind !== 'ok' || !verdict.meta || typeof verdict.meta.type !== 'string') return null;
  return { name, type: verdict.meta.type, multiple: verdict.meta.multiple === true, meta: verdict.meta };
}

/** One side of a refused comparison: its class, or why it has none. */
function sidePhrase(verdict: CrossFieldColumnVerdict): string {
  if (verdict.kind === 'class') return CLASS_PHRASE[verdict.class];
  return verdict.reason === 'list-or-object' ? 'a list or an object' : NO_CLASS_NOUN[verdict.reason];
}

/** One lowered comparison between two columns that share no comparison class. */
export interface CrossClassComparison {
  /** The comparison as the author wrote it, back in CEL. */
  written: string;
  /** The two sides, in the written order: each one's class, or why it has none (`text vs a number`). */
  why: string;
}

/**
 * Every lowered `{ $field }` comparison whose two declared columns share no
 * comparison class — two classes (text vs number), or a column with none (a
 * file field, a formula field) — judged by {@link crossFieldComparisonVerdict}.
 * Read off the COMPILER'S OUTPUT and resolved against the object graph, like
 * {@link listHoldingComparisons}; a comparison either side of which holds a list
 * or an object is that function's and is skipped here, and a column the graph
 * cannot answer for, or whose declared type is outside `FieldType`, is not
 * judged.
 *
 * Exported for `validate-sharing-rule-enforceability.ts`, which judges the same
 * class on a sharing rule's lowered `condition`: one classification, two rules.
 */
export function crossClassComparisons(
  graph: ObjectGraph,
  object: string,
  filter: Record<string, unknown>,
): CrossClassComparison[] {
  const found = new Map<string, CrossClassComparison>();
  const sites = loweredSites(filter, (op, operand) =>
    FIELD_COMPARISON_SYMBOL.has(op) &&
    !!operand && typeof operand === 'object' && !Array.isArray(operand) &&
    typeof (operand as Record<string, unknown>).$field === 'string');
  for (const site of sites) {
    const referenced = (site.operand as { $field: string }).$field;
    const target = declaredColumn(graph, object, site.field);
    const ref = declaredColumn(graph, object, referenced);
    if (!target || !ref) continue;
    if (holdsListOrObject(target.meta) || holdsListOrObject(ref.meta)) continue;
    const verdict = crossFieldComparisonVerdict(target, ref);
    let why: string;
    if (verdict.verdict === 'cross-class') {
      why = `${CLASS_PHRASE[verdict.left]} vs ${CLASS_PHRASE[verdict.right]}`;
    } else if (verdict.verdict === 'no-class') {
      why = `${sidePhrase(verdict.left)} vs ${sidePhrase(verdict.right)}`;
    } else {
      continue;
    }
    const written = `record.${site.field} ${FIELD_COMPARISON_SYMBOL.get(site.op)} record.${referenced}`;
    found.set(written, { written, why });
  }
  return [...found.values()];
}

/**
 * [#22161] The cross-class verdict, after its subject: the first comparison,
 * why its two fields share no class, and a count of the rest. Why classes
 * decide comparability, and what the refusal costs, is the `os explain`
 * entry's. Shared with the sharing-rule arm.
 */
export function crossClassVerdict(comparisons: readonly CrossClassComparison[]): string {
  const [first] = comparisons;
  return (
    `compares \`${first.written}\`, which no comparison class spans (${first.why})` +
    moreComparisons(comparisons.length)
  );
}

/*
 * [#22161] The prescription both rules shared, ahead of their per-surface
 * alternatives (`CROSS_CLASS_REMEDY`), listed every class with its types on
 * the `fix:` line. The listing is the explanation's now — written out there
 * and held to {@link CROSS_FIELD_CLASS_LISTING} by the rules' tests — and each
 * rule's `fix:` line is one sentence naming its own alternatives.
 */

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

/** The prescription for an engine refusal, keyed by the engine's `code` (never by its prose). */
function engineRefusalHint(code: string): string {
  if (code === 'FILTER_TOKEN_UNKNOWN' || code === 'FILTER_TOKEN_UNRESOLVED') {
    // [#22161] One line; the `current_user` keys are the explanation's list.
    return (
      "Write the caller's value as a `current_user` key, never a `{…}` placeholder: `owner == current_user.id`, " +
      "not `owner == '{current_user_id}'`"
    );
  }
  if (code === 'INVALID_FIELD') {
    return (
      'A row filter reaches only the stored columns of its own object. Denormalise the value the engine ' +
      'names onto this object (a stored field, written when the source changes) and test that column.'
    );
  }
  return (
    'Rewrite the comparison the engine names: a text operator only on a field that holds a string, and a date ' +
    'or datetime field only against a value its storage can read'
  );
}

/** [#25234] One lowered `in` site that tests a declared key against the wrong column (refusal 11). */
interface MembershipTargetFault {
  key: string;
  /** The key's values' object. */
  target: string;
  /** What the compared column holds, as a phrase. */
  holds: string;
}

/**
 * The `in` / not-`in` sites of a lowered predicate that test a declared key
 * against a column whose values can never be the key's (refusal 11).
 *
 * The key holds ids of its `valueField`'s target T. So the compared column must
 * reference T, or be the `id` of T itself. A reference to another object, a
 * column that is no reference, and the `id` of another object hold values that
 * never equal a T id: `x in KEY` then matches no row, and `!(x in KEY)` every
 * row. Exact, because the declaration names T. A key whose target is not known
 * here, and a column the graph cannot answer for, are not judged.
 */
function membershipTargetFaults(
  graph: ObjectGraph,
  object: string,
  filter: Record<string, unknown>,
  membership: MembershipKeyContext,
): MembershipTargetFault[] {
  const faults: MembershipTargetFault[] = [];
  const sites = loweredSites(
    filter,
    (op, operand) => (op === '$in' || op === '$nin') && membershipKeyOfOperand(operand) !== null,
  );
  for (const site of sites) {
    const key = membershipKeyOfOperand(site.operand) as string;
    const target = membership.targetOf.get(key);
    if (!target || !object) continue;
    if (site.field === 'id') {
      if (object !== target) faults.push({ key, target, holds: `\`id\` of '${object}'` });
      continue;
    }
    const verdict = resolveFieldPath(graph, object, site.field);
    if (!verdict || verdict.kind !== 'ok' || !verdict.meta?.type) continue;
    const meta = verdict.meta;
    if (!RELATIONSHIP_FIELD_TYPES.has(meta.type as string)) {
      faults.push({ key, target, holds: `'${site.field}', a \`${meta.type}\` field` });
    } else if (meta.reference && meta.reference !== target) {
      faults.push({ key, target, holds: `'${site.field}', which references '${meta.reference}'` });
    }
  }
  return faults;
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
  clause: Clause,
  where: string,
  path: string,
  object: string,
  /**
   * [#20158] The engine's judge, when this clause is a read scope the caller
   * can have judged — `undefined` otherwise (no judge handed in, a `check`, a
   * policy outside the read scope, or no object named).
   */
  judge?: FilterJudge,
  /** [#25234] The membership keys the stack and the deployment declare. */
  membership: MembershipKeyContext = NO_MEMBERSHIP_KEYS,
): RlsPredicateFinding[] {
  const findings: RlsPredicateFinding[] = [];
  const bridged = sqlPredicateToCel(source);
  const { filter, unresolvedScalars, unresolvedMemberships, probe, refusal } = resolveReferences(bridged, membership);

  for (const fieldPath of filterFieldPaths(filter)) {
    const verdict = resolveFieldPath(graph, object, fieldPath);
    if (isUnjudgeable(verdict) || !verdict) continue;
    const account = describeFieldPathVerdict(
      verdict,
      fieldPath,
      clause === 'filter' ? 'membership key filter field' : `${CLAUSE_LABEL[clause]} predicate field`,
    );
    if (!account) continue;
    findings.push({
      severity: 'error',
      rule: RLS_PREDICATE_UNKNOWN_FIELD,
      where,
      path,
      message: `${account.message} ${droppedSentence(clause)}`,
      // [#22161] One line: the verdict's "Did you mean" names the nearest
      // declared column, so the object's whole field list (`account.detail`)
      // and the rename / join reasoning are the explanation's.
      hint: UNKNOWN_FIELD_FIX,
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
        `${CLAUSE_LABEL[clause]} reads \`${variablePath}\`, which nothing pre-resolves, in a scalar position no request ` +
        `can ever fill, ${droppedClause(clause)}`,
      // [#22161] One remedy line, naming only the fixed key set and the
      // nearest key, so no author text can lengthen it. What each key holds,
      // and how an app stages a membership set, are the explanation's.
      hint:
        `Read a pre-resolved key (${listNames(PRERESOLVED_USER_KEYS)}), or test an app-staged membership ` +
        `set with \`in\`, never \`==\`.${suggestName(key, PRERESOLVED_USER_KEYS)}`,
    });
  }

  // [#25234 refusal 12] A key in a membership position that no kernel key,
  // declaration or registered resolver owns. Judged only where the runtime
  // gate states the resolver's keys: on the CLI a self-hosted resolver may own
  // any key, so there it stays `unknowable`. A nested path is not a key.
  const resolverKeys = membership.resolverKeys;
  if (resolverKeys) {
    for (const variablePath of unresolvedMemberships) {
      const key = variablePath.slice('current_user.'.length);
      if (key.includes('.') || resolverKeys.has(key) || membership.declared.has(key)) continue;
      const known = [...membership.declared, ...resolverKeys];
      findings.push({
        severity: 'error',
        rule: RLS_PREDICATE_UNKNOWN_USER_VARIABLE,
        where,
        path,
        message:
          `${CLAUSE_LABEL[clause]} reads \`${variablePath}\` as a membership set, which no kernel key, membership ` +
          `key declaration or registered resolver owns, ${droppedClause(clause)}`,
        hint:
          `Declare \`${key}\` in its roster object's \`membershipKeys\`, or test a key that is declared.` +
          suggestName(key, known),
      });
    }
  }

  // [#19951] The refusals the shape check cannot see (the block above
  // {@link attributeTypeFault}). A refusal no single type swap cures — the
  // probe-artefact class — reports nothing.
  const fault = refusal !== null ? attributeTypeFault(bridged, probe, membership) : null;
  if (refusal !== null && fault) {
    findings.push({
      severity: 'error',
      rule: RLS_PREDICATE_UNENFORCEABLE,
      where,
      path,
      message: `${CLAUSE_LABEL[clause]}: ${HOLDING_VERDICT[fault.holds](fault.variable)}, ${droppedClause(clause)}`,
      hint: firstAndCount(fault.sites.map((site) => typeFaultRewrite(fault, site))),
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
      // [#20212] `RLSCompiler.compileFilter` runs the same two faces on every
      // compiled policy filter, `using` and `check` alike, so the policy is
      // dropped on every request, exactly as a TYPE fault is.
      message: `${CLAUSE_LABEL[clause]} lowers to a refused comparand (${firstSentence(faced)}), ${droppedClause(clause)}`,
      hint: rewrites.length > 0 ? firstAndCount(rewrites) : COMPARAND_REWRITE,
    });
  }

  // [#19886] A field compared with a field that holds a list or an object,
  // judged by DECLARED type (this file's header). Every clause, and ahead of
  // the engine's pass below, which then does not judge this clause at all.
  const listComparisons = filter ? listHoldingComparisons(graph, object, filter) : [];
  if (listComparisons.length > 0) {
    findings.push({
      severity: 'error',
      rule: RLS_PREDICATE_UNENFORCEABLE,
      where,
      path,
      message: `${CLAUSE_LABEL[clause]} ${listHoldingVerdict(listComparisons)}, ${REFUSED_COMPARISON[clause]}`,
      hint:
        'Compare with a single-valued column, a literal or a `current_user` value ' +
        '(`record.owner in current_user.org_user_ids`), or move the condition into a validation rule or a hook',
    });
  }

  // [#20347] A field compared with a field of ANOTHER comparison class — two
  // classes, or a file / formula field with none — by the spec's classification
  // (this file's header). Every clause, beside the arm above (which keeps every
  // comparison against a list or an object), and ahead of the engine's pass.
  const crossClass = filter ? crossClassComparisons(graph, object, filter) : [];
  if (crossClass.length > 0) {
    findings.push({
      severity: 'error',
      rule: RLS_PREDICATE_UNENFORCEABLE,
      where,
      path,
      message: `${CLAUSE_LABEL[clause]} ${crossClassVerdict(crossClass)}, ${REFUSED_COMPARISON[clause]}`,
      hint:
        'Compare a field only with a field of its comparison class, or with a literal or a `current_user` value; ' +
        'if both columns do hold comparable values, fix the declaration',
    });
  }

  // [#25234 refusal 11] A declared key tested against a column whose values
  // can never be the key's. Every clause; ahead of the engine's pass.
  const targetFaults = filter ? membershipTargetFaults(graph, object, filter, membership) : [];
  if (targetFaults.length > 0) {
    const first = targetFaults[0];
    findings.push({
      severity: 'error',
      rule: RLS_PREDICATE_MEMBERSHIP_KEY_TARGET,
      where,
      path,
      message:
        `${CLAUSE_LABEL[clause]} tests ${first.holds} against \`current_user.${first.key}\`, which holds ` +
        `'${first.target}' ids, so the two never match${targetFaults.length > 1 ? ` (and ${targetFaults.length - 1} more)` : ''}`,
      hint: `Test the key against a column that references '${first.target}', or against \`id\` on '${first.target}'`,
    });
  }

  // [#20158] The engine's own admission of the lowered read scope — run only
  // on a clause every pass above left clean, so one defect earns one finding.
  // The verdict and its sentence are the engine's; this rule adds the clause.
  // What the refusal costs (every analytics query the read scope reaches) is
  // the `os explain` entry's.
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
        `${CLAUSE_LABEL[clause]} (${refused.code} / ${refused.status}): ${refusalVerdict(firstSentence(refused.message))}`,
      hint: engineRefusalHint(refused.code),
    });
  }

  return findings;
}

/** Where one policy sits: the object it targets, how a finding names it, and its config path. */
interface PolicySite {
  /** The policy's target object (`''` when it names none). */
  object: string;
  /** Human-readable location, the finding's `where`. */
  where: string;
  /** Config path of the policy itself; each clause appends `.using` / `.check`. */
  path: string;
}

/** The rule's inputs beyond the stack. */
interface JudgeOptions {
  judgeFilter?: IObjectQLEngine['judgeFilter'];
  /** [#25234] The deployment's membership-key owners, stated by the runtime publish gate. */
  membershipKeyOwners?: MembershipKeyOwners;
}

/**
 * Every finding one policy's `using` and `check` earn — the whole judgement,
 * shape pass and reference pass, for a policy wherever it is declared. The
 * walker below calls it for a permission set's policy and for an object's
 * default row scope alike, so the two sources cannot be judged differently.
 */
function judgePolicy(
  graph: ObjectGraph,
  policy: AnyRec,
  site: PolicySite,
  options: JudgeOptions,
  membership: MembershipKeyContext,
): RlsPredicateFinding[] {
  const findings: RlsPredicateFinding[] = [];
  for (const clause of ['using', 'check'] as const) {
    const source = str(policy[clause]);
    // Absent / blank is Zod's to judge (`using` is required on the schema);
    // inventing a second complaint about the shape here would be the
    // double-report this rule avoids for everything else.
    if (!source.trim()) continue;
    // [#20158] The engine judges the READ SCOPE only: a `using` on a
    // `select` / `all` policy that names its object.
    const judge =
      clause === 'using' && site.object && READ_SCOPE_OPERATIONS.has(str(policy.operation))
        ? options.judgeFilter
        : undefined;
    findings.push(...judgeClause(graph, source, clause, site, judge, membership));
  }
  return findings;
}

/**
 * Every finding one predicate earns: the shape pass, then the reference pass.
 * One function for a policy's two clauses and a membership key's `filter`
 * (#25234), which the security plugin compiles by the same compiler.
 */
function judgeClause(
  graph: ObjectGraph,
  source: string,
  clause: Clause,
  site: PolicySite,
  judge: FilterJudge | undefined,
  membership: MembershipKeyContext,
): RlsPredicateFinding[] {
  const findings: RlsPredicateFinding[] = [];
  // ── The verdict. This is the consumer's own function, not a model of
  // it: `RLSCompiler.compileFilter` calls the SAME `isSupportedRlsExpression`
  // to decide whether a dropped policy warrants its WARN. There is no
  // heuristic here to drift.
  const object = site.object;
  const where = site.where;
  const path = `${site.path}.${clause}`;

  if (isSupportedRlsExpression(source)) {
    // [#16119] The shape is fine, so the REFERENCE pass owns this predicate.
    // Disjoint from everything below by construction: the three shape ids
    // only ever run on predicates this branch has already returned from.
    findings.push(
      ...referenceFindings(graph, source, clause, where, path, object, judge, membership),
    );
    return findings;
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
        `${CLAUSE_LABEL[clause]} is valid CEL but overruns the parse bound ${bound}${budget}${measured} ` +
        `(${overrun.summary}), ${droppedClause(clause)}`,
      // [#22161] One line; the four options in full, and why a top-level
      // `&&` must never be split, are the explanation's.
      hint: OVER_BUDGET_FIX,
    });
    return findings;
  }

  if (parseError) {
    findings.push({
      severity: 'error',
      rule: RLS_PREDICATE_UNPARSEABLE,
      where,
      path,
      message:
        `${CLAUSE_LABEL[clause]} does not parse as CEL, even after the legacy SQL bridge (${detail}), ` +
        droppedClause(clause),
      hint: UNPARSEABLE_FIX,
    });
    return findings;
  }

  findings.push({
    severity: 'error',
    rule: RLS_PREDICATE_UNENFORCEABLE,
    where,
    path,
    message: `${CLAUSE_LABEL[clause]} is not lowerable (${refusalVerdict(detail)}), ${droppedClause(clause)}`,
    hint: LOWERABLE_REWRITE,
  });
  return findings;
}

/**
 * [#25234] The membership keys a predicate is judged against: every key the
 * stack's objects declare, plus — at the runtime gate — every key the live
 * objects declare and the registered resolver's keys. A key's target is read
 * off the one declaring object the stack carries; a key two objects declare,
 * or whose declaring object the stack does not carry, has none here.
 */
function membershipKeyContextOf(
  cfg: AnyRec,
  graph: ObjectGraph,
  owners: MembershipKeyOwners | undefined,
): MembershipKeyContext {
  const declaredHere = declaredMembershipKeysOf(cfg);
  if (declaredHere.length === 0 && !owners) return NO_MEMBERSHIP_KEYS;
  const declared = new Set<string>(declaredHere.map((d) => d.key));
  const stackNames = stackObjectNamesOf(cfg);
  // A stored declaration counts only while the stack does not carry (and so
  // override) every object that declares it.
  for (const key of owners?.declaredBy.keys() ?? []) {
    if (objectsDeclaringKey(key, declaredHere, stackNames, owners).length > 0) declared.add(key);
  }
  const targetOf = new Map<string, string>();
  for (const decl of declaredHere) {
    if (objectsDeclaringKey(decl.key, declaredHere, stackNames, owners).length !== 1) continue;
    const verdict = resolveFieldPath(graph, decl.object, decl.valueField);
    if (!verdict || verdict.kind !== 'ok') continue;
    const meta: GraphField = verdict.meta ?? {};
    if (meta.type && RELATIONSHIP_FIELD_TYPES.has(meta.type) && meta.reference) targetOf.set(decl.key, meta.reference);
  }
  return { declared, targetOf, ...(owners ? { resolverKeys: owners.resolverKeys } : {}) };
}

/**
 * The first `current_user` value a membership key's `filter` reads, or `null`.
 *
 * Asked of the compiler, with the caller context the security plugin hands
 * it for a filter: an empty one. Any `current_user.*` is then unresolved, as it
 * is at runtime, whatever the key.
 */
function callerValueRead(source: string): string | null {
  const res = compileCelToFilter(sqlPredicateToCel(source), { variables: { current_user: {} } });
  if (res.ok || res.reason !== 'unresolved-variable') return null;
  const path = unresolvedVariablePath(res.detail);
  return path && (path === 'current_user' || path.startsWith('current_user.')) ? path : null;
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
 * @param options.membershipKeyOwners [#25234] The deployment's membership-key
 *   owners — the registered resolver's keys and every key the live objects
 *   declare — stated by the runtime publish gate. Present, a key in a
 *   membership position that nobody owns is refused (refusal 12). Absent (the
 *   CLI), such a key stays `unknowable`, as before.
 */
export function validateRlsPredicateEnforceability(
  stack: unknown,
  options: JudgeOptions = {},
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
  // [#25234] The declared membership keys every predicate below is judged
  // against: bound as lists, traced to their targets — see `## Membership keys`.
  const membership = membershipKeyContextOf(cfg, graph, options.membershipKeyOwners);

  // The permission sets' policies (`permissions[].rowLevelSecurity[]`).
  recordsOf(cfg.permissions).forEach((ps, psIndex) => {
    const psName = str(ps.name) || String(psIndex);
    recordsOf(ps.rowLevelSecurity).forEach((policy, pIndex) => {
      const object = str(policy.object);
      findings.push(
        ...judgePolicy(graph, policy, {
          object,
          where:
            `permission set "${psName}" policy "${str(policy.name) || String(pIndex)}"` +
            (object ? ` on object "${object}"` : ''),
          path: `permissions[${psIndex}].rowLevelSecurity[${pIndex}]`,
        }, options, membership),
      );
    });
  });

  // [#24452] Each object's default row scope (`objects[].defaultRowScope`):
  // the same policy shape without `object`, which the declaring object
  // implies. The security plugin's row-policy collection hands it to the same
  // `RLSCompiler` an authored policy reaches, so it is judged by the same
  // passes, with the declaring object as its target — see this file's
  // `## Scope`.
  recordsOf(cfg.objects).forEach((obj, oIndex) => {
    const scope = obj.defaultRowScope;
    if (!scope || typeof scope !== 'object' || Array.isArray(scope)) return;
    const object = str(obj.name);
    const scopeName = str((scope as AnyRec).name);
    findings.push(
      ...judgePolicy(graph, scope as AnyRec, {
        object,
        where: `default row scope${scopeName ? ` "${scopeName}"` : ''} of object "${object || String(oIndex)}"`,
        path: `objects[${oIndex}].defaultRowScope`,
      }, options, membership),
    );
  });

  // [#25234 refusal 7] Each declared membership key's `filter`. The security
  // plugin compiles it by the same compiler, against the declaring object's
  // columns and with NO caller, before the roster read; a filter that does not
  // compile leaves the key unresolved. So it is judged by the same passes, with
  // the declaring object as its target, after one check of its own: it reads no
  // `current_user` value — see `## Membership keys`.
  for (const decl of declaredMembershipKeysOf(cfg)) {
    const source = decl.filter ?? '';
    if (!source.trim()) continue;
    const site: PolicySite = {
      object: decl.object,
      where: `membership key "${decl.key}" of object "${decl.object}"`,
      path: `objects[${decl.objectIndex}].membershipKeys.${decl.key}`,
    };
    const callerRead = callerValueRead(source);
    if (callerRead) {
      findings.push({
        severity: 'error',
        rule: RLS_PREDICATE_UNKNOWN_USER_VARIABLE,
        where: site.where,
        path: `${site.path}.filter`,
        message:
          `${CLAUSE_LABEL.filter} reads \`${callerRead}\`, but a key's filter is resolved with no caller, ` +
          `so ${FILTER_DROPPED}`,
        hint: "Narrow the roster with this object's own columns only (`active == true`): a key is never built from a caller value",
      });
      continue;
    }
    findings.push(...judgeClause(graph, source, 'filter', site, options.judgeFilter, membership));
  }

  return findings;
}
