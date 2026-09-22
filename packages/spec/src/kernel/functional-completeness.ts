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
 * ## Discipline: every rule here cites the runtime site that makes it true
 *
 * The completeness audit's scariest candidate (a "fail-open sharing rule")
 * collapsed on a three-file read, and this campaign shipped four confidently
 * wrong prescriptions before learning the same lesson — so a rule is added
 * here ONLY with the silent-skip site named, and a deliberate NON-rule is
 * recorded with the evidence that exempts it. The codebase can be asked;
 * these were:
 *
 * - `summary` w/o `summaryOperations` →
 *   `packages/objectql/src/engine.ts#buildSummaryIndex`, verbatim
 *   `if (d?.type !== 'summary' || !d.summaryOperations) continue;`
 * - `formula` w/o `expression` →
 *   `packages/objectql/src/engine.ts#planFormulaProjection`, verbatim
 *   `def?.type === 'formula' && def.expression`: it builds the formula plan
 *   only from fields WITH an expression, so a bare formula never computes.
 * - `lookup`/`master_detail` w/o `reference` →
 *   `packages/objectql/src/engine.ts#expandRelatedRecords` (`$expand`),
 *   verbatim `if (!referenceObject) continue;` — the relationship silently
 *   never resolves, and the record picker has no target to search.
 * - `select`/`radio` w/o `options` → `record-validator.ts`'s `validateOne`,
 *   verbatim `allowed.length > 0 && !allowed.includes(String(value))`: an
 *   empty option list disables server-side value validation entirely, while
 *   the form control offers nothing to pick.
 * - **NON-rule:** `multiselect` w/o `options` — `record-validator.ts`'s
 *   `validateOne` says, verbatim, `// free-form (tags without options)`. The
 *   runtime blesses it as a deliberate mode, which makes it ADR-0078 case (3)
 *   "genuinely optional", not an omission. Flagging it would be this
 *   campaign's own false-prescription mistake again.
 * - `checkboxes` w/o `options` sits between the two: it shares the multi
 *   branch's free-form validator behaviour, but a checkbox group with zero
 *   boxes is almost certainly an omission — so it is a WARNING, not an error.
 * - a grid view's `rowColor` w/o `colors` → objectui `plugin-grid`'s
 *   `useRowColor.ts` `if (!config?.field || !config.colors) return undefined;`
 *   — the row-className resolver bails before it reads a single row, so every
 *   row keeps the default colour. See {@link VIEW_ROW_COLOR_WITHOUT_COLORS}.
 * - a grid view's `rowColor.colors` VALUE the resolver cannot resolve → the
 *   same file, eleven lines further down: `colorToClass` returns `undefined`
 *   for anything that is neither a `bg-`-prefixed literal nor a member of its
 *   own closed vocabulary of colour names. The block clears the guard above,
 *   silences that rule, and still colours nothing. See
 *   {@link VIEW_ROW_COLOR_UNRESOLVABLE_VALUE} — and read the note on
 *   {@link isUnresolvableRowColor} for why this rule judges the SHAPE a value
 *   has rather than transcribing the other repo's 23-entry map.
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
export const VIEW_ROW_COLOR_WITHOUT_COLORS = 'view/row-color-without-colors';
export const VIEW_ROW_COLOR_UNRESOLVABLE_VALUE = 'view/row-color-unresolvable-value';
export const WEBHOOK_WITHOUT_TRIGGERS = 'webhook/without-triggers';

/** Every rule id this module can emit — pinned by tests so ids cannot drift. */
export const FUNCTIONAL_COMPLETENESS_RULES = [
  FIELD_SUMMARY_WITHOUT_OPERATIONS,
  FIELD_FORMULA_WITHOUT_EXPRESSION,
  FIELD_RELATIONSHIP_WITHOUT_REFERENCE,
  FIELD_CHOICE_WITHOUT_OPTIONS,
  VIEW_LAYOUT_WITHOUT_BINDING,
  VIEW_TREE_WITHOUT_PARENT_FIELD,
  VIEW_ROW_COLOR_WITHOUT_COLORS,
  VIEW_ROW_COLOR_UNRESOLVABLE_VALUE,
  WEBHOOK_WITHOUT_TRIGGERS,
] as const;

type AnyRec = Record<string, unknown>;

const isRec = (v: unknown): v is AnyRec => !!v && typeof v === 'object' && !Array.isArray(v);

const hasEntries = (v: unknown): boolean => Array.isArray(v) && v.length > 0;

/**
 * Field types whose single-choice control is dead without `options`
 * (`record-validator.ts`'s `validateOne` skips validation on an empty list —
 * verbatim `allowed.length > 0 && !allowed.includes(String(value))` — and the
 * form control has nothing to offer). `multiselect` is deliberately absent — see
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
 * The layout-specific config block each view type is inert without. What a
 * view WITHOUT its block actually does is per type — a fallback to LITERAL
 * field names that renders empty on any object not happening to declare
 * them, a binding inferred from the object, or a refusal screen — so every
 * row below states its own measured outcome and names the reading it came
 * from. ⛔ Do not generalise one row to the next, and ⛔ do not restate a row
 * as fact without re-reading the renderer: objectui is deleting these floors
 * one view type at a time, so a row is only as true as its last measurement.
 *
 * Either way the author asked for a surface that does not render, while
 * authoring reports success: WARNING, not error (ADR-0078 §1). ⚠️ The
 * rubric's other half — refuse what renders NOTHING — was put to [#16577]
 * for the `type: 'calendar'` route and is SETTLED, not pending: ruled B
 * (director seat, comment `5634033966`; the card closed `completed` on
 * 2026-09-11), the route STAYS warning-class and is carried at `warning` by
 * the table below. The ruling turns on BOTH doors being loud — loud at
 * `os validate` (this warning) and loud at render (objectui#7029 deleted the
 * `'start_date'` / `'end_date'` floors; `ObjectCalendar.getCalendarConfig`
 * returns `null` and the named refusal screen is reachable) — which is
 * exactly what the `calendar` row below now measures. So this table moves no
 * severity because the severity is already RULED, and the corrected row is
 * the evidence that ruling rests on. ⛔ Reopening it takes a new ruling,
 * not a re-read; a row going stale is a reason to re-measure the ROW.
 *
 * Every entry names its measured renderer binding. The verify-then-enforce
 * gate this table sits behind (the audit's Tier-A had named only the first
 * three) was discharged for `timeline` / `map` / `tree` by two measurements
 * on record: the per-type props builder of objectui's ListView adapter
 * (`packages/plugin-list/src/ListView.tsx`, read back verbatim from the built
 * console 17.2.0), and a both-direction ablation on `os validate` — deleting
 * a `timeline` block left `warnings: []` with `valid: true`, deleting the
 * sibling `gantt` block warned as designed. The gate was working; the table
 * was short. ⚠️ That reading is dated — console 17.2.0 — and is no longer
 * current for every row; see the re-measurement note under the table.
 *
 * - `kanban`   → `groupBy = groupByField || groupField || <inferred>`
 * - `calendar` → NO fallback, and no silence: the view is bound to nothing
 *   and the renderer says so on screen. Measured on objectui `main` at
 *   `0cf2d6644` (2026-09-21), both halves of the path a `type: 'calendar'`
 *   list view takes. ① `ListView.tsx`'s `case 'calendar'` restates only the
 *   bindings the view DECLARED — the `startDateField || 'start_date'` and
 *   `endDateField || 'end_date'` floors this row used to name were deleted
 *   by objectui#7029, whose own comment records that they were "field names
 *   no view had written and most objects do not carry". ② `ObjectCalendar`'s
 *   `getCalendarConfig` returns `null` with neither a `calendar` block nor a
 *   flat `startDateField`, and the `if (!calendarConfig)` arm renders the
 *   "Calendar configuration required" refusal screen, which names
 *   `startDateField` as the key to declare (objectui#8170 corrected that
 *   screen's second clause: `titleField` is NOT required). ⚠️ That literal
 *   is the text RENDERED at the pin: objectui#10101 landed AFTER the pin and
 *   moved it into a `tt('calendar.configRequired', …)` default, so on
 *   objectui's head a non-English locale renders other words for the same
 *   screen. Harmless for the console this repo ships — and the pin citation
 *   below is what reds when the pin moves past it. So the loss is
 *   total rather than partial — every record, on every object — and the
 *   author is told at render time as well as here. Both reads are identical
 *   at the pin this repo builds against (`.objectui-sha` = `87af769e9`), so
 *   this describes the console this repo SHIPS and not only objectui's head.
 *   This repo already records the same deletion one door over: the #13817
 *   check in `../ui/view.zod.ts` names objectui#7029 as its runtime half.
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
 * ⚠️ RE-MEASUREMENT [#17445], objectui `main` at `0cf2d6644` (2026-09-21).
 * The `calendar` row above is the one that card corrected. The same reading
 * found three siblings still naming floors objectui has since deleted, and
 * they are RECORDED here rather than corrected, because that correction is a
 * separate finding to rule on and not a rider (the card scoped itself to
 * `calendar`, and each of the three changes what its row's severity rests
 * on):
 *
 * - `gantt` — all four floors gone (objectui#7070 for the dates, #7499 for
 *   `progressField` / `dependenciesField`); `ObjectGantt` REFUSES an absent
 *   date binding rather than drawing the blank chart this row describes.
 * - `timeline` — `startDateField || 'created_at'` gone (objectui#7070 step
 *   ③, on the ruling 日期轴永不虚构), with a refusal screen in its place;
 *   the `titleField || 'name'` half of the row still stands.
 * - `map` — `locationField || 'location'` gone on BOTH faces (objectui#8169):
 *   `ObjectMap` renders "Map configuration required" instead of an empty map.
 *   ⛔ That literal is also quoted in this rule's `map`-specific message
 *   below and pinned by `functional-completeness.test.ts`, so correcting the
 *   row means correcting the message and the pin together.
 *
 * `kanban` and `tree` were re-read at the same ref and still say what they
 * say. ⛔ Until the three above are corrected, do not cite them — or the
 * warning text they feed — as a current measurement.
 *
 * `gallery` is measured too (`titleField || 'name'`) and is deliberately NOT
 * here: `GalleryConfigSchema` requires no key, so "has a `gallery` block"
 * would assert nothing an author could act on, and the fallback mis-titles
 * cards rather than emptying the surface — a degradation this table cannot
 * express without inventing a binding key the schema does not have.
 * Recorded, not enforced.
 *
 * ⛔ [#17063] `page` is not in this table because there is no longer a `page`
 * view type: the member and its `pageName` binding were retired under ADR-0049
 * enforce-or-remove (maintainer ruling 2026-09-09 「撤」 — the delegating mount
 * was declared on the spec side and never built). The list-view `type` enum
 * refuses the value by name (`packages/spec/src/ui/view.zod.ts`). ⛔ Do not
 * re-add a row for it here if it ever returns: its binding was a STRING, and
 * the check below asks `isRec(view[block])`, so a correct declaration would be
 * read as a missing block and warned about on every page view.
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

/**
 * The body of the `view/layout-without-binding` warning for a type whose
 * measured outcome is NOT the generic literal-fallback sentence
 * ({@link unboundBlockMessage}). A type with no entry here gets the generic
 * body, so this map is the exception list, not a second copy of the table.
 *
 * ⛔ An entry is written from a reading of the renderer, never from the row
 * above it — the two carriers went out of sync once already, which is what
 * this map exists to make cheap to fix: {@link VIEW_BINDING_BLOCKS}'s
 * `calendar` row and this rule's message BOTH asserted a
 * `startDateField || 'start_date'` fallback that objectui#7029 had deleted,
 * and correcting one without the other would have left the author reading the
 * stale half.
 *
 * ⚠️ What the correction must PRESERVE is the prescription. The old sentence
 * was wrong about the mechanism and still right about the remedy, and the
 * remedy is the whole value of a warning an author meets at authoring time:
 * it says which key to declare, not merely that something is missing.
 */
const VIEW_BINDING_MESSAGE: Readonly<Record<string, string>> = {
  calendar:
    'A `calendar` view with no `calendar` block declares no date axis, and the renderer does '
    + 'not invent one: objectui\'s `ListView.tsx` calendar branch forwards only the bindings the '
    + 'view DECLARED, so `getCalendarConfig` (objectui `ObjectCalendar.tsx`) resolves `null` and '
    + 'the view renders its "Calendar configuration required" refusal screen instead of records '
    + '— it parses and publishes clean, then shows no event on any object, not just on one that '
    + 'happens to lack a field. Declare `calendar.startDateField`, the block\'s one required key; '
    + 'the event title resolves through the ADR-0079 record display-name chain when `titleField` '
    + 'is omitted.',
};

/**
 * The generic body — a view type whose renderer still floors the binding at a
 * literal field name. It is what the five types with no
 * {@link VIEW_BINDING_MESSAGE} entry receive, and the re-measurement note on
 * {@link VIEW_BINDING_BLOCKS} says which of those five it is still true of
 * (`kanban`, `tree`) and which three inherit it pending their own correction.
 * ⛔ So it is the DEFAULT, never a universal: a type that stops flooring gets
 * an entry above, not a reworded sentence here.
 */
const unboundBlockMessage = (type: string, block: string): string =>
  `A \`${type}\` view with no \`${block}\` block is bound to nothing: the renderer falls `
  + 'back to literal default field names, which works only if the object happens to declare '
  + 'them — on any other object the view renders empty while authoring reports success.';

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
 * Whether the tree renderer could auto-detect a parent pointer on this object:
 * a field declared `type: 'tree'` whose `reference` is absent or the object's
 * own name, else a `lookup` / `master_detail` whose `reference` is the object's
 * own name.
 *
 * The `tree` arm reads the rule `ObjectSchema` enforces at parse (#14892
 * ruling: a `tree` field's `reference`, when present, must name the declaring
 * object — a hierarchy is parent/child within one object), so an unparsed
 * object carrying a foreign-referencing `tree` is judged here exactly as the
 * parse door judges it: not a parent pointer. On that arm this predicate is
 * STRICTER than objectui's `detectParentField`
 * (`packages/plugin-tree/src/ObjectTree.tsx`), which still returns the first
 * `tree` field whatever its `reference` says; tightening the renderer is an
 * objectui follow-up, and the shape the two now disagree on no longer parses
 * here, so the disagreement is unreachable from parsed metadata. The
 * `lookup` / `master_detail` arm is the renderer's, unchanged. The renderer
 * also reads `reference_to`; that is the retired spelling the ADR-0087
 * conversion layer folds to `reference` before this predicate ever sees the
 * stack, so it needs no arm here. An object with no `name` cannot be
 * self-referenced — the renderer's detection needs the object name for the
 * lookup arm too, and a `tree` that names a `reference` cannot be matched
 * against a name that is not there.
 */
function hasDetectableParentField(object: AnyRec): boolean {
  const own = isNonEmptyString(object.name) ? object.name : undefined;
  return fieldDefsOf(object).some((def) =>
    (def.type === 'tree' && (def.reference === undefined || (own !== undefined && def.reference === own)))
    || ((def.type === 'lookup' || def.type === 'master_detail') && own !== undefined && def.reference === own));
}

/**
 * The view types whose renderer actually READS `rowColor`, measured rather
 * than inferred from the schema: `rowColor` is declared on every list view,
 * but objectui's ListView adapter forwards it in exactly one branch of its
 * per-type props switch — `case 'grid'` (`packages/plugin-list/src/
 * ListView.tsx`, `...(rowColorConfig ? { rowColor: rowColorConfig } : {})`).
 * `kanban` / `gallery` / `calendar` / `timeline` / `gantt` / `map` / `tree` /
 * `chart` each build their own props and never carry the key; `page` mounts a
 * published page through a different renderer entirely.
 *
 * ⛔ So this rule is NOT widened to every list view type, however tempting the
 * schema's shape makes it. On a `kanban` view a `rowColor` block is inert too
 * — but it is inert for a DIFFERENT reason, and this rule's prescription
 * ("declare a `colors` map") would not fix it: the key is never read there
 * with or without a map. Warning would be a false prescription, the failure
 * mode the module doc and ADR-0078 §6 exist to prevent. That non-grid
 * inertness is recorded here, not enforced — the `gallery` disposition in
 * {@link VIEW_BINDING_BLOCKS} for the same reason.
 *
 * The `default:` arm of that switch shares the grid branch, so an unrecognised
 * view type would carry `rowColor` too — unreachable from this predicate,
 * which returns early on a view with no string `type` and never sees a
 * defaulted one (it runs on the NORMALIZED, pre-parse stack).
 */
const ROW_COLOR_VIEW_TYPES: ReadonlySet<string> = new Set(['grid']);

/**
 * Whether a `rowColor` block declares no usable colour map.
 *
 * Both spellings of "no map" are flagged, and they reach the same dead end by
 * two different routes in objectui's `useRowColor.ts` (`plugin-grid`):
 *
 * - `colors` ABSENT — the resolver's own guard,
 *   `if (!config?.field || !config.colors) return undefined;`, returns before
 *   it reads a row. Nothing is ever coloured.
 * - `colors: {}` — an empty object is truthy, so it PASSES that guard; the
 *   lookup one line down (`hasOwnProperty.call(config.colors, value)`) then
 *   matches no value, `if (!color) return undefined`, and nothing is coloured
 *   either. Mirroring the guard expression alone would have blessed this one;
 *   the rule mirrors the OUTCOME the guard produces, which is the same.
 *
 * An empty map is not an "I meant it" marker the way an action's
 * `locations: []` is — turning row colouring off has its own spellings (omit
 * the `rowColor` block, or leave the toolbar toggle `userActions.rowColor`
 * off), so `{}` is the same dead shape spelled out. Same reasoning as
 * `triggers: []` in {@link checkWebhookCompleteness}.
 *
 * Any OTHER shape (a string, an array) is left alone: the schema refuses it at
 * parse, and this module only asserts what it verified.
 */
const hasNoColorMap = (colors: unknown): boolean =>
  colors === undefined || colors === null || (isRec(colors) && Object.keys(colors).length === 0);

/**
 * Whether an authored `rowColor.colors` VALUE can never reach a class name.
 *
 * ## The trap this exists for
 *
 * `RowColorConfigSchema.colors` is `z.record(z.string(), z.string())`, so every
 * string parses. The only renderer resolves far less than that — objectui
 * `plugin-grid`'s `useRowColor.ts`, verbatim:
 *
 * ```
 * if (color.startsWith('bg-')) return color;
 * const lower = color.toLowerCase().trim();
 * return Object.prototype.hasOwnProperty.call(COLOR_TO_CLASS, lower)
 *   ? COLOR_TO_CLASS[lower]
 *   : undefined;
 * ```
 *
 * So a hex — the spelling a select field already uses for its own option
 * colours, and therefore the obvious thing to copy — clears the
 * `!config.colors` guard {@link VIEW_ROW_COLOR_WITHOUT_COLORS} watches,
 * SILENCES that rule, and still colours no row. Presence-only cannot see it;
 * this is the check that can.
 *
 * ## Why it judges SHAPE and not membership — and why that is sound
 *
 * The obvious implementation transcribes `COLOR_TO_CLASS` here. ⛔ It is not
 * done, for the reason `examples/app-showcase`'s own arm already records: a
 * hand-copy of another repo's map is a second opinion that drifts, silently, in
 * BOTH directions — a name objectui adds becomes a false positive here, a name
 * it drops becomes a false negative. The vocabulary lives in the renderer; only
 * its SHAPE is a fact this side can hold without owning it.
 *
 * Two structural facts about that snippet are enough, and neither depends on
 * what the map contains: the `bg-` branch tests the RAW value, and every key of
 * `COLOR_TO_CLASS` is a bare lower-case word, matched after `toLowerCase()` and
 * `trim()`. Therefore a value that is neither `bg-`-prefixed nor a bare
 * alphabetic word once lower-cased and trimmed CANNOT be a key, whatever the
 * map holds. That makes this predicate **sound** (it never accuses a value the
 * renderer would have resolved) and deliberately **incomplete** (a misspelled
 * or simply absent colour name — `chartreuse` — is shaped like a key and is
 * passed). Soundness is the half a gate must have; an over-eager rule here
 * would be the false prescription this module's discipline forbids.
 *
 * Three consequences worth stating, all measured against the snippet above:
 *
 * - `'RED'` and `' red '` ARE resolvable — the lookup lower-cases and trims —
 *   so this predicate applies both before judging, rather than testing the raw
 *   value the way an app-local pin can afford to.
 * - `' bg-red-100'` is NOT resolvable: `startsWith` sees the leading space, and
 *   the lower-cased form is not a bare word. Flagged, correctly.
 * - `''` never colours (`if (!color) return undefined` one frame out) and is
 *   not a bare word either. Flagged, correctly.
 *
 * ⛔ **Recorded NON-rule:** whether a `bg-…` literal names a class Tailwind
 * actually compiled is NOT judged here. `colorToClass` returns it untouched, so
 * the resolver resolved it; whether the compiled stylesheet carries a rule for
 * it is a fact about another repo's build, and asserting it from here would be
 * asserting what was not verified.
 */
const isUnresolvableRowColor = (value: string): boolean =>
  !value.startsWith('bg-') && !/^[a-z]+$/.test(value.toLowerCase().trim());

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
 *
 * ## Why `rowColor` gets a rule of its own
 *
 * `RowColorConfigSchema` requires `field` and leaves `colors` optional, so
 * `rowColor: { field: 'status' }` parses, publishes and colours nothing — the
 * only renderer needs BOTH ({@link ROW_COLOR_VIEW_TYPES},
 * {@link hasNoColorMap}). It is the same ADR-0078 silent half as a `summary`
 * with no `summaryOperations`: every key is one we know, so the unknown-key
 * rejection cannot see it and the liveness ledger cannot either — `rowColor`
 * IS live, it is this instance that is dead. WARNING rather than error: only
 * the colouring is lost, the rows still render (ADR-0078 §1).
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
      message: VIEW_BINDING_MESSAGE[type] ?? unboundBlockMessage(type, block),
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
          + 'undeclared and the bound object declares neither a `tree` field (with no `reference`, or one '
          + 'naming this object) nor a lookup/master_detail back to itself, so the renderer\'s '
          + 'auto-detection finds nothing (objectui `ObjectTree.tsx` — '
          + '`detectParentField`) and `buildForest` makes every record a root at depth 0. The result is '
          + 'a complete, correct-looking table with an expand slot that never opens, while authoring '
          + 'reports success. Declare `tree.parentField`, or add a self-referencing field to the object.',
        fix: "tree: { parentField: '<self_lookup_field>' }",
      });
    }
  }

  if (ROW_COLOR_VIEW_TYPES.has(type) && isRec(view.rowColor)) {
    const field = isNonEmptyString(view.rowColor.field) ? view.rowColor.field : undefined;
    if (field !== undefined && hasNoColorMap(view.rowColor.colors)) {
      out.push({
        rule: VIEW_ROW_COLOR_WITHOUT_COLORS,
        severity: 'warning',
        path: 'rowColor.colors',
        message:
          `A \`${type}\` view whose \`rowColor\` binds \`${field}\` and declares no \`colors\` map never `
          + 'colours a row: the grid\'s row-className resolver returns before it reads a record (objectui '
          + '`useRowColor.ts` — `if (!config?.field || !config.colors) return undefined`), so every row keeps '
          + 'the default background while parsing and publishing report success. An empty `colors: {}` is the '
          + 'same dead shape spelled out — it passes that guard and then matches no value. The map is what '
          + 'does the colouring; the field only says which value to look up. Each value is a colour NAME from '
          + 'the resolver\'s own vocabulary (`red`, `blue`, `slate`, …) or a complete Tailwind background class '
          + '(`bg-red-200`) — a hex parses, publishes and silences this very rule while still colouring '
          + `nothing (\`${VIEW_ROW_COLOR_UNRESOLVABLE_VALUE}\`).`,
        // ⛔ The prescription must name a spelling that RESOLVES. It used to
        // read `'<hex_or_token>'`, which put the one spelling the renderer
        // cannot resolve in first position: the gate fired, handed the author a
        // hex, the hex parsed and published, and this rule went green over a
        // grid that coloured nothing — a control whose own prescription
        // switched it off. `functional-completeness.test.ts` pins this string
        // by feeding the value back through `checkViewCompleteness`, so it can
        // only ever suggest something the sibling rule below accepts.
        fix: `rowColor: { field: '${field}', colors: { '<field_value>': 'red' } }`,
      });
    }
    if (field !== undefined && isRec(view.rowColor.colors)) {
      const dead = Object.entries(view.rowColor.colors)
        .filter(([, colour]) => typeof colour === 'string' && isUnresolvableRowColor(colour))
        .map(([key, colour]) => `\`${key}\` = ${JSON.stringify(colour)}`);
      if (dead.length > 0) {
        out.push({
          rule: VIEW_ROW_COLOR_UNRESOLVABLE_VALUE,
          severity: 'warning',
          path: 'rowColor.colors',
          message:
            `A \`${type}\` view whose \`rowColor\` binds \`${field}\` declares ${dead.length} colour `
            + `value${dead.length === 1 ? '' : 's'} the renderer resolves to nothing: ${dead.join(', ')}. `
            + 'objectui `useRowColor.ts` — `colorToClass` — hands a `bg-`-prefixed literal through untouched '
            + 'and otherwise looks the lower-cased, trimmed value up in its own closed vocabulary of colour '
            + 'NAMES, returning `undefined` for everything else; Tailwind v4 has no runtime, so no class can '
            + 'be fabricated from a hex. A map like this CLEARS the `!config.colors` guard, so '
            + `\`${VIEW_ROW_COLOR_WITHOUT_COLORS}\` goes quiet, and every row still keeps its default `
            + 'background while parsing and publishing report success. Write a colour name (`red`, `blue`, '
            + '`slate`, …) or a complete Tailwind background class (`bg-red-200`).',
          fix: `rowColor: { field: '${field}', colors: { '<field_value>': 'red' } }`,
        });
      }
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
