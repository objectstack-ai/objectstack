// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import {
  CLIENT_CONDITION_ROOTS,
  RECORD_CONDITION_SUBJECTS,
} from './inspectors/ConditionBuilder.js';

/**
 * Which lint scope a SCHEMA-DRIVEN condition editor claims, decided by the
 * metadata type being edited (objectui#8167).
 *
 * ## The defect
 *
 * `SchemaForm` routes a field to the CEL condition builder by NAME CONVENTION
 * (`visible` / `hidden` / `disabled` / `condition` / `predicate` / `*When`),
 * so one widget serves every metadata type. It claimed no scope, so
 * every such field fell through to `celAuthoring`'s own `hint.scope ??
 * 'flattened'` default — and a bare `status == 'done'` typed into an action's
 * **Visible when** linted CLEAN while the runtime binds the row as the `record`
 * ROOT and never matches it. The editor issued a receipt the runtime refuses.
 *
 * ## Why a TABLE and not one value
 *
 * The widget's surface is whatever the host schema points it at, so no single
 * scope is right for it: `record` is right where the evaluator binds a row, and
 * refusing the bare shorthand on the flow / RLS tiers — which are NOT row
 * surfaces (stand-down 3 on the corpus-sweep card behind `702c48a62`) — would narrow a surface with no defect.
 * The one place that knows which tier is on screen is the host that is editing
 * a metadata type, so the scope originates there and rides
 * {@link WidgetContext.conditionScope}, required at construction.
 *
 * ## The verdicts are RULED, not derived here
 *
 * Every row below is the director seat's ruling of 2026-09-17 (batch #150 item
 * 5, letter B with the derivation table; maintainer 「同意」), which applies the
 * earlier rule — *a mount's lint scope is decided by what the evaluator binds at
 * runtime* — once per tier, from readings already taken on that thread:
 *
 *   • action `visible` / `disabled` / `enabled` → `record`: a row surface by
 *     `rowPredicateCanon.ts`'s own words.
 *   • validation rule `condition` → `record`: objectql's rule validator binds
 *     `{ record, previous }` and fail-closes on an unevaluable predicate, so a
 *     bare reference rejects every write to the object.
 *   • hook `condition` → `record`: `wrapDeclarativeHook` evaluates it as
 *     `{ record: record ?? {}, previous }` and throws on an unevaluable one.
 *     Landed at the curated hook inspector in objectui#9643; this is the same
 *     verdict reaching the generic form.
 *   • flow node `condition` → `flattened`: the flow tier is not a row surface.
 *   • permission / RLS row condition → `flattened`: RLS is not a row surface.
 *   • page block `visibleWhen` → `none`: its evaluator binds `record` +
 *     `current_user` + `page.<var>`, and NEITHER lint scope expresses that set —
 *     at `record` the validator refuses `page.<var>`, which is the spec's own
 *     worked example for the key, with the nonsense remedy `record.page`. It
 *     becomes `record` once the engine gains the `page` root (objectstack#18554
 *     or the no-objectstack fourth option recorded there); ⛔ this card does not
 *     wait on it.
 *   • any type without a row → `none`.
 *
 * ⛔ Do not re-open a row here. A tier whose runtime binding has actually
 * CHANGED is a new reading and a new ruling, not an edit to this table.
 *
 * ## `none` is a decision, not an absence
 *
 * `none` routes the field to the plain editor with no lint claim at all — the
 * option-D shape, taken per row. It is NOT the same as omitting a scope: an
 * omitted scope still renders the builder and still lets `celAuthoring`'s
 * `flattened` default answer, which is the receipt-for-nothing this card exists
 * to stop.
 *
 * ## The table is exhaustive over the types the editor serves
 *
 * A type reaching this table with no row would take `none` silently — a lint
 * claim dropped by omission, which is exactly how the defect got in. So the
 * runtime fallback is `none` (a new type must never crash the editor) and
 * `ConditionWidget.conditionScope.test.tsx` is what makes it LOUD: it
 * enumerates the registered metadata resources and reddens on the first type
 * that has no row here.
 */
export type ConditionScope = 'record' | 'flattened' | 'none';

/**
 * The ruled table, one row per metadata type the editor serves.
 *
 * `satisfies` rather than an annotation so the KEY SET survives as a literal
 * union for the pin test to read back, while every value still has to be a
 * {@link ConditionScope}.
 */
export const CONDITION_SCOPE_BY_METADATA_TYPE = {
  /* ── `record` — the evaluator binds the row as the `record` root ─────── */
  action: 'record',
  hook: 'record',
  /**
   * ⚠️ RULED and correct, and today it has no live host through this table —
   * both halves matter, so both are written down.
   *
   * The verdict is the ruling's: a validation rule's `condition` is evaluated
   * by objectql's rule validator with `{ record, previous }` and nothing else,
   * and an unevaluable predicate there is fail-CLOSED, so a bare reference
   * rejects every write to the object. ⛔ Not re-openable here.
   *
   * What does NOT follow is that this row is what delivers it. The standalone
   * `validation` KIND is retired (ADR-0088; `anchors.validation-retired.test.ts`
   * pins it, and records that the kind is absent from the spec's registry), so
   * `ResourceEditPage` never legitimately receives this type. An object's
   * embedded rules are reached through the `__object_validation` anchor, whose
   * `editAs: 'validation'` opens `EmbeddedItemEditor` — and that editor builds
   * NO `WidgetContext` at all, so its form never consults this table. The
   * `record` verdict those conditions actually get today comes from the curated
   * `ObjectValidationsPanel`, which declares `scope="record"` at its own mount.
   *
   * ⇒ the row is the ruling written down and the answer waiting for a host, ⛔
   * not a claim that a host reads it. Successor: `EmbeddedItemEditor` deriving a
   * `WidgetContext` from its `editAs`, which is the one change that would put
   * every embedded child on this table.
   */
  validation: 'record',

  /* ── `flattened` — a real tier, and not a row surface ────────────────── */
  flow: 'flattened',
  permission: 'flattened',
  /** Row-level security: a rule condition, evaluated per row but bound flat —
   *  a stand-down 3 surface of the corpus-sweep card behind `702c48a62`, the same as `permission`. */
  sharing_rule: 'flattened',

  /* ── `none` — no lint claim this editor may honestly make ────────────── */
  /** Page blocks: `record` + `current_user` + `page.<var>`, which no lint
   *  scope expresses. See the `page block` bullet above. */
  page: 'none',

  /* ── `none` — the ruling's last row: a type without a row of its own ─── */
  __object_field: 'none',
  __object_index: 'none',
  __object_validation: 'none',
  analytics_cube: 'none',
  api: 'none',
  app: 'none',
  agent: 'none',
  book: 'none',
  connector: 'none',
  dashboard: 'none',
  datasource: 'none',
  /** objectui#10188 registers `doc`; `DocSchema` declares no condition key. */
  doc: 'none',
  email_template: 'none',
  field: 'none',
  index: 'none',
  job: 'none',
  mapping: 'none',
  object: 'none',
  position: 'none',
  report: 'none',
  skill: 'none',
  tool: 'none',
  translation: 'none',
  view: 'none',
  webhook: 'none',
} satisfies Record<string, ConditionScope>;

/** Every metadata type {@link CONDITION_SCOPE_BY_METADATA_TYPE} rules, as a union. */
export type RuledMetadataType = keyof typeof CONDITION_SCOPE_BY_METADATA_TYPE;

/**
 * The scope a host editing `type` must declare on its {@link WidgetContext}.
 *
 * Falls back to `none` for an unruled type — the editor must keep working for a
 * metadata type this build has never heard of, and `none` is the only answer
 * that claims nothing. ⚠️ That fallback is NOT where a new type is meant to
 * land: the pin test enumerates the registered types against the table, so a
 * new one is a red test before it is ever a silent `none`.
 */
export function conditionScopeForMetadataType(type: string): ConditionScope {
  const table: Record<string, ConditionScope> = CONDITION_SCOPE_BY_METADATA_TYPE;
  return table[type] ?? 'none';
}

/* ========================================================================== */
/* The SECOND question: who evaluates the condition (objectui#9953)           */
/* ========================================================================== */

/**
 * Which host evaluates a condition authored at a mount editing this metadata
 * type.
 *
 * ## Why {@link ConditionScope} cannot answer this, and a second table must
 *
 * The scope table gives `action`, `hook` and `validation` the same `'record'`,
 * and that verdict is right for all three — each evaluator binds the row as the
 * `record` ROOT. But `'record'` is a claim about how the CEL is LINTED, not a
 * claim about what the host BINDS, and on that second question the three
 * disagree: two are evaluated on the SERVER, one in the BROWSER. So one value
 * covers two different binding sets, and any single subject vocabulary declared
 * at the generic mount would be correct for one tier and wrong for the other.
 *
 * `RECORD_CONDITION_SUBJECTS` refuses to derive its narrowing from
 * `scope === 'record'` for precisely this reason, and says so in its own words.
 * This table is the other end of that refusal: the fact the component cannot
 * see, supplied by the one place that knows which metadata type is on screen.
 */
export type ConditionEvaluationHost = 'server' | 'client';

/**
 * The measured host per metadata type, PARTIAL over the ruled table on purpose.
 *
 * ## Why partial, and what keeps it honest anyway
 *
 * A row here is a MEASUREMENT of a real evaluator, so a type whose condition
 * nobody has put to an evaluator must have no row rather than a guessed one.
 * Every absent type therefore derives no narrowing at all and the builder keeps
 * its own default vocabulary — byte for byte what it offered before this table
 * existed.
 *
 * Two things stop that from becoming the silent-default defect this card is
 * about. The `satisfies Partial<Record<RuledMetadataType, …>>` below ties the
 * KEY SET to the ruled scope table, so a key that is not a ruled metadata type
 * is a compile error here. And `ConditionWidget.conditionSubjects.test.tsx`
 * requires a row for every type the scope table rules `'record'` — the tiers
 * where a subject vocabulary is actually offered — so a new row-surface type
 * reddens there instead of inheriting `user.*` unremarked.
 *
 * ## The readings behind each row, re-derived at source in objectstack
 *
 *  • `hook` → `server`. `wrapDeclarativeHook`'s pre-compiled condition calls
 *    `ExpressionEngine.evaluate<boolean>(expr, { record: record ?? {}, previous })`
 *    and throws when the result is not `ok`, so an unevaluable predicate aborts
 *    the operation rather than resolving false. Two bindings, no `user`.
 *  • `validation` → `server`. A rule's `condition` goes through `checkPredicate`
 *    and its `when` through `checkConditional`; both evaluate against
 *    `{ record, previous }` and both return an `unevaluableRuleError` when the
 *    predicate cannot be evaluated — the rule validator's own log line calls
 *    that outcome "rejected, not skipped". Two bindings, no `user`.
 *  • `action` → `client`. An action's `visible` / `disabled` are evaluated in
 *    the browser, where `buildExpressionScope` (`ExpressionProvider`) returns a
 *    bag carrying `user` (alongside `current_user`, `ctx`, `os` and `features`)
 *    and the row arrives through `usePredicateRecordContext`. `user` is a
 *    subject an author can legitimately pick here, so this row exists to keep
 *    the narrowing OFF this tier — an omission would read the same way and
 *    claim nothing.
 *
 * ⛔ Do not add a row from a docblock or a card. A row is a reading taken at
 * the evaluator.
 */
export const CONDITION_HOST_BY_METADATA_TYPE = {
  action: 'client',
  hook: 'server',
  validation: 'server',
} satisfies Partial<Record<RuledMetadataType, ConditionEvaluationHost>>;

/** The host that evaluates `type`'s condition, or `undefined` when unmeasured. */
export function conditionHostForMetadataType(
  type: string,
): ConditionEvaluationHost | undefined {
  const table: Partial<Record<string, ConditionEvaluationHost>> =
    CONDITION_HOST_BY_METADATA_TYPE;
  return table[type];
}

/**
 * The context subjects a host editing `type` must declare on its
 * {@link WidgetContext}, or `undefined` to declare nothing.
 *
 * The sibling of {@link conditionScopeForMetadataType}, and the one place the
 * per-type answer is derived: `ResourceEditPage` is polymorphic over every
 * metadata type, so it can no more hard-code a vocabulary than it could
 * hard-code a scope.
 *
 * `undefined` is a decision and not an absence, the same way `'none'` is in the
 * scope table — it means this mount declares no narrowing, so `ConditionBuilder`
 * keeps `CONTEXT_SUBJECTS`, which is what every generic mount offered before
 * this derivation existed. The `client` tier takes that arm deliberately: its
 * predicates really are evaluated where `user` is bound, so narrowing there
 * would take a working subject away rather than withdraw an unbound one.
 */
export function conditionSubjectsForMetadataType(
  type: string,
): ReadonlyArray<{ value: string; label?: string }> | undefined {
  return conditionHostForMetadataType(type) === 'server'
    ? RECORD_CONDITION_SUBJECTS
    : undefined;
}

/**
 * The scope roots a condition editor at a host editing `type` may OFFER, or
 * `undefined` to declare no narrowing (objectui#9856).
 *
 * The third derivation off {@link CONDITION_HOST_BY_METADATA_TYPE}, and the one
 * that reads it the other way round from
 * {@link conditionSubjectsForMetadataType}. That one narrows the SERVER tier,
 * because the row builder's subject dropdown offers `user.*` by default and a
 * server host binds no `user`. This one widens the CLIENT tier, because
 * `ConditionBuilder` narrows a `scope="record"` mount to
 * `RECORD_CONDITION_ROOTS` by default and a browser host binds more than that.
 * Same table, opposite defaults, one ruling — which is why neither can be
 * derived from `scope === 'record'`, and why the answer has to come from the
 * host that knows which metadata type is on screen.
 *
 * `undefined` is a decision here too, and it covers both remaining arms:
 *
 *  - a `server` tier keeps the builder's own record-scoped narrowing, byte for
 *    byte what objectui#9645 landed;
 *  - an UNMEASURED tier keeps whatever it had, because a root list is a reading
 *    taken at an evaluator and there is none to hand back for a tier nobody has
 *    put to one.
 */
export function conditionRootsForMetadataType(type: string): string[] | undefined {
  return conditionHostForMetadataType(type) === 'client' ? CLIENT_CONDITION_ROOTS : undefined;
}
