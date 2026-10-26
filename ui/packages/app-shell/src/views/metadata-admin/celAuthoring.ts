/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * Author-time CEL safety for the RLS policy editor (objectui#2413).
 *
 * Row-Level Security `USING` (read filter) / `CHECK` (write filter) predicates
 * are the highest-risk authoring surface in the permission model: a typo in a
 * predicate silently produces the wrong row scope, and a predicate the runtime
 * cannot lower to a row filter is DROPPED at request time — the runtime fails
 * CLOSED, so the policy grants (or admits) nothing it was written to. Yet the
 * editor shipped as a bare `<textarea>` with zero validation.
 *
 * This module is the thin bridge from the editor to the framework's canonical
 * CEL engine, `@objectstack/formula` — the SAME parser/validator the server and
 * the `validate_expression` agent tool use — so the GUI, SDK, and CLI reach the
 * identical verdict rather than maintaining a second grammar (ADR-0032). It
 * exposes exactly the four author-time affordances the editors need:
 *
 *   1. {@link lintCelPredicate}    — parse/field lint (surfaced inline as you type).
 *   2. {@link introspectCelScope}  — the valid field + scope identifiers (autocomplete).
 *   3. {@link testRunCelPredicate} — dry-run a predicate against a sample record.
 *   4. {@link inferCelValueType}   — the value type a formula computes (objectui#1582 follow-up).
 *
 * Progressive enhancement (mirrors `preview/capabilityLint.ts`): the engine is
 * loaded LAZILY via dynamic `import()` — it carries the CEL parser (cel-js), so
 * keeping it out of the main bundle matters and this rare admin surface is the
 * right place to pay that cost. Every entry point FEATURE-DETECTS the function
 * it needs and SWALLOWS any failure (import, missing export, throw): author-time
 * assistance must NEVER break or block the editor. A missing engine degrades to
 * "no lint / no suggestions / test-run unavailable", never to an exception.
 */

/** A schema hint for the predicate's target object — powers field-existence lint. */
export interface CelSchemaHint {
  /** The target object api-name (`*` / undefined => no field hints). */
  objectName?: string;
  /** Known field names of {@link objectName}, so `<field>` refs can be checked. */
  fields?: string[];
  /**
   * Which RLS clause is being edited: `USING` (read filter) or `CHECK` (write
   * filter). Naming one turns on `@objectstack/lint`'s RLS rule — a clause it
   * refuses, lowerable or not, is an `error` (see {@link lintCelPredicate}).
   * Omitted on every non-RLS surface.
   */
  clause?: 'using' | 'check';
  /**
   * Evaluation scope of the authoring site (mirrors the engine's
   * `ExprSchemaHint.scope`, objectui#1582):
   *  - `'flattened'` (default) — the record's fields are spread to bare
   *    top-level (RLS predicates, flow conditions), so `organization_id == …`
   *    is legal and an unknown bare identifier is only a warning.
   *  - `'record'` — the record is bound ONLY as the `record` namespace
   *    (field conditional rules `visibleWhen`/`readonlyWhen`/`requiredWhen`,
   *    formulas). A bare field ref silently evaluates to null at runtime, so
   *    the engine flags it as an ERROR with the `record.<field>` fix.
   */
  scope?: 'record' | 'flattened';
  /**
   * Override the scope roots offered by autocomplete. The engine advertises
   * every root ANY predicate site may see (`current_user`, `os`, `vars`, …),
   * but a given authoring surface binds only a subset — field conditional
   * rules bind exactly `record` / `previous` / `parent` (see
   * `@object-ui/core`'s `evalFieldPredicate`). Suggesting an unbound root
   * would author a predicate that silently never fires.
   */
  roots?: string[];
  /**
   * The authored KEY this source is the value of — `visibleWhen`,
   * `readonlyWhen`, `requiredWhen` (`e3cb47624`). Naming it lets the
   * wrong-layer advisory take its verdict from `@objectstack/lint`'s published
   * `fieldRuleRootIssue`, which judges per SLOT, instead of from a second copy
   * of that judgement maintained here.
   *
   * Optional, and an unrecognised value is not an error: a surface that does
   * not name a slot — or names one the published helper's vocabulary does not
   * cover — keeps the local fallback. See {@link FIELD_RULE_VERDICT_SLOTS} for
   * why that is a real set and not a formality.
   */
  slot?: string;
  /**
   * The engine field role of the authoring site (mirrors `FieldRole` minus
   * `template`, which no CEL editor hosts):
   *  - `'predicate'` (default) — bare CEL expected to return bool (RLS
   *    clauses, conditional rules). The engine words its parse errors around
   *    predicates.
   *  - `'value'` — bare CEL of ANY type (a `formula` field's `expression`).
   *    Same parse/field checks, but a non-boolean result is the point, and
   *    {@link inferCelValueType} reports WHICH type it computes.
   */
  role?: 'predicate' | 'value';
}

/**
 * The advisory {@link lintCelPredicate} words itself, as a key of the designer
 * catalogue (objectui#10862): the wrong-layer root advisory's local sentence
 * (see `rowCanonAdvisory`). It is handed back as a key plus its values, not
 * text, and `CelPredicateField` reads it through the `t` its host binds to the
 * designer locale — so this module stays free of any import at load, the same
 * seam as {@link CelTestMessageKey}.
 */
export type CelLintMessageKey = 'engine.celLint.notTheRow';

/**
 * A single lint finding surfaced inline under the editor. `error` blocks save
 * (a parse fault, or an RLS clause `@objectstack/lint`'s rule refuses);
 * `warning` is advisory (a typo, a wrong-layer root).
 *
 * Every error, and every advisory the engine or `@objectstack/lint` words,
 * carries that producer's `message` as written. An advisory this module words
 * itself carries a {@link CelLintMessageKey} and the values its `{token}`
 * holes take instead; it is only ever a `warning`, so a caller that keeps the
 * errors alone (`clientValidation`) never meets one.
 */
export type CelLintIssue =
  | { severity: 'error'; message: string; messageKey?: never; messageVars?: never }
  | { severity: 'warning'; message: string; messageKey?: never; messageVars?: never }
  | { severity: 'warning'; messageKey: CelLintMessageKey; messageVars: Record<string, string>; message?: never };

/** The advisory half of {@link CelLintIssue}: either wording, never blocking. */
type CelLintWarning = Extract<CelLintIssue, { severity: 'warning' }>;

/** The in-scope identifiers an author may reference — the autocomplete catalog. */
export interface CelScopeInfo {
  /** The target object's field names (referenced BARE, e.g. `organization_id`). */
  fields: string[];
  /** Scope roots: `record`, `current_user`, `user`, `previous`, `input`, `os`, `vars`. */
  roots: string[];
  /** Callable CEL stdlib functions (`now`, `has`, `contains`, …). */
  functions: string[];
}

/** The sample scope an author supplies for a dry-run. */
export interface CelSampleContext {
  /** The candidate row the predicate is evaluated against. */
  record: Record<string, unknown>;
  /** The acting subject, bound verbatim as `current_user` / `user`. */
  currentUser: Record<string, unknown>;
}

/**
 * The words a dry-run writes itself, as keys of the designer catalogue
 * (objectui#10862). They are handed back as keys, not text, and the dialog
 * reads them through the `t` its host binds to the designer locale — so this
 * module stays free of any import at load (the catalogue module reaches
 * `@object-ui/i18n` and `@object-ui/core`, which every caller of
 * {@link lintCelPredicate} would then load too).
 */
export type CelTestMessageKey = 'engine.celTest.predicateEmpty' | 'engine.flowSim.note.evaluationFailed';

/** The verdict of a dry-run — never throws; the UI branches on `status`. */
export type CelTestOutcome =
  /** Predicate returned boolean `true` — the row is IN scope (allowed). */
  | { status: 'allow' }
  /** Predicate returned boolean `false` — the row is OUT of scope (denied). */
  | { status: 'deny' }
  /** Predicate returned a non-boolean — an authoring smell (a filter must be bool). */
  | { status: 'value'; value: unknown }
  /** Parse / type / runtime fault — carries the engine's self-correcting message. */
  | { status: 'error'; kind: string; message: string; messageKey?: never }
  /**
   * A fault this module words itself — an empty predicate, or an engine
   * failure that carries no message — as a {@link CelTestMessageKey} the
   * renderer translates.
   */
  | { status: 'error'; kind: string; messageKey: CelTestMessageKey; message?: never }
  /** The CEL engine could not be loaded — the affordance is unavailable. */
  | { status: 'unavailable' };

/* ── Lazy engine loader (feature-detected, error-swallowing) ─────────── */

interface FormulaModule {
  validateExpression?: (
    role: string,
    input: unknown,
    schema?: unknown,
  ) => {
    ok: boolean;
    errors?: Array<{ message?: string }>;
    warnings?: Array<{ message?: string }>;
  };
  introspectScope?: (
    role: string,
    schema?: unknown,
  ) => { fields?: string[]; roots?: string[]; functions?: string[] };
  inferExpressionType?: (
    input: unknown,
    schema?: unknown,
  ) => 'number' | 'text' | 'boolean' | 'date' | 'unknown';
  ExpressionEngine?: {
    evaluate: (
      expr: { dialect: string; source: string },
      ctx: Record<string, unknown>,
    ) => { ok: true; value: unknown } | { ok: false; error?: { kind?: string; message?: string } };
  };
}

let loaderOverride: (() => Promise<FormulaModule | null>) | null = null;
let cached: Promise<FormulaModule | null> | null = null;

/**
 * Test seam — inject a fake engine (or `null` to simulate an unavailable one).
 * Pass `undefined` to restore the real lazy import. Mirrors the `ruleOverride`
 * seam in `preview/capabilityLint.ts`.
 */
export function __setCelFormulaLoader(
  loader: (() => Promise<FormulaModule | null>) | null | undefined,
): void {
  loaderOverride = loader ?? null;
  cached = null;
}

function loadFormula(): Promise<FormulaModule | null> {
  if (loaderOverride) return Promise.resolve(loaderOverride()).catch(() => null);
  if (!cached) {
    cached = import('@objectstack/formula')
      .then((m) => m as unknown as FormulaModule)
      .catch(() => null);
  }
  return cached;
}

/* ── Lazy RLS rule verdict (objectui#13061, objectui#13082) ──────────── */

/** One finding of `@objectstack/lint`'s published RLS rule — the fields read here. */
interface RlsPredicateFinding {
  severity: 'error' | 'warning';
  message: string;
}

/** `@objectstack/lint`'s published `validateRlsPredicateEnforceability`. */
type RlsPredicateRule = (stack: unknown) => RlsPredicateFinding[];

let rlsRuleCached: Promise<RlsPredicateRule | null> | null = null;

/**
 * Feature-detect `validateRlsPredicateEnforceability` on the installed
 * `@objectstack/lint` — the `rls-predicate-*` rule `os build` runs. Dynamic
 * for the reason {@link loadFieldRuleVerdict} gives, and reduced to the one
 * symbol in the callback for the reason `loadRowCanon` gives. Swallows every
 * failure: an absent rule is "no verdict", never a throw.
 */
function loadRlsRule(): Promise<RlsPredicateRule | null> {
  if (!rlsRuleCached) {
    rlsRuleCached = import('@objectstack/lint')
      .then((m) => {
        const fn = (m as unknown as Record<string, unknown>)?.validateRlsPredicateEnforceability;
        return typeof fn === 'function' ? (fn as RlsPredicateRule) : null;
      })
      .catch(() => null);
  }
  return rlsRuleCached;
}

/**
 * `@objectstack/lint`'s verdicts on one RLS clause, in the lint's words
 * (objectui#13061, objectui#13082).
 *
 * The verdicts are the publish door's. `validateRlsPredicateEnforceability` is
 * the `rls-predicate-*` rule `os build` and the runtime publish gate run, so
 * asking it here means Studio and the server cannot disagree about a clause.
 * The runtime drops a policy the rule refuses, and the policy then grants (or
 * admits) nothing: it fails CLOSED.
 *
 * The words are the lint's. ⛔ No sentence for any of these verdicts is written
 * here, and none is synthesized: each finding is one the published rule returns
 * for a one-clause stack holding this source, with its severity and message as
 * written. What the rule does not say, the editor does not say.
 *
 * ## What the one-clause stack lets the rule judge
 *
 * Every clause that parses is asked, lowerable or not (objectui#13082; until
 * then only a clause `isSupportedRlsExpression` refuses was). A clause the
 * engine already refuses as a parse fault is not asked, so one fault earns one
 * blocking finding (a `null` beside a typed list member is one). The stack names
 * no object, so the rule answers exactly what the clause alone decides — the
 * answer the publish door gives for the same clause. For a clause the runtime
 * cannot lower that is the shape pass. For one that lowers it is each
 * reference verdict that reads the clause and nothing else: a `current_user`
 * member nothing pre-resolves, a `current_user` value of the wrong type for
 * its position, a comparand the shared filter faces refuse. Which verdicts
 * those are is the rule's, not a list kept here:
 * `celAuthoring.rlsReferencePasses-13082.test.ts` pins each one against the
 * rule.
 *
 * ## What stays at the publish door, and why
 *
 * The rule's other reference passes read metadata the editor does not hold.
 * The one-clause stack carries no object, so they are silent here by the
 * rule's own construction (an object the stack does not declare is one it
 * cannot judge), and absent metadata is never an editor verdict:
 *
 *  - an unknown field reads the object's field map as the door's universe
 *    holds it: the live objects plus the drafts a package publish carries with
 *    the write. The editor holds a list of field NAMES read from the published
 *    object (the host's `loadObjectFields`), so a field the author added in a
 *    pending object draft is missing from it, and the rule would refuse a
 *    predicate the package publish accepts. Here an unknown field gets at most
 *    the engine's non-blocking "did you mean" warning, for a near miss
 *    ({@link lintCelPredicate});
 *  - a field compared with a field that holds a list or an object, or with a
 *    field of another comparison class, reads each field's declared TYPE; the
 *    editor holds names only;
 *  - the engine's admission of the read scope reads the host engine's
 *    `judgeFilter`, which only the server holds.
 *
 * A lint without the rule gives no verdict, the same degradation as every
 * other entry point of this module.
 */
async function rlsPredicateVerdict(source: string, clause: 'using' | 'check'): Promise<CelLintIssue[]> {
  const rule = await loadRlsRule();
  if (!rule) return [];
  const issues: CelLintIssue[] = [];
  for (const f of rule({ permissions: [{ rowLevelSecurity: [{ [clause]: source }] }] })) {
    if (!f?.message) continue;
    issues.push(f.severity === 'error' ? { severity: 'error', message: f.message } : { severity: 'warning', message: f.message });
  }
  return issues;
}

/* ── Lazy row-canon detector (objectui#8972) ─────────────────────────── */

/** The shape of `@object-ui/core`'s offline row-spelling instrument. */
interface RowCanonModule {
  detectNonCanonicalRowSpelling?: (
    source: string,
    row: Record<string, unknown> | null | undefined,
    dataNamesRow: boolean,
  ) => { kind: string; identifier: string; canonical: string } | null;
}

let rowCanonCached: Promise<RowCanonModule | null> | null = null;

/** `@objectstack/lint`'s published per-slot verdict (`e3cb47624`). */
type FieldRuleRootIssue = (slot: string, source: string) => { root: string; message: string } | null;

let fieldRuleVerdictCached: Promise<FieldRuleRootIssue | null> | null = null;

/**
 * Feature-detect `fieldRuleRootIssue` on the installed `@objectstack/lint`.
 *
 * The `import()` must stay DYNAMIC for the same reason `securityPostureLint.ts`
 * keeps its own dynamic — `@objectstack/lint` is the one `@objectstack/*`
 * package the console's `vendor-objectstack` chunk group does not claim
 * (objectui#5266), so a static import would pull the whole lint bundle onto the
 * eager graph. Progressive enhancement, like every other entry point in this
 * module: a lint package without the export degrades to the local fallback,
 * never to an exception and never to silence.
 */
function loadFieldRuleVerdict(): Promise<FieldRuleRootIssue | null> {
  if (!fieldRuleVerdictCached) {
    fieldRuleVerdictCached = import('@objectstack/lint')
      .then((m) => {
        const fn = (m as unknown as Record<string, unknown>)?.fieldRuleRootIssue;
        return typeof fn === 'function' ? (fn as FieldRuleRootIssue) : null;
      })
      .catch(() => null);
  }
  return fieldRuleVerdictCached;
}

/**
 * The authored slots whose bound-root set IS the platform's field-rule set, so
 * `fieldRuleRootIssue`'s verdict answers THIS surface's question (`e3cb47624`).
 *
 * ⚠️ This is a list of objectui's own surfaces, not a copy of the platform's
 * judgement — the judgement itself is read from `@objectstack/lint` at call
 * time. Membership is measured, not assumed: `ObjectFieldInspector` offers
 * exactly `FIELD_RULE_ROOTS` (`record` / `previous` / `parent`) on these three
 * editors, which is `FIELD_RULE_BOUND_ROOTS` verbatim.
 *
 * ## What is deliberately NOT here, and why the local fallback stays
 *
 * ⚠️ `fieldRuleRootIssue` does NOT gate on the slot name. Hand it any string and
 * it judges against `FIELD_RULE_BOUND_ROOTS` and interpolates the name into its
 * message — measured on 17.4.0, `('expression', 'current_user.x')` and
 * `('condition', 'current_user.x')` both return a finding, not `null`. The
 * helper never declines a surface, so this list is objectui's OWN coverage
 * answer and it is the only thing standing between a wrong surface and a
 * confident wrong verdict.
 *
 * Two guarded surfaces bind a set that is not the field-rule set, and neither
 * is comparable to it — they overlap on `record` alone:
 *
 *  - a `formula` field's `expression` binds `FORMULA_ROOTS` — `['record']`, a
 *    proper SUBSET. Routed through the helper, `previous.*` / `parent.*` come
 *    back clean — the helper reports them BOUND at the field tier, and on a
 *    formula they are not bound at all. A false green; and the message it does
 *    print for other roots names `previous` and `parent` as available here,
 *    which on this surface is wrong prose as well as a wrong verdict;
 *  - a conditional-formatting `condition` binds `ROW_PREDICATE_ROOTS` —
 *    `record`, `current_user`, `user`, `features`, `os`, `ctx`. That is five
 *    roots the field tier does not bind, but it is NOT a superset of the
 *    field-rule set: it lacks `previous` and `parent`. Routed through the
 *    helper, all five would be advised as unbound where the surface binds them
 *    — an author told to rewrite a predicate that works.
 *
 * ⛔ Neither miss is a coverage SHRINK, and it is worth being exact about that:
 * measured on this tree, both surfaces report nothing at all for `previous.*` /
 * `parent.*` today, so nothing currently advised would stop being advised. The
 * hazard is the other one — a verdict that is wrong in a DIFFERENT direction on
 * each surface: too loud on the condition, too quiet on the formula.
 *
 * So those keep the local instrument. ⛔ Do not extend this list to "tidy up"
 * the branch below without re-measuring the surface's bound roots first —
 * narrowing a consumer to fit the API it adopted is the drift `e3cb47624`
 * set out to stop, and `celAuthoring.fieldRuleVerdict-9318.test.ts` pins both
 * uncovered surfaces as live controls against exactly that edit.
 */
const FIELD_RULE_VERDICT_SLOTS: readonly string[] = ['visibleWhen', 'readonlyWhen', 'requiredWhen'];

/**
 * Load `@object-ui/core`'s row-spelling detector the same way the engine is
 * loaded: lazily, feature-detected, swallowing every failure. The detector
 * imports `@objectstack/formula` at module scope, so a STATIC import here
 * would drag the CEL parser into whatever chunk holds this module and undo the
 * bundle split the header describes.
 *
 * ⛔ Dynamic is necessary but NOT sufficient, and this docblock used to be
 * silent about the other half (objectui#9492). Until that card the `.then`
 * callback below returned the imported NAMESPACE object, so the whole barrel
 * escaped into the cached Promise and rolldown had to retain every one of its
 * exports in the eager `framework` chunk — a dynamic specifier carrying an
 * eager payload. Destructuring the ONE symbol this module consumes, in the
 * callback's parameter pattern, is what lets the rest be shaken out.
 * ⛔ Do not widen this back to a namespace binding, and ⛔ do not reach for a
 * deep subpath instead: `@object-ui/core`'s `package.json` declares only the
 * `"."` export key, so `@object-ui/core/rowPredicateCanon` is unreachable for a
 * real consumer of the published package — the destructure is the form that
 * works through the published barrel. What this chunk weighs is what
 * `pnpm check:eager-closure` prints on your own build; ⛔ no figure is copied
 * here (AGENTS.md #9).
 */
function loadRowCanon(): Promise<RowCanonModule | null> {
  if (!rowCanonCached) {
    rowCanonCached = import('@object-ui/core')
      .then(({ detectNonCanonicalRowSpelling }): RowCanonModule => ({ detectNonCanonicalRowSpelling }))
      .catch(() => null);
  }
  return rowCanonCached;
}

/**
 * The wrong-layer `data.*` advisory — why it is wired HERE, and why it is only
 * an advisory (objectui#8972).
 *
 * ## What it closes
 *
 * `@objectstack/formula`'s `SCOPE_ROOTS` carries `data`, so at `scope: 'record'`
 * the engine lint ACCEPTS `data.status == 'x'` with zero findings (measured on
 * `@objectstack/formula@17.4.0`). `83fe6e741` retired that spelling on runtime
 * record surfaces and objectui#8166 stopped this tier binding an ambient `data`,
 * so the predicate now faults at runtime with `Unknown variable: data` — but the
 * author still gets a GREEN lint while typing it. That gap is the whole card:
 * the diagnostic arrives at misbehaviour time instead of at typing time.
 *
 * ## Why this is not a re-run of the warning Phase 2 (`83fe6e741`) deleted
 *
 * That ruling removed the Phase-1 warning from the runtime hot path and kept
 * the export, in its own words, "as the offline instrument". `listConditional.ts`
 * records the same split: the detector "stays exported for OFFLINE sweeps of
 * authored metadata, not for this hot path". This call site is neither the hot
 * path nor a render — it is the editor bridge, classifying authored text as the
 * author types it, which is the sweep case one document at a time. Nothing is
 * added back to `evalRowPredicate` / `listConditional.ts`.
 *
 * ## Why WARNING and never ERROR
 *
 * An `error` here would narrow the accepted set: every save gate on this tier
 * counts `severity === 'error'` (`ConditionalFormattingEditor`,
 * `ObjectFieldInspector`, `ConditionBuilder`, `PermissionAdvancedFacets`,
 * `clientValidation.validateObjectFieldRules`), so promoting this would refuse
 * predicates already stored in customer metadata. A `warning` leaves
 * `aria-invalid` unset and every gate open. Narrowing the ACCEPT SET is the
 * producer-side half and lives in `@objectstack/formula` (objectui#8166's
 * ruling); adding an advisory the engine never had is not that change.
 *
 * ## Why only ONE of the detector's two arms is consulted
 *
 * The detector also reports the bare shorthand, and that arm is deliberately
 * disabled here by passing `row = null` (the arm requires an own key of the
 * row). Measured, both directions:
 *
 *  - at `scope: 'record'` the engine ALREADY errors on a bare identifier and
 *    names the `record.<field>` fix, so the arm can only duplicate it;
 *  - at `scope: 'flattened'` — RLS `USING` / `CHECK` — a bare identifier is the
 *    CORRECT spelling (`organization_id == current_user.organization_id` is the
 *    editor's own placeholder). All three genuine RLS predicates in this repo
 *    fire that arm, i.e. it is a 100% false positive rate on that tier.
 *
 * `dataNamesRow` is passed `true` because what that guard actually decides — in
 * its own words, "a surface whose `data` is the host scope's own … is a
 * legitimate `data.*` site and is left alone" — is whether `data` is legitimate
 * here. On a record-scope authoring site it is not: `ROW_PREDICATE_ROOTS`,
 * `FIELD_RULE_ROOTS` and `FORMULA_ROOTS` all exclude it and `buildExpressionScope`
 * binds nothing under it. The metadata-editing layer where `data` IS canonical
 * (ADR-0089 D3) is `views/metadata-admin/SchemaForm.tsx`, which evaluates through
 * `views/metadata-admin/predicate.ts` and never reaches this function — which is
 * why the gate below is `scope === 'record'` and not a source pattern.
 *
 * ## Where the VERDICT comes from since `e3cb47624`
 *
 * "Is this root bound on this surface?" is a judgement the platform publishes:
 * `@objectstack/lint` exports `fieldRuleRootIssue` / `FIELD_RULE_BOUND_ROOTS`,
 * pinned upstream by a test named for rejecting `data` — the LEGAL root of the
 * same key one layer over. objectui derived the same answer independently, from
 * `ROW_PREDICATE_ROOTS` / `FIELD_RULE_ROOTS` / `FORMULA_ROOTS` plus the single
 * root `@object-ui/core`'s detector hard-codes. Two hand-maintained copies of
 * one judgement: they agree today, and the next root the platform binds or
 * unbinds moves one and not the other, silently, in the direction objectui#8166
 * already paid for once.
 *
 * So on the slots {@link FIELD_RULE_VERDICT_SLOTS} names, the verdict is ASKED,
 * not re-derived — and the engine's own message ships with it.
 *
 * ⚠️ The reason is NOT that the engine's message refuses a `record.<root>`
 * rewrite. Measured against the installed 18.1.0 (objectui#12030, objectui#12370, objectui#12626, objectui#12873, objectui#12971, objectui#13261, objectui#13440), it mostly PRESCRIBES one: the
 * `current_user` text CONTAINS "To gate on record state, rewrite the predicate
 * against `record`." — one of the three remedies it offers, and NOT where it
 * ends (measured: `includes` true, `endsWith` false; every covered slot's text
 * closes on "it is not a fourth answer"). (Exactly one root's message does
 * refuse the rewrite by name — `app`'s,
 * with "⛔ Do NOT write `record.app`" — and that one never reaches this function;
 * see the gate below.) The real reason is that the verdict widens and objectui
 * has no message for most of what it now judges:
 *
 *  - the local instrument produces a sentence for exactly ONE root —
 *    `@object-ui/core`'s `METADATA_LAYER_ROOT`, `data`. For every OTHER root a
 *    covered slot now reports there is no objectui sentence to keep; the
 *    alternative is hand-writing one per root, which is the second copy this
 *    card exists to delete. ⛔ Do not write that population down — it is
 *    `FIELD_RULE_JUDGED_ROOTS` minus `FIELD_RULE_BOUND_ROOTS` minus `data`, and
 *    it moves whenever the platform moves either set. And they would have to be
 *    per-root: the engine's texts for `data`, the user-root family, the
 *    platform-wide family and the ambient family are four different remedies,
 *    not one sentence with the root substituted;
 *  - the one message actually SWAPPED is `data`'s, and objectui's tail there —
 *    "Re-root the reference on `record`" — is the half that does not generalise.
 *    It is right for `data` and wrong for `current_user`, which is not a field of
 *    the record. Reading a verdict from one authority and explaining it from
 *    another drifts exactly the way two verdicts do.
 *
 * ⛔ Exactly one message ships per finding; the two are never concatenated.
 *
 * Two consequences, both deliberate and both pinned:
 *
 *  - a covered slot now advises on EVERY root the field level leaves unbound —
 *    except `app`. ⛔ The exception is a MECHANISM, not a list, and this comment
 *    deliberately enumerates neither side of it: the advisory runs only once the
 *    predicate is error-free (`issues.every((i) => i.severity !== 'error')`,
 *    below), and `app` is the single root the helper judges that the platform
 *    does not DECLARE (`FIELD_RULE_JUDGED_ROOTS` is `SCOPE_ROOTS` plus the
 *    ambient `app`), so for `app` alone the pre-existing bare-reference ERROR
 *    fires first and the advisory never runs — even though the helper judges it
 *    and carries a bespoke message for it. A name the helper does not judge at
 *    all is stopped by that same error, and was never a candidate. ⛔ Writing
 *    the advised roots out here would go stale the next time the platform moves
 *    either set; `celAuthoring.fieldRuleVerdict-9318.test.ts` sweeps the whole
 *    population instead. Still `warning`, so no save gate's accept set moves;
 *  - the surfaces {@link FIELD_RULE_VERDICT_SLOTS} does not name keep this
 *    function's own reading, unchanged. ⛔ Their coverage is not shrunk to match
 *    the helper.
 *
 * Severity is the one thing that stays objectui's: `warning`, never `error`.
 */
async function rowCanonAdvisory(source: string, slot: string | undefined): Promise<CelLintWarning | null> {
  if (slot !== undefined && FIELD_RULE_VERDICT_SLOTS.includes(slot)) {
    const fieldRuleRootIssue = await loadFieldRuleVerdict();
    if (fieldRuleRootIssue) {
      const issue = fieldRuleRootIssue(slot, source);
      // `null` = the source does not parse, or every root it reads is bound
      // here. Both are "nothing to report" upstream and here.
      return issue ? { severity: 'warning', message: issue.message } : null;
    }
    // An older/absent `@objectstack/lint` has no verdict to give. Fall through
    // to the local instrument rather than going quiet — progressive
    // enhancement never costs an author a diagnostic they had yesterday.
  }
  const canon = await loadRowCanon();
  const finding = canon?.detectNonCanonicalRowSpelling?.(source, null, true);
  if (!finding || finding.kind !== 'metadata-layer-root') return null;
  // objectui's own sentence, as a catalogue key the editor reads in the
  // designer locale (objectui#10862); `Unknown variable: …` inside it is the
  // runtime's fault text and stays as written in every locale.
  return {
    severity: 'warning',
    messageKey: 'engine.celLint.notTheRow',
    messageVars: { identifier: finding.identifier, canonical: finding.canonical },
  };
}

/* ── 1. Lint ─────────────────────────────────────────────────────────── */

/**
 * Validate one CEL source. Returns the findings to surface inline: parse
 * faults as `error` (block save), unknown-field near-misses as `warning`
 * (advisory). With {@link CelSchemaHint.clause} set, `@objectstack/lint`'s RLS
 * rule judges the clause too, and each finding keeps the rule's severity and
 * words — the publish door's verdict (see `rlsPredicateVerdict`).
 *
 * RLS predicates reference fields BARE (`organization_id == current_user.…`),
 * like a flattened flow condition — so a bare identifier is legal and an
 * unknown one is a non-blocking "did you mean" warning, never a hard error.
 * We never fail-CLOSED on a maybe-typo for a security surface: flag it, don't
 * silently narrow (or, worse, block) the author's row scope.
 *
 * With `hint.role: 'value'` the same checks run for a formula-style value
 * expression (usually paired with `scope: 'record'`, where a bare field ref IS
 * a hard error — it silently evaluates to null at runtime).
 *
 * At `scope: 'record'` one finding comes from outside `validateExpression`: the
 * wrong-layer root advisory described on {@link rowCanonAdvisory}, whose verdict
 * comes from `@objectstack/lint` when {@link CelSchemaHint.slot} names a slot
 * that helper's vocabulary covers and from the local instrument otherwise. It is
 * always a `warning`, so it never narrows what this surface accepts.
 *
 * Empty input is always clean.
 */
export async function lintCelPredicate(
  source: string,
  hint: CelSchemaHint = {},
): Promise<CelLintIssue[]> {
  if (!source || !source.trim()) return [];
  try {
    const mod = await loadFormula();
    if (!mod?.validateExpression) return [];
    const res = mod.validateExpression(hint.role ?? 'predicate', source, {
      objectName: hint.objectName,
      fields: hint.fields,
      scope: hint.scope ?? 'flattened',
    });
    const issues: CelLintIssue[] = [];
    for (const e of res?.errors ?? []) {
      if (e?.message) issues.push({ severity: 'error', message: e.message });
    }
    for (const w of res?.warnings ?? []) {
      if (w?.message) issues.push({ severity: 'warning', message: w.message });
    }
    // The RLS rule's verdicts (objectui#13061, objectui#13082) — see
    // `rlsPredicateVerdict`. Both RLS clauses, lowerable or not, only once the
    // predicate parses (a parse fault already surfaced above), at the rule's
    // severity and in its words.
    // (`some`, not `every`: an inferred predicate on `every` would narrow
    // `issues` to warnings and refuse the push below.)
    if (!issues.some((i) => i.severity === 'error') && (hint.clause === 'using' || hint.clause === 'check')) {
      try {
        issues.push(...(await rlsPredicateVerdict(source, hint.clause)));
      } catch {
        /* author-time assistance — never let it break the lint */
      }
    }
    // Wrong-layer root advisory (objectui#8972, verdict re-homed by `e3cb47624`)
    // — see `rowCanonAdvisory`. Only in `record` scope, only once the predicate
    // parses, only a WARNING.
    if (issues.every((i) => i.severity !== 'error') && hint.scope === 'record') {
      try {
        const advisory = await rowCanonAdvisory(source, hint.slot);
        if (advisory) issues.push(advisory);
      } catch {
        /* advisory only — never let it break the lint */
      }
    }
    return issues;
  } catch {
    return [];
  }
}

/* ── 1b. Value-type inference (formulas) ─────────────────────────────── */

/**
 * The coarse value categories a formula can compute — mirrors the engine's
 * `InferredValueType`. `'unknown'` means cel-js could not PROVE a concrete
 * type (e.g. `record.a + record.b` could be number addition or string
 * concatenation); wrapping operands in `double()` / `int()` / `string()`
 * pins it.
 */
export type CelValueType = 'number' | 'text' | 'boolean' | 'date' | 'unknown';

const CEL_VALUE_TYPES: readonly CelValueType[] = ['number', 'text', 'boolean', 'date', 'unknown'];

/**
 * Infer the value type a formula (`role: 'value'`) expression computes, via
 * the engine's `inferExpressionType` — the SAME verdict dataset derivation
 * uses for measure eligibility (only a proven-`number` formula becomes a SUM
 * measure), so the editor can show the author what their formula will and
 * won't be usable as *before* they save.
 *
 * Returns `null` — "no affordance", not "unknown type" — for empty input or
 * when the engine (or its `inferExpressionType` export) is unavailable.
 */
export async function inferCelValueType(
  source: string,
  hint: CelSchemaHint = {},
): Promise<CelValueType | null> {
  if (!source || !source.trim()) return null;
  try {
    const mod = await loadFormula();
    if (!mod?.inferExpressionType) return null;
    const res = mod.inferExpressionType(source, {
      objectName: hint.objectName,
      fields: hint.fields,
      scope: hint.scope ?? 'record',
    });
    return CEL_VALUE_TYPES.includes(res as CelValueType) ? (res as CelValueType) : 'unknown';
  } catch {
    return null;
  }
}

/* ── 2. Autocomplete scope ───────────────────────────────────────────── */

/**
 * Introspect the identifiers valid in a predicate for {@link hint}'s object:
 * the object fields, the scope roots (`current_user`, `record`, …) and the
 * callable stdlib functions. Feeds the editor's autocomplete so the author
 * doesn't guess an identifier that silently never matches.
 *
 * Degrades to `{ fields: hint.fields, roots: [], functions: [] }` when the
 * engine (or the `introspectScope` export) is unavailable — the author keeps
 * field suggestions from metadata even with an older/absent engine.
 */
export async function introspectCelScope(hint: CelSchemaHint = {}): Promise<CelScopeInfo> {
  const fallback: CelScopeInfo = { fields: hint.fields ?? [], roots: hint.roots ?? [], functions: [] };
  try {
    const mod = await loadFormula();
    if (!mod?.introspectScope) return fallback;
    const res = mod.introspectScope(hint.role ?? 'predicate', {
      objectName: hint.objectName,
      fields: hint.fields,
      scope: hint.scope ?? 'flattened',
    });
    return {
      fields: res?.fields ?? hint.fields ?? [],
      roots: hint.roots ?? res?.roots ?? [],
      functions: res?.functions ?? [],
    };
  } catch {
    return fallback;
  }
}

/* ── Autocomplete token/candidate helpers (pure) ─────────────────────── */

/** What an autocomplete entry represents — drives its badge and insert form. */
export type CelSuggestionKind = 'field' | 'root' | 'function';
export interface CelSuggestion {
  label: string;
  kind: CelSuggestionKind;
}

/** Chars that make up a CEL identifier segment. */
const IDENT_CHAR = /[A-Za-z0-9_$]/;
const IDENT_START = /[A-Za-z_$]/;
/** Cap on suggestions shown at once. */
export const MAX_CEL_SUGGESTIONS = 8;

/**
 * The identifier segment being typed immediately before `caret`, or `null` when
 * there is nothing to complete. A segment preceded by `.` is member access
 * (`current_user.org…`) — we can't know the member shape, so we suppress rather
 * than suggest a wrong top-level identifier (but see {@link memberTokenAt} for
 * the roots whose member shape IS known).
 */
export function tokenAt(
  text: string,
  caret: number,
): { start: number; end: number; text: string } | null {
  let start = caret;
  while (start > 0 && IDENT_CHAR.test(text[start - 1])) start--;
  if (start === caret) return null; // caret not at the end of an identifier run
  const seg = text.slice(start, caret);
  if (!IDENT_START.test(seg[0])) return null; // starts with a digit → not an identifier
  if (start > 0 && text[start - 1] === '.') return null; // member access → suppress
  return { start, end: caret, text: seg };
}

/**
 * The member segment being typed immediately after `<root>.` — e.g. caret at
 * the end of `record.sta` yields `{ root: 'record', text: 'sta' }`, and caret
 * right after `record.` yields `{ root: 'record', text: '' }` (so the full
 * field catalog can surface as soon as the dot is typed). Unlike
 * {@link tokenAt} the segment may be EMPTY, and only a single-level chain
 * qualifies: in `record.owner.name` the `name` segment's root is `owner`
 * (unknown shape), not `record`, so it returns `null` via the root's own
 * preceding-dot check. Returns `null` when the caret is not in a member
 * position (objectui#1582).
 */
export function memberTokenAt(
  text: string,
  caret: number,
): { root: string; start: number; end: number; text: string } | null {
  let start = caret;
  while (start > 0 && IDENT_CHAR.test(text[start - 1])) start--;
  const seg = text.slice(start, caret);
  if (seg && !IDENT_START.test(seg[0])) return null; // digit-led → not an identifier
  if (start === 0 || text[start - 1] !== '.') return null; // not member access
  // The identifier run immediately before the dot is the root.
  let rootStart = start - 1;
  while (rootStart > 0 && IDENT_CHAR.test(text[rootStart - 1])) rootStart--;
  const root = text.slice(rootStart, start - 1);
  if (!root || !IDENT_START.test(root[0])) return null;
  if (rootStart > 0 && text[rootStart - 1] === '.') return null; // deeper chain → unknown shape
  return { root, start, end: caret, text: seg };
}

/** Merge a scope into a single de-duplicated, ordered candidate catalog. */
export function buildCandidates(scope: CelScopeInfo): CelSuggestion[] {
  const seen = new Set<string>();
  const out: CelSuggestion[] = [];
  const push = (label: string, kind: CelSuggestionKind) => {
    if (!label || seen.has(label)) return;
    seen.add(label);
    out.push({ label, kind });
  };
  // Fields first (the author's own object), then scope roots, then functions.
  scope.fields.forEach((f) => push(f, 'field'));
  scope.roots.forEach((r) => push(r, 'root'));
  scope.functions.forEach((fn) => push(fn, 'function'));
  return out;
}

/**
 * Prefix-filter the catalog for `query` (case-insensitive), excluding exact
 * hits. An empty query yields nothing unless `allowEmpty` — member completion
 * wants the full (capped) catalog the moment the dot is typed, while bare
 * completion staying quiet until a character is typed avoids a popup on focus.
 */
export function filterCandidates(
  candidates: CelSuggestion[],
  query: string,
  allowEmpty = false,
): CelSuggestion[] {
  const q = query.toLowerCase();
  if (!q && !allowEmpty) return [];
  const out: CelSuggestion[] = [];
  for (const c of candidates) {
    const l = c.label.toLowerCase();
    if (l.startsWith(q) && l !== q) out.push(c);
    if (out.length >= MAX_CEL_SUGGESTIONS) break;
  }
  return out;
}

/* ── 3. Test-run ─────────────────────────────────────────────────────── */

/**
 * Dry-run a predicate against a sample scope and report allow / deny / value /
 * error. The scope is bound to match how the RLS runtime exposes data:
 *
 *   - `record`               the candidate row, as the `record` namespace;
 *   - the row's fields spread to BARE top-level (`organization_id`), so the
 *     flattened authoring convention (`organization_id == …`) resolves; and
 *   - `current_user` / `user` bound VERBATIM from the author's sample (no
 *     canonical renaming — `current_user.organization_id` resolves as typed).
 *
 * Never throws — the engine returns a discriminated result and any thrown
 * loader/eval fault collapses to `error` / `unavailable`.
 *
 * The two sentences this function writes itself come back as a `messageKey`
 * (objectui#10862): the empty-predicate result
 * (`engine.celTest.predicateEmpty`) and the fallback when the engine reports a
 * failure without a message (`engine.flowSim.note.evaluationFailed`, the same
 * "Evaluation failed." the flow debugger uses). The engine's own message
 * passes through as written, as `message`.
 */
export async function testRunCelPredicate(
  source: string,
  sample: CelSampleContext,
): Promise<CelTestOutcome> {
  if (!source || !source.trim()) {
    return { status: 'error', kind: 'parse', messageKey: 'engine.celTest.predicateEmpty' };
  }
  let mod: FormulaModule | null;
  try {
    mod = await loadFormula();
  } catch {
    return { status: 'unavailable' };
  }
  if (!mod?.ExpressionEngine?.evaluate) return { status: 'unavailable' };
  try {
    const record = sample.record ?? {};
    const currentUser = sample.currentUser ?? {};
    const ctx = {
      record,
      extra: { ...record, record, current_user: currentUser, user: currentUser },
    };
    const res = mod.ExpressionEngine.evaluate({ dialect: 'cel', source }, ctx);
    if (!res || res.ok !== true) {
      const err = res && res.ok === false ? res.error : undefined;
      const kind = err?.kind ?? 'runtime';
      return err?.message != null
        ? { status: 'error', kind, message: err.message }
        : { status: 'error', kind, messageKey: 'engine.flowSim.note.evaluationFailed' };
    }
    if (res.value === true) return { status: 'allow' };
    if (res.value === false) return { status: 'deny' };
    return { status: 'value', value: res.value };
  } catch (e) {
    return { status: 'error', kind: 'runtime', message: (e as Error)?.message ?? String(e) };
  }
}
