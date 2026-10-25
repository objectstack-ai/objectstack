/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * @object-ui/types/zod - Complex Component Zod Validators
 * 
 * Zod validation schemas for advanced/composite components.
 * Following @objectstack/spec UI specification format.
 * 
 * @module zod/complex
 * @packageDocumentation
 */

import { z } from 'zod';
import { aliasKeyRefusal, durationKeyRenamedGuidance, handlerKeyRefusal, retiredNodeType, retirementTombstone } from './tombstone.zod.js';
import {
  ChartTypeSchema as SpecChartTypeSchema,
  checkDashboardWidgetChartMeasureArity,
  checkDashboardWidgetMetricMeasureArity,
  checkDashboardWidgetStageOrder,
  DashboardSchema as SpecDashboardSchema,
  DashboardWidgetSchema as SpecDashboardWidgetSchema,
  GlobalFilterSchema as SpecGlobalFilterSchema,
  I18nLabelSchema,
  ViewFilterRuleSchema as SpecViewFilterRuleSchema,
} from '@objectstack/spec/ui';
import { BaseSchema, SchemaNodeSchema, specFieldsExcept } from './base.zod.js';
import { DASHBOARD_COLOR_VARIANTS, DASHBOARD_WIDGET_TYPES } from '../designer.js';
import { DASHBOARD_COMPONENT_WIDGET_TYPES, DASHBOARD_WIDGET_TYPE_EXTENSIONS } from '../complex.js';
import { stripImportedDefaults } from './imported-defaults.js';
import { closeStrictUnionArms } from './node-derivation.js';

/**
 * ⭐ THE IMPORT BOUNDARY (objectui#8317, decision batch #90, 2026-09-08).
 *
 * **This mirror authors no default, imported subschemas included.** Batch #69
 * (objectui#7735) ruled that a validator validates and does not write values
 * into an author's document; batch #90 ruled that this holds for EVERY key
 * `safeValidateSchema` answers, not only the sites this repository wrote. So a
 * schema arriving from `@objectstack/spec` crosses into a mirror shape only
 * through `stripImportedDefaults`, which removes each reachable `ZodDefault`
 * with `.removeDefault()` and keeps the key omissible. Keys, types, checks and
 * the accept set are untouched, and a subtree carrying no default comes back
 * reference-equal — so this is a no-op the day the spec adopts the same
 * principle.
 *
 * ⛔ Spelled at every crossing rather than once per file, deliberately: a local
 * `const Spec… = stripImportedDefaults(…)` would put the spec's provenance one
 * hop away from every declaration that reads it, and `check:spec-symbols`
 * (rule 1) reads exactly one hop — a mirror export under a spec-owned name has
 * to show the spec binding in its OWN initializer. The verbosity is the
 * provenance.
 *
 * ⚠️ A read that is NOT a crossing stays unwrapped and is declared as such: a
 * value VOCABULARY (`./views.zod.ts`'s `SpecListViewTypeEnum` and
 * `./objectql.zod.ts`'s `ViewKindEnum`, which unwrap the spec's own
 * `.default('grid')` to reach its enum) and a TYPE position — neither puts a
 * default into a parsed document. `../__tests__/imported-defaults-8317.test.ts`
 * re-derives that exception list from the source rather than trusting this
 * paragraph, and fails if an entry stops matching a real read.
 */


/**
 * The retired declarative face, named once so every refusal below says the
 * same thing (objectui#7664, maintainer ruling (a), 2026-09-05: for an authored
 * `type: 'kanban'` document the PLUGIN dialect is authoritative; the
 * `DeclarativeKanbanSchema` / `DeclarativeKanbanColumn` / `DeclarativeKanbanCard`
 * trio and its three mirrors retired under ADR-0049 in the same change).
 *
 * A board written in that dialect used to PASS `safeValidateSchema` and render
 * EMPTY, because the validator and the registered renderer honoured two
 * unrelated shapes. The keys that dialect had and this one does not are refused
 * BY NAME, so the author reads which shape they wrote and what to write instead
 * — the named-refusal outcome objectui#5474 records as intended, not a silent
 * strip.
 */
const retiredDeclarativeKanbanKey = (key: string, where: string, remedy: string) =>
  retirementTombstone(
    `\`${key}\` is RETIRED (objectui#7664, ADR-0049) — it belonged to the retired ` +
      `\`DeclarativeKanbanSchema\` dialect (a ${where} key of the old \`@object-ui/types\` ` +
      'kanban face), which no registered kanban renderer ever read. The `kanban` type key ' +
      'now validates the shape `@object-ui/plugin-kanban` renders: `objectName` + `groupBy` for ' +
      `an object-bound board, or \`columns[].cards[]\` for a static one. ${remedy}`,
  );

// ⛔ `retiredZeroReadKanbanKey` RETIRED with its only three call sites
// (objectui#8802): `allowCollapse` / `cardTemplates` / `columnWidths` were
// tombstones on the `kanban` arm, and the arm itself is gone. The batch #70
// refusals it carried were arm-scoped by construction — a `type: "kanban"`
// document is now refused whole, and a `type: "object-kanban"` one is judged by
// `objectql.zod.ts#ObjectKanbanSchema` exactly as it always was.

/**
 * Kanban Card Schema — mirrors {@link KanbanCard} in `../complex.ts` key for key.
 *
 * `.passthrough()` because the declaration carries `[key: string]: any`: a card
 * is a record, and `bucketCardsIntoColumns` pushes raw records into lanes with
 * their fields intact (conditional formatting reads them back). The three
 * runtime-computed members `ObjectKanban` writes onto a card — `cardFieldCells`
 * (rendered `React.ReactNode` cells) and a badge's `colorStyle` (the
 * `getBadgeHexAppearance` style object) — are PASSED THROUGH as `z.any()`, the
 * way `data-display.zod.ts` passes `TableColumn.headerIcon` through
 * (objectui#6424): a non-strict object would otherwise silently strip what the
 * renderer honours, which is the second de-facto contract that card closed.
 */
export const KanbanCardSchema = z.object({
  id: z.string().describe('Card ID'),
  title: z.string().describe('Card title'),
  description: z.string().optional().describe('Card description'),
  badges: z.array(z.object({
    label: z.string().describe('Badge label'),
    variant: z.enum(['default', 'secondary', 'destructive', 'outline']).optional().describe('Badge variant'),
    colorClass: z.string().optional().describe('Tailwind class string applied to the badge; overrides `variant`'),
    colorStyle: z.any().optional().describe('Inline style accompanying `colorClass` — the `getBadgeHexAppearance` style object, passed through verbatim'),
  })).optional().describe('Card badges'),
  cardSubtitle: z.string().optional().describe('Synthesized card subtitle, rendered in preference to `description`'),
  cardFieldCells: z.array(z.object({
    field: z.string().describe('Field name the cell renders'),
    label: z.string().optional().describe('Cell label'),
    node: z.any().describe('Rendered cell node — written by `ObjectKanban` from `cardFields`, passed through verbatim'),
  })).optional().describe('Structured per-field cells rendered through the `@object-ui/fields` cell pipeline'),
  coverImage: z.string().optional().describe('Resolved cover-image URL, derived from the board\'s `coverImageField`'),
}).passthrough();

/**
 * Kanban Column Schema — mirrors {@link KanbanColumn} in `../complex.ts`.
 */
export const KanbanColumnSchema = z.object({
  id: z.string().describe('Column ID'),
  title: z.string().describe('Column title'),
  cards: z.array(KanbanCardSchema).describe('Column cards'),
  limit: z.number().optional().describe('WIP limit — the card count at which the lane warns'),
  className: z.string().optional().describe('Column class name'),
  collapsed: z.boolean().optional().describe('Whether the lane renders collapsed — narrowed to a title spine with its cards withheld, and reopenable by the viewer; the authored value is the initial state'),
  color: retiredDeclarativeKanbanKey('color', 'column', 'Style a lane through its `className`.'),
});

/**
 * Card Template Schema — mirrors {@link CardTemplate} in `../complex.ts`.
 */
export const CardTemplateSchema = z.object({
  id: z.string().describe('Unique template identifier'),
  name: z.string().describe('Human-readable template name'),
  icon: z.string().optional().describe('Optional Lucide icon name'),
  values: z.record(z.string(), z.any()).describe('Pre-filled field values'),
});

/**
 * ⛔ The `'kanban'` arm is RETIRED (objectui#8802, maintainer ruling 2026-09-09)
 * — this is its NAMED REFUSAL, the half a deletion would not have given.
 *
 * {@link KanbanSchema}'s member-by-member mirror of `../complex.ts` went with
 * the TypeScript interface. What stays is an arm claiming the literal, so
 * `AnyComponentSchema`'s discriminator still routes a `type: "kanban"` document
 * HERE and the author reads why the spelling went and what to write instead —
 * rather than the union's own remedy-free `Invalid input`.
 *
 * ⚠️ Read `retiredNodeType`'s own docblock before changing this: the reason an
 * arm is needed at all is NOT `BaseSchema`'s `.passthrough()` (that rule governs
 * dropped MEMBER keys), it is that the union's generic discriminator message
 * names no remedy.
 *
 * The keys this arm alone declared — `columns`, `cardTitle`, `swimlaneField`,
 * `grouping`, `conditionalFormatting`, `navigation` — were never on the
 * `object-kanban` face (`objectql.zod.ts#ObjectKanbanSchema`) and are not being
 * removed from it: an `object-kanban` document is judged exactly as it was.
 *
 * Pinned in `../__tests__/bare-kanban-node-key-retired-8802.test.ts`.
 */
export const RetiredKanbanNodeSchema = retiredNodeType(
  'kanban',
  'Author `object-kanban` instead — the same board, the same renderer, and the ' +
    'spelling every stored kanban view already renders through (`ObjectView` maps a ' +
    'stored `kanban` view type onto the `object-kanban` node type). ⚠️ The STORED ' +
    '`NamedListView.type` value `"kanban"` is a DIFFERENT layer and is unaffected — ' +
    'do not rewrite it.',
);

/**
 * Calendar View Mode — the registered renderer's rendered set.
 *
 * `'agenda'` was retired (`b55a34647`): no view ever rendered it, and no
 * measured app authors it. `view` is a DECLARED key, so this retirement is a
 * new rejection — see the accept-set note on {@link CalendarViewSchema}.
 */
export const CalendarViewModeSchema = z.enum(['month', 'week', 'day']);

/**
 * Calendar Event Schema
 */
export const CalendarEventSchema = z.object({
  id: z.string().describe('Event ID'),
  title: z.string().describe('Event title'),
  description: z.string().optional().describe('Event description'),
  start: z.union([z.string(), z.date()]).describe('Event start time'),
  end: z.union([z.string(), z.date()]).describe('Event end time'),
  allDay: z.boolean().optional().describe('Whether event is all-day'),
  color: z.string().optional().describe('Event color'),
  data: z.any().optional().describe('Custom event data'),
});

/**
 * Calendar View Schema - Calendar component
 *
 * Mirrors `CalendarViewSchema` in `../complex.ts`, converged on the registered
 * `calendar-view` renderer's measured read set (objectui#5667): events are
 * computed from `data` plus the field-name keys; the formerly required
 * `events` and the eight other inert keys (`defaultView`, `defaultDate`,
 * `date`, `views`, `editable`, `onEventCreate`, `onEventUpdate`,
 * `onDateChange`) are retired (ADR-0049 enforce-or-remove).
 *
 * `BaseSchema` is `.passthrough()`, so the retired keys are not REJECTED here
 * — they are simply no longer declared or type-checked. The material accept
 * change is that `events` is no longer required.
 *
 * Value-level residue (`b55a34647`): `'agenda'` left
 * `CalendarViewModeSchema`. Unlike the key retirements above, this IS a new
 * rejection — `view` is a declared key, and declared keys are validated even
 * under `.passthrough()` — so `view: 'agenda'`, which parsed green before,
 * now fails with an `invalid_value` issue on the `view` path.
 */
export const CalendarViewSchema = BaseSchema.extend({
  type: z.literal('calendar-view'),
  data: z
    .any()
    .optional()
    .describe(
      'Records to display as events (computed with the field-name keys; binding expressions resolve before the renderer reads it)',
    ),
  titleField: z.string().optional().describe("Record field for the event title (default 'title')"),
  startDateField: z
    .string()
    .optional()
    .describe("Record field for the event start date/time (default 'start')"),
  endDateField: z
    .string()
    .optional()
    .describe("Record field for the event end date/time (default 'end')"),
  allDayField: z.string().optional().describe("Record field for the all-day flag (default 'allDay')"),
  colorField: z.string().optional().describe("Record field for the event color (default 'color')"),
  view: CalendarViewModeSchema.optional().describe(
    "View mode — 'month' | 'week' | 'day', the renderer's rendered set ('agenda' was retired)",
  ),
  currentDate: z
    .union([z.string(), z.date()])
    .optional()
    .describe('Initial calendar date (ISO string authored; Date instance from a React host)'),
  allowCreate: z.boolean().optional().describe('Show the "New event" affordance (default false)'),
  className: z.string().optional().describe('Tailwind classes for the calendar container'),
  // objectui#7344: the multi-line `z.function()` spelling PR #7339's anchored
  // census could not see; `pickHostCallbacks` forwards it exactly like
  // `onViewChange` below.
  onEventClick: handlerKeyRefusal('onEventClick', 'runtime-slot', 'Host-only event click handler'),
  onViewChange: handlerKeyRefusal('onViewChange', 'runtime-slot', 'Host-only view change handler'),
  body: retirementTombstone(
    'REFUSED (objectui#9256, ADR-0049) — `calendar-view` reads NEITHER content channel: measured with the '
    + 'TypeScript type checker across all 24 registering packages, no renderer read consumes `body` or '
    + '`children` for this node, and `SchemaRenderer` strips both out of the props bag it spreads. An '
    + 'authored value therefore rendered NOTHING — no render-time error or warning and no element; only the parser tier\'s `not-a-container` warning (objectui#9910) noticed it. '
    + 'What it renders instead: `allDayField`, `colorField`, `data`, `endDateField`, `startDateField`, '
    + '`titleField`.',
  ),
  children: retirementTombstone(
    'REFUSED (objectui#9256, ADR-0049) — `calendar-view` reads NEITHER content channel: measured with the '
    + 'TypeScript type checker across all 24 registering packages, no renderer read consumes `body` or '
    + '`children` for this node, and `SchemaRenderer` strips both out of the props bag it spreads. An '
    + 'authored value therefore rendered NOTHING — no render-time error or warning and no element; only the parser tier\'s `not-a-container` warning (objectui#9910) noticed it. '
    + 'What it renders instead: `allDayField`, `colorField`, `data`, `endDateField`, `startDateField`, '
    + '`titleField`.',
  ),
});

/**
 * Filter Operator — DERIVED from `@objectstack/spec/ui`, never hand-copied
 * (objectui#9559, ruling B, ratified).
 *
 * This is the protocol's own operator member of `ViewFilterRuleSchema`, which
 * the spec builds from its declared set and its alias fold:
 * `z.preprocess(normalizeFilterOperator, z.enum(VIEW_FILTER_OPERATORS))`. So
 * this mirror accepts exactly what the protocol's rule accepts and answers with
 * exactly what it answers:
 *
 *   - every canonical member of `VIEW_FILTER_OPERATORS` parses as itself;
 *   - every legacy spelling in the spec's alias table (`lessThan`, `gt`,
 *     `isEmpty`, …) parses AND IS NORMALISED to its canonical member — the parse
 *     output of an authored `lessThan` is `less_than`;
 *   - every other spelling is refused, as the protocol refuses it
 *     (`containsCaseInsensitive`, `exists` and `notExists` among them: the
 *     protocol's table has no row for them, and this mirror adds none).
 *
 * It used to be a 14-member local literal that had fallen six members behind
 * the protocol (`icontains`, `is_empty`, `is_not_empty`, `before`, `after`,
 * `between`) and refused every alias the protocol normalises, so the authoring
 * gate refused operators the runtime and the protocol both accept. Taking the
 * spec's member ends that drift class rather than this instance of it: a
 * member the spec adds, an alias row it adds, or a change to how it folds
 * reaches this mirror with no edit here.
 *
 * Why the rule's member and not a local `z.enum(VIEW_FILTER_OPERATORS)`:
 * the result is the same schema, and this spelling is the one the objectui#8317
 * import boundary can police — every spec value read in a mirror goes through
 * `stripImportedDefaults`, which has an arm for a schema and none for a bare
 * array or a function. The rule carries no default, so the strip hands back the
 * spec's own object.
 *
 * ⚠️ A `ZodPipe` (preprocess into the enum), not a `ZodEnum`: the member list is
 * `FilterOperatorSchema.out.options`, and the input side takes any value so the
 * fold can run before the enum judges it. The TypeScript twin, the
 * `FilterBuilderCondition.operator` member in `../complex.ts`, is typed by the
 * spec's `ViewFilterOperator` by reference — the canonical spellings only, because the aliases are a
 * read-side migration bridge the spec marks deprecated, not a vocabulary new
 * producers may emit.
 */
export const FilterOperatorSchema = stripImportedDefaults(SpecViewFilterRuleSchema).shape.operator;

/**
 * A condition's `value` is judged against its `operator` by the PROTOCOL'S OWN
 * RULE (objectui#10478): delegated to `ViewFilterRuleSchema`, never restated.
 *
 * The spec rule couples the two in its object-level refinement (`in` / `not_in`
 * take an array, `between` takes exactly `[min, max]`, plus whatever arms the
 * installed spec release carries), and its `value` member bounds the value's
 * type. This mirror used to declare `value: z.any()` and run none of it, so
 * `safeValidateSchema`, `objectui check` and `objectui validate` answered green
 * on a rule the protocol refuses: `{ field: 'amount', operator: 'between',
 * value: 5 }` among them.
 *
 * The spec's check functions are module-private, so the delegation goes through
 * the exported rule. The condition's PROJECTION onto the rule's three keys is
 * re-parsed by the rule, and the rule's issues are forwarded verbatim, so the
 * author reads the spec's own message. It is the same composition
 * `GlobalFilterSchema` below uses, and for the same reason: an arm the spec adds
 * later reaches this mirror with no edit here.
 *
 *   - `id` is withheld. It is this mirror's row identity (objectui#8415), and
 *     the rule is strict and refuses it as a console row key, so the
 *     projection is load-bearing rather than tidy.
 *   - `field` and `operator` are the schemas the rule itself declares (the
 *     operator IS the rule's member, above), and zod runs an object refinement
 *     only after every member was accepted. So every issue the rule can raise
 *     here is about `value`: the mirror refuses nothing new for another reason.
 *   - An omitted `value` stays omitted, so the rule judges absence as absence.
 *
 * `value` keeps its `z.any()` declaration, so the static type does not move and
 * the TypeScript twin (`FilterBuilderCondition.value`, `any`) is untouched; only
 * the runtime accept set narrows, to the protocol's.
 */
function conditionValueFollowsTheProtocolRule(
  condition: { field: string; operator: string; value?: unknown },
  ctx: z.RefinementCtx,
): void {
  const rule: Record<string, unknown> = { field: condition.field, operator: condition.operator };
  if ('value' in condition) rule.value = condition.value;
  const result = stripImportedDefaults(SpecViewFilterRuleSchema).safeParse(rule);
  if (result.success) return;
  for (const issue of result.error.issues) ctx.addIssue({ ...issue });
}

/**
 * Filter Condition Schema
 *
 * MEMOISED (objectui#7918): the getter returns a module-level constant, so the
 * PUBLIC `FilterBuilderConditionSchema.unwrap()` is reference-stable. (`ZodLazy`
 * spells `unwrap` as `() => _zod.def.getter()`, going around the cache zod keeps
 * on `def._cachedInner`, so an un-memoised lazy hands out a fresh schema per
 * call.) Safe here because this body is NOT recursive — it names only
 * `FilterOperatorSchema` and `conditionValueFollowsTheProtocolRule`, both
 * declared above, and neither reaches back to this const.
 *
 * ⚠️ Not every `z.lazy` export of this face can take this shape. The ones the
 * `TDZ_BOUND` ledger of `../__tests__/zod-lazy-getter-identity-7918.test.ts`
 * lists have bodies that name the very const being declared, so evaluating the
 * body eagerly throws `ReferenceError: Cannot access '<name>' before
 * initialization` at module load; the `z.lazy` there is buying a TDZ dodge, not
 * a style. Read that ledger before "fixing" any of them to match this one.
 * `FilterGroupSchema` below was one of them until objectui#9306 made its body
 * flat; it now takes this shape too.
 */
const FilterBuilderConditionObject = z.object({
  // REQUIRED, and the asymmetry with `FilterGroupSchema.id` below is the whole
  // point of declaring it here (objectui#8415). The group's `id` has ZERO read
  // sites and is optional for that reason; a CONDITION's `id` is the identity
  // every affordance on the row matches on, measured in
  // `packages/components/src/custom/filter-builder.tsx`:
  //
  //   - the four MATCH sites — `removeCondition` (`c.id !== conditionId`),
  //     `updateCondition` and `changeOperator` (`c.id === conditionId`) and
  //     `changeField` (`c.id !== conditionId`);
  //   - the React `key` on the row;
  //   - eleven call sites that hand `condition.id` to one of those four.
  //
  // The TypeScript twin, `FilterBuilderCondition.id` in `../complex.ts`, is a
  // required `string`, not `string | undefined`. The component declares no
  // `id` of its own: its `FilterBuilderRow` takes the member from that
  // declaration (objectui#9306), and `addCondition` emits `crypto.randomUUID()`.
  //
  // ⭐ The narrowing refuses only what is ALREADY broken. Because a plain
  // `z.object` STRIPS undeclared keys, an author who correctly wrote `id` had
  // it discarded in silence: the document validated, the row rendered, and the
  // row then had no individual identity. Both sides of every comparison listed
  // above are `undefined`, and `undefined === undefined` is TRUE, so each
  // helper matches EVERY id-less row rather than none:
  //
  //   - `removeCondition(undefined)` deletes them ALL in one click — the
  //     clicked row included; only rows carrying a real id survive it;
  //   - `updateCondition`, `changeOperator` and `changeField` fan a single
  //     edit out across all of them;
  //   - `key={condition.id}` becomes `key={undefined}`, which React reads as
  //     NO key at all rather than as a duplicate one, so the rows reconcile by
  //     index and React warns about the missing key.
  //
  // ⛔ Not "matches none": the failure is EN BLOC, and it is the more severe
  // reading — a row cannot be edited or removed on its own. Nothing that worked
  // stops working; the state this refuses is accepted-and-discarded, the class
  // objectui#6150 closed for `tree-view.title`.
  id: z.string().describe('Row identity — matched by `removeCondition` / `updateCondition` / `changeOperator` / `changeField`, and the React key'),
  field: z.string().describe('Field name'),
  operator: FilterOperatorSchema.describe('Filter operator'),
  // Judged against `operator` by the spec rule, in the refinement below.
  value: z.any().optional().describe('Filter value'),
}).superRefine(conditionValueFollowsTheProtocolRule);

export const FilterBuilderConditionSchema: z.ZodType<any> = z.lazy(() => FilterBuilderConditionObject);

/**
 * Filter Group Schema — the shape `FilterBuilder` actually reads
 * (`d4493fdbc`, the `filter-builder` group; maintainer ruling 2026-09-02,
 * director seat summon #8, verbatim 「同意」).
 *
 * The gate is `isValidGroup` in `packages/components/src/custom/filter-builder.tsx`:
 *
 *     Array.isArray(v.conditions) && (v.logic === "and" || v.logic === "or")
 *
 * so `logic` is the read key and the mirror's former `operator` was a spelling
 * with ZERO read sites. Measured through the real `SchemaRenderer`: rewriting a
 * catalog entry's group from `{ id, logic, conditions }` to
 * `{ operator, conditions }` fails that gate, the component falls back to
 * `EMPTY_GROUP`, and the board EMPTIES — 76 elements and three condition rows
 * become 11 elements and none.
 *
 * `id` is DECLARED here but deliberately OPTIONAL, and that is a departure from
 * a literal reading of the ruling's `{ id, logic, conditions }`. `isValidGroup`
 * never consults it and nothing else reads `filterGroup.id`; measured, deleting
 * `id` from an authored group renders BYTE-IDENTICALLY (76 elements, same text,
 * same SHA-256). Requiring it would refuse a document the renderer draws
 * perfectly — a fresh instance of the exact class that ruling's eight groups
 * exist to close. Declared rather than dropped because the component's exported
 * `FilterBuilderRowGroup` carries it, `EMPTY_GROUP` emits it, every catalog entry authors
 * it, and it round-trips out through `onChange`; declaring it buys the type
 * check (`id: 42` now refuses) that an undeclared key would not get, since a
 * plain `z.object` strips unknown keys in silence.
 *
 * ## `conditions` is FLAT — a nested sub-group is refused BY NAME (objectui#9306)
 *
 * This array used to take `union([condition, group])`, so a sub-group parsed
 * green. Nothing honours one: `FilterBuilder` draws every entry as one flat
 * field / operator / value row, so a sub-group rendered as a row with blank
 * triggers while its own conditions were drawn nowhere, and the builder handed
 * it back through `onChange` untouched. The maintainer's ruling on
 * objectui#9306 (「A 撤掉嵌套声明」) retires the nesting at this authority.
 *
 * Why a named refusal and not just `z.array(FilterBuilderConditionSchema)`: a
 * sub-group run through the ROW schema is refused, but only as a missing
 * `field` and a missing `operator` — true, and no help to an author who wrote
 * a group on purpose. So each entry is asked one question first: does it carry
 * its own `conditions`? A row never does, so an entry that does is a
 * sub-group, and it gets ONE `custom` issue at the entry's own path, carrying
 * {@link NESTED_FILTER_GROUP_RETIRED}. The pipe does not go on to the row
 * schema after that issue, so the author reads the reason, not its symptoms.
 * Every other entry is judged by the row schema exactly as before.
 *
 * MEMOISED, like {@link FilterBuilderConditionSchema}: the body no longer names
 * this const, so the `z.lazy` has no temporal dead zone left to dodge (the
 * objectui#7918 ledger moved it from `TDZ_BOUND` to `MEMOISED`). The `z.lazy`
 * and the `z.ZodType<any>` annotation stay, so the public handle's type and
 * its `.unwrap()` accessor do not move.
 */
const NESTED_FILTER_GROUP_RETIRED =
  'A nested sub-group is RETIRED (objectui#9306, ADR-0049): every entry of a filter group\'s '
  + '`conditions` is one flat `{ id, field, operator, value }` row, and an entry carrying its own '
  + '`conditions` is refused by name. `filter-builder` draws no nested group: it drew a sub-group '
  + 'as a row with blank field and operator triggers and showed its conditions nowhere. Write the '
  + 'rows into the one group instead; its `logic` (`and` / `or`) combines all of them.';

const FilterGroupEntrySchema = z
  .any()
  .superRefine((entry, ctx) => {
    if (
      typeof entry === 'object'
      && entry !== null
      && !Array.isArray(entry)
      && Object.prototype.hasOwnProperty.call(entry, 'conditions')
    ) {
      ctx.addIssue({ code: 'custom', message: NESTED_FILTER_GROUP_RETIRED });
    }
  })
  .pipe(FilterBuilderConditionSchema);

const FilterGroupObject = z.object({
  id: z.string().optional().describe('Group id — round-tripped through `onChange`; no read site'),
  logic: z.enum(['and', 'or']).describe('How the conditions combine — read by `isValidGroup`'),
  conditions: z.array(FilterGroupEntrySchema).describe(`Flat condition rows. ${NESTED_FILTER_GROUP_RETIRED}`),
});

export const FilterGroupSchema: z.ZodType<any> = z.lazy(() => FilterGroupObject);

/**
 * Filter Field Schema — one entry of `FilterBuilderSchema.fields`
 * (`d4493fdbc`, same ruling).
 *
 * ## `value`, not `name`
 *
 * Every read site looks the entry up by `value`:
 * `fields.find((f) => f.value === fieldValue)` in `getOperatorsForField`,
 * `changeField`, `getInputType` and `renderValueInput`, plus `fields[0]?.value`
 * in `addCondition` and `<SelectItem value={field.value}>` in the field
 * dropdown — all in `custom/filter-builder.tsx`, plus the row render. `name`
 * has zero read sites, and `FilterBuilderProps.fields` in that file declares
 * `Array<{ value, label, type? }>`. Measured: rewriting
 * a catalog entry's `value` to `name` loses the field on every row —
 * `…Clear allCategoryRemove condition…` becomes
 * `…Clear allRemove condition…`, and the three value inputs degrade from
 * `text`/`number`/`number` to three `text` boxes.
 *
 * ## The type vocabulary — the FOURTEEN the published doc declares
 *
 * Ruled on objectui#7562 (director seat, decision batch #88, 2026-09-08): of
 * the three declarations of this one authoring surface — the published doc
 * (`content/docs/components/complex/filter-builder.mdx`), the component, and
 * this mirror — the DOC is the authority. The component already follows it,
 * and a contract does not retract what it published to authors. So the enum
 * below is the doc's fourteen in the doc's order, and `type` is OPTIONAL
 * because the doc publishes `type?:` and the renderer reads `fieldType ||
 * "text"` (`custom/filter-builder.tsx`: `valueFamilyForFieldType`, and again
 * in `operatorsForFieldType` for operators).
 *
 * ⛔ The ruling carried a PRECONDITION, measured before this enum moved:
 * every one of the fourteen has a renderer branch, because a key declared that
 * nothing draws would have had to come OUT of the doc instead. Measured on
 * `e3fb3b6` by driving one condition row per member through the real
 * `FilterBuilder` and reading both the value control and the operator bucket.
 * All fourteen passed and nothing was removed from the doc. The branches, in
 * `custom/filter-builder.tsx`:
 *
 *   - `numberLikeTypes:931` — `number`, `currency`, `percent`, `rating`
 *     ⇒ `<input type="number">` and the numeric bucket (`greaterThan` /
 *     `lessThan` / `greaterOrEqual` / `lessOrEqual`).
 *   - `dateLikeTypes:933`, plus the three equality tests at 411-413 — `date`,
 *     `datetime`, `time` ⇒ `<input type>` `date` / `datetime-local` / `time`
 *     and `before` / `after` / `between`.
 *   - `boolean` is its own family (line 410) ⇒ no `<input>` at all but a
 *     two-item Select, and a two-operator bucket nothing else has.
 *   - `selectLikeTypes:935` — `select`, `status`; `lookupLikeTypes:947` —
 *     `lookup`, `master_detail`, `user` ⇒ the option-driven Select (a THIRD
 *     combobox on the row, no `<input>`) and the relational `in` / `notIn`
 *     bucket. With no static option domain but a `referenceTo` — or
 *     `type: 'user'`, which defaults its own — all three lookup-like members
 *     draw the remote search picker instead (line 1277).
 *
 * ⚠ `text` is the fourteenth and its branch is BY NAME, not by a distinct
 * control: it IS the unrecognised-word fallthrough target, so a `text` column
 * measures identical to a nonsense spelling AND to an absent `type` — same 35
 * elements, same `<input type="text">`, same operator bucket, all three. What
 * makes it READ rather than phantom is that the renderer names it: line 408 is
 * where an absent `type` acquires the family called `text`, and `text` is a
 * `FilterValueFamily` member (line 405) and a `FILTER_INPUT_TYPE_BY_FAMILY`
 * key (line 431). The ruling says the same from the other side — "`text` when
 * absent, as the renderer already reads it" — so its optional half cannot land
 * while `text` is deleted.
 *
 * `string` stays OUT, and that is the contrast the paragraph above turns on:
 * it is named NOWHERE in the renderer, so it reaches the text control only by
 * the fallthrough. A phantom, removed by `d4493fdbc` and not restored here;
 * the published doc does not offer it either, so the two faces agree.
 */
export const FilterFieldSchema = z.object({
  value: z.string().describe('Field key — the identity every read site matches on'),
  label: z.string().describe('Field label'),
  type: z.enum([
    'text', 'number', 'currency', 'percent', 'rating',
    'date', 'datetime', 'time',
    'boolean',
    'select', 'status',
    'lookup', 'master_detail', 'user',
  ]).optional().describe('Field type — the published doc\'s fourteen; `text` when absent'),
  // The spec's canonical filter vocabulary, `VIEW_FILTER_OPERATORS` in
  // `@objectstack/spec/ui` (objectui#10286, the objectui#7759 ruling: where the
  // spec declares it, both faces align to the spec). This key used to take
  // `FilterOperatorSchema` above, which carries `is_null` / `is_not_null` where
  // the TS declaration carried `is_empty` / `is_not_empty`, so neither face
  // could be satisfied from the other. `FilterOperatorSchema` itself still
  // types a CONDITION's `operator` and is not this key's business.
  //
  // Spelled out rather than imported: a raw spec VALUE read in a mirror must go
  // through the objectui#8317 import boundary, which is about schemas and has no
  // arm for a bare array. It cannot drift silently: the TS face takes the spec's
  // `ViewFilterOperator` BY REFERENCE, so the parity ledger reddens the day the
  // two sets differ, and `mirror-groups-cd-10286.test.ts`
  // compares this list with the spec's array at runtime.
  operators: z.array(z.enum([
    'equals', 'not_equals',
    'contains', 'not_contains', 'icontains',
    'starts_with', 'ends_with',
    'greater_than', 'less_than',
    'greater_than_or_equal', 'less_than_or_equal',
    'in', 'not_in',
    'is_empty', 'is_not_empty',
    'is_null', 'is_not_null',
    'before', 'after', 'between',
  ])).optional().describe('Available operators'),
  options: z.array(z.object({
    label: z.string(),
    value: z.any(),
  })).optional().describe('Options for select type'),
});

/**
 * `FilterBuilderSchema.value` — a filter GROUP, and nothing else (objectui#10825).
 *
 * This key used to take `union([condition, group])`, while the TypeScript face
 * declares `value?: FilterGroup`, so the mirror was WIDER than the published
 * type. A bare condition parsed green, and `FilterBuilder` then drew an EMPTY
 * builder: its `isValidGroup` gate (`custom/filter-builder.tsx`) needs
 * `conditions` and `logic`, a condition carries neither, and the component
 * falls back to `EMPTY_GROUP` with no error. The condition was lost in silence.
 *
 * The contract follows the published type. The value is judged by
 * {@link FilterGroupSchema} alone, and a value that is recognisably a bare
 * condition is refused BY NAME first, in the shape `FilterGroupEntrySchema`
 * above uses for a nested sub-group: ONE `custom` issue at `value`, carrying
 * {@link BARE_CONDITION_VALUE_REFUSED}, after which the pipe does not go on to
 * the group schema, so the author reads the prescription and not the missing
 * `logic` and `conditions` it would otherwise report.
 *
 * "Recognisably a bare condition" is a plain object that carries a
 * condition's own `field` or `operator` and no `conditions` of its own. Every
 * other shape (a group missing `logic`, a query-style `{ field: value }` map,
 * a string) is judged by the group schema exactly as a group is.
 *
 * The union also wrapped every refusal of a GROUP in an `invalid_union` at
 * `value`. With the condition arm gone there is no union, so a group's own
 * refusals are reported at their own path under `value`.
 */
const BARE_CONDITION_VALUE_REFUSED =
  'A bare condition is REFUSED as a `filter-builder` `value` (objectui#10825): the value is a filter '
  + 'group, the only shape `FilterBuilder` reads, and it drew a bare `{ id, field, operator, value }` '
  + 'condition as an EMPTY builder, with no error. Wrap it in `{ logic, conditions: [ … ] }`: `logic` '
  + 'is `and` or `or`, and the condition becomes the one row of `conditions`.';

const FilterBuilderValueSchema = z
  .any()
  .superRefine((value, ctx) => {
    if (
      typeof value === 'object'
      && value !== null
      && !Array.isArray(value)
      && !Object.prototype.hasOwnProperty.call(value, 'conditions')
      && (Object.prototype.hasOwnProperty.call(value, 'field') || Object.prototype.hasOwnProperty.call(value, 'operator'))
    ) {
      ctx.addIssue({ code: 'custom', message: BARE_CONDITION_VALUE_REFUSED });
    }
  })
  .pipe(FilterGroupSchema);

/**
 * Filter Builder Schema - Filter builder component
 */
export const FilterBuilderSchema = BaseSchema.extend({
  type: z.literal('filter-builder'),
  fields: z.array(FilterFieldSchema).describe('Available filter fields'),
  // RETIRED (objectui#10825, ADR-0049): measured through the real
  // `SchemaRenderer`, a group authored as `defaultValue` drew the same empty
  // builder as a node with no filter key at all. The registration hands
  // `FilterBuilder` `schema.value || props.value`, and `FilterBuilder` has no
  // `defaultValue` prop. A tombstone rather than a deletion because this node
  // is `.passthrough()`: an undeclared key would be KEPT in silence.
  defaultValue: retirementTombstone(
    'RETIRED (objectui#10825, ADR-0049) — never read: the `filter-builder` renderer hands `FilterBuilder` '
    + 'only `value`, and `FilterBuilder` has no `defaultValue` prop, so an authored default drew the same '
    + 'empty builder as no key at all. Author the filter group as `value` instead, the key the renderer '
    + 'reads. Delete the key.',
  ),
  value: FilterBuilderValueSchema.optional().describe(`Controlled filter value — a filter group. ${BARE_CONDITION_VALUE_REFUSED}`),
  onChange: handlerKeyRefusal('onChange', 'runtime-slot', 'Change handler'),
  // Both RETIRED with the nesting they configured (objectui#9306, ADR-0049): no
  // renderer read either, and `FilterGroupSchema` above now refuses the nested
  // sub-group they were about. Tombstones rather than deletions because this
  // node is `.passthrough()`: an undeclared key would be KEPT in silence.
  allowGroups: retirementTombstone(
    'REFUSED (objectui#9306, ADR-0049) — `filter-builder` has no nested groups, so `allowGroups` has '
    + 'nothing to allow: no renderer read it, every entry of a filter group\'s `conditions` is one flat '
    + 'row, and a nested sub-group is refused by name. Remove the key.',
  ),
  maxDepth: retirementTombstone(
    'REFUSED (objectui#9306, ADR-0049) — `filter-builder` has no nested groups, so `maxDepth` has no '
    + 'depth to limit: no renderer read it, every entry of a filter group\'s `conditions` is one flat '
    + 'row, and a nested sub-group is refused by name. Remove the key.',
  ),
  // Applied by renderers/complex/filter-builder.tsx as `className={schema.wrapperClass || ''}`.
  wrapperClass: z.string().optional().describe('Outer wrapper classes for the filter builder (objectui#6150)'),
  body: retirementTombstone(
    'REFUSED (objectui#9256, ADR-0049) — `filter-builder` reads NEITHER content channel: measured with the '
    + 'TypeScript type checker across all 24 registering packages, no renderer read consumes `body` or '
    + '`children` for this node, and `SchemaRenderer` strips both out of the props bag it spreads. An '
    + 'authored value therefore rendered NOTHING — no render-time error or warning and no element; only the parser tier\'s `not-a-container` warning (objectui#9910) noticed it. '
    + 'What it renders instead: `fields`, `label`, `name`, `value`, `wrapperClass`.',
  ),
  children: retirementTombstone(
    'REFUSED (objectui#9256, ADR-0049) — `filter-builder` reads NEITHER content channel: measured with the '
    + 'TypeScript type checker across all 24 registering packages, no renderer read consumes `body` or '
    + '`children` for this node, and `SchemaRenderer` strips both out of the props bag it spreads. An '
    + 'authored value therefore rendered NOTHING — no render-time error or warning and no element; only the parser tier\'s `not-a-container` warning (objectui#9910) noticed it. '
    + 'What it renders instead: `fields`, `label`, `name`, `value`, `wrapperClass`.',
  ),
});

/**
 * Carousel Item Schema
 */
export const CarouselItemSchema = z.object({
  id: z.string().optional().describe('Item ID'),
  content: z.union([SchemaNodeSchema, z.array(SchemaNodeSchema)]).describe('Item content'),
});

/**
 * Carousel Schema - Carousel component
 */
export const CarouselSchema = BaseSchema.extend({
  type: z.literal('carousel'),
  items: z.array(CarouselItemSchema).describe('Carousel items'),
  opts: z.record(z.string(), z.unknown()).optional()
    .describe("Embla option bag forwarded verbatim (`opts={schema.opts}`). Left OPEN on purpose: the renderer passes the whole bag through, so narrowing it to the docs' `{loop, align}` pair would refuse authored documents that work today (objectui#6150)"),
  orientation: z.enum(['horizontal', 'vertical']).optional()
    .describe("Scroll axis — `orientation={schema.orientation || 'horizontal'}` (objectui#6150)"),
  // Applied at renderers/complex/carousel.tsx:30 as `className={schema.itemClassName}` on every CarouselItem.
  itemClassName: z.string().optional().describe('Per-slide Tailwind classes, applied to every carousel item (objectui#6150)'),
  autoPlayMs: z.number().optional().describe('Auto-play interval (ms)'),
  autoPlay: retirementTombstone(durationKeyRenamedGuidance('autoPlay', 'autoPlayMs', 'milliseconds')),
  showArrows: z.boolean().optional().describe('Show navigation arrows'),
  showDots: z.boolean().optional().describe('Show navigation dots'),
  loop: z.boolean().optional().describe('Enable infinite loop'),
  itemsPerView: z.number().optional().describe('Items per view'),
  gap: z.number().optional().describe('Gap between items'),
  onSlideChange: handlerKeyRefusal('onSlideChange', 'retired', 'Slide change handler'),
  body: retirementTombstone(
    'REFUSED (objectui#9256, ADR-0049) — `carousel` reads NEITHER content channel: measured with the '
    + 'TypeScript type checker across all 24 registering packages, no renderer read consumes `body` or '
    + '`children` for this node, and `SchemaRenderer` strips both out of the props bag it spreads. An '
    + 'authored value therefore rendered NOTHING — no render-time error or warning and no element; only the parser tier\'s `not-a-container` warning (objectui#9910) noticed it. '
    + 'What it renders instead: `itemClassName`, `items`, `opts`, `orientation`, `showArrows`.',
  ),
  children: retirementTombstone(
    'REFUSED (objectui#9256, ADR-0049) — `carousel` reads NEITHER content channel: measured with the '
    + 'TypeScript type checker across all 24 registering packages, no renderer read consumes `body` or '
    + '`children` for this node, and `SchemaRenderer` strips both out of the props bag it spreads. An '
    + 'authored value therefore rendered NOTHING — no render-time error or warning and no element; only the parser tier\'s `not-a-container` warning (objectui#9910) noticed it. '
    + 'What it renders instead: `itemClassName`, `items`, `opts`, `orientation`, `showArrows`.',
  ),
});

/**
 * Chat Message Schema
 */
export const ChatToolInvocationSchema = z.object({
  toolCallId: z.string().describe('Unique tool call identifier'),
  toolName: z.string().describe('Name of the tool'),
  args: z.unknown().optional().describe('Tool arguments'),
  result: z.unknown().optional().describe('Tool result'),
  errorText: z.string().optional().describe('Tool error text'),
  // The AUTHORING state vocabulary (objectui#10018). The AI SDK's three
  // approval states — `approval-requested`, `approval-responded` and
  // `output-denied` — are runtime-only and are not listed: an authored claim
  // of one is refused as an `invalid_value` at `state`, with or without an
  // `approval` envelope. Mirrors `ChatToolInvocation.state` in ../complex.ts.
  state: z
    .enum([
      'partial-call',
      'call',
      'result',
      'input-streaming',
      'input-available',
      'output-available',
      'output-error',
    ])
    .optional()
    .describe('Tool invocation state'),
  // Mirrors `ChatToolInvocation.approval` in ../complex.ts. The AI SDK v6
  // tool-part union requires this envelope alongside the three approval
  // states, which the `state` enum above does not admit (objectui#10018); on
  // the states it does admit the envelope is never required, so this arm
  // stays independently optional (objectui#8442).
  approval: z
    .object({
      id: z.string().describe('Approval request id — the key a decision is replied on'),
      approved: z.boolean().optional().describe('The decision, once made'),
      reason: z.string().optional().describe('Free-text reason supplied with the decision'),
      isAutomatic: z.boolean().optional().describe('True when policy decided without a human'),
      signature: z.string().optional().describe('Signature over the approval, when signed'),
    })
    .optional()
    .describe('AI SDK approval envelope for a tool call awaiting or carrying a human decision'),
});

export const ChatMessageSourceSchema = z.object({
  id: z.string().optional(),
  title: z.string().optional(),
  url: z.string().describe('Source URL'),
});

export const ChatMessageSchema = z.object({
  id: z.string().describe('Message ID'),
  role: z.enum(['user', 'assistant', 'system', 'tool']).describe('Message role'),
  content: z.string().describe('Message content'),
  timestamp: z.union([z.string(), z.date()]).optional().describe('Message timestamp'),
  metadata: z.record(z.string(), z.any()).optional().describe('Custom metadata'),
  streaming: z.boolean().optional().describe('Whether message is being streamed'),
  toolInvocations: z.array(ChatToolInvocationSchema).optional().describe('Tool invocations'),
  reasoning: z.string().optional().describe('Chain-of-thought reasoning text'),
  sources: z.array(ChatMessageSourceSchema).optional().describe('Citation sources'),
  traceId: z.string().optional().describe('Backend trace id (ai_traces.id)'),
  // Read at plugin-chatbot/src/index.tsx:172-174 as `message.avatar || userAvatarUrl` (or `|| assistantAvatarUrl` on the assistant branch).
  avatar: z.string().optional().describe('Per-message avatar image URL overriding the chatbot-level userAvatarUrl / assistantAvatarUrl (objectui#7295)'),
  // Read at plugin-chatbot/src/index.tsx:176-178 as `message.avatarFallback || userAvatarFallback` (or `|| assistantAvatarFallback` on the assistant branch).
  avatarFallback: z.string().optional().describe('Per-message avatar fallback text overriding the chatbot-level userAvatarFallback / assistantAvatarFallback (objectui#7295)'),
});

/**
 * Chatbot Schema - Chatbot component
 */
export const ChatbotSchema = BaseSchema.extend({
  type: z.literal('chatbot'),
  messages: z.array(ChatMessageSchema).describe('Chat messages'),
  placeholder: z.string().optional().describe('Input placeholder'),
  // --- ADR-0049 retirement tombstones (`a4611b3e2`) -----------------------
  //
  // Six keys this twin mirrored and no `plugin-chatbot` registration read —
  // `loading`, `showAvatars`, `userAvatar`, `assistantAvatar`, `markdown` and
  // `height` (that last one below, after `processVisibility`, which is NOT
  // part of this retirement: `chatbot-enhanced` reads it). The census, the lit
  // controls and the per-key enforce-or-remove argument live on the TS twin's
  // `ChatbotSchema` docblock (`../complex.ts`); the pins are in
  // `../__tests__/chatbot-dark-keys-retired-7703.test.ts`.
  //
  // Deleting these arms was the wrong route and is why they stay declared:
  // `BaseSchema` is `.passthrough()`, so an undeclared key is not refused, it
  // is KEPT — the same silent acceptance the retirement exists to close.
  loading: retirementTombstone(
    'RETIRED (ADR-0049) — never read: chat progress is runtime state the chat runtime owns '
    + '(the registration derives it from `useObjectChat` as `isLoading`), and `<Chatbot>` declares no `loading` '
    + 'prop for an authored value to land on. There is no authored spelling that sets it; delete the key.',
  ),
  onSendMessage: handlerKeyRefusal('onSendMessage', 'retired', 'Send message handler'),
  showAvatars: retirementTombstone(
    'RETIRED (ADR-0049) — no registration reads or forwards this key by name, and a `chatbot` '
    + 'node renders `<Chatbot>`, which has no `showAvatars` prop; the one channel that did deliver it — the '
    + "`chatbot-floating` registration's unfiltered props spread — was fenced. Delete the key: "
    + 'a `chatbot` node already renders an avatar beside every message, and the images are `userAvatarUrl` / '
    + '`assistantAvatarUrl` with their `userAvatarFallback` / `assistantAvatarFallback` siblings.',
  ),
  userAvatar: retirementTombstone(
    'RETIRED (ADR-0049) — never read: this spelling has zero hits anywhere in '
    + '`packages/plugin-chatbot`. Write `userAvatarUrl` instead (with `userAvatarFallback` for the text shown '
    + 'while the image loads or fails), the key all three chatbot registrations read.',
  ),
  assistantAvatar: retirementTombstone(
    'RETIRED (ADR-0049) — never read: this spelling has zero hits anywhere in '
    + '`packages/plugin-chatbot`. Write `assistantAvatarUrl` instead (with `assistantAvatarFallback` for the '
    + 'text shown while the image loads or fails), the key all three chatbot registrations read.',
  ),
  markdown: retirementTombstone(
    'RETIRED (ADR-0049) — never read: a `chatbot` node renders `<Chatbot>`, which prints message '
    + 'content as text and has no markdown path for this switch to reach. Author `type: "chatbot-enhanced"` '
    + '(or `"chatbot-floating"`) with `enableMarkdown` instead — markdown is those nodes\' capability, and '
    + '`enableMarkdown` is the key their registrations read.',
  ),
  processVisibility: z.enum(['hidden', 'summary', 'debug']).optional().describe('How much agent reasoning/tool detail to show'),
  height: retirementTombstone(
    'RETIRED (ADR-0049) — never read: `<Chatbot>` has no `height` prop. Write `maxHeight` '
    + 'instead (a CSS length string, default "500px"), the key the `chatbot` and `chatbot-enhanced` '
    + 'registrations forward; size a `chatbot-floating` panel with `floatingConfig.panelHeight`, a number of '
    + 'pixels, which is what that panel reads.',
  ),
  api: z.string().optional().describe('Backend API endpoint for streaming chat'),
  conversationId: z.string().optional().describe('Conversation ID for multi-turn context'),
  systemPrompt: z.string().optional().describe('System prompt for assistant behavior'),
  model: z.string().optional().describe('AI model identifier'),
  streamingEnabled: z.boolean().optional().describe('Enable streaming responses'),
  headers: z.record(z.string(), z.string()).optional().describe('Additional API headers'),
  // objectui#6152 round 4 — declared on the interface all along and READ by all three
  // registrations (`body: schema.requestBody`, forwarded to the chat runtime), but
  // mirrored only on the two twins below. Declared HERE so the shared pick carries it
  // and the three faces spell it once; `body` below points authors at this key.
  requestBody: z.record(z.string(), z.unknown()).optional()
    .describe('Additional body parameters sent with each API request (forwarded to the chat runtime as its `body` option)'),
  body: retirementTombstone(
    'REFUSED (objectui#8572, ADR-0049) — `body` is the CONTENT slot on every other component, and '
    + '`chatbot` reads NEITHER content channel; this arm restated it as the chat API body params, the one '
    + 'place in this vocabulary where the key carried two meanings. Author the chat API params as '
    + '`requestBody` instead — the key the registration forwards to the chat runtime as its `body` option, '
    + 'and the key the `chatbot-enhanced` and `chatbot-floating` twins already declare. Delete `body` here: '
    + 'nothing renders it, and nothing sends it.',
  ),
  // objectui#5605, ADR-0049 — retired behind a tombstone, not deleted: under
  // `BaseSchema`'s `.passthrough()` a deleted arm would KEEP an authored value
  // in silence. `chatbot-enhanced` and `chatbot-floating` carry this same arm.
  maxToolRoundtrips: retirementTombstone(
    'RETIRED (objectui#5605, ADR-0049) — never honoured: a chat node cannot cap tool-calling round-trips. '
    + 'The tool loop runs on the server agent inside one streamed response, the chat runtime (`useChat`) has '
    + 'no numeric round-trip cap, and the chat request carries no cap field, so the value was dropped before '
    + 'any request was sent. Cap tool loops on the agent instead — `planning.maxIterations` (default 10). '
    + 'Delete the key.',
  ),
  // objectui#6152 round 5, ADR-0049 — declared on the interface and never
  // mirrored here, so `.passthrough()` KEPT an authored value that the `chatbot`
  // registration never reads. Retired on both faces; the census and the route
  // are on the TS twin's `ChatbotSchema.floatingConfig` member (`../complex.ts`).
  // ⛔ Not in `ChatbotSharedMirrorShape` below, so the `chatbot-floating` twin's
  // own `floatingConfig` arm is untouched.
  floatingConfig: retirementTombstone(
    'RETIRED (objectui#6152, ADR-0049) — never read on a `chatbot` node: the trigger and the panel this '
    + 'key configures belong to the floating presentation, which a `chatbot` node does not render. Author '
    + '`type: "chatbot-floating"` with `floatingConfig` instead — that is the registration that reads it — or '
    + 'delete the key.',
  ),
  onError: handlerKeyRefusal('onError', 'runtime-slot', 'Error callback'),
  // --- Local display + legacy auto-response fields (objectui#6169) ---
  // Mirrors the TS declaration added at ../complex.ts in lockstep, so these
  // ten keys move from the pre-existing "declared but unmirrored, rides
  // through .passthrough() unvalidated" state straight to mirrored — never
  // through an interim unmirrored window.
  showTimestamp: z.boolean().optional().describe('Display a timestamp on each message'),
  userAvatarUrl: z.string().optional().describe("URL of the user's avatar image"),
  userAvatarFallback: z.string().optional().describe('Fallback text for the user avatar'),
  assistantAvatarUrl: z.string().optional().describe("URL of the assistant's avatar image"),
  assistantAvatarFallback: z.string().optional().describe('Fallback text for the assistant avatar'),
  maxHeight: z.string().optional().describe('Maximum height of the chat message container (CSS value)'),
  autoResponse: z.boolean().optional().describe('Enable local auto-response (demo/playground) mode'),
  autoResponseText: z.string().optional().describe('Text of the local auto-response'),
  autoResponseDelayMs: z.number().optional().describe('Delay in milliseconds before the local auto-response is sent'),
  autoResponseDelay: retirementTombstone(durationKeyRenamedGuidance('autoResponseDelay', 'autoResponseDelayMs', 'milliseconds')),
  onSend: handlerKeyRefusal('onSend', 'runtime-slot', 'Called after a message is sent, in both API and local auto-response mode'),
  children: retirementTombstone(
    'REFUSED (objectui#9256, ADR-0049) — `chatbot` reads NEITHER content channel: measured with the '
    + 'TypeScript type checker across all 24 registering packages, no renderer read consumes `body` or '
    + '`children` for this node, and `SchemaRenderer` strips both out of the props bag it spreads. An '
    + 'authored value therefore rendered NOTHING — no render-time error or warning and no element; only the parser tier\'s `not-a-container` warning (objectui#9910) noticed it. '
    + 'What it renders instead: `api`, `assistantAvatarFallback`, `assistantAvatarUrl`, `autoResponse`, '
    + '`autoResponseDelayMs`, `autoResponseText`, `conversationId`, `headers`, `maxHeight`, '
    + '`messages`, `model`, `onError`, `onSend`, `placeholder`, `requestBody`, '
    + '`showTimestamp`, `streamingEnabled`, `systemPrompt`, `userAvatarFallback`, `userAvatarUrl`.',
  ),
});

/**
 * The chat-surface arms ALL THREE `plugin-chatbot` registrations read
 * (objectui#7655) — the Zod side of `../complex.ts`'s `ChatbotSharedKey`,
 * taken off `ChatbotSchema`'s own shape so every shared arm has ONE spelling.
 * Not exported: it is a census, not a mirror, and the parity census in
 * `__tests__/zod-mirror-parity.test.ts` registers `export const`s only.
 *
 * `requestBody` is in this pick since objectui#6152 round 4. Before it,
 * `ChatbotSchema` above did not declare the key at all — it rode through
 * `.passthrough()` there, recorded under `UnmirroredDeclared` in
 * `__tests__/zod-mirror-parity.test.ts` — so each twin below carried its own
 * copy of the arm. Now `ChatbotSchema` declares it and all three faces share
 * this one spelling, as `../complex.ts`'s `ChatbotSharedKey` always said.
 *
 * ⚠️ This note used to end "ruling on `ChatbotSchema`'s own `body` arm is a
 * separate question and is not decided here". It has been decided: ruling A on
 * objectui#8572 (decision batch #137, item 4, 2026-09-15) retires that arm, and
 * `body` is a `retirementTombstone` on `ChatbotSchema` above. ⇒ the naming
 * collision this pick was built to sidestep no longer exists on any of the
 * three chatbot faces — they now agree that `body` is not theirs to read.
 */
const ChatbotSharedMirrorShape = ChatbotSchema.pick({
  messages: true,
  placeholder: true,
  api: true,
  conversationId: true,
  systemPrompt: true,
  model: true,
  streamingEnabled: true,
  headers: true,
  requestBody: true,
  onError: true,
  showTimestamp: true,
  userAvatarUrl: true,
  userAvatarFallback: true,
  assistantAvatarUrl: true,
  assistantAvatarFallback: true,
  autoResponse: true,
  autoResponseText: true,
  autoResponseDelayMs: true,
  onSend: true,
}).shape;

/** The arms `chatbot-enhanced` and `chatbot-floating` share beyond the pick above. */
const chatbotEnableMarkdownArm = () =>
  z.boolean().optional().describe('Render assistant messages as markdown (default true)');
const chatbotEnableFileUploadArm = () =>
  z.boolean().optional().describe('Show the file-attachment control in the composer (default false)');
const chatbotOnClearArm = () =>
  handlerKeyRefusal('onClear', 'runtime-slot', 'Called after the conversation is cleared');

/**
 * Chatbot Enhanced Schema - `chatbot-enhanced` component (objectui#7655).
 *
 * Zod twin of `../complex.ts`'s `ChatbotEnhancedSchema`, in lockstep: every
 * key that declaration lists is an arm here, and the three runtime slots
 * (`onError`, `onSend`, `onClear`) are named refusals (objectui#6124).
 */
export const ChatbotEnhancedSchema = BaseSchema.extend({
  type: z.literal('chatbot-enhanced'),
  ...ChatbotSharedMirrorShape,
  maxToolRoundtrips: ChatbotSchema.shape.maxToolRoundtrips,
  autoResponseDelay: ChatbotSchema.shape.autoResponseDelay,
  maxHeight: ChatbotSchema.shape.maxHeight,
  processVisibility: ChatbotSchema.shape.processVisibility,
  enableMarkdown: chatbotEnableMarkdownArm(),
  enableFileUpload: chatbotEnableFileUploadArm(),
  surface: z.enum(['card', 'plain']).optional()
    .describe("Visual chrome for the chat surface: 'card' bordered panel (default) or 'plain' frameless full-page workspace (objectui#6687)"),
  onClear: chatbotOnClearArm(),
  // Declared HERE rather than inherited, because objectui#6771's retirement
  // of `BaseSchema.body` refuses the key with a message naming `children` —
  // which is the right remedy on every node except this family, where
  // `children` is refused too and the key an author actually wants is
  // `requestBody`. The sentence below is the one this node's `children`
  // tombstone already asserts about BOTH channels; only the declaration was
  // missing, and inheriting a wrong remedy is worse than inheriting none.
  body: retirementTombstone(
    'REFUSED (objectui#9256, ADR-0049) — `chatbot-enhanced` reads NEITHER content channel: measured with the '
    + 'TypeScript type checker across all 24 registering packages, no renderer read consumes `body` or '
    + '`children` for this node, and `SchemaRenderer` strips both out of the props bag it spreads. An '
    + 'authored value therefore rendered NOTHING — no render-time error or warning and no element; only the parser tier\'s `not-a-container` warning (objectui#9910) noticed it. '
    + 'The chat API body params go on `requestBody`, which the registration forwards to the chat runtime. '
    + 'What it renders instead: `api`, `assistantAvatarFallback`, `assistantAvatarUrl`, `autoResponse`, '
    + '`autoResponseDelayMs`, `autoResponseText`, `conversationId`, `enableFileUpload`, `enableMarkdown`, '
    + '`headers`, `maxHeight`, `messages`, `model`, `onClear`, `onError`, '
    + '`onSend`, `placeholder`, `processVisibility`, `requestBody`, `showTimestamp`, '
    + '`streamingEnabled`, `surface`, `systemPrompt`, `userAvatarFallback`, `userAvatarUrl`.',
  ),
  children: retirementTombstone(
    'REFUSED (objectui#9256, ADR-0049) — `chatbot-enhanced` reads NEITHER content channel: measured with the '
    + 'TypeScript type checker across all 24 registering packages, no renderer read consumes `body` or '
    + '`children` for this node, and `SchemaRenderer` strips both out of the props bag it spreads. An '
    + 'authored value therefore rendered NOTHING — no render-time error or warning and no element; only the parser tier\'s `not-a-container` warning (objectui#9910) noticed it. '
    + 'What it renders instead: `api`, `assistantAvatarFallback`, `assistantAvatarUrl`, `autoResponse`, '
    + '`autoResponseDelayMs`, `autoResponseText`, `conversationId`, `enableFileUpload`, `enableMarkdown`, '
    + '`headers`, `maxHeight`, `messages`, `model`, `onClear`, `onError`, '
    + '`onSend`, `placeholder`, `processVisibility`, `requestBody`, `showTimestamp`, '
    + '`streamingEnabled`, `surface`, `systemPrompt`, `userAvatarFallback`, `userAvatarUrl`.',
  ),
});

/**
 * objectui#6152 round 4 — `../complex.ts`'s `FloatingChatbotConfig`, restated
 * member for member: the trigger and panel geometry `FloatingChatbot` destructures
 * (`position`, `defaultOpen`, `panelWidth`, `panelHeight`, `title`, `triggerSize`),
 * each measured READ by a type-checker census. Module-private: a nested shape of
 * the `chatbot-floating` arm below, not a registered pair — the parity ratchet
 * compares it through that arm's `floatingConfig` member.
 *
 * `triggerIcon` is the RUNTIME half of objectui#7654's tombstone, which that card
 * left type-level only because this mirror did not exist; its tripwire
 * (`../__tests__/floating-chatbot-trigger-icon-retired.test.ts`) asked whoever
 * minted the mirror to add it here, at the same time.
 */
const FloatingChatbotConfigSchema = z.object({
  position: z.enum(['bottom-right', 'bottom-left']).optional()
    .describe('Corner the trigger button sits in (default bottom-right)'),
  defaultOpen: z.boolean().optional().describe('Open the panel on mount (default false)'),
  panelWidth: z.number().optional().describe('Panel width in pixels (default 400)'),
  panelHeight: z.number().optional().describe('Panel height in pixels (default 520)'),
  title: z.string().optional().describe('Panel header title (default "Chat")'),
  triggerIcon: retirementTombstone(
    'RETIRED (objectui#7654, ADR-0049) — never read: the floating trigger renders a fixed icon and takes '
    + 'no icon prop, so no authored value changes it. Delete the key.',
  ),
  triggerSize: z.number().optional().describe('Trigger button size in pixels (default 56)'),
});

/**
 * Chatbot Floating Schema - `chatbot-floating` component (objectui#7655).
 *
 * Zod twin of `../complex.ts`'s `ChatbotFloatingSchema`. One of that
 * declaration's keys is deliberately NOT mirrored, and the parity ledger
 * records it under `UnmirroredDeclared` for this pair — exactly as it records
 * the same key for `ChatbotSchema`, which declares it too (the only key the two
 * twins' ledger entries still hold since objectui#6152 round 5):
 *
 *   - `displayMode` — RETIRED by objectui#7654 (maintainer ruling B,
 *     2026-09-05): the node `type` is the one selector of presentation. The
 *     TypeScript half landed there — `?: never` tombstone on both faces,
 *     designer control and seed removed. The refusal stays TypeScript-only:
 *     stored designer documents carry `displayMode: 'floating'`, and
 *     objectui#6152 round 4 kept that under the ruling, so this twin has no
 *     arm and a stored document carrying the key parses exactly as it did
 *     (`chatbot-display-mode-retired.test.ts` pins the shape as the tripwire).
 *     It rides through `BaseSchema`'s `.passthrough()` unvalidated, byte for
 *     byte as it does on `ChatbotSchema`'s twin.
 *
 * `floatingConfig` was the second such key until objectui#6152 round 4 minted
 * `FloatingChatbotConfigSchema` above and declared it here: this registration is
 * the one that reads it (`floatingConfig={schema.floatingConfig}`). On
 * `ChatbotSchema`'s twin it stayed unmirrored — the `chatbot` registration never
 * reads it — until objectui#6152 round 5 RETIRED it there, a
 * `retirementTombstone()` arm on that twin; this twin does not spread that arm
 * (the shared pick leaves it out), so its own arm above is the only
 * `floatingConfig` any chatbot twin accepts.
 */
export const ChatbotFloatingSchema = BaseSchema.extend({
  type: z.literal('chatbot-floating'),
  ...ChatbotSharedMirrorShape,
  maxToolRoundtrips: ChatbotSchema.shape.maxToolRoundtrips,
  autoResponseDelay: ChatbotSchema.shape.autoResponseDelay,
  enableMarkdown: chatbotEnableMarkdownArm(),
  enableFileUpload: chatbotEnableFileUploadArm(),
  onClear: chatbotOnClearArm(),
  floatingConfig: FloatingChatbotConfigSchema.optional()
    .describe('Trigger button and panel geometry for the floating chat'),
  // Declared HERE rather than inherited, because objectui#6771's retirement
  // of `BaseSchema.body` refuses the key with a message naming `children` —
  // which is the right remedy on every node except this family, where
  // `children` is refused too and the key an author actually wants is
  // `requestBody`. The sentence below is the one this node's `children`
  // tombstone already asserts about BOTH channels; only the declaration was
  // missing, and inheriting a wrong remedy is worse than inheriting none.
  body: retirementTombstone(
    'REFUSED (objectui#9256, ADR-0049) — `chatbot-floating` reads NEITHER content channel: measured with the '
    + 'TypeScript type checker across all 24 registering packages, no renderer read consumes `body` or '
    + '`children` for this node, and `SchemaRenderer` strips both out of the props bag it spreads. An '
    + 'authored value therefore rendered NOTHING — no render-time error or warning and no element; only the parser tier\'s `not-a-container` warning (objectui#9910) noticed it. '
    + 'The chat API body params go on `requestBody`, which the registration forwards to the chat runtime. '
    + 'What it renders instead: `api`, `assistantAvatarFallback`, `assistantAvatarUrl`, `autoResponse`, '
    + '`autoResponseDelayMs`, `autoResponseText`, `conversationId`, `enableFileUpload`, `enableMarkdown`, '
    + '`floatingConfig`, `headers`, `messages`, `model`, `onClear`, `onError`, '
    + '`onSend`, `placeholder`, `requestBody`, `showTimestamp`, `streamingEnabled`, `systemPrompt`, '
    + '`userAvatarFallback`, `userAvatarUrl`.',
  ),
  children: retirementTombstone(
    'REFUSED (objectui#9256, ADR-0049) — `chatbot-floating` reads NEITHER content channel: measured with the '
    + 'TypeScript type checker across all 24 registering packages, no renderer read consumes `body` or '
    + '`children` for this node, and `SchemaRenderer` strips both out of the props bag it spreads. An '
    + 'authored value therefore rendered NOTHING — no render-time error or warning and no element; only the parser tier\'s `not-a-container` warning (objectui#9910) noticed it. '
    + 'What it renders instead: `api`, `assistantAvatarFallback`, `assistantAvatarUrl`, `autoResponse`, '
    + '`autoResponseDelayMs`, `autoResponseText`, `conversationId`, `enableFileUpload`, `enableMarkdown`, '
    + '`floatingConfig`, `headers`, `messages`, `model`, `onClear`, `onError`, '
    + '`onSend`, `placeholder`, `requestBody`, `showTimestamp`, `streamingEnabled`, `systemPrompt`, '
    + '`userAvatarFallback`, `userAvatarUrl`.',
  ),
});

/**
 * Dashboard Widget Layout Schema
 */
export const DashboardWidgetLayoutSchema = z.object({
  x: z.number().describe('Grid x position'),
  y: z.number().describe('Grid y position'),
  w: z.number().describe('Grid width'),
  h: z.number().describe('Grid height'),
});

/**
 * The CLOSED vocabulary a dashboard widget's `type` may name — Zod twin of
 * `../complex.ts` {@link DashboardWidgetTypeName}, and the enforcement half of
 * the 2026-08-14 maintainer ruling on objectstack#8593.
 *
 * Composed of two sets, each reached the way its own provenance demands:
 *
 *  - the spec's 20 visualization families, BY REFERENCE off
 *    `ChartTypeSchema.options` — the same enum the spec's own
 *    `DashboardWidgetSchema.shape.type` wraps in a `.default()`. Restating them here would be the
 *    "narrower than the contract it implements" shape this file already
 *    records twice (`label`, `defaultRange`): a family the spec ADDS would be a
 *    legal document objectui refuses.
 *  - `DASHBOARD_WIDGET_TYPE_EXTENSIONS` — objectui-only widget FAMILIES
 *    (`list`, `custom`). The pre-existing divergence, until objectui#4600
 *    carried only as the prose "widened to `z.string()`" and enforced nowhere.
 *
 * `DASHBOARD_COMPONENT_WIDGET_TYPES` (`metric-card`) was a third set here
 * until objectui#11483, and it is ⛔ not a widget type. The slot holds such a
 * node directly, and the slot's component arm,
 * {@link DashboardWidgetSlotComponentSchema}, reads it with the registered
 * inputs it declares. While the type was also in this vocabulary, a
 * `metric-card` carrying only widget keys (`{ type: 'metric-card', title }`)
 * parsed as a WIDGET, so the arm's required `value` governed only when a
 * card-only input happened to be present, and `MetricCard` drew an empty
 * figure. objectui#11483 measured, through the real `DashboardRenderer` and
 * `DashboardGridLayout`, that no widget key binds the card's figure: a
 * `dataset` then drew `DatasetWidget` in the card's place, by a rule that
 * ignored the `type`, and the `options` bag was spread onto the node as
 * literal props, which is not a binding. Since objectui#11598 (2026-10-04)
 * both surfaces read a widget key on the widget arm alone: a `metric-card`
 * carrying one (`dataset`, `options`, `component`, …) is refused by the strict
 * face and is not drawn as a widget — the card draws its own keys, and no
 * `options` bag is spread onto it. So the type left this vocabulary, and
 * the component arm's required `value` is the one reading of a `metric-card`
 * in the slot. A dataset-bound single figure is the `metric` widget
 * (`type: 'metric'` with `dataset` and `values`).
 *
 * ⛔ Closed, not `z.string()`. The open form is what let the catalog ship
 * widgets naming types nothing registers: measured on this tree before the
 * change, `DashboardComponentSchema.safeParse` ACCEPTED a widget with
 * `type: 'zzz-not-a-widget-type'` and one with no `type` at all, so a gate
 * built on it would have passed by validating nothing.
 *
 * ⚠️ A member of `DASHBOARD_COMPONENT_WIDGET_TYPES` is a component node, and
 * this schema is NOT the schema for its `type` or its body: `metric-card`'s own props
 * (`value`, `icon`, `trend`, `trendValue` — registry `inputs`, not widget
 * keys) belong to objectui's own component schema — passthrough `BaseSchema`
 * plus those inputs as members (objectui#11467) — which is the schema the
 * ruling names for a component node. Since
 * objectui#6002 made {@link DashboardWidgetSchema} `.strict()`, that routing
 * lives in `DashboardComponentSchema`'s widget slot itself (see
 * {@link DashboardWidgetSlotComponentSchema}); the standing gate
 * (`examples/schema-catalog/test/plugin-dashboard-component-schema.test.ts`)
 * routes each widget to whichever of the two owns it and asserts a component
 * node loses no authored key while a widget refuses undeclared ones.
 */
export const DashboardWidgetTypeSchema = z.enum([
  ...stripImportedDefaults(SpecChartTypeSchema).options,
  ...DASHBOARD_WIDGET_TYPE_EXTENSIONS,
]);

/**
 * objectui#9256 (public-block slice): ONE refusal string for both content channels of the
 * widget-slot `metric-card` node. Its own string rather than `neitherContentChannelGuidance`, because
 * that builder says the parser tier's `not-a-container` warning noticed the key, and in a widget slot
 * it does not: that tier walks `children`, never `widgets`.
 */
const METRIC_CARD_NEITHER_CHANNEL =
  'REFUSED (objectui#9256, ADR-0049) — `metric-card` reads NEITHER content channel: measured with the '
  + 'TypeScript type checker over one program per workspace package on a BUILT tree, no renderer read consumes '
  + '`body` or `children` for this node — `DashboardRenderer` hands a `metric-card` widget to `SchemaRenderer` '
  + 'as the widget\'s own keys, and the registration (`plugin-dashboard:metric-card`) renders `MetricCard`, '
  + 'which reads named props and forwards the rest to its `Card` as DOM attributes — and `SchemaRenderer` '
  + 'strips both out of the props bag it spreads. An '
  + 'authored value therefore rendered NOTHING — no render-time error or warning and no element — and in a '
  + 'widget slot nothing else noticed it: the parser tier\'s `not-a-container` warning (objectui#9910) walks '
  + '`children`, never `widgets`. What it renders instead: one KPI card — `title`, `value`, `icon`, '
  + '`trend` / `trendValue` and `description`.';

/**
 * objectui#4425: the site detail of the widget-slot `metric-card` node's `label` refusal. The lead
 * sentence and the `title` remedy come from `aliasKeyRefusal`, because `label` is a second spelling
 * of a key this node declares, not a withdrawn one. Module-private, like the string above.
 */
const METRIC_CARD_LABEL_IS_TITLE =
  'REFUSED (objectui#4425, the objectui#8284 ruling: one spelling per rendered thing) — `metric-card` '
  + 'spells its heading `title`. The registration (`plugin-dashboard:metric-card`) declares `title`, and '
  + '`MetricCard` draws it as the card heading; nothing on that path reads `label`, which is how the sibling '
  + '`metric` node (`plugin-dashboard:metric`) spells its heading. An authored `label` therefore drew a card '
  + 'with NO heading, and no render-time error or warning; nor did the parser tier\'s `validateTree` notice it, '
  + 'because it does not walk a dashboard\'s `widgets`. Write the heading as `title`: a plain string or an '
  + 'inline per-locale map.';

/**
 * A COMPONENT node sitting directly in a dashboard's widget slot — the
 * `metric-card` extension the 2026-08-14 ruling (objectstack#8593) admits:
 *
 *   > An SDUI dashboard COMPONENT node validates against objectui's OWN
 *   > component schema; [...] `metric-card` joins objectui's own CLOSED
 *   > component enum as an explicitly allowed objectui extension.
 *
 * Its body is `BaseSchema` (passthrough) plus the component's registry
 * `inputs`, declared below: `title` / `value` / `icon` / `trend` /
 * `trendValue` are the component's props, not widget keys, and a `.strict()`
 * {@link DashboardWidgetSchema} must never see them. The `type` override is
 * what makes this arm reachable ONLY for component nodes: for
 * every other widget (any spec family, `list`/`custom`, the legacy
 * `component` envelope with no `type` at all) the required closed enum fails
 * fast and the union falls through to the strict widget schema — so this arm
 * cannot become a passthrough hatch around #6002's refusal. The converse holds
 * since objectui#11483: the widget schema's `type` vocabulary names no
 * component type, so a `metric-card` in the slot is read by this arm ALONE, and
 * a card this arm refuses, one with no `value` among them, has no other reading.
 * Before that, a card carrying only keys both arms accept (`title`,
 * `description`, `layout`, `id`) parsed as a widget, and the required `value`
 * below governed nothing. Deliberately NOT
 * exported: the routing is an internal property of the widget slot, not new
 * authoring surface.
 *
 * `children` and `body` are refused by name (objectui#9256): `MetricCard`
 * reads neither content channel, as its TypeScript twin's `?: never` pair
 * states. ⚠️ A refusal here does not surface on its own: this is the first arm
 * of the slot's `z.union`, so a document it refuses falls through to the
 * strict {@link DashboardWidgetSchema}, which refuses the same key as
 * unrecognized and the `metric-card` type as no widget type (objectui#11483),
 * and the author gets one `invalid_union` at the widget's path
 * with each arm's issues under `errors` — this arm's message among them, which
 * `objectui validate` prints as one arm of two.
 *
 * `label` is refused by name too (objectui#4425), toward `title`: it is the
 * `BaseSchema` member `MetricCard` never reads, and the sibling `metric` node's
 * spelling of the heading this node spells `title`. Same shape as the two
 * channels above — a MEMBER whose `z.never` refuses at the key's own path, with
 * `label?: never` on the TypeScript twin — under the objectui#8284 ruling (one
 * spelling per rendered thing). The message is `aliasKeyRefusal`'s, so it
 * names the remedy in its lead sentence.
 *
 * ## The registered inputs are MEMBERS (objectui#11467)
 *
 * `metric-card`'s registration (`plugin-dashboard:metric-card`) declares six
 * `inputs`, and `MetricCard` reads all six. `description` is the `BaseSchema`
 * member of the same type; the other five are declared here, each with the
 * type of the prop `MetricCard` declares for it (`trend` takes the
 * registration's enum), as on the TypeScript twin. Until objectui#11467 the
 * five were admitted by the catchall and judged by nothing on this face; the
 * strict authoring face admitted their NAMES only, from a side table of the
 * registration's input names (objectui#11022), and judged each value by the
 * same catchall. Declared, both faces judge each value by its member, and
 * `value` — the registration's one `required` input — is required, and since
 * objectui#11483 the slot has no other reading of the card to escape it. The side
 * table went with the repair, because every name it held is now a member.
 * This package depends on no registry, so the members are held to the live
 * registration and to `MetricCardProps` by the registering package's own
 * test, `metricCardRegisteredInputsStrictFace-11022.test.ts` in
 * `@object-ui/plugin-dashboard`'s `__tests__`. Any other key is still kept by
 * the passthrough here and refused by name on the strict face.
 *
 * `type` checks the closed set against its one member, so a second member is
 * a compile error until this arm is split per component: a second component
 * type has its own inputs, and this arm declares `metric-card`'s.
 *
 * `layout` is the one WIDGET key this arm declares (objectui#11070 round 11),
 * and it is the spec's member BY REFERENCE: `@objectstack/spec`'s
 * `DashboardWidgetSchema.shape.layout`, the same member the strict widget arm
 * below carries. It is not a registry input — no registration declares it and
 * `MetricCard` never reads it — it is the slot's position, which the dashboard
 * reads off every entry of `widgets[]`: `DashboardGridLayout` places each entry
 * by it, and its Save Layout (`mergeLayoutIntoSchema`) writes it back onto
 * EVERY entry, a component node included. Left to the passthrough, the strict
 * face closed it out (`unrecognized_keys: ['layout']`), so a dashboard the
 * grid had saved was refused there. Declared, both faces judge it by the
 * spec's shape — four numbers, no other key — so a malformed one is refused
 * on the tolerant face too, as it already was on the widget arm.
 */
const DashboardWidgetSlotComponentSchema = BaseSchema.extend({
  type: z.enum(DASHBOARD_COMPONENT_WIDGET_TYPES satisfies readonly ['metric-card'])
    .describe('objectui component type legal in a widget slot (closed set)'),
  layout: stripImportedDefaults(SpecDashboardWidgetSchema).shape.layout,
  // objectui#11467: `metric-card`'s registered inputs, typed as `MetricCard`'s props.
  title: stripImportedDefaults(I18nLabelSchema).optional().describe('Card heading (plain string or inline locale map)'),
  value: z.union([z.string(), z.number()]).describe('The figure the card shows'),
  icon: z.string().optional().describe('Lucide icon name'),
  trend: z.enum(['up', 'down', 'neutral']).optional().describe('Trend direction, drawn with trendValue'),
  trendValue: z.string().optional().describe('Trend text, drawn with trend'),
  // objectui#4425: the heading is `title`; `label` is refused by name toward it, kept a MEMBER, as on
  // the TypeScript twin.
  label: aliasKeyRefusal('label', 'title', 'this `metric-card` node', METRIC_CARD_LABEL_IS_TITLE),
  // objectui#9256: `MetricCard` reads NEITHER content channel, so both are refused by name, each
  // kept a MEMBER, as on the TypeScript twin.
  body: retirementTombstone(METRIC_CARD_NEITHER_CHANNEL),
  children: retirementTombstone(METRIC_CARD_NEITHER_CHANNEL),
});

/**
 * objectui#12163 (ruling C, comment 6121298298): the rule and the fix the legacy envelope's
 * `component` slot answers every node but a `metric-card` with. ONE string, carried into the
 * parse-time message and the `.describe()` metadata, as in `tombstone.zod.ts`.
 */
const WIDGET_COMPONENT_SLOT_RULE =
  'A dashboard widget\'s legacy `component` envelope takes a `metric-card` node only: it is the one '
  + 'component node the 2026-08-14 slot ruling admits (objectstack#8593), and `@objectstack/spec` '
  + 'declares neither this envelope nor a `custom` widget (objectui#12163). A dashboard widget binds a '
  + 'dataset (ADR-0021): write the widget itself in the spec form, a chart-family `type` with `dataset`, '
  + '`dimensions` and `values`, or put a `metric-card` node, with its `value`, in this slot.';

/** What the refusal calls the authored value, so the issue names the node it refuses. */
const slotNodeLabel = (input: unknown): string => {
  if (typeof input === 'object' && input !== null && !Array.isArray(input)) {
    const type = (input as { type?: unknown }).type;
    return typeof type === 'string' ? `a \`${type}\` node` : 'a node with no `type`';
  }
  if (Array.isArray(input)) return 'a list';
  return input === null ? 'a `null` value' : `a ${typeof input} value`;
};

/**
 * The second arm of the legacy envelope's `component` slot (objectui#12163, ruling C): a refusal
 * BY NAME of every node the routing step does not hand the component arm.
 *
 * ## What it replaces
 *
 * The arm was passthrough `BaseSchema`. The tolerant face admitted any node through it, and the
 * strict face closed it to the ~21 base keys, so a `text` node's `content` (and a `statistic`
 * node's `value`) was refused as an unrecognized key: the strict face told an author to empty a
 * node, which is the objectui#5250 defect. Ruling C keeps the slot at what objectstack#8593
 * admits, `metric-card`, and says so instead: one issue, code `custom`, at the slot's own path,
 * naming the node it refuses and the fix. Both faces, because the faces differ only in unknown
 * keys (objectui#5250 slice A) and this is a slot-membership rule; the TypeScript twin narrows in
 * the same change, so the pair records no divergence.
 *
 * ## Why this primitive, measured on zod 4.6.5
 *
 *  - `z.custom<never>`, as `handlerKeyRefusal` spells a refusal arm: `z.input` is `never`, so
 *    the slot's input type is the component arm's alone, the TypeScript twin's type.
 *  - `abort: false`. A `z.custom` issue aborts by default, and zod's union answers with one arm
 *    only when exactly one failing arm is not aborted. The component arm aborts on any node that
 *    is not a `metric-card` (its closed `type`), so this arm's issue is the slot's whole answer:
 *    no `invalid_union`, and nothing from the component arm (on the strict face that included
 *    the misleading `unrecognized_keys`). With `abort` left on, the slot answered
 *    `invalid_union` with both arms, the shape objectui#11709 measured and declined.
 *  - ⛔ Not a `z.never` arm: its issue aborts too, with the same two-arm answer.
 *
 * The strict walker reports this arm as an opaque `custom` shape and leaves it as it is: it has
 * no keys to close.
 */
const WidgetComponentSlotRefusal = z.custom<never>(() => false, {
  abort: false,
  error: (issue) => `REFUSED (objectui#12163) — ${slotNodeLabel(issue.input)} is not a node this slot takes. ${WIDGET_COMPONENT_SLOT_RULE}`,
}).describe(WIDGET_COMPONENT_SLOT_RULE);

/** The legacy envelope's `component` slot: the two arms, in the TypeScript twin's order. */
type WidgetComponentSlot = z.ZodUnion<readonly [typeof DashboardWidgetSlotComponentSchema, typeof WidgetComponentSlotRefusal]>;

/**
 * objectui#11709: the constructor of the legacy envelope's `component` slot. It is a
 * `z.union` of the same two arms, plus one routing step before the union runs. A node
 * whose `type` the FIRST arm declares is judged by that arm alone. Any other node goes
 * to the union exactly as before.
 *
 * ⚠️ Since objectui#12163 (ruling C) the second arm is {@link WidgetComponentSlotRefusal},
 * which refuses every node by name, so "any other node" is refused, with one issue from
 * that arm. This constructor did not change; the history below is written about the
 * `BaseSchema` arm it routed around.
 *
 * ## Why the slot routes
 *
 * A plain union tries each arm, and the first arm with no issues wins. The second arm
 * was passthrough `BaseSchema`. It admitted a node whatever its `type` said, so every
 * `metric-card` the component arm refuses parsed through it. That was true for
 * `label`, `children` and an out-of-enum `trend`, and for a card with no `value`.
 * The arm's refusals therefore never reached `objectui validate`, while the strict face
 * and `tsc` refused the same document. `body` was refused, but by both arms, so
 * `objectui validate` printed `BaseSchema`'s message beside the arm's.
 *
 * ## Why this shape, measured against the other two
 *
 *  - `z.discriminatedUnion('type', …)` cannot hold the second arm. `BaseSchema`'s `type`
 *    is an open string, which declares no discriminator value, so zod refuses the option
 *    (`Invalid discriminated union option at index "1"`), with or without `unionFallback`.
 *  - A `BaseSchema` arm that refuses `type: 'metric-card'` does refuse the card. But the
 *    union then fails on BOTH arms, and `objectui validate` prints each arm's issues,
 *    so the arm's message arrives beside a second, routing-only message from the fallback.
 *  - Routing gives the card to the arm, so the slot answers with the arm's own issues,
 *    at the arm's own paths. There is no union issue at `component`, and nothing from
 *    `BaseSchema`. That is the shape the same card already has directly in `widgets[]`.
 *
 * The routing reads the arm's own discriminator (its `propValues` for `type`, which is
 * `DASHBOARD_COMPONENT_WIDGET_TYPES`), so it copies none of the arm's rules. A component
 * type the arm later declares is routed with no edit here. This is the same mechanism as
 * zod's `discriminatedUnion` with `unionFallback`. It is spelled here because zod's own
 * version demands a declared value of every arm.
 *
 * ⚠️ The strict face derives this slot by cloning its def through this constructor
 * (`../strict-authoring-face.ts`), so its twin routes the same way over the closed arms.
 */
const WidgetComponentSlotUnion = z.core.$constructor<WidgetComponentSlot>(
  'ZodWidgetComponentSlotUnion',
  (inst, def) => {
    z.ZodUnion.init(inst, def);
    const union = inst._zod.parse;
    const [arm] = def.options;
    inst._zod.parse = (payload, ctx) => {
      const node = payload.value;
      const type = typeof node === 'object' && node !== null ? (node as { type?: unknown }).type : undefined;
      return arm._zod.propValues?.type?.has(type as string) ? arm._zod.run(payload, ctx) : union(payload, ctx);
    };
  },
);

/**
 * Dashboard Widget Schema — DERIVED from `@objectstack/spec/ui`
 * (objectstack#4115): every spec key flows in **by reference** via
 * {@link specFieldsExcept}, so a key the spec adds or retypes cannot silently
 * diverge here.
 *
 * The hand copy this replaces declared 10 of the spec's 22 keys, and because a
 * `z.object()` strips unknown keys, the other 12 were dropped without a word by
 * `objectui validate` — including `chartConfig`, `colorVariant`, `filter`,
 * `responsive`, `aria`, `actionUrl`/`actionType`/`actionIcon`, `compareTo` and
 * the `requiresObject`/`requiresService` capability gates. The TS interface in
 * `complex.ts` declared most of them all along, so a widget could type-check in
 * objectui and still lose half its configuration on validation.
 *
 * Two pinned divergences plus one objectui-only extension:
 *  - `id` relaxed to optional — the spec requires it, but stored objectui
 *    dashboards (and the legacy `component` format below) omit it.
 *  - `type` re-pointed at {@link DashboardWidgetTypeSchema} — the spec's own
 *    enum plus objectui's CLOSED `list` / `custom` extension. It was `z.string()` until
 *    objectui#4600; the widening was real (objectui renders `list` / `custom`)
 *    but it was spent as an unbounded hatch rather than a named set, so every typo and
 *    every retired family validated too. The vocabulary also named the
 *    `metric-card` component type until objectui#11483, which made a card with
 *    no `value` parse here as a widget; see that schema's docblock.
 *  - `component` — the legacy `{ id, component: <SDUI node>, layout }` envelope,
 *    which the spec has no room for. Migration to the shorthand form is deferred.
 *    It holds a `metric-card` node only, and refuses every other node by name
 *    (objectui#12163, ruling C).
 *
 * ## `.strict()` — undeclared keys are REFUSED, not stripped (objectui#6002)
 *
 * Until #6002 this was a plain `z.object()`, and the docstring above records
 * what that meant once already: keys outside the declared set were dropped
 * WITHOUT A WORD. Measured on the #4600 branch, a widget carrying the retired
 * pre-ADR-0021 inline analytics keys (`object` / `categoryField` / `aggregate`)
 * parsed five-keys-in, three-keys-out, verdict ACCEPT — so the contract could
 * never tell an author, a designer, or a publish-time check that the document
 * says something the platform stopped honouring. Maintainer ruling 2026-08-25
 * (objectui#6002, Route 1 two-step): after #6150 declared the genuinely
 * consumed keys, undeclared widget keys refuse loudly — zod's
 * `unrecognized_keys` issue names every offending key. The spec's own
 * tombstones (`actionUrl` / `actionType` / `actionIcon` / `aria` /
 * `responsive`) stay DECLARED `z.never()` members, so they keep their specific
 * removal messages rather than degrading to a generic unknown-key error.
 *
 * ⚠️ This schema owns spec-family widgets only. A component node in the widget
 * slot (`type: 'metric-card'`) is routed to
 * {@link DashboardWidgetSlotComponentSchema} — passthrough `BaseSchema` plus
 * the component's registered inputs — before this schema is consulted: its
 * props are component inputs, not widget keys, and MUST NOT be refused here
 * (2026-08-14 ruling, objectstack#8593). Since objectui#11483 this schema
 * refuses that `type` too, so it is never a second reading of the card.
 *
 * Drift guard: `__tests__/report-chart-query-spec-parity.test.ts`.
 */
export const DashboardWidgetSchema = specFieldsExcept(stripImportedDefaults(SpecDashboardWidgetSchema).shape, [
  'id',
  'type',
] as const).extend({
  id: z.string().optional().describe('Widget ID'),
  type: DashboardWidgetTypeSchema.optional()
    .describe('Widget visualization type — the spec families plus objectui\'s closed `list`/`custom` extension'),
  // objectui#12163 (ruling C, comment 6121298298): the slot takes a `metric-card` node
  // and nothing else, on both faces and on the TypeScript twin
  // (`component?: DashboardWidgetSlotComponentSchema`). It is the one component node
  // the 2026-08-14 slot ruling admits (objectstack#8593); `metric-card` is
  // DELIBERATELY not an arm of `AnyComponentSchema`, which is why this slot never
  // took `SchemaNodeSchema` (objectui#8344). The README's legacy-envelope example
  // writes one with its registered inputs (objectui#11467).
  //
  // objectui#11709: a node whose `type` the component arm declares is judged by that
  // arm ALONE, so each key the arm refuses is refused here too, with the arm's own
  // message (see `WidgetComponentSlotUnion` above). Every other node, a primitive
  // included, is refused by {@link WidgetComponentSlotRefusal}, one `custom` issue at
  // this key naming the node and the fix. Until objectui#12163 that arm was
  // passthrough `BaseSchema`: the tolerant face kept any node, and the strict face
  // refused a `text` node's `content` as an unrecognized key.
  component: new WidgetComponentSlotUnion({
    type: 'union',
    options: [DashboardWidgetSlotComponentSchema, WidgetComponentSlotRefusal],
  }).optional()
    .describe('Widget Component (legacy format)'),
}).strict()
  // ⭐ THE SPEC'S OBJECT-LEVEL CHECKS, re-attached (objectui#7715, ruling B1; objectui#11073).
  //
  // `specFieldsExcept` rebuilds a fresh object from the spec's `.shape`, so it drops
  // every check the spec attached to the OBJECT. The spec attaches three to
  // `DashboardWidgetSchema` and exports each by name, so the one the spec runs is
  // attached here instead of restated. All three are ATTACHABLE: each reads only `type`,
  // `options.stageOrder` / `dimensions` / `values` and `id`, and on this node those are
  // the spec's own fields (`type` adds objectui's closed `list` / `custom` extensions,
  // which the spec's checks judge as the non-funnel, non-metric, undeclared types they
  // are; an absent `type` resolves to the spec's default inside the check, as on the
  // spec). This is objectui#9111's criterion: a non-funnel widget carrying
  // `options.stageOrder` is refused here as the server refuses it.
  // `__tests__/spec-object-refinements-7715.test.ts` re-derives the split from the spec
  // object's own check count.
  //
  // The third, `checkDashboardWidgetChartMeasureArity` (objectui#11334, objectui#11417),
  // chained after the metric-family check as the spec orders them, so a metric-family
  // widget keeps its one issue. Two arms: with no `dimensions`, two or more measures only
  // on a type in `DASHBOARD_WIDGET_MULTI_MEASURE_TYPES`; on `pie` / `donut` / `funnel` /
  // `treemap` / `sankey`, one measure whatever the dimension. A type outside the spec's
  // `ChartTypeSchema` (objectui's `list` / `custom`) is not this check's to judge, by the
  // check's own guard. Pinned on both doors by
  // `__tests__/dashboard-widget-metric-measure-door-8894.test.ts`.
  .superRefine(checkDashboardWidgetStageOrder)
  .superRefine(checkDashboardWidgetMetricMeasureArity)
  .superRefine(checkDashboardWidgetChartMeasureArity);

/**
 * Global Filter Schema — a dashboard-level filter definition: `@objectstack/spec/ui`'s
 * `GlobalFilterSchema` BY REFERENCE, whole (objectui#7759 group A). Every key,
 * every nested shape and the spec's own object-level refinement (the date
 * `defaultValue` vocabulary check) flow in unchanged; `stripImportedDefaults`
 * only removes the imported `scope` default, the same treatment every other
 * spec-derived schema in this package gets.
 *
 * ## The two local overrides this replaced, and why they went
 *
 * Until objectui#7759 this was the spec's `.shape` spread into a local
 * `z.object` with `options` and `optionsFrom` restated, plus a `superRefine`
 * that re-ran the spec schema on the other keys. The restatement disagreed with
 * the spec in both directions, which is why the dashboard pair carried this key
 * in BOTH `KnownDrift` and `WiderThanDeclared`
 * (`__tests__/zod-mirror-parity.test.ts`):
 *  - WIDER — `options` took the bare-string shorthand (`options: ['EMEA']`) and
 *    an option with no `label`; `optionsFrom.labelField` was optional and
 *    `optionsFrom.filter` was `z.any()` (an array parsed green); an unknown key
 *    in a filter was stripped in silence. The spec refuses each of these, so
 *    this validator went green on metadata the platform refuses at publish.
 *  - NARROWER — an option's `label` was `z.string()`, so the spec's inline
 *    per-locale map (`I18nLabel`), which the declaration admits and the filter
 *    bar resolves with `pickLocalized`, was refused here.
 *
 * The spec declares the key, so under that card's ruling (5617465269,
 * principle 1) both faces follow the spec, both ways: the declaration already
 * bound `GlobalFilter` by reference (objectui#4032), and this validator now does
 * too. The runtime followed on the objectstack#7917 option-② schedule
 * (objectui#4356): `@object-ui/core`'s `normalizeFilterOptions` no longer lifts
 * a stored bare-string option — the member yields no option, and a dev-mode
 * warning names it — so the SCHEMA and the READ PATH now refuse the same
 * spelling. The filter bar still falls back to `valueField` when `labelField`
 * is absent.
 *
 * The `{ preset }` `defaultValue` object form is the objectui#4165 instance of
 * the split `options` has now left behind — refused by the schema, still lifted
 * on read by `liftLegacyGlobalFilterDefault` (`../dashboard-filter-alias.ts`,
 * which carries its own retirement window).
 *
 * Drift guard: `__tests__/report-chart-query-spec-parity.test.ts`; pinned by
 * `__tests__/dashboard-header-global-filters-spec-7759.test.ts`.
 */
export const GlobalFilterSchema = stripImportedDefaults(SpecGlobalFilterSchema);

/**
 * Dashboard Schema - Dashboard component
 */
/**
 * Spec-owned Dashboard fields, flowing in **by reference** (objectstack#4115).
 *
 * `BaseSchema` is `.passthrough()` while the spec's `DashboardSchema` is
 * strict, so before this derivation every spec-only key rode through objectui
 * unvalidated — `header`, `refreshIntervalSeconds`, `performance`, `aria`,
 * `protection` and the `_lock*`/`_package*`/`_provenance` package-lock
 * envelope were neither checked nor declared. (That key was spelled
 * `refreshInterval` until @objectstack/spec 17.4.0 renamed it — objectui#7783;
 * the spec now carries a `retiredKey` tombstone under the old spelling, and it
 * flows in here by reference like every other member of this set.)
 *
 * Omitted, each for a stated reason:
 *  - `name`/`label`/`description` — component-envelope keys owned by BaseSchema;
 *  - `widgets` — objectui's element schema is its own ledger entry (the local
 *    widget still carries the legacy `component` envelope the spec has no room
 *    for); migration deferred.
 *  - `globalFilters` — re-added below over the exported {@link GlobalFilterSchema},
 *    which since objectui#7759 IS the spec's element schema by reference, so the
 *    accept set equals the spec member's; the separate const is kept because it
 *    is published API. (It used to be "deliberately looser than spec's" — the
 *    bare-string option shorthand and a relaxed `optionsFrom` — see that const.)
 *
 * `dateRange` was a third member of that list until objectui#10334. Its local
 * element (`defaultRange` a bare `z.string()`, a stripping object) admitted
 * preset names the spec's enum and the TypeScript twin both refuse — the
 * `WiderThanDeclared` row objectui#7759 group F left behind. The spec declares
 * the key, so by that card's rule 1 / proposal F1 both faces now take the
 * spec's AUTHORING shape by reference through this projection: the closed
 * `DATE_RANGE_DEFAULT_RANGES` vocabulary, the spec's strict object with its
 * named alias refusals, and — via `stripImportedDefaults` — no authored
 * default. The read site (`resolveDashboardFilterDefs` in `@object-ui/core`)
 * already implements every arm: each preset, the `custom` sentinel, `field`
 * and `allowCustomRange`.
 *
 * `.partial()` guarantees no *future* spec field can become required and
 * silently invalidate stored objectui dashboards.
 */
export const DASHBOARD_SPEC_EXCLUDED = [
  'name',
  'label',
  'description',
  'widgets',
  'globalFilters',
] as const;

// One list, two readers (objectui#9736): this call and the `DashboardComponentSchema`
// TypeScript twin in `../complex.ts`, which extends `Omit< Dashboard, … >` over the same
// array — so the published validator and the published type project one spec
// surface and cannot drift apart again.
const SpecDashboardFields = specFieldsExcept(stripImportedDefaults(SpecDashboardSchema).shape, DASHBOARD_SPEC_EXCLUDED);

/**
 * Dashboard Schema — the objectui dashboard renderer node, derived from
 * `@objectstack/spec/ui` `DashboardSchema` (see {@link SpecDashboardFields}).
 * The drift guard is `__tests__/page-app-dashboard-spec-parity.test.ts`.
 */
export const DashboardComponentSchema = BaseSchema.extend(SpecDashboardFields.shape).extend({
  type: z.literal('dashboard'),
  columns: z.number().optional().describe('Number of columns'),
  gap: z.number().optional().describe('Grid gap'),
  // Routed slot (objectui#6002): a component node (`metric-card`) is owned by
  // objectui's own component schema per the 2026-08-14 ruling — passthrough
  // BaseSchema plus the component's registered inputs (objectui#11467); every
  // other widget is the `.strict()` spec-derived schema. Component arm first — it matches
  // exclusively on the closed component-type enum, so a spec-family widget
  // can never be captured by it. The other way round, the widget arm's vocabulary names no
  // component type (objectui#11483), so a `metric-card` is read by the component arm alone.
  // That arm's required `value` is the one spelling of what the card draws from.
  // objectui#11073: the strict spec-derived arm is closed where it meets this union, so a
  // widget the component arm refuses by name is not answered by this arm's unknown keys alone
  // (see `closeStrictUnionArms` in `./node-derivation.ts`).
  widgets: z.array(z.union(closeStrictUnionArms([DashboardWidgetSlotComponentSchema, DashboardWidgetSchema] as const)))
    .describe('Dashboard widgets'),
  globalFilters: z.array(GlobalFilterSchema).optional().describe('Dashboard-level filters'),
  body: retirementTombstone(
    'REFUSED (objectui#9256, ADR-0049) — `dashboard` reads NEITHER content channel: measured with the '
    + 'TypeScript type checker across all 24 registering packages, no renderer read consumes `body` or '
    + '`children` for this node, and `SchemaRenderer` strips both out of the props bag it spreads. An '
    + 'authored value therefore rendered NOTHING — no render-time error or warning and no element; only the parser tier\'s `not-a-container` warning (objectui#9910) noticed it. '
    + 'What it renders instead: `columns`, `dateRange`, `description`, `gap`, `globalFilters`, '
    + '`header`, `label`, `name`, `refreshIntervalSeconds`, `type`, `widgets`.',
  ),
  children: retirementTombstone(
    'REFUSED (objectui#9256, ADR-0049) — `dashboard` reads NEITHER content channel: measured with the '
    + 'TypeScript type checker across all 24 registering packages, no renderer read consumes `body` or '
    + '`children` for this node, and `SchemaRenderer` strips both out of the props bag it spreads. An '
    + 'authored value therefore rendered NOTHING — no render-time error or warning and no element; only the parser tier\'s `not-a-container` warning (objectui#9910) noticed it. '
    + 'What it renders instead: `columns`, `dateRange`, `description`, `gap`, `globalFilters`, '
    + '`header`, `label`, `name`, `refreshIntervalSeconds`, `type`, `widgets`.',
  ),
});

/**
 * Dashboard Widget Config Schema (for DashboardConfigPanel)
 */
export const DashboardWidgetConfigSchema = z.object({
  id: z.string().describe('Widget ID'),
  title: z.string().optional().describe('Widget title'),
  description: z.string().optional().describe('Widget description'),
  type: z.enum(DASHBOARD_WIDGET_TYPES).optional().describe('Widget visualization type'),
  object: z.string().optional().describe('Data source object name'),
  filter: z.array(z.any()).optional().describe('Widget filter conditions'),
  categoryField: z.string().optional().describe('Category/x-axis field'),
  valueField: z.string().optional().describe('Value/y-axis field'),
  aggregate: z.string().optional().describe('Aggregation function'),
  chartConfig: z.any().optional().describe('Chart configuration'),
  colorVariant: z.enum(DASHBOARD_COLOR_VARIANTS).optional().describe('Color variant'),
  layout: DashboardWidgetLayoutSchema.optional().describe('Widget grid layout'),
  actionUrl: z.string().optional().describe('Clickable action URL'),
});

/**
 * Dashboard Config Schema — Zod validator for DashboardConfigPanel data model.
 *
 * Validates the unified dashboard configuration used by create/edit workflows.
 *
 * The `aria` member is an ADR-0049 retirement tombstone (`e7957ab87`),
 * following this package's convention (`data-display.zod.ts`
 * `StaticTableColumnSchema`, the set `crud.zod.ts` `confirm` established):
 * `z.never().optional()` REFUSES an authored value at parse time with the key
 * named in the error path, rather than letting it be silently stripped the way
 * an undeclared key would be on this non-`.strict()` object. Loud refusal is
 * the ruled outcome — `aria` was accepted-and-preserved for as long as it was
 * declared, so a plain deletion would have converted a preserved key into a
 * silent drop. The TS twin (`../designer.ts` `DashboardConfig`) no longer
 * declares it at all; both halves are pinned by
 * `__tests__/dashboard-config.test.ts`.
 */
export const DashboardConfigSchema = z.object({
  id: z.string().optional().describe('Dashboard identifier'),
  title: z.string().optional().describe('Dashboard title'),
  description: z.string().optional().describe('Dashboard description'),
  columns: z.number().min(1).max(24).optional().describe('Grid columns (1-24)'),
  gap: z.number().min(0).optional().describe('Grid gap in pixels'),
  refreshIntervalSeconds: z.number().min(0).optional().describe('Auto-refresh interval in seconds'),
  widgets: z.array(DashboardWidgetConfigSchema).optional().describe('Dashboard widgets'),
  globalFilters: z.array(z.any()).optional().describe('Global filter conditions'),
  dateRange: z.object({
    enabled: z.boolean().optional(),
    field: z.string().optional(),
    presets: z.array(z.string()).optional(),
  }).optional().describe('Date range filter'),
  userFilters: z.array(z.object({
    field: z.string(),
    label: z.string().optional(),
    type: z.string().optional(),
  })).optional().describe('User-selectable filters'),
  showHeader: z.boolean().optional().describe('Show dashboard header'),
  showFilters: z.boolean().optional().describe('Show global filter bar'),
  showDateRange: z.boolean().optional().describe('Show date range picker'),
  headerActions: z.array(z.object({
    label: z.string(),
    action: z.string().optional(),
    icon: z.string().optional(),
    variant: z.string().optional(),
  })).optional().describe('Header action buttons'),
  aria: z.never({ error: 'RETIRED (ADR-0049) — `aria` is no longer part of DashboardConfig; delete the key. The `{ label, description }` spellings matched no renderer vocabulary and nothing ever read them.' }).optional().describe('RETIRED (ADR-0049) — the `{ label, description }` spellings matched no renderer vocabulary and no read point ever consumed them; delete the key. For real ARIA use the spec vocabulary (`ariaLabel` / `ariaDescribedBy` / `role`) on a surface that reads it.'),
});

/**
 * Complex Schema Union - All complex component schemas
 */
const ComplexSchemaInferred = z.discriminatedUnion('type', [
  RetiredKanbanNodeSchema,
  CalendarViewSchema,
  FilterBuilderSchema,
  CarouselSchema,
  ChatbotSchema,
  ChatbotEnhancedSchema,
  ChatbotFloatingSchema,
  DashboardComponentSchema,
]);

/**
 * The TYPE of {@link ComplexSchema}, NAMED so declaration emit prints it by
 * reference (objectui#11573): see "Why every category union's TYPE is named"
 * on `AnyComponentSchema` (`index.zod.ts`). It adds no member.
 */
export interface ComplexZodType extends ComplexSchemaInferredType {
  options: ComplexSchemaInferredType['options'];
}
type ComplexSchemaInferredType = typeof ComplexSchemaInferred;

/** The union above, typed by its named {@link ComplexZodType}. */
export const ComplexSchema: ComplexZodType = ComplexSchemaInferred;
