/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * Client-side evaluation of the **list-view conditional tier** — conditional
 * formatting and row-action visibility — on the canonical CEL engine.
 *
 * B2 (ADR-0036) moved *field-level* rules (`visibleWhen` / `readonlyWhen` /
 * `requiredWhen`) onto `@objectstack/formula`'s `ExpressionEngine`, evaluated
 * identically on the client and the server. The list tier historically stayed
 * on the legacy `ExpressionEvaluator` (a JS-dialect recursive-descent parser),
 * even though `@objectstack/spec` already types these surfaces as CEL
 * (`ListViewSchema.conditionalFormatting[].condition` and `ActionSchema.visible`
 * are `ExpressionInputSchema` → `{ dialect: 'cel', source }`). This module
 * converges them onto the same engine so the whole platform speaks one dialect
 * (framework ADR-0058, "one authoring language, one interpret backend").
 *
 * Two evaluation entry points:
 *   - {@link evalRowPredicate} — a single boolean predicate over a row record
 *     (row-action `visible` / `disabled`, or a formatting `condition`).
 *   - {@link resolveConditionalFormatting} — the one implementation of the
 *     three historical rule shapes, returning the first matching rule's style.
 *
 * **Dialect routing.** A predicate authored as the `{ dialect: 'cel', source }`
 * envelope is authoritative CEL and is *always* sent to the CEL engine. A bare
 * string is CEL per the spec contract, *unless* it carries legacy-only syntax
 * (`${…}` templating, `===`/`!==`, `?.` JS optional-chaining, JS string/array
 * methods) — those are routed to the legacy engine for back-compat and emit a
 * one-time deprecation warning, because such a string means something different
 * (or nothing) to the server's CEL engine.
 */
import { evalFieldPredicate, type FieldRulePredicate } from './fieldRules.js';
import { ExpressionEvaluator } from './ExpressionEvaluator.js';
import { toPredicateRecord, type FieldContainerLike } from '../utils/predicate-record.js';

/**
 * Syntax that only the legacy JS-dialect evaluator understands and that is NOT
 * valid CEL: `${…}` templates, strict (in)equality, JS optional-chaining
 * (`?.` — distinct from CEL's optional selection `.?`), the `??` operator, and
 * JS-only string/array methods (CEL has `.contains()`, not `.includes()`).
 * `&&` / `||` / `.contains(` are intentionally absent — they are valid in both
 * dialects, so they must not force the legacy route.
 */
const LEGACY_DIALECT_MARKERS =
  /\$\{|===|!==|\?\.|\?\?|\.(?:includes|indexOf|toUpperCase|toLowerCase|startsWith|endsWith|trim|split|map|filter|reduce|find|some|every|join|slice|charAt|padStart|padEnd|replace|match|test)\s*\(/;

/** True when a *string* predicate uses legacy-only (non-CEL) syntax. */
export function isLegacyDialectSource(source: string): boolean {
  return LEGACY_DIALECT_MARKERS.test(source);
}

const warnedLegacy = new Set<string>();
function warnLegacyDialect(source: string): void {
  if (warnedLegacy.has(source)) return;
  warnedLegacy.add(source);
  console.warn(
    '[object-ui] A conditional predicate uses the legacy expression dialect ' +
      'and is not portable to the server CEL engine: ' +
      JSON.stringify(source) +
      '. Rewrite it as CEL (use "==" not "===", "x in [..]" for membership, ' +
      '".contains()" not ".includes()", and drop template interpolation).',
  );
}

const warnedError = new Set<string>();
/**
 * One-time report for a predicate that could not be evaluated.
 *
 * The message names the caller's `fallback` as "its safe default" without
 * asserting a direction, because the direction is the caller's: row surfaces
 * fail CLOSED (a faulting `visible` hides the action), while a param-collection
 * dialog fails OPEN (objectui#4640 — a silently hidden required param is the
 * undiagnosable failure). Both are loud; only silence was ever ruled out
 * (2026-08-06 on objectui#4051 / objectstack#5149).
 *
 * `reason` is the engine's own description of the failure (`"[runtime] No such
 * key: owner_id"`) — the single most useful line for the author, and precisely
 * what this path used to discard: the fault-probing CEL route silences the
 * canonical helper's warning to avoid double-reporting, so before objectui#3792
 * the more safety-critical the surface, the LESS it said. It is optional
 * because a caller may genuinely have no reason to pass (nothing fabricates
 * one).
 *
 * The wording is deliberately surface-neutral: this function is not
 * list-specific and has not been for a long time — row kebabs, the bulk
 * selection bar, kanban conditional formatting and (since objectui#3521)
 * `page:header` all report through it, and telling a page-header author that
 * "a list conditional predicate" failed sends them to the wrong screen.
 */
function warnEvalError(source: string, label?: string, reason?: string): void {
  // One-time-warning identity for the (label, source) pair. JSON-encoded rather
  // than joined on a character the two halves "cannot contain" — that separator
  // was a raw U+0000, which made this whole file binary to grep (objectstack#5450).
  // JSON needs no impossible character, so the boundary is unambiguous for any
  // label and any predicate source, and the literal is plain ASCII.
  // `reason` is deliberately NOT part of the key: one predicate text has one
  // reason, so keying on it could only ever weaken the warn-once contract.
  const key = JSON.stringify([label ?? '', source]);
  if (warnedError.has(key)) return;
  warnedError.add(key);
  console.warn(
    '[object-ui] A conditional predicate failed to evaluate' +
      (label ? ` (${label})` : '') +
      ' and was treated as its safe default: ' +
      JSON.stringify(source) +
      (reason ? `. Reason: ${reason}` : '') +
      '. Check the field names and CEL syntax.',
  );
}

/** Result of a fault-aware CEL evaluation: `ok:false` distinguishes a fault
 * from a genuine `false`, so callers can fail-soft-but-warn (ADR-0058). */
interface CelVerdict {
  ok: boolean;
  value: boolean;
  /** The engine's failure reason when `ok` is false — see {@link warnEvalError}. */
  reason?: string;
}

/**
 * Evaluate a CEL predicate against a row, surfacing whether it faulted. Mirrors
 * `evalFieldPredicate`'s engine call (binding `record` + an `extra` scope) but
 * keeps the fault flag so `evalRowPredicate` can warn on a broken predicate
 * rather than silently defaulting.
 */
function evalCel(
  pred: FieldRulePredicate,
  record: Record<string, unknown>,
  scope: Record<string, unknown>,
): CelVerdict {
  // `evalFieldPredicate` fails soft to the fallback and hides the fault flag;
  // we run it twice-in-one by using distinct fallbacks: if the value tracks the
  // fallback for BOTH `true` and `false`, the predicate faulted (a genuine
  // verdict is independent of the fallback). This reuses the canonical helper
  // verbatim — no second engine — so CEL semantics never drift from B2.
  // `warn: false`: this caller reports the fault itself (the labelled
  // `warnEvalError` in `evalRowPredicate`) — one warning per broken predicate,
  // not two (objectstack-ai/objectstack#5149). `onFault` carries the engine's reason across that silence
  // so the labelled report can still name it (objectui#3792); both probes fault
  // identically, so the first reason is the reason.
  let reason: string | undefined;
  const onFault = (r: string): void => {
    reason ??= r;
  };
  const diagnostic = { warn: false, onFault };
  const asTrue = evalFieldPredicate(pred, record, true, undefined, scope, diagnostic);
  const asFalse = evalFieldPredicate(pred, record, false, undefined, scope, diagnostic);
  if (asTrue !== asFalse) return { ok: false, value: false, reason };
  return { ok: true, value: asTrue };
}

/** Options for {@link evalRowPredicate}. */
export interface RowPredicateOptions {
  /** Value returned when the predicate is absent or fails to evaluate.
   * Pick the safe default for the surface: `false` (fail-closed) for a
   * row-action `visible`/`disabled`; `false` (no style) for formatting. */
  fallback?: boolean;
  /** Extra top-level scope merged alongside the row — e.g. the global predicate
   * scope (`features` / `user`) a host shell provides. The row wins on
   * collision: a `record` key here never shadows the row. Every OTHER key —
   * a host's own `data` included — reaches the predicate as the host's own
   * (`83fe6e741`: `data` no longer names the row on a record surface). */
  scope?: Record<string, unknown>;
  /** When true, log a one-time warning if a *present* predicate faults. */
  warnOnError?: boolean;
  /** Label used in warning messages (e.g. an action name or rule index). */
  label?: string;
  /**
   * This surface has **no row of its own** — bind NOTHING for the row instead
   * of binding an empty one, so a `record` the HOST SCOPE carries survives to
   * the predicate (objectui#4640).
   *
   * The default (`false`) is this function's whole subject rule: the row is
   * pinned over the scope as `record`, on both dialect paths, so `record`
   * always names THIS row even when the host scope carries a key of that name
   * (objectui#3796). That is right for every row surface — and exactly wrong
   * for a surface that has no row, because the pin then writes an EMPTY
   * `record` over the host's real one and every `record.*` predicate faults
   * with "No such key". "This surface has no row of its own" and "this
   * surface's row is empty" are different facts; only the latter is entitled to
   * shadow the scope. Same distinction, same words, as `usePredicateRecordContext`
   * in `@object-ui/react` (objectui#4075) — which is the BINDING half of this
   * rule for the `useCondition` tier; this is the evaluation-entry half.
   *
   * Set it where the predicate is scoped to a *dialog / shell / page* rather
   * than to a record — `ActionParamDialog`'s param `visible` gates are the
   * first caller (objectui#4640): their scope IS the host predicate scope,
   * `data` and all. `opts.fields` is meaningless here (there is no row to
   * collapse relations on) and is ignored.
   */
  rowless?: boolean;
  /**
   * The object's field definitions (`objectSchema.fields`). Supplying them lets
   * a relation field be bound as the FOREIGN KEY the server stores, rather than
   * as whatever `$expand` happened to substitute for it on this surface — see
   * {@link toPredicateRecord}. Omitting them keeps the payload verbatim, so a
   * caller with no schema at hand never guesses which fields are relations.
   */
  fields?: FieldContainerLike;
}

/**
 * Evaluate a single boolean predicate against a row record on the canonical CEL
 * engine (with a legacy-dialect fallback — see the module note). The row is
 * bound ONE way: as `record.*` — **the canon** (maintainer ruling 2026-08-20 on
 * objectui#5330, option B; Phase 2 executed by `83fe6e741`).
 *
 * Until Phase 2 the row was also bound as bare fields (`status`, the row-action
 * shorthand) and as `data.*`, and Phase 1 (`d1ab06f0f`) warned once per
 * non-canonical spelling. Both bindings and that warning are gone. A bare-field
 * or `data.*` predicate on a record surface now FAULTS here exactly as it always
 * did on the server — measured on `@objectstack/formula@17.1.0`,
 * `buildScope({ record })` mounts exactly `['record']`, so a bare field faults
 * `Unknown variable: status` and `data.*` faults `Unknown variable: data` — and
 * takes this function's EXISTING fault policy: the caller's `fallback`, reported
 * once by `warnEvalError` (when `warnOnError` is set) or by the canonical
 * helper's own one-time warning, either of which names the unknown variable.
 * Nothing detects a retired spelling on this path; it is simply unbound. The
 * same holds on the legacy `${…}` path below — one scope shape per surface,
 * both dialects — so `${data.x}` / `${x}` strings on a row surface fault there
 * too, and land in the same fallback / warning.
 *
 * The retirement is scoped to the RUNTIME RECORD layer. `data` is the canonical
 * root one layer over, in a metadata-editing form (ADR-0089 D3,
 * `CANONICAL_ROOT_BY_LAYER` = `{ runtime: 'record', metadata: 'data' }`), and
 * that layer evaluates through its own entry (`app-shell`'s metadata-admin
 * `predicate.ts`), never through this one. See {@link ./rowPredicateCanon.ts}
 * for the canon statement, the server measurement and the offline detector.
 *
 * The optional `scope` (host predicate scope) is bound alongside so
 * `features.*` / `user.*` predicates keep working — but the row is the subject:
 * `record` always names THIS row, on both dialect paths, even when the host
 * scope carries a key of that name (objectui#3796). Every OTHER host key —
 * a host's own `data` included — reaches the predicate as the host's own.
 *
 * A caller with no row at all passes {@link RowPredicateOptions.rowless}, and
 * then nothing is bound over the scope — see that option for why an absent row
 * must not be spelled as an empty one.
 */
export function evalRowPredicate(
  pred: FieldRulePredicate | undefined | null,
  row: Record<string, unknown> | null | undefined,
  opts: RowPredicateOptions = {},
): boolean {
  const fallback = opts.fallback ?? false;
  if (pred == null) return fallback;
  // A BLANK predicate is not answered here. It used to be, for the bare-string
  // spelling only: `''` / whitespace returned the fallback on this line, in
  // silence, while a blank ENVELOPE went on to `evalFieldPredicate`'s `[blank]`
  // report below (objectui#11262, ADR-0137 D4: a blank gate predicate is
  // "diagnosed, never a silent `true`"). Both spellings now take that one
  // route: no legacy marker can match blank text, so a blank string reaches
  // the CEL path like its envelope twin and gets the same verdict — the
  // caller's fallback — and the same report, labelled on the fail-closed route
  // and by the canonical helper on the single-eval one.
  const source = typeof pred === 'string' ? pred : undefined;

  // Relations collapse to the foreign key the server stores, so `record.owner`
  // means one thing whether or not this surface expanded the column
  // (objectui#3501). Returned by reference when there is nothing to collapse.
  // A `rowless` caller has no row to collapse, so `opts.fields` is moot there.
  const rowObj = opts.rowless
    ? {}
    : toPredicateRecord(row && typeof row === 'object' ? row : {}, opts.fields);
  // `record.*` + the host scope, all top-level. The row is bound ONE way
  // (`83fe6e741`, Phase 2 of the objectui#5330 canon): no bare-field spread
  // and no `data` — a predicate spelled either way is simply unbound here and
  // faults, on both dialect paths, exactly as it does on the server.
  //
  // `record` is pinned AFTER the spread, so a host scope that happens to carry
  // that key is background and the ROW stays the subject of this function — on
  // BOTH dialect paths. Before objectui#3796 it relied instead on each engine's
  // own binding, which disagreed: the legacy evaluator re-pinned `record` (row
  // won) while the CEL engine takes `extra` over its `record` binding (host
  // scope won). Same function, same predicate text, opposite subjects — decided
  // by whether the string happens to contain `===`/`${…}`, which no author is
  // choosing deliberately. Pinning here fixes both paths at the merge,
  // independently of either engine's precedence.
  //
  // …UNLESS the caller has no row (`rowless`), in which case there is nothing
  // to pin and the host scope keeps its own `record` — see the option.
  const scope = opts.rowless
    ? { ...(opts.scope ?? {}) }
    : { ...(opts.scope ?? {}), record: rowObj };

  // The predicate TEXT for diagnostics: a bare string is itself, an envelope is
  // its `source`. Reported separately from `source` above, which is `undefined`
  // for an envelope *by design* (it drives the dialect routing, and an envelope
  // is never routed to the legacy engine). Reusing it for the warning is what
  // made every faulting envelope report as the literal `"(expression)"` — no
  // predicate text for the author, and, because the one-time key is
  // (label, source), the FIRST faulting envelope on a given label silenced every
  // other one under it (objectui#4640: measured on `evalRowPredicate` — a second
  // envelope with a different, also-broken source warned zero times). The
  // envelope is not an exotic spelling: `@objectstack/spec`'s
  // `ExpressionInputSchema` normalizes every authored predicate into one, so it
  // is the likeliest shape in served metadata and was the least diagnosable.
  const predicateText =
    source ??
    (pred && typeof pred === 'object' && typeof (pred as { source?: unknown }).source === 'string'
      ? (pred as { source: string }).source
      : '(expression)');

  // Legacy-dialect *strings* route to the legacy engine (back-compat). The
  // `{ dialect: 'cel', source }` envelope is never routed here — it is CEL.
  if (source !== undefined && isLegacyDialectSource(source)) {
    warnLegacyDialect(source);
    try {
      const evaluator = new ExpressionEvaluator(scope);
      return evaluator.evaluateCondition(source, { throwOnError: true });
    } catch (err) {
      // The legacy engine reports by throwing, so its message IS the reason —
      // the fail-closed report carries it for the same reason the CEL path does.
      if (opts.warnOnError) {
        warnEvalError(source, opts.label, `[legacy] ${err instanceof Error ? err.message : String(err)}`);
      }
      return fallback;
    }
  }

  // CEL path — everything reaching here is CEL. No spelling detector runs here
  // (`83fe6e741` removed the Phase-1 warning with the bindings): a retired
  // bare-field / `data.*` spelling is unbound above and faults in the engine
  // like any other unknown variable, and the fault report below is what names
  // it. `detectNonCanonicalRowSpelling` stays exported for OFFLINE sweeps of
  // authored metadata, not for this hot path.
  //
  // The fault-aware `evalCel` costs two evaluations (to tell a fault
  // from a genuine `false`), so only pay it when a caller wants the labelled
  // fail-closed warning — the formatting hot path takes the single-eval fast
  // route. Since objectstack-ai/objectstack#5149 the fast route is no longer silent either: the
  // canonical helper itself warns once per broken predicate (with `opts.label`
  // as the locator when given).
  if (!opts.warnOnError) {
    return evalFieldPredicate(pred, rowObj, fallback, undefined, scope, { context: opts.label });
  }
  const verdict = evalCel(pred, rowObj, scope);
  if (!verdict.ok) {
    warnEvalError(predicateText, opts.label, verdict.reason);
    return fallback;
  }
  return verdict.value;
}

/** The two halves of a {@link partitionRowsByPredicate} verdict over a selection. */
export interface RowPartition<TRow> {
  /** Records whose predicate passed — the ones an operation may act on. */
  eligible: TRow[];
  /**
   * How many records were filtered out. A caller that shrinks a user's
   * selection owes them this number: a run over fewer records than they picked
   * must say so rather than quietly shrinking.
   */
  skipped: number;
}

/**
 * Split a set of records by one per-record predicate — the SET-shaped
 * counterpart of {@link evalRowPredicate}, and the reason a bulk gate never
 * needs a hook.
 *
 * A bulk affordance spans N records, so its gate is a **loop**, and React
 * forbids calling `useRowPredicate` (or any hook) per iteration. Every bulk
 * surface therefore reaches for `evalRowPredicate` directly; this wrapper is
 * that loop written once, with the three cases each caller was otherwise
 * re-deriving:
 *
 *   - **absent** (`null` / `undefined` / `''`) — nothing is gated, so `rows` is
 *     returned BY REFERENCE and `skipped` is 0. The common case allocates
 *     nothing and a caller's downstream memo still holds. Whitespace-only text
 *     and an envelope whose `source` is blank are NOT absent here: they are
 *     evaluated, and fail closed like any other predicate that cannot run.
 *   - **boolean** — a verdict, not an expression, short-circuited exactly as
 *     `useCondition` / `useRowPredicate` do. Handing `true` to the engine
 *     produces `{ dialect: 'cel', source: undefined }`, which faults and — on
 *     this fail-closed path — would disqualify every record, so the most
 *     explicit way to say "always" would exclude everyone (objectui#3492).
 *   - **expression** — evaluated once per record with that record in scope,
 *     **fail-closed**: a predicate that faults must not hand the caller records
 *     it was written to exclude. `warnOnError` (default `true`) makes the
 *     resulting exclusion diagnosable once per predicate instead of silent.
 *
 * The fail-closed default is what separates this from a lenient record-free
 * evaluation, and the difference is not mere strictness: evaluated with NO
 * record bound, `record.status != 'paid'` returns `true` for every row —
 * including the ones it was written to exclude — so an authored gate is not
 * weakened, it is inverted for half its inputs (objectui#3067).
 *
 * ## Who calls it, and who decides "is a gate declared?" (objectui#11322)
 *
 * This is a shared partitioner, and its opening test is not the action
 * family's "is a gate declared?" question. Its callers:
 *
 *   - the bulk ACTION fold, plugin-grid's `partitionBulkRows` (a bulk def's
 *     `visible`). The action family decides "declared?" BEFORE calling here,
 *     through `hasDeclaredVisibilityGate`, and hands an undeclared gate over as
 *     `undefined`. So a whitespace-only `visible` or a blank-`source` envelope
 *     never reaches the test below from that caller.
 *   - the built-in Delete's `userActions.delete.visibleWhen`, a field-rule key,
 *     from plugin-grid's `ObjectGrid` and from plugin-list's `ListView`
 *     (`bulkDeleteEligibility`). The test below is THEIR answer: a blank one
 *     that is not `''` is evaluated and excludes every record.
 *
 * A caller that needs the action family's answer asks it first; it does not
 * write a second blank test in front of this one.
 */
export function partitionRowsByPredicate<TRow extends Record<string, unknown>>(
  pred: FieldRulePredicate | boolean | undefined | null,
  rows: readonly TRow[],
  opts: Omit<RowPredicateOptions, 'fallback' | 'rowless'> = {},
): RowPartition<TRow> {
  if (pred == null || pred === '') {
    return { eligible: rows as TRow[], skipped: 0 };
  }
  if (typeof pred === 'boolean') {
    return pred
      ? { eligible: rows as TRow[], skipped: 0 }
      : { eligible: [], skipped: rows.length };
  }
  const eligible = (rows as TRow[]).filter(row =>
    evalRowPredicate(pred, row, {
      ...opts,
      warnOnError: opts.warnOnError ?? true,
      fallback: false,
    }),
  );
  return { eligible, skipped: rows.length - eligible.length };
}

// ---------------------------------------------------------------------------
// Conditional formatting
// ---------------------------------------------------------------------------

/** A conditional-formatting rule in any of the three historical shapes. */
export type ConditionalFormattingRuleLike = {
  /** Spec shape: a CEL predicate (`ExpressionInputSchema`). */
  condition?: FieldRulePredicate;
  /** ObjectUI template shape: a `${…}` / plain expression string. */
  expression?: string;
  /** ObjectUI native shape: structured field/operator/value comparison. */
  field?: string;
  operator?: 'equals' | 'not_equals' | 'contains' | 'greater_than' | 'less_than' | 'in';
  value?: unknown;
  /** Style outputs (all shapes). `style` is the base; the three color props
   * override individual CSS keys. */
  style?: Record<string, unknown>;
  backgroundColor?: string;
  textColor?: string;
  borderColor?: string;
};

/** Serialize a JS value as a CEL literal (string / number / bool / list / null). */
function celLiteral(v: unknown): string {
  if (v === null || v === undefined) return 'null';
  const t = typeof v;
  if (t === 'string') return JSON.stringify(v);
  if (t === 'number' || t === 'boolean') return String(v);
  if (Array.isArray(v)) return `[${v.map(celLiteral).join(', ')}]`;
  return JSON.stringify(String(v));
}

/**
 * Translate a `{ field, operator, value }` native rule into an equivalent CEL
 * predicate string, so all three formatting shapes evaluate through one engine.
 * The field is referenced by index (`record["name"]`) so any api-name is safe.
 */
function fieldOperatorValueToCel(rule: ConditionalFormattingRuleLike): string | null {
  const { field, operator, value } = rule;
  if (!field || !operator) return null;
  const ref = `record[${JSON.stringify(field)}]`;
  switch (operator) {
    case 'equals':
      return `${ref} == ${celLiteral(value)}`;
    case 'not_equals':
      return `${ref} != ${celLiteral(value)}`;
    case 'greater_than':
      return `${ref} > ${celLiteral(value)}`;
    case 'less_than':
      return `${ref} < ${celLiteral(value)}`;
    case 'contains':
      return `${ref}.contains(${celLiteral(value)})`;
    case 'in':
      return `${ref} in ${celLiteral(Array.isArray(value) ? value : [value])}`;
    default:
      return null;
  }
}

/** Normalize a rule to the single predicate that gates it, or `null` if none. */
function ruleToPredicate(rule: ConditionalFormattingRuleLike): FieldRulePredicate | null {
  if (rule.condition != null) return rule.condition;
  if (typeof rule.expression === 'string' && rule.expression.trim()) return rule.expression;
  return fieldOperatorValueToCel(rule);
}

/** Build the style map a matched rule applies (base `style`, then color overrides). */
function ruleToStyle(rule: ConditionalFormattingRuleLike): Record<string, string> {
  const style: Record<string, string> = {};
  if (rule.style && typeof rule.style === 'object') {
    for (const [k, v] of Object.entries(rule.style)) {
      if (v != null) style[k] = String(v);
    }
  }
  if (rule.backgroundColor) style.backgroundColor = String(rule.backgroundColor);
  if (rule.textColor) style.color = String(rule.textColor);
  if (rule.borderColor) style.borderColor = String(rule.borderColor);
  return style;
}

/**
 * Evaluate conditional-formatting rules against a record and return the style
 * map for the first matching rule (rules are first-match-wins), or `{}`.
 *
 * Zero-React: returns a plain `Record<string, string>` style map; React
 * consumers cast it to `CSSProperties`. Accepts all three historical rule
 * shapes — spec `{ condition, style }`, ObjectUI `{ expression, … }`, and the
 * native `{ field, operator, value, … }` — and evaluates every expression on
 * the canonical CEL engine (with the legacy-dialect fallback in
 * {@link evalRowPredicate}).
 *
 * @param scope  Extra top-level scope (host predicate scope) bound alongside
 *               the row, so `features.*` predicates keep resolving.
 * @param fields The object's field definitions, so a rule comparing a relation
 *               field sees the stored foreign key rather than the expanded
 *               record (see {@link RowPredicateOptions.fields}).
 */
export function resolveConditionalFormatting(
  record: Record<string, unknown> | null | undefined,
  rules?: readonly ConditionalFormattingRuleLike[] | null,
  scope?: Record<string, unknown>,
  fields?: FieldContainerLike,
): Record<string, string> {
  if (!rules || rules.length === 0) return {};
  const row = record && typeof record === 'object' ? record : {};
  for (let i = 0; i < rules.length; i++) {
    const rule = rules[i];
    if (!rule || typeof rule !== 'object') continue;
    const pred = ruleToPredicate(rule);
    if (pred == null) continue;
    const matched = evalRowPredicate(pred, row, {
      fallback: false,
      scope,
      fields,
      label: `conditionalFormatting[${i}]`,
    });
    if (matched) return ruleToStyle(rule);
  }
  return {};
}
