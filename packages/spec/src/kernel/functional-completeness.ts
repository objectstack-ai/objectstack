// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * # Functional completeness — the shared per-type predicate (ADR-0078 Phase 1)
 *
 * A metadata instance can be Zod-valid, use only *live* properties, and still
 * be runtime-DEAD because it omits a sibling config its consumer needs — and
 * the consumer silently no-ops instead of erroring. The founding case
 * (cloud#687): an AI authored `{ type: 'summary' }` with no
 * `summaryOperations`; the engine's index builder skips it, the field reads 0
 * everywhere, the dependent "occupancy rate" formula is forever 0 — and the
 * agent reported the work done, because every gate it could see was green.
 *
 * This module is the single source of truth for "is this instance complete
 * enough to run", shared the way `data/aggregation-policy.ts` shares
 * `isIncoherentAggregate` (the ADR-0019 pattern): `@objectstack/lint`'s
 * `validate-functional-completeness` consumes it for `os build` / `os validate`
 * / MCP / hand authoring, and cloud's graph-lint is meant to re-home its
 * duplicate rules onto it so the AI-build path cannot drift from the framework
 * (ADR-0078 §2 — the path-asymmetry the ADR exists to kill).
 *
 * ## Discipline: every rule here cites the runtime line that makes it true
 *
 * The completeness audit's scariest candidate (a "fail-open sharing rule")
 * collapsed on a three-file read, and this campaign shipped four confidently
 * wrong prescriptions before learning the same lesson — so a rule is added
 * here ONLY with the silent-skip site named, and a deliberate NON-rule is
 * recorded with the evidence that exempts it. The codebase can be asked;
 * these were:
 *
 * - `summary` w/o `summaryOperations` → `objectql/engine.ts:3001`
 *   `if (d?.type !== 'summary' || !d.summaryOperations) continue;`
 * - `formula` w/o `expression` → `objectql/engine.ts:346` builds the formula
 *   plan only from fields WITH an expression; a bare formula never computes.
 * - `lookup`/`master_detail` w/o `reference` → `objectql/engine.ts:3191`
 *   `$expand` `if (!referenceObject) continue;` — the relationship silently
 *   never resolves, and the record picker has no target to search.
 * - `select`/`radio` w/o `options` → `record-validator.ts:452`
 *   `allowed.length > 0 && …`: an empty option list disables server-side
 *   value validation entirely, while the form control offers nothing to pick.
 * - **NON-rule:** `multiselect` w/o `options` — `record-validator.ts:471`
 *   says, verbatim, `// free-form (tags without options)`. The runtime
 *   blesses it as a deliberate mode, which makes it ADR-0078 case (3)
 *   "genuinely optional", not an omission. Flagging it would be this
 *   campaign's own false-prescription mistake again.
 * - `checkboxes` w/o `options` sits between the two: it shares the multi
 *   branch's free-form validator behaviour, but a checkbox group with zero
 *   boxes is almost certainly an omission — so it is a WARNING, not an error.
 * - `webhook` w/o `triggers` → `auto-enqueuer.ts` `if (triggers.size === 0) …
 *   return null`. Note this one needed a SECOND source: that skip site's own
 *   comment blesses the empty case as "a manual-only webhook", which reads
 *   exactly like the `multiselect` exemption above — but `webhook.zod.ts`
 *   (#3196) records that no manual fire path exists, so the blessed mode is
 *   unreachable. See {@link checkWebhookCompleteness}. A runtime comment states
 *   what its author believed; a removed sibling feature can make it stale.
 *
 * Severity follows ADR-0078 decision 1: `error` when the instance is fully
 * inert, `warning` when it degrades to something that partially works.
 */

/** One completeness violation on one instance. */
export interface CompletenessFinding {
  /** Stable rule id, e.g. `field/summary-without-operations`. */
  rule: string;
  /** `error` = fully inert instance; `warning` = degrades (ADR-0078 §1). */
  severity: 'error' | 'warning';
  /** Path of the omitted config relative to the item (e.g. `summaryOperations`). */
  path: string;
  /** What is inert, the runtime line that makes it so, and what to add. */
  message: string;
  /** One-line prescription, machine-pastable where possible. */
  fix: string;
}

export const FIELD_SUMMARY_WITHOUT_OPERATIONS = 'field/summary-without-operations';
export const FIELD_FORMULA_WITHOUT_EXPRESSION = 'field/formula-without-expression';
export const FIELD_RELATIONSHIP_WITHOUT_REFERENCE = 'field/relationship-without-reference';
export const FIELD_CHOICE_WITHOUT_OPTIONS = 'field/choice-without-options';
export const VIEW_LAYOUT_WITHOUT_BINDING = 'view/layout-without-binding';
export const VIEW_TREE_WITHOUT_PARENT_FIELD = 'view/tree-without-parent-field';
export const WEBHOOK_WITHOUT_TRIGGERS = 'webhook/without-triggers';

/** Every rule id this module can emit — pinned by tests so ids cannot drift. */
export const FUNCTIONAL_COMPLETENESS_RULES = [
  FIELD_SUMMARY_WITHOUT_OPERATIONS,
  FIELD_FORMULA_WITHOUT_EXPRESSION,
  FIELD_RELATIONSHIP_WITHOUT_REFERENCE,
  FIELD_CHOICE_WITHOUT_OPTIONS,
  VIEW_LAYOUT_WITHOUT_BINDING,
  VIEW_TREE_WITHOUT_PARENT_FIELD,
  WEBHOOK_WITHOUT_TRIGGERS,
] as const;

type AnyRec = Record<string, unknown>;

const isRec = (v: unknown): v is AnyRec => !!v && typeof v === 'object' && !Array.isArray(v);

const hasEntries = (v: unknown): boolean => Array.isArray(v) && v.length > 0;

/**
 * Field types whose single-choice control is dead without `options`
 * (`record-validator.ts:452` skips validation on an empty list, and the form
 * control has nothing to offer). `multiselect` is deliberately absent — see
 * the NON-rule note in the module doc.
 */
const DEAD_WITHOUT_OPTIONS_ERROR: ReadonlySet<string> = new Set(['select', 'radio']);
const DEAD_WITHOUT_OPTIONS_WARNING: ReadonlySet<string> = new Set(['checkboxes']);

/** Relationship types whose `$expand` / picker are inert without `reference`.
 * `user` is exempt (its target is implicitly `sys_user`); `tree` is exempt
 * pending its own verification pass — only assert what was verified. */
const RELATIONSHIP_TYPES: ReadonlySet<string> = new Set(['lookup', 'master_detail']);

/**
 * Completeness of a single field definition (an `objects[].fields` entry or a
 * standalone `field` metadata item). Pure and total: unknown shapes yield no
 * findings, never a throw — a lint must not be the thing that crashes a build.
 */
export function checkFieldCompleteness(def: unknown): CompletenessFinding[] {
  if (!isRec(def)) return [];
  const type = typeof def.type === 'string' ? def.type : undefined;
  if (!type) return [];
  const out: CompletenessFinding[] = [];

  if (type === 'summary' && !isRec(def.summaryOperations)) {
    // Internal anchor: the founding incident for this rule is cloud#687. It sits
    // here rather than in the message — the message is printed to a customer who
    // has neither repo's tracker; ADR-0078 is the reference that travels.
    out.push({
      rule: FIELD_SUMMARY_WITHOUT_OPERATIONS,
      severity: 'error',
      path: 'summaryOperations',
      message:
        'A `summary` field with no `summaryOperations` computes nothing: the engine\'s '
        + 'summary index skips it (`engine.ts` — `if (!d.summaryOperations) continue`), so it '
        + 'reads 0/null everywhere and anything derived from it is stuck at 0 — while every '
        + 'authoring surface reports success. This is the shape ADR-0078 was written for.',
      fix: "summaryOperations: { object: '<child_object>', field: '<child_field>', function: 'sum' }",
    });
  }

  if (type === 'formula' && def.expression === undefined) {
    out.push({
      rule: FIELD_FORMULA_WITHOUT_EXPRESSION,
      severity: 'error',
      path: 'expression',
      message:
        'A `formula` field with no `expression` never computes: the engine builds its formula '
        + 'plan only from fields that HAVE one (`engine.ts` — `if (def?.type === \'formula\' && '
        + 'def.expression)`), so this field is permanently empty while parsing and publishing succeed.',
      fix: 'expression: F`record.<a> * record.<b>`',
    });
  }

  if (RELATIONSHIP_TYPES.has(type) && typeof def.reference !== 'string') {
    out.push({
      rule: FIELD_RELATIONSHIP_WITHOUT_REFERENCE,
      severity: 'error',
      path: 'reference',
      message:
        `A \`${type}\` field with no \`reference\` is a relationship to nowhere: \`$expand\` `
        + 'silently skips it (`engine.ts` — `if (!referenceObject) continue`) and the record '
        + 'picker has no object to search, so the column stores raw ids that never resolve.',
      fix: "reference: '<target_object_name>'",
    });
  }

  if (DEAD_WITHOUT_OPTIONS_ERROR.has(type) && !hasEntries(def.options)) {
    out.push({
      rule: FIELD_CHOICE_WITHOUT_OPTIONS,
      severity: 'error',
      path: 'options',
      message:
        `A \`${type}\` field with no \`options\` is a choice with nothing to choose: the form `
        + 'control is empty AND server-side value validation is disabled (`record-validator.ts` '
        + 'skips the check when the allowed list is empty), so any value writes through the API.',
      fix: "options: [{ label: '…', value: '…' }]",
    });
  } else if (DEAD_WITHOUT_OPTIONS_WARNING.has(type) && !hasEntries(def.options)) {
    out.push({
      rule: FIELD_CHOICE_WITHOUT_OPTIONS,
      severity: 'warning',
      path: 'options',
      message:
        'A `checkboxes` field with no `options` renders zero checkboxes. The validator\'s '
        + 'multi-value branch tolerates it as free-form (the `multiselect` tags mode), but a '
        + 'checkbox group is almost never meant to be free-form — declare the boxes, or use '
        + '`multiselect` if free-form tags were the intent.',
      fix: "options: [{ label: '…', value: '…' }]",
    });
  }

  return out;
}

/**
 * The layout-specific config block each view type is inert without. The
 * renderer falls back to LITERAL field names, so a view without its block
 * renders — but empty — on any object that does not happen to declare those
 * exact fields. Degrades rather than fully dies: WARNING, not error
 * (ADR-0078 §1).
 *
 * Every entry names its measured renderer fallback. The verify-then-enforce
 * gate this table sits behind (the audit's Tier-A had named only the first
 * three) was discharged for `timeline` / `map` / `tree` by two measurements
 * on record: the per-type props builder of objectui's ListView adapter
 * (`packages/plugin-list/src/ListView.tsx`, read back verbatim from the built
 * console 17.2.0), and a both-direction ablation on `os validate` — deleting
 * a `timeline` block left `warnings: []` with `valid: true`, deleting the
 * sibling `gantt` block warned as designed. The gate was working; the table
 * was short.
 *
 * - `kanban`   → `groupBy = groupByField || groupField || <inferred>`
 * - `calendar` → `startDateField || 'start_date'`, `endDateField || 'end_date'`
 * - `gantt`    → `startDateField || 'start_date'`, `endDateField || 'end_date'`,
 *   `progressField || 'progress'`, `dependenciesField || 'dependencies'` —
 *   fails CLOSED (`null` unless both dates resolve): a blank chart
 * - `timeline` → `startDateField || 'created_at'`, `titleField || 'name'` — the
 *   sharpest member: `created_at` is a plausible-looking name many objects do
 *   not declare, and the renderer drops every row whose start date fails to
 *   parse, so the view is blank rather than merely mis-titled
 * - `map`      → `locationField || 'location'` — rows whose coordinates do not
 *   parse are dropped and the chrome renders over nothing. ⚠️ Unlike the
 *   others, `ListMapConfigSchema` requires NO key: its docblock says the
 *   coordinates come from EITHER a `latitudeField`/`longitudeField` pair OR a
 *   `locationField`, and nothing in the schema demands one form. A present
 *   block declaring neither is the same unbound view with an extra pair of
 *   braces, so {@link checkViewCompleteness} reads a `map` block for its
 *   coordinate binding, not merely for its presence.
 * - `tree`     → `labelField || titleField || 'name'`; the load-bearing binding
 *   is `parentField`, and a missing one puts every record at depth 0. Every
 *   `TreeConfigSchema` key is optional, so `tree: {}` satisfies THIS table and
 *   still renders flat — the parent pointer has its own rule,
 *   {@link VIEW_TREE_WITHOUT_PARENT_FIELD}, below.
 *
 * `gallery` is measured too (`titleField || 'name'`) and is deliberately NOT
 * here: `GalleryConfigSchema` requires no key, so "has a `gallery` block"
 * would assert nothing an author could act on, and the fallback mis-titles
 * cards rather than emptying the surface — a degradation this table cannot
 * express without inventing a binding key the schema does not have.
 * Recorded, not enforced.
 *
 * ⛔ [#13216] `page` does NOT belong in this table, and completing the map with
 * it would be a regression in two independent ways. Its binding is `pageName`,
 * a STRING — the check below asks `isRec(view[block])`, so a correct
 * declaration would be read as a missing block and warned about on every page
 * view. And the premise of this table does not hold for it: a `page` view with
 * no binding does not degrade to a wrong-but-visible list, it renders nothing,
 * so it is refused outright at parse by `checkListViewPageMount`
 * (`packages/spec/src/ui/view.zod.ts`) — an error where this table can only
 * advise, and already spent before a completeness pass ever runs.
 */
const VIEW_BINDING_BLOCKS: Readonly<Record<string, string>> = {
  kanban: 'kanban',
  calendar: 'calendar',
  gantt: 'gantt',
  timeline: 'timeline',
  map: 'map',
  tree: 'tree',
};

/**
 * The `fix` hint per entry. Each names the keys that make the block a
 * binding: the schema's required keys where it has them (`timeline` requires
 * both of its; `calendar` requires `startDateField`), and for `map` / `tree`,
 * whose schemas require nothing, the keys the renderer reads instead of a
 * literal.
 */
const VIEW_BINDING_FIX: Readonly<Record<string, string>> = {
  kanban: "kanban: { groupByField: '<select_or_status_field>' }",
  calendar: "calendar: { startDateField: '<date_field>', titleField: '<text_field>' }",
  gantt: "gantt: { startDateField: '<date_field>', endDateField: '<date_field>', titleField: '<text_field>' }",
  timeline: "timeline: { startDateField: '<date_field>', titleField: '<text_field>' }",
  map: "map: { locationField: '<location_field>' } — or { latitudeField: '<number_field>', longitudeField: '<number_field>' }",
  tree: "tree: { parentField: '<self_lookup_field>', labelField: '<text_field>' }",
};

const isNonEmptyString = (v: unknown): v is string => typeof v === 'string' && v.length > 0;

/** A `map` block's coordinate binding — either of the two forms its schema documents. */
const hasMapCoordinateBinding = (block: AnyRec): boolean =>
  isNonEmptyString(block.locationField)
  || (isNonEmptyString(block.latitudeField) && isNonEmptyString(block.longitudeField));

/**
 * The field definitions of a bound object in either authorable spelling — a
 * name-keyed map (`fields: { parent: {…} }`) or an array (`fields: [{ name:
 * 'parent', … }]`). Only the definitions are needed: parent-pointer detection
 * reads `type` and `reference`, never the key.
 */
function fieldDefsOf(object: AnyRec): AnyRec[] {
  const fields = object.fields;
  if (Array.isArray(fields)) return fields.filter(isRec);
  if (isRec(fields)) return Object.values(fields).filter(isRec);
  return [];
}

/**
 * Whether the tree renderer could auto-detect a parent pointer on this object
 * — a mirror of objectui's `detectParentField`
 * (`packages/plugin-tree/src/ObjectTree.tsx`): a field declared
 * `type: 'tree'`, else a `lookup` / `master_detail` whose `reference` is the
 * object's own name. Mirrored, not tightened: a stricter predicate here would
 * warn about a view that renders correctly, a looser one would bless the flat
 * render. The renderer also reads `reference_to`; that is the retired spelling
 * the ADR-0087 conversion layer folds to `reference` before this predicate
 * ever sees the stack, so it needs no arm here. An object with no `name`
 * cannot be self-referenced — the renderer's detection needs the object name
 * for the lookup arm too.
 */
function hasDetectableParentField(object: AnyRec): boolean {
  const own = isNonEmptyString(object.name) ? object.name : undefined;
  return fieldDefsOf(object).some((def) =>
    def.type === 'tree'
    || ((def.type === 'lookup' || def.type === 'master_detail') && own !== undefined && def.reference === own));
}

/**
 * Completeness of a single list-view definition (a container's `list` /
 * `listViews.*` entry).
 *
 * `boundObject` is the definition of the object the view is bound to, when
 * the caller can resolve it (`@objectstack/lint`'s walk looks it up by name in
 * `stack.objects`). It feeds exactly one rule —
 * {@link VIEW_TREE_WITHOUT_PARENT_FIELD} — whose second clause ("nothing on
 * the object to auto-detect from") cannot be asserted without it: with no
 * object in hand that rule stays silent rather than guess, the same
 * only-assert-what-was-verified stance every rule in this module takes. A
 * view naming an object the stack does not declare is
 * `validate-object-references`' finding, not this one's.
 *
 * ## Why `tree` needs a second rule, not a stronger entry in the table
 *
 * The binding-block rule asks "is the block there"; for `tree` that is the
 * weakest assertion in the table, because every `TreeConfigSchema` key is
 * optional and `parentField` is documented as auto-detected when omitted. So
 * a `tree: {}` view is spec-valid, satisfies the table, and on an object with
 * no self-reference still renders FLAT: `detectParentField` returns nothing,
 * `buildForest` makes every record a root, and the result is a complete,
 * correct-looking table with an expand slot that never opens — the one shape
 * in this family that looks right on every surface an author can see. A gate
 * that passed it would be vouching for it, which is worse than no gate. The
 * rule fires only when BOTH halves fail — `parentField` undeclared AND nothing
 * on the bound object the renderer would detect — so a view that renders
 * correctly by auto-detection is never warned about.
 */
export function checkViewCompleteness(view: unknown, boundObject?: unknown): CompletenessFinding[] {
  if (!isRec(view)) return [];
  const type = typeof view.type === 'string' ? view.type : undefined;
  if (!type) return [];
  const out: CompletenessFinding[] = [];

  const block = VIEW_BINDING_BLOCKS[type];
  if (block && !isRec(view[block])) {
    out.push({
      rule: VIEW_LAYOUT_WITHOUT_BINDING,
      severity: 'warning',
      path: block,
      message:
        `A \`${type}\` view with no \`${block}\` block is bound to nothing: the renderer falls `
        + 'back to literal default field names, which works only if the object happens to declare '
        + 'them — on any other object the view renders empty while authoring reports success.',
      fix: VIEW_BINDING_FIX[type],
    });
  } else if (type === 'map' && isRec(view.map) && !hasMapCoordinateBinding(view.map)) {
    out.push({
      rule: VIEW_LAYOUT_WITHOUT_BINDING,
      severity: 'warning',
      path: 'map.locationField',
      message:
        'A `map` view whose `map` block declares neither `locationField` nor the `latitudeField`/'
        + '`longitudeField` pair is bound to nothing: the renderer reads `locationField || '
        + "'location'` (objectui `ListView.tsx`), which works only if the object happens to declare "
        + 'a `location` field — on any other object every marker is dropped and the map renders '
        + 'empty while authoring reports success.',
      fix: VIEW_BINDING_FIX.map,
    });
  }

  if (type === 'tree' && isRec(boundObject)) {
    const declared = isRec(view.tree) && isNonEmptyString(view.tree.parentField);
    if (!declared && !hasDetectableParentField(boundObject)) {
      out.push({
        rule: VIEW_TREE_WITHOUT_PARENT_FIELD,
        severity: 'warning',
        path: 'tree.parentField',
        message:
          'A `tree` view with no resolvable parent pointer renders FLAT, not empty: `parentField` is '
          + 'undeclared and the bound object declares neither a `tree` field nor a lookup/master_detail '
          + 'back to itself, so the renderer\'s auto-detection finds nothing (objectui `ObjectTree.tsx` — '
          + '`detectParentField`) and `buildForest` makes every record a root at depth 0. The result is '
          + 'a complete, correct-looking table with an expand slot that never opens, while authoring '
          + 'reports success. Declare `tree.parentField`, or add a self-referencing field to the object.',
        fix: "tree: { parentField: '<self_lookup_field>' }",
      });
    }
  }

  return out;
}

/**
 * Completeness of a single webhook definition.
 *
 * ## Why this one needed TWO sources, and why one of them alone was misleading
 *
 * The auto-enqueuer's own comment reads, at the skip site:
 *
 * ```
 * if (triggers.size === 0) {
 *     // No dispatchable triggers (or a manual-only webhook with none) —
 *     // skip auto-enqueue.
 *     return null;
 * ```
 *
 * Read alone, that parenthetical *blesses* the empty case as a deliberate mode
 * — exactly the shape that makes `multiselect` without options a NON-rule
 * above. Stopping there would have left this candidate unenforced.
 *
 * But the mode it names does not exist. `webhook.zod.ts`'s #3196 note records
 * that `api` (manual/programmatic fire) was REMOVED as a trigger value
 * precisely because "no manual fire path exists (the only webhook HTTP surface
 * re-queues already-failed deliveries)". So there is no way to fire a webhook
 * that the auto-enqueuer has dropped: it is inert on every path, not
 * manual-only. Hence `error`, not a NON-rule.
 *
 * The lesson generalizes past this rule: a runtime comment describes what its
 * author believed, and beliefs go stale when a sibling feature is removed. The
 * blessing has to be corroborated by something that says the blessed mode is
 * REACHABLE — otherwise it is a comment about a mode that no longer exists.
 *
 * `triggers: []` is flagged the same as an omitted `triggers`: unlike an
 * action's `locations: []` (the documented headless spelling), an empty array
 * here is not an "I meant it" marker — turning a webhook OFF has its own key
 * (`isActive` → the row's `active`), so `[]` is simply the same dead shape
 * spelled out.
 */
export function checkWebhookCompleteness(webhook: unknown): CompletenessFinding[] {
  if (!isRec(webhook)) return [];
  if (hasEntries(webhook.triggers)) return [];
  return [{
    rule: WEBHOOK_WITHOUT_TRIGGERS,
    severity: 'error',
    path: 'triggers',
    message:
      'A webhook with no `triggers` never fires on any path. The auto-enqueuer drops it while '
      + 'building its subscription cache (`auto-enqueuer.ts` — `if (triggers.size === 0) … return '
      + 'null`), and there is no manual fire path to reach it either: `webhook.zod.ts` '
      + 'records that the `api` trigger was removed because "no manual fire path exists — the only '
      + 'webhook HTTP surface re-queues already-failed deliveries". The webhook materializes into '
      + '`sys_webhook`, looks armed in Setup, and delivers nothing. To disable a webhook use '
      + '`isActive: false`; an empty `triggers` is not an off switch, just a dead one.',
    fix: "triggers: ['create', 'update']",
  }];
}
