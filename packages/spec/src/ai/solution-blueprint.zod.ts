// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { z } from 'zod';
import { lazySchema } from '../shared/lazy-schema';
import { FieldType, SelectOptionSchema } from '../data/field.zod';
import { checkLiteralDefaultValue } from '../data/default-value-shape';
import { isRuntimeDefaultToken } from '../data/default-value-tokens';
import { FilterConditionSchema } from '../data/filter.zod';
import { SortDirectionEnum, SortItemSchema } from '../shared/enums.zod';
import { VIEW_FILTER_OPERATORS, ViewFilterRuleSchema } from '../ui/view.zod';

/**
 * Solution Blueprint Schema (ADR-0033 §4 — plan-first authoring)
 *
 * The structured-output target an AI agent emits for a *high-level* goal
 * ("build me a project-management system") instead of transcribing a field
 * list. It is a **simplified proposal shape** — deliberately lighter than the
 * full {@link ObjectSchema} / {@link ViewSchema} / {@link DashboardSchema}.
 * The `apply_blueprint` tool expands each entry into a proper metadata body
 * and stages it as a draft (so the per-type Zod schema still validates the
 * real artifact at write time).
 *
 * The blueprint is **never persisted on its own**: the agent presents it for
 * conversational confirmation/edit (cheap), and only on human approval does it
 * batch-draft. This is the safety valve for low-specificity input.
 */

/** Machine-name pattern every object, field and option name in a blueprint must match. */
const SNAKE_CASE = /^[a-z_][a-z0-9_]*$/;

/**
 * The lifecycle category a blueprint option declares: `SelectOption.kind`'s own
 * enum (`open` / `won` / `lost`), taken from that schema's shape and never
 * re-spelled here, so a blueprint can offer no kind the object field's option
 * refuses and miss none it accepts. Both option shapes below wrap it in their
 * own spelling of "optional" (`.optional()` lenient, `.nullable()` strict).
 *
 * A function rather than a constant: the lenient shapes build lazily
 * ({@link lazySchema}), and a module-level read would force
 * `SelectOptionSchema` at import for every consumer of this module.
 */
const optionKindEnum = () => SelectOptionSchema.shape.kind.unwrap();

/**
 * What the object schema refuses about the field a blueprint object's
 * `stageField` names (`refuseStageFieldWithoutKinds`, `data/object.zod.ts`):
 * one sentence both object shapes and both option shapes state, so the two
 * halves of the rule (the pointer and the kinds) read the same on every side.
 */
const STAGE_FIELD_RULE =
  'The object schema refuses the object unless the field `stageField` names is a single-value `select` or `radio` '
  + 'whose inline options EACH declare `kind`: "open" for a step on the way, "won" for the successful end (a deal\'s '
  + 'Closed Won, a task\'s Done, a case\'s Resolved), "lost" for the unsuccessful end (Closed Lost, Cancelled, '
  + 'Unqualified). Naming a multiselect / checkboxes / tags field that carries options is refused too: a record '
  + 'stands at one stage.';

/**
 * One `field op value` comparison in a blueprint predicate.
 *
 * Deliberately FLAT — no nested maps — because a blueprint is emitted through
 * OpenAI *strict* structured output, which rejects the open-ended
 * `additionalProperties` a real {@link FilterConditionSchema} map needs. Both
 * places a blueprint scopes a record set (a dashboard widget, a conditional
 * roll-up) use this shape; the builder compiles it to the real query filter.
 */
export const BlueprintConditionSchema = lazySchema(() => z.object({
  field: z.string().regex(SNAKE_CASE).describe('Field on the target object to filter by (e.g. "stock_quantity", "status")'),
  op: z.enum(['lt', 'lte', 'gt', 'gte', 'eq', 'ne']).describe('Comparison operator'),
  value: z.union([z.number(), z.string(), z.boolean()]).describe('Comparison value — for a select field use its option VALUE, never its label (e.g. "completed", not "已完成")'),
}));
export type BlueprintCondition = z.input<typeof BlueprintConditionSchema>;

/**
 * A roll-up (`summary` field) declared IN the blueprint — the aggregation of
 * CHILD records onto this parent record that `apply_blueprint` materializes as
 * the object field's `summaryOperations`.
 *
 * Why it lives on the blueprint at all: a `summary` field with no aggregation
 * config is runtime-DEAD (the engine's summary index skips it, so it reads
 * null/0 everywhere), and roll-ups are only recomputed when a CHILD row is
 * written — so a roll-up configured AFTER the build's sample data loaded stays
 * empty until someone edits a child. The design phase is where the aggregation
 * is actually known ("已完成任务数 counts only completed tasks"), so it must be
 * expressible here rather than left to a follow-up patch.
 *
 * `conditions` is the strict-structured-output-safe way to write the predicate;
 * `filter` accepts the canonical query map directly for a hand-authored
 * blueprint. Give at most one — `filter` wins when both are present.
 */
export const BlueprintSummaryOperationsSchema = lazySchema(() => z.object({
  object: z.string().regex(SNAKE_CASE)
    .describe('The CHILD object whose records are aggregated (snake_case). It must carry a lookup / master_detail field pointing back at this parent, or the roll-up never computes.'),
  function: z.enum(['count', 'sum', 'avg', 'min', 'max'])
    .describe('Aggregation: "数量 / 个数 / 计数" → count; "合计 / 总额 / 累计" → sum; "平均" → avg'),
  field: z.string().regex(SNAKE_CASE).optional()
    .describe('Numeric field on the CHILD object to aggregate. Ignored for "count" (pass "id" or omit it).'),
  relationshipField: z.string().regex(SNAKE_CASE).optional()
    .describe('The child FK field pointing back at this parent. Auto-detected from the child\'s lookup / master_detail; set it only when the child has more than one reference to this parent.'),
  conditions: z.array(BlueprintConditionSchema).optional()
    .describe('CONDITIONAL roll-up: aggregate only the child rows matching these comparisons (ANDed). REQUIRED whenever the field name carries a qualifier — "已完成任务数 / 已收货金额 / 待处理工单数", any 已X / 未X / <某状态>的 count-or-sum → e.g. [{ field: "status", op: "eq", value: "completed" }]. WITHOUT it the roll-up silently counts EVERY child and reports a plausible-looking WRONG number, which is worse than a visible 0.'),
  filter: FilterConditionSchema.optional()
    .describe('The same predicate as a canonical query filter map (e.g. { status: "completed" }, { status: { $in: ["received", "partial"] } }). Use it when hand-authoring a blueprint; the structured design path uses `conditions` instead. Wins over `conditions` when both are given.'),
}));
export type BlueprintSummaryOperations = z.input<typeof BlueprintSummaryOperationsSchema>;

/** What a blueprint field of one type may say in `defaultValue` (see {@link BLUEPRINT_DEFAULT_VALUE_RULES}). */
type BlueprintDefaultValueRule =
  /** Admitted: `takes` names the value, `fromOptions` marks a default that must be one of the field's own options. */
  | { readonly takes: string; readonly fromOptions?: true }
  /** Refused by name: `because` is the reason the refusal states. */
  | { readonly because: string };

/**
 * Which field types a blueprint field may give a `defaultValue`, and what each
 * one takes (ruling B on cloud#3619). One row per `FieldType` member, so a type
 * added to the field vocabulary does not compile here until someone decides
 * whether a blueprint may default it.
 *
 * Admitted: the types whose default a design can state as ONE literal that the
 * built field stores as written. An admitted value is judged by the field
 * schema's own literal contract (`checkLiteralDefaultValue`, ADR-0104 D1, the
 * check `FieldSchema` runs on the built field's `defaultValue`), so a value
 * legal here is legal on the field the applier writes. Every admitted value is a
 * boolean, a number or a string, which is why the strict mirror can carry the
 * key as one scalar union.
 *
 * Refused, by name, even where `FieldSchema` would take a default:
 *  - `date` / `datetime`: a literal day is frozen when the blueprint is written.
 *    "Today" is the runtime token `NOW()`, an instruction the built field
 *    resolves, not a value; a blueprint default is a literal only.
 *  - the reference and file types: the value is the id of a record or an
 *    uploaded file, and none exists while the blueprint is designed (seed data
 *    is reported, never applied). `current_user` is a runtime token too.
 *  - `multiselect` / `checkboxes` / `tags`: the stored value is an array, and
 *    this key carries one scalar.
 *  - `formula` / `summary` / `autonumber`: computed, so a default is never read
 *    (`summary` is numeric in the value classes, and still refused).
 *  - `password` / `secret`, `signature` / `qrcode`, and the structured JSON
 *    types: no one value is right for every record, or the value is not a
 *    scalar at all.
 */
const BLUEPRINT_DEFAULT_VALUE_RULES: Readonly<Record<FieldType, BlueprintDefaultValueRule>> = {
  boolean: { takes: 'true or false' },
  toggle: { takes: 'true or false' },
  number: { takes: 'a number' },
  currency: { takes: 'a number' },
  percent: { takes: 'a number' },
  rating: { takes: 'a number' },
  slider: { takes: 'a number' },
  progress: { takes: 'a number' },
  text: { takes: 'a string' },
  textarea: { takes: 'a string' },
  email: { takes: 'a string' },
  url: { takes: 'a string' },
  phone: { takes: 'a string' },
  markdown: { takes: 'a string' },
  html: { takes: 'a string' },
  richtext: { takes: 'a string' },
  code: { takes: 'a string' },
  color: { takes: 'a string' },
  time: { takes: 'a time of day, "HH:MM"' },
  select: { takes: 'the `value` of one of the field\'s own `options`, never its label', fromOptions: true },
  radio: { takes: 'the `value` of one of the field\'s own `options`, never its label', fromOptions: true },
  date: { because: 'a literal date is fixed when the blueprint is written, so every record created later would start on that same day' },
  datetime: { because: 'a literal date is fixed when the blueprint is written, so every record created later would start on that same day' },
  lookup: { because: 'its value is the id of a record, and no record exists while the blueprint is designed' },
  master_detail: { because: 'its value is the id of a record, and no record exists while the blueprint is designed' },
  tree: { because: 'its value is the id of a record, and no record exists while the blueprint is designed' },
  user: { because: 'its value is the id of a user record, and no record exists while the blueprint is designed' },
  image: { because: 'its value is the id of an uploaded file, and no file exists while the blueprint is designed' },
  file: { because: 'its value is the id of an uploaded file, and no file exists while the blueprint is designed' },
  avatar: { because: 'its value is the id of an uploaded file, and no file exists while the blueprint is designed' },
  video: { because: 'its value is the id of an uploaded file, and no file exists while the blueprint is designed' },
  audio: { because: 'its value is the id of an uploaded file, and no file exists while the blueprint is designed' },
  multiselect: { because: 'it stores a list of values, and a blueprint default is one value' },
  checkboxes: { because: 'it stores a list of values, and a blueprint default is one value' },
  tags: { because: 'it stores a list of values, and a blueprint default is one value' },
  formula: { because: 'the platform computes its value, so a default is never read' },
  summary: { because: 'the platform computes its value, so a default is never read' },
  autonumber: { because: 'the platform computes its value, so a default is never read' },
  password: { because: 'a default would give every record the same credential' },
  secret: { because: 'a default would give every record the same credential' },
  signature: { because: 'its value is made for each record, so one default for every record is never right' },
  qrcode: { because: 'its value is made for each record, so one default for every record is never right' },
  json: { because: 'its value is structured data, and a blueprint default is one plain value' },
  composite: { because: 'its value is structured data, and a blueprint default is one plain value' },
  repeater: { because: 'its value is structured data, and a blueprint default is one plain value' },
  record: { because: 'its value is structured data, and a blueprint default is one plain value' },
  location: { because: 'its value is structured data, and a blueprint default is one plain value' },
  address: { because: 'its value is structured data, and a blueprint default is one plain value' },
  vector: { because: 'its value is structured data, and a blueprint default is one plain value' },
};

/**
 * The admitted types and what each takes, as one sentence: the rows of
 * {@link BLUEPRINT_DEFAULT_VALUE_RULES} that admit a default, grouped by the
 * value they take, in table order. Read by both describes and by the refusal.
 */
const BLUEPRINT_DEFAULT_VALUE_ADMITTED = (() => {
  const groups = new Map<string, string[]>();
  for (const [type, rule] of Object.entries(BLUEPRINT_DEFAULT_VALUE_RULES) as Array<[string, BlueprintDefaultValueRule]>) {
    if (!('takes' in rule)) continue;
    groups.set(rule.takes, [...(groups.get(rule.takes) ?? []), type]);
  }
  return [...groups].map(([takes, types]) => `${types.map((t) => `"${t}"`).join(' / ')} → ${takes}`).join('; ');
})();

/** Which types take a default and what each takes, read by both describes. */
const DEFAULT_VALUE_TYPE_RULE = `It must fit \`type\`, and only these types take one: ${BLUEPRINT_DEFAULT_VALUE_ADMITTED}. `
  + 'Every other type is refused by name: a date is fixed at design time, a reference or file names no record yet, a '
  + 'multi-value field stores a list, a formula / summary / autonumber is computed, and a credential, signature or '
  + 'structured value has no one value right for every record.';

/**
 * The boolean-flag rule both describes state (cloud#972 guidance, ruling B on
 * cloud#3619), with each side's spelling of an unset `required`.
 */
const booleanFlagRule = (unsetRequired: string) =>
  'A yes/no flag (是否完成 / 已付款 / is_active) is a "boolean" field that is never `required` '
  + `(${unsetRequired}) and carries defaultValue false: a required flag refuses the unchecked switch, and a flag with no `
  + 'default is empty, not false, on every record created without it, so a filter on false misses those records.';

/**
 * The refusal of a `defaultValue` that does not fit the field (ruling B on
 * cloud#3619): a type that takes none, a runtime token, a select / radio that
 * declares no options, or a value outside the type's literal contract. Each
 * issue lands on the field's `defaultValue` and names the field and its type.
 *
 * It runs on every parse (`when: () => true`): the key's own scalar union
 * aborts on an array or object, and a refusal that named nothing would leave a
 * `multiselect` default refused without saying why. Every read below is
 * guarded for that reason, and a `type` outside `FieldType` is left to that
 * key's own issue.
 */
function refuseUnfitDefaultValue(field: unknown, ctx: z.RefinementCtx): void {
  if (typeof field !== 'object' || field === null) return;
  const { name, type, options, defaultValue } = field as Record<string, unknown>;
  // Absence. The strict mirror's null is stripped before this schema reads it,
  // and a lenient null is refused by the key's own union.
  if (defaultValue === undefined || defaultValue === null) return;
  if (typeof type !== 'string' || !Object.prototype.hasOwnProperty.call(BLUEPRINT_DEFAULT_VALUE_RULES, type)) return;
  const rule = BLUEPRINT_DEFAULT_VALUE_RULES[type as FieldType];
  const subject = `Field "${typeof name === 'string' ? name : '<unnamed>'}" (${type})`;
  const shown = JSON.stringify(defaultValue) ?? String(defaultValue);
  const refuse = (message: string) => ctx.addIssue({ code: 'custom', path: ['defaultValue'], message });

  if (!('takes' in rule)) {
    refuse(`${subject}: a "${type}" field takes no defaultValue in a blueprint, because ${rule.because}. The types that `
      + `take one: ${BLUEPRINT_DEFAULT_VALUE_ADMITTED}. Remove defaultValue from this field.`);
    return;
  }
  if (isRuntimeDefaultToken(defaultValue)) {
    refuse(`${subject}: the defaultValue ${shown} is a runtime token, resolved when a record is created rather than `
      + `stored, and a blueprint default is a literal value the built field stores as written. A "${type}" field's `
      + `default is ${rule.takes}; write one, or remove defaultValue.`);
    return;
  }
  const declared = Array.isArray(options) ? options as Array<{ value: string }> : undefined;
  if (rule.fromOptions && !declared?.length) {
    refuse(`${subject}: the defaultValue ${shown} must be the \`value\` of one of the field's own \`options\`, and the `
      + 'field declares none. Declare the options, or remove defaultValue.');
    return;
  }
  const verdict = checkLiteralDefaultValue({ type, options: declared }, defaultValue);
  if (!verdict.ok) {
    refuse(`${subject}: the defaultValue ${shown} does not fit the field's type (${verdict.detail ?? 'invalid value'}). `
      + `A "${type}" field's default is ${rule.takes}, stored as written on every record created without one; write `
      + 'one, or remove defaultValue.');
  }
}

/**
 * A proposed field on a blueprint object. `reference` carries the target
 * object for `lookup` / `master_detail` types — relationships are expressed
 * inline as reference fields rather than in a separate block.
 */
export const BlueprintFieldSchema = lazySchema(() => z.object({
  name: z.string().regex(SNAKE_CASE).describe('Field machine name (snake_case)'),
  label: z.string().optional().describe('Human-readable field label'),
  type: FieldType.describe('Field data type'),
  required: z.boolean().optional().describe('Whether the field is required'),
  reference: z.string().regex(SNAKE_CASE).optional()
    .describe('Target object name for lookup / master_detail relationship fields'),
  options: z.array(z.object({
    label: z.string(),
    value: z.string().regex(SNAKE_CASE),
    kind: optionKindEnum().optional()
      .describe(`The option's lifecycle category, REQUIRED on EVERY option of the field the object's \`stageField\` names. ${STAGE_FIELD_RULE} Only a single-value \`select\` / \`radio\` field's options take it: omit it on a multiselect / checkboxes / tags field's options, where the field schema refuses it. Absent on any other select option reads as "open".`),
  })).optional().describe('Choices for select / multiselect / radio fields'),
  summaryOperations: BlueprintSummaryOperationsSchema.optional()
    .describe('REQUIRED when `type` is "summary" (a roll-up of child records: 任务总数 / 报名人数 / 合计金额 / 已完成任务数). Names the child object, the aggregation, and — for a qualified count/sum — the condition. A "summary" field without it materializes runtime-dead.'),
  expression: z.string().optional()
    .describe('REQUIRED when `type` is "formula" — the CEL body the field computes, e.g. "record.quantity * record.unit_price", or "record.order_no + \' · \' + record.customer.name" for a composed title. A formula reads a lookup / master_detail field\'s related record ONE hop through it — `record.<lookup>.<field>`, as `record.customer.name` above; the bare `record.customer` is the stored id, and a second hop (`record.customer.owner.name`) is refused at build. A "formula" field without it materializes runtime-dead: the engine builds its formula plan only from fields that HAVE an expression, so the field reads null everywhere, forever. Same failure shape as a "summary" with no `summaryOperations`. Note `nameField` on the object recommends a formula for numbered entities (invoice/ticket) — that formula needs THIS key, or the record title is blank on every card, lookup chip and breadcrumb.'),
  // Ruling B on cloud#3619. The scalar union is the value space every admitted
  // type draws from; whether THIS field takes a default, and which value, is a
  // rule across `type` / `options` and this key, so it is the refinement below.
  defaultValue: z.union([z.boolean(), z.number(), z.string()]).optional()
    .describe(`The built field's default: the value a new record gets when it is created without one, carried into the object field as its \`defaultValue\` and stored as written. ${DEFAULT_VALUE_TYPE_RULE} ${booleanFlagRule('omit `required` or set it false')} Omit it for a field with no default.`),
}).superRefine(refuseUnfitDefaultValue, { when: () => true }));
export type BlueprintField = z.input<typeof BlueprintFieldSchema>;

/** A proposed business object (table) with its fields. */
export const BlueprintObjectSchema = lazySchema(() => z.object({
  name: z.string().regex(SNAKE_CASE).describe('Object machine name (snake_case)'),
  label: z.string().optional().describe('Human-readable singular label'),
  description: z.string().optional().describe('What this object represents'),
  fields: z.array(BlueprintFieldSchema).describe('Fields to create on the object'),
  sharingModel: z.enum(['private', 'public_read', 'public_read_write', 'controlled_by_parent']).optional()
    .describe('Org-Wide Default record visibility (OWD) for INTERNAL users — the deliberate sharing choice for this object (ADR-0090). Canonical four only: private (owner-only) | public_read (everyone reads, owner writes) | public_read_write (everyone reads+writes) | controlled_by_parent (derived from the master record — ONLY for an object whose fields include a master_detail reference). SET it when the user\'s description implies a visibility intent — personal/private data (HR, 绩效, salary, 个人隐私) → "private"; shared reference data everyone edits → "public_read_write". Omit to accept the platform\'s deterministic default (business object → public_read_write; master-detail child → controlled_by_parent) — omitting on privacy-sensitive data silently over-shares it.'),
  nameField: z.string().regex(SNAKE_CASE).optional()
    .describe('The record title field — which field holds the human-readable name shown on cards, lookup chips, breadcrumbs and search (ADR-0079). Set it to the object\'s text label field (e.g. "product_name"). For a numbered entity (invoice/ticket), set it to a formula field that composes number + name (e.g. a formula "record.order_no + \' · \' + record.customer.name" — a lookup\'s name is read one hop through it, `record.<lookup>.<name field>`). A formula title is computed on read and stored nowhere: it is shown everywhere, but a list cannot sort by it and search does not scan it. Omitting it lets the platform auto-pick a text field, but declaring it is strongly preferred.'),
  // `ObjectSchema.stageField` (ADR-0085), and the ONLY trigger of the object
  // schema's mandatory-kind rule: without this key the option `kind` above is
  // never required of an AI-built object. The string arm only — the object
  // schema's `false` ("no linear lifecycle") has no blueprint spelling.
  stageField: z.string().regex(SNAKE_CASE).optional()
    .describe(`The lifecycle stage field (ADR-0085) — which \`select\` (or \`radio\`) field of THIS object holds the ordered steps a record moves through (a deal's stage, a ticket's status), drawn as the record path. snake_case, naming one of this object's own fields. ${STAGE_FIELD_RULE} SET it whenever the object has such a status/stage field, and give every one of that field's options its \`kind\`. Omitting it leaves stage detection to a guess from field names (status / stage / state / phase).`),
}));
export type BlueprintObject = z.input<typeof BlueprintObjectSchema>;

/**
 * How a blueprint dashboard widget aggregates its records (ruling A on
 * cloud#3607 row 2). Before this key the widget could only name its `measure`
 * and the reader picked the aggregation from the field type, so a widget meant
 * to AVERAGE a plain number field summed it (a 「平均面试评分」 card showed the
 * total of 12 scores, 908) and nothing on this shape could say otherwise.
 * Declared once and spelled by both the lenient widget and its strict mirror.
 */
const BLUEPRINT_WIDGET_AGGREGATES = ['sum', 'avg', 'min', 'max', 'count'] as const;

/** What each {@link BLUEPRINT_WIDGET_AGGREGATES} value means — one sentence, read on both sides. */
const WIDGET_AGGREGATE_MEANING = '"sum" = the total of the `measure` field; "avg" = its average; "min" / "max" = its smallest / largest value; "count" = the number of records the widget covers (after its `condition`). "sum", "avg", "min" and "max" need `measure` to name a numeric field of the widget\'s object. "count" needs no `measure` field: it counts records, and a field named in `measure` beside it is not read. Say what the widget computes: an average → "avg", a total → "sum", a highest / lowest value → "max" / "min", a number of records → "count".';

/** The widget `measure` rule, read on both sides: it names a field, never an aggregation. */
const WIDGET_MEASURE_RULE = 'Name the FIELD, not "total_amount" or "avg_score": how it is aggregated is what `aggregate` says, never this key. A "total revenue" widget sets measure:"amount" with aggregate:"sum"; an "average interview score" widget sets measure:"score" with aggregate:"avg"; a "number of deals" widget sets aggregate:"count" and needs no measure. measure:"count" is the legacy spelling of a record count: write aggregate:"count" instead. Beside "sum", "avg", "min" or "max", measure:"count" names no field to aggregate, so that widget is incomplete: a reader must refuse it, never sum, average or rank a record count.';

/**
 * The blueprint view's calendar date key (ruling B on cloud#3607): which date
 * field a `calendar` view schedules on, the value the built view carries as
 * `calendar.startDateField`. Read for `type: "calendar"` only and IGNORED on
 * every other view type, not refused: the strict mirror the design model
 * generates against is per-leaf and cannot state a cross-key rule, so a
 * refusal on the lenient side alone would make a proposal legal to generate
 * and illegal to apply (the cloud#1967 failure mode documented below), and
 * `groupBy` already sets the precedent of a kind-scoped key that other kinds
 * ignore.
 */
const VIEW_START_DATE_FIELD_RULE = 'For type:"calendar" only: the date or datetime field of THIS view\'s object that places each record on the calendar (e.g. "interview_date", "due_date"), carried into the built view as `calendar.startDateField`. snake_case, naming one of the object\'s own fields. SET it on every calendar view; without it the builder binds a date field of its own choosing, which may not be the one meant. Ignored on the other view types (a gantt view takes its dates from `columns`, start before end).';

/**
 * A proposed list/form/kanban/calendar/gallery/gantt view over an object.
 *
 * `filters` and `sort` are what let a view keep the promise its name makes
 * (ruling A on cloud#2932). Without them a plan could say 「overdue only」 in a
 * view's name and nowhere else: the applier shipped an unfiltered grid under
 * that name, and build verification passed it, because nothing on this shape
 * could carry the condition (cloud#2922 — 12 rows shown where the plan
 * promised 3). Neither key invents a format: `filters` IS
 * {@link ViewFilterRuleSchema}, the rule `ListView.filter` declares, and `sort`
 * is the shared {@link SortItemSchema} whose `{ field, order }` keys and
 * `asc` / `desc` vocabulary the `ListView.sort` entry declares (that entry is an
 * inline shape, not an export). The strict mirror below carries both keys in
 * the model-facing shape; the key-parity tests fail if either side drops one.
 */
export const BlueprintViewSchema = lazySchema(() => z.object({
  object: z.string().regex(SNAKE_CASE).describe('Object this view displays (snake_case)'),
  name: z.string().regex(SNAKE_CASE).describe('View machine name (snake_case)'),
  label: z.string().optional().describe('Human-readable view label'),
  type: z.enum(['list', 'form', 'kanban', 'calendar', 'gallery', 'gantt']).default('list')
    .describe('View kind. Pick the surface that fits the data: "gallery" for a visual card/cover browse when the user asks for a 画廊/相册/卡片墙/封面/海报/图集 (a gallery / card wall / cover / poster grid) or the object has an image/avatar/file field worth showing as a card cover; "gantt" for a 甘特图/时间线/排期 (timeline / schedule) when the object has BOTH a start and an end date field; "kanban" for a board grouped by a status/select field; "calendar" for a single-date schedule; "form" for a record editor; else "list".'),
  columns: z.array(z.string().regex(SNAKE_CASE)).optional()
    .describe('Field names shown as columns (in order). For a gallery, INCLUDE the image/avatar/file field (it becomes the card cover); for a gantt, INCLUDE the start date column before the end date column.'),
  groupBy: z.string().regex(SNAKE_CASE).optional()
    .describe('REQUIRED for kanban views: the select/status field whose options become the board columns (e.g. "stage", "status"). Without it a kanban renders as a plain list. Optional for gantt (groups leaf tasks into summary rows).'),
  // [#28020] Flat rules only: the any-of group element `ListView.filter` takes
  // (`ViewFilterElementSchema`) is deliberately NOT admitted here. The design
  // model writes this key through the strict mirror below, which cannot carry a
  // union, and the applier that turns it into a built view lives outside this
  // repository; widening the lenient side alone would accept a shape no producer
  // emits and no reader here was measured on.
  filters: z.array(ViewFilterRuleSchema).optional()
    .describe('Which records this view shows: the list-view filter rules [{ field, operator, value }] the built view carries, ANDed. REQUIRED whenever the view\'s name or label states a condition — an 「overdue / 逾期」, 「my open / 我的未完成」, 「待审批」 or 「本月」 view MUST carry the rules that make its name true, e.g. overdue → [{ field: "due_date", operator: "less_than", value: "{today}" }, { field: "status", operator: "not_equals", value: "completed" }]; my open → [{ field: "owner", operator: "equals", value: "{current_user_id}" }, { field: "status", operator: "equals", value: "open" }]. WITHOUT it the view shows EVERY record under a name that promises a subset. For a select field compare its option VALUE, never its label. Omit for a view that genuinely spans every record.'),
  sort: z.array(SortItemSchema).optional()
    .describe('Default record order: [{ field, order }] with order "asc" or "desc"; the first entry sorts first (e.g. an overdue list → [{ field: "due_date", order: "asc" }]). Omit for the platform default order.'),
  startDateField: z.string().regex(SNAKE_CASE).optional()
    .describe(VIEW_START_DATE_FIELD_RULE),
}));
export type BlueprintView = z.input<typeof BlueprintViewSchema>;
/** Post-parse shape of {@link BlueprintView} — defaults applied, transforms run (ADR-0122). */
export type BlueprintViewParsed = z.infer<typeof BlueprintViewSchema>;

/**
 * A single comparison that scopes WHICH records a dashboard widget
 * counts/aggregates — kept deliberately simple (one field op value) so the
 * builder can compile it to a widget `runtimeFilter`, and the model can emit it
 * reliably, instead of leaving a "low stock" / "overdue" card counting every row.
 *
 * Alias of {@link BlueprintConditionSchema} (the same `{field, op, value}` shape
 * a conditional roll-up uses); kept as its own export/type for the widget call
 * sites that name it.
 */
export const BlueprintWidgetConditionSchema = BlueprintConditionSchema;
export type BlueprintWidgetCondition = z.input<typeof BlueprintWidgetConditionSchema>;

/** A proposed dashboard with a few widgets (kept intentionally light). */
export const BlueprintDashboardSchema = lazySchema(() => z.object({
  name: z.string().regex(SNAKE_CASE).describe('Dashboard machine name (snake_case)'),
  label: z.string().optional().describe('Human-readable dashboard label'),
  widgets: z.array(z.object({
    id: z.string().regex(SNAKE_CASE).describe('Widget id (snake_case)'),
    title: z.string().optional().describe('Widget title'),
    object: z.string().regex(SNAKE_CASE).optional().describe('Source object for the widget'),
    chart: z.enum(['metric', 'bar', 'line', 'pie', 'table']).optional().describe('Widget visualization'),
    measure: z.string().regex(SNAKE_CASE).optional()
      .describe(`The field this widget aggregates (e.g. "amount", "score"), or "count" to count records. ${WIDGET_MEASURE_RULE} Omit for a count widget.`),
    aggregate: z.enum(BLUEPRINT_WIDGET_AGGREGATES).optional()
      .describe(`How the widget aggregates its records: ${WIDGET_AGGREGATE_MEANING} SET it on every widget that aggregates; omitted, the reader falls back to a default of its own, which may not be the average or extreme a widget means.`),
    groupBy: z.string().regex(SNAKE_CASE).optional()
      .describe('The field to break the widget down by — the category or time axis (e.g. "stage", "created_at"). A "by status" chart MUST set this to the status field; the title and this field MUST name the SAME field. Omit for a single-number metric.'),
    condition: BlueprintWidgetConditionSchema.optional()
      .describe('Restrict WHICH records the widget counts/aggregates when its title implies a threshold or status (e.g. "stock below 10" → {field:"stock_quantity", op:"lt", value:10}; "open tickets" → {field:"status", op:"eq", value:"open"}). Without it the widget covers ALL records — so a "低于10的备件预警" / "overdue" card would wrongly count everything. Omit when the widget genuinely spans every record.'),
  })).optional().describe('Widgets to place on the dashboard'),
}));
export type BlueprintDashboard = z.input<typeof BlueprintDashboardSchema>;

/**
 * A proposed navigation item in the blueprint app — points at one of the
 * created objects or dashboards. `apply_blueprint` expands it into the full
 * `AppSchema` nav item (object → list view, dashboard → dashboard view).
 *
 * `viewName` is what makes "list AND board for the same table" expressible
 * (cloud#2150). Without it this shape could only say WHICH OBJECT an entry
 * opens, so a model that had just designed a kanban and wanted it in the menu
 * had exactly one move left: emit a SECOND entry at the same `target`, with the
 * intent carried only by `label`/`icon`. Both entries then opened the object's
 * default view, and the cloud applier derived both ids from the target, so they
 * collided — the user clicked 「工单看板」 and got the list, with no error
 * anywhere (the target object really does exist, so the lint had nothing to
 * say). The runtime could always express this: `ObjectNavItemSchema.viewName`
 * is "Default list view to open". Only the blueprint could not, which is why
 * the model's behaviour was reasonable and the schema was the defect.
 *
 * Deliberately NOT `.regex(SNAKE_CASE)`, unlike `target`. A view is identified
 * downstream in two interchangeable spellings — the bare key a blueprint's
 * `views[].name` carries (`ticket_status_board`) and the qualified
 * `<object>.<key>` a staged view record's `name` carries — and the applier
 * normalizes between them. Constraining this leaf to snake_case would make the
 * qualified spelling legal to GENERATE (a strict mirror is per-leaf) and
 * illegal to APPLY, which is the cloud#1967 failure mode: a blueprint the user
 * already approved, refused wholesale at apply time.
 */
export const BlueprintNavItemSchema = lazySchema(() => z.object({
  type: z.enum(['object', 'dashboard']).default('object').describe('What this nav entry opens'),
  target: z.string().regex(SNAKE_CASE).describe('Object or dashboard machine name to surface (snake_case)'),
  label: z.string().optional().describe('Nav entry label. Optional: absent ⇒ the entry inherits the CURRENT label of what it opens at render time (a renamed target shows its new name); present ⇒ rendered verbatim, so never copy the target\'s label in as a default.'),
  icon: z.string().optional().describe('Lucide icon name for the nav entry'),
  viewName: z.string().optional()
    .describe('For type:"object" only — the `views[].name` this entry opens (e.g. "ticket_status_board"). Omit for the object\'s default list. SET it whenever this blueprint authors a kanban/calendar/gallery/gantt view the menu should reach: give the object ONE entry per view (a 「工单列表」 entry with no viewName plus a 「工单看板」 entry with viewName:"ticket_status_board"). Without it every entry on the same target opens the SAME default list, and a label/icon saying otherwise is decoration.'),
}));
export type BlueprintNavItem = z.input<typeof BlueprintNavItemSchema>;
/** Post-parse shape of {@link BlueprintNavItem} — defaults applied, transforms run (ADR-0122). */
export type BlueprintNavItemParsed = z.infer<typeof BlueprintNavItemSchema>;

/**
 * The navigation shell (the thing end users open in the App Launcher) that
 * surfaces the solution. When `nav` is omitted, `apply_blueprint` auto-builds
 * one nav entry per created object (then per dashboard).
 */
export const BlueprintAppSchema = lazySchema(() => z.object({
  name: z.string().regex(SNAKE_CASE).describe('App machine name (snake_case)'),
  label: z.string().optional().describe('App display label'),
  icon: z.string().optional().describe('Lucide icon for the App Launcher'),
  nav: z.array(BlueprintNavItemSchema).optional()
    .describe('Navigation entries; omit to auto-surface every created object and dashboard'),
}));
export type BlueprintApp = z.input<typeof BlueprintAppSchema>;
/** Post-parse shape of {@link BlueprintApp} — defaults applied, transforms run (ADR-0122). */
export type BlueprintAppParsed = z.infer<typeof BlueprintAppSchema>;

/**
 * Seed data the agent suggests. Mirrors {@link SeedSchema.records}. NOTE:
 * Phase C does NOT auto-apply seed data — there is no runtime-draftable
 * `dataset` metadata type (seed = code-loaded `*.seed.ts`). `apply_blueprint`
 * reports it as "proposed, not applied" so a human can wire it deliberately.
 */
export const BlueprintSeedSchema = lazySchema(() => z.object({
  object: z.string().regex(SNAKE_CASE).describe('Target object name (snake_case)'),
  records: z.array(z.record(z.string(), z.unknown())).describe('Rows to seed'),
}));
export type BlueprintSeed = z.input<typeof BlueprintSeedSchema>;

/**
 * The full plan-first blueprint. `assumptions` state the design choices the
 * agent made from an underspecified goal; `questions` (≤2) are the only
 * structure-deciding clarifications it should ask before proposing.
 */
export const SolutionBlueprintSchema = lazySchema(() => z.object({
  // OPTIONAL on purpose. The design step (SolutionBlueprintStrictSchema) always
  // produces it, but this lenient schema is also what `apply_blueprint` parses
  // the model's re-emitted blueprint against — and a purely descriptive
  // one-liner must never sink a structurally complete build. It did: a
  // hand-authored blueprint that omitted it was rejected with
  // `path: "summary"`, which the model read as "the summary FIELDS are
  // invalid" and "fixed" by DELETING the roll-up fields (cloud#970).
  summary: z.string().optional().describe('One-line description of the proposed solution'),
  assumptions: z.array(z.string()).default([])
    .describe('Design assumptions made from the underspecified goal'),
  questions: z.array(z.string()).max(2).optional()
    .describe('At most 1-2 structure-deciding questions to confirm before building'),
  objects: z.array(BlueprintObjectSchema).describe('Objects (tables) to create'),
  views: z.array(BlueprintViewSchema).optional().describe('Views to create'),
  dashboards: z.array(BlueprintDashboardSchema).optional().describe('Dashboards to create'),
  app: BlueprintAppSchema.optional()
    .describe('The navigation shell (app) that surfaces the created objects/dashboards to end users'),
  seedData: z.array(BlueprintSeedSchema).optional()
    .describe('Suggested seed data (reported, not auto-applied in Phase C)'),
}));
export type SolutionBlueprint = z.input<typeof SolutionBlueprintSchema>;
/** Post-parse shape of {@link SolutionBlueprint} — defaults applied, transforms run (ADR-0122). */
export type SolutionBlueprintParsed = z.infer<typeof SolutionBlueprintSchema>;

/**
 * Factory mirroring `defineAgent` / `defineTool` / `defineSkill`: validates a
 * blueprint literal at authoring time and returns the parsed value.
 */
export function defineSolutionBlueprint(config: z.input<typeof SolutionBlueprintSchema>): SolutionBlueprintParsed {
  return SolutionBlueprintSchema.parse(config);
}

// ---------------------------------------------------------------------------
// Strict structured-output mirror (OpenAI / Vercel AI Gateway)
//
// OpenAI's *strict* structured outputs (what `generateObject` uses through the
// gateway) require that EVERY property is listed in `required` and reject
// open-ended `additionalProperties` (i.e. `z.record`). The authoring schema
// above is deliberately lenient (optional fields, a free-form `seedData`
// record), which OpenAI rejects with:
//   "'required' … must include every key in properties. Missing 'label'."
//
// This mirror expresses the SAME shape in a strict-compatible way — every key
// present, "optional" → `.nullable()`, and the un-representable `seedData`
// record dropped (Phase C only *reports* seed data; it never applies it, and
// the agent can still describe it in prose). It is used ONLY as the
// `generateObject` output contract. The model emits `null` for empty fields;
// the blueprint tools strip those nulls so the lenient {@link
// SolutionBlueprintSchema} (and every existing consumer/test) is unchanged.
// ---------------------------------------------------------------------------

// Identifier leaves in this mirror carry the SAME `SNAKE_CASE` constraint the
// lenient schema above enforces (cloud#1967). They had drifted: the mirror is
// what the model may GENERATE, the lenient schema is what `apply_blueprint`
// VALIDATES, so an identifier legal here and illegal there produced a proposal
// the applier rejected wholesale — `1_49` from a 「1-49人」 label, staging
// nothing on the turn the user clicked 「确认，开始搭建」. Declaring the constraint
// on the generating side makes that value impossible to propose rather than
// impossible to apply. The `strict mirror ↔ lenient schema — VALUE parity` test
// walks both schemas leaf by leaf and fails on any future divergence.
const strictIdent = (description: string) => z.string().regex(SNAKE_CASE).describe(description);
/** The same identifier, `.nullable()` — this mirror's spelling of "optional". */
const strictIdentOrNull = (description: string) =>
  z.string().regex(SNAKE_CASE).nullable().describe(description);

// The roll-up config, strict-shaped: every key present, "optional" → nullable,
// and the predicate as a flat `conditions` ARRAY because strict mode cannot
// express the canonical `filter` map (open-ended additionalProperties). The
// blueprint tools compile `conditions` back into a real query filter.
const StrictSummaryOperations = z.object({
  object: strictIdent('The CHILD object whose records are aggregated (snake_case). It MUST have a lookup/master_detail field pointing back at this parent.'),
  function: z.enum(['count', 'sum', 'avg', 'min', 'max']).describe('Aggregation: "数量/个数/计数" → count; "合计/总额/累计" → sum; "平均" → avg'),
  field: strictIdentOrNull('Numeric field on the CHILD to aggregate; null (or "id") for count'),
  relationshipField: strictIdentOrNull('Child FK field back to this parent, or null to auto-detect'),
  conditions: z.array(z.object({
    field: strictIdent('Field on the CHILD object'),
    op: z.enum(['lt', 'lte', 'gt', 'gte', 'eq', 'ne']).describe('Comparison operator'),
    value: z.union([z.number(), z.string(), z.boolean()]).describe('Comparison value — a select field\'s option VALUE, never its label'),
  })).nullable()
    .describe('CONDITIONAL roll-up: aggregate only child rows matching these (ANDed), or null to aggregate every child. REQUIRED whenever the field name carries a qualifier ("已完成任务数 / 已收货金额 / 待处理工单数", any 已X / 未X / <某状态>的 count-or-sum) — e.g. [{field:"status",op:"eq",value:"completed"}]. Without it the roll-up counts EVERYTHING and reports a plausible WRONG number.'),
});

const StrictField = z.object({
  name: strictIdent('Field machine name (snake_case)'),
  label: z.string().nullable().describe('Human-readable field label, or null'),
  type: FieldType.describe('Field data type'),
  required: z.boolean().nullable().describe('Whether the field is required, or null'),
  reference: strictIdentOrNull('Target object for lookup/master_detail, or null'),
  options: z.array(z.object({
    label: z.string().describe('What the user reads on the dropdown — free text in the user\'s own language (「1-49人」, 「已完成」).'),
    value: strictIdent('The STORED machine value: snake_case, and it may NEVER start with a digit — give it a word prefix instead (「1-49人」 → "size_1_49", 「2024年」 → "year_2024"). The label carries the human wording; this key only has to be a legal identifier.'),
    // ⛔ Must stay in lockstep with the lenient `BlueprintFieldSchema.options[].kind`.
    // THIS describe is the one the design model reads, and strict mode makes
    // the key required, so the model decides on every option. The option
    // key-parity pin fails if either side drops it.
    kind: optionKindEnum().nullable()
      .describe(`The option's lifecycle category, or null. REQUIRED (never null) on EVERY option of the field the object's \`stageField\` names. ${STAGE_FIELD_RULE} Only a single-value \`select\` / \`radio\` field's options take it: null on a multiselect / checkboxes / tags field's options, where the field schema refuses it. Null on any other select option reads as "open".`),
  })).nullable()
    .describe('Choices for select-family fields, or null'),
  summaryOperations: StrictSummaryOperations.nullable()
    .describe('REQUIRED when type is "summary" (a roll-up of child records onto this parent: 任务总数 / 报名人数 / 合计金额 / 已完成任务数); null for every other field type. A "summary" field without it is runtime-dead — it reads 0/empty everywhere.'),
  expression: z.string().nullable()
    .describe('REQUIRED when type is "formula" — the CEL body the field computes, e.g. "record.quantity * record.unit_price", or "record.order_no + \' · \' + record.customer.name" for a composed record title; null for every other field type. A formula reads a lookup / master_detail field\'s related record ONE hop through it — `record.<lookup>.<field>`, as `record.customer.name` above; the bare `record.customer` is the stored id, and a second hop (`record.customer.owner.name`) is refused at build. A "formula" field without it is runtime-dead — it reads null everywhere, forever. This is the formula analogue of summaryOperations: name the type and you must supply the body.'),
  // ⛔ Must stay in lockstep with the lenient `BlueprintFieldSchema.defaultValue`
  // (ruling B on cloud#3619). One scalar union, because strict structured
  // output states a rule per key and cannot read `type` while judging this one:
  // which of the three a field takes is the lenient field's refinement, run when
  // `apply_blueprint` parses. So a value legal to generate here can still be
  // refused there, and it is then refused BY NAME at this key (the VALUE-parity
  // pin walks every type × arm), never stripped. The field key-parity pin fails
  // if either side drops the key.
  defaultValue: z.union([z.boolean(), z.number(), z.string()]).nullable()
    .describe(`The built field's default, or null for none: the value a new record gets when it is created without one, carried into the object field as its \`defaultValue\` and stored as written. ${DEFAULT_VALUE_TYPE_RULE} Null on every other type. ${booleanFlagRule('`required` null or false')}`),
});

const StrictObject = z.object({
  name: strictIdent('Object machine name (snake_case)'),
  label: z.string().nullable().describe('Human-readable singular label, or null'),
  description: z.string().nullable().describe('What this object represents, or null'),
  fields: z.array(StrictField).describe('Fields to create on the object'),
  sharingModel: z.enum(['private', 'public_read', 'public_read_write', 'controlled_by_parent']).nullable()
    .describe('Org-Wide Default record visibility (OWD) for INTERNAL users (ADR-0090), or null to accept the platform default (business object → public_read_write; master-detail child → controlled_by_parent). SET it when the user\'s description implies a visibility intent: personal/private data (HR, 绩效, salary, 个人隐私) → "private" (owner-only); "public_read" = everyone reads, owner writes; "public_read_write" = everyone reads+writes; "controlled_by_parent" ONLY for an object with a master_detail reference field. Null on privacy-sensitive data silently over-shares it.'),
  nameField: strictIdentOrNull('The record title field — which field holds the human-readable name shown on cards, lookup chips, breadcrumbs and search (ADR-0079), or null to let the platform auto-pick a text field. Set it to the object\'s text label field (e.g. "product_name") — snake_case. For a numbered entity (invoice/ticket), set it to a formula field that composes number + name (e.g. a formula "record.order_no + \' · \' + record.customer.name" — a lookup\'s name is read one hop through it, `record.<lookup>.<name field>`). A formula title is computed on read and stored nowhere: it is shown everywhere, but a list cannot sort by it and search does not scan it. Declaring it is strongly preferred over null.'),
  // ⛔ Must stay in lockstep with the lenient `BlueprintObjectSchema.stageField`:
  // a key present only there is one no proposal can ever contain, and the
  // option `kind` above would then never be required of an AI-built object.
  // The object key-parity pin fails if either side drops it.
  stageField: strictIdentOrNull(`The lifecycle stage field (ADR-0085) — which \`select\` (or \`radio\`) field of THIS object holds the ordered steps a record moves through (a deal's stage, a ticket's status), drawn as the record path — or null. snake_case, naming one of this object's own fields. ${STAGE_FIELD_RULE} SET it whenever the object has such a status/stage field, and give every one of that field's options a non-null \`kind\`. Null leaves stage detection to a guess from field names (status / stage / state / phase).`),
});

// One list-view filter rule, strict-shaped. The lenient side reuses
// `ViewFilterRuleSchema` itself; this mirror carries its SAME three keys and
// differs only where strict structured output cannot express the original:
//  - `value` is nullable and present, not optional — strict mode needs every
//    key in `required`, and null is the unary operators' spelling. The blueprint
//    tools strip it to an absent `value`, which is what the lenient rule reads.
//  - `operator` is the plain canonical enum. The lenient `z.preprocess` that
//    folds legacy spellings (`eq`, `gt`, …) is a parse-time transform with no
//    JSON-Schema form, and a new producer emits the canonical vocabulary anyway.
//  - the operator ↔ value-shape refinement (`in` takes an array, `between` a
//    pair, `icontains` a non-empty string) has no JSON-Schema form either; the
//    lenient rule `apply_blueprint` parses against refuses those, by name.
// The key-parity test pins this key set to `ViewFilterRuleSchema`'s.
const StrictViewFilterRule = z.object({
  field: z.string().describe('Field on the view\'s object to filter by (snake_case, e.g. "due_date", "status", "owner")'),
  operator: z.enum(VIEW_FILTER_OPERATORS).describe('Filter operator — the canonical vocabulary only'),
  value: z.union([z.string(), z.number(), z.boolean(), z.array(z.union([z.string(), z.number()]))]).nullable()
    .describe('Comparison value, or null for the unary operators (is_empty / is_not_empty / is_null / is_not_null), which take their direction from the operator name. "in" / "not_in" take an ARRAY (any length); "between" takes exactly [min, max]; every other operator takes a scalar. For a select field use its option VALUE, never its label. Today\'s date is the platform token "{today}" and the signed-in user is "{current_user_id}".'),
});

// One sort entry, strict-shaped: the lenient side reuses the shared
// `SortItemSchema`; both of its keys are already required, so the mirror needs
// no nullable — it is inlined only because this mirror declares every shape it
// sends, as the other nested shapes here do.
const StrictSortItem = z.object({
  field: z.string().describe('Field on the view\'s object to sort by (snake_case)'),
  order: SortDirectionEnum.describe('Sort direction: "asc" or "desc"'),
});

const StrictView = z.object({
  object: strictIdent('Object this view displays (snake_case)'),
  name: strictIdent('View machine name (snake_case)'),
  label: z.string().nullable().describe('Human-readable view label, or null'),
  type: z.enum(['list', 'form', 'kanban', 'calendar', 'gallery', 'gantt']).nullable().describe('View kind, or null for list. "gallery" = visual card/cover browse (画廊/相册/卡片墙/封面/海报, or an object with an image/avatar/file field); "gantt" = timeline/schedule (甘特图/时间线/排期, object with BOTH a start and an end date field); "kanban" = board grouped by a status/select field; "calendar" = single-date schedule; "form" = record editor.'),
  columns: z.array(z.string().regex(SNAKE_CASE)).nullable().describe('Field names shown as columns, or null. For a gallery, INCLUDE the image/avatar/file field (becomes the card cover); for a gantt, INCLUDE the start date column before the end date column.'),
  groupBy: strictIdentOrNull('REQUIRED for kanban: the select/status field whose options become the board columns (e.g. "stage"). Optional for gantt (groups leaf tasks). Null for list/form/calendar/gallery.'),
  // ⛔ Must stay in lockstep with the lenient `BlueprintViewSchema.filters`.
  // THIS describe is the one the design model reads, and strict mode makes the
  // key required, so the model decides on every view: state the filter its
  // name promises, or say null. The view key-parity pin fails if it goes.
  filters: z.array(StrictViewFilterRule).nullable()
    .describe('Which records this view shows: list-view filter rules [{field, operator, value}], ANDed, or null for a view over EVERY record. REQUIRED whenever the view\'s name or label states a condition — an 「overdue / 逾期」, 「my open / 我的未完成」, 「待审批」 or 「本月」 view MUST carry the rules that make its name true, e.g. overdue → [{field:"due_date",operator:"less_than",value:"{today}"},{field:"status",operator:"not_equals",value:"completed"}]; my open → [{field:"owner",operator:"equals",value:"{current_user_id}"},{field:"status",operator:"equals",value:"open"}]. Null under such a name ships a view that shows every record while its name promises a subset.'),
  sort: z.array(StrictSortItem).nullable()
    .describe('Default record order: [{field, order}] with order "asc" or "desc"; the first entry sorts first (e.g. an overdue list → [{field:"due_date",order:"asc"}]), or null for the platform default order.'),
  // ⛔ Must stay in lockstep with the lenient `BlueprintViewSchema.startDateField`
  // (ruling B on cloud#3607): THIS describe is the one the design model reads,
  // and strict mode makes the key required, so it decides on every view. The
  // view key-parity pin fails if either side drops it.
  startDateField: strictIdentOrNull(`${VIEW_START_DATE_FIELD_RULE} Null on every view that is not a calendar.`),
});

const StrictDashboard = z.object({
  name: strictIdent('Dashboard machine name (snake_case)'),
  label: z.string().nullable().describe('Human-readable dashboard label, or null'),
  widgets: z.array(z.object({
    id: strictIdent('Widget id (snake_case)'),
    title: z.string().nullable().describe('Widget title, or null'),
    object: strictIdentOrNull('Source object, or null'),
    chart: z.enum(['metric', 'bar', 'line', 'pie', 'table']).nullable().describe('Visualization, or null'),
    measure: strictIdentOrNull(`The field this widget aggregates (e.g. "amount", "score"), or "count" to count records, or null for a count widget. ${WIDGET_MEASURE_RULE}`),
    // ⛔ Must stay in lockstep with the lenient widget `aggregate` (ruling A on
    // cloud#3607 row 2): with it on the lenient side only, the design model
    // could never say "average". The widget key-parity pin fails if it goes.
    aggregate: z.enum(BLUEPRINT_WIDGET_AGGREGATES).nullable()
      .describe(`How the widget aggregates its records, or null for the reader's own default. ${WIDGET_AGGREGATE_MEANING} Write it, never null, on every widget that aggregates.`),
    groupBy: strictIdentOrNull('The field to break the widget down by — the category or time axis (e.g. "stage", "created_at"), or null for a single-number metric. A "by status" chart MUST set this to the status field; the title and this field MUST name the SAME field.'),
    condition: z.object({
      field: strictIdent('Field on the widget object to filter by (e.g. "stock_quantity", "status")'),
      op: z.enum(['lt', 'lte', 'gt', 'gte', 'eq', 'ne']).describe('Comparison operator'),
      value: z.union([z.number(), z.string(), z.boolean()]).describe('Comparison value (e.g. 10, "open")'),
    }).nullable()
      .describe('Restrict WHICH records the widget counts/aggregates when its title implies a threshold or status (e.g. "stock below 10" → {field:"stock_quantity",op:"lt",value:10}; "open tickets" → {field:"status",op:"eq",value:"open"}), or null when the widget covers every record. Without it a "低于10的预警" / "overdue" card wrongly counts ALL rows.'),
  })).nullable().describe('Widgets to place on the dashboard, or null'),
});

const StrictNavItem = z.object({
  type: z.enum(['object', 'dashboard']).describe('What this nav entry opens'),
  target: strictIdent('Object or dashboard machine name to surface (snake_case)'),
  // ⛔ Must state the SAME rule as the lenient `BlueprintNavItemSchema.label`
  // (cloud#2021). THIS describe is the one the design model reads:
  // `propose_blueprint`'s structured output is generated against this mirror,
  // and strict mode makes `label` required, so the model decides on every
  // entry. The blueprint tools strip its `null` to an absent label, which the
  // renderer resolves to the target's CURRENT label on every render; a written
  // string is rendered verbatim and never follows a rename. A describe that
  // does not say which choice inherits steers the model to write a label on
  // every entry. The nav `label` rule pin in `solution-blueprint.test.ts`
  // (beside the `viewName` key-parity pin) fails if the two drift.
  label: z.string().nullable()
    .describe('Nav entry label, or null. null ⇒ the entry inherits the CURRENT label of what it opens at render time (a renamed target shows its new name); a string ⇒ rendered verbatim, so never copy the target\'s label in as a default. Write a label ONLY when the entry must read differently from what it opens; otherwise null.'),
  icon: z.string().nullable().describe('Lucide icon name, or null'),
  // ⛔ Must stay in lockstep with the lenient `BlueprintNavItemSchema.viewName`
  // (cloud#2150). THIS side is the one that decides whether the design step can
  // author a board entry at all: `propose_blueprint`'s structured output is
  // validated against this mirror, so a key present only in the lenient schema
  // is a fix that exists nowhere on the main path — the applier would accept a
  // `viewName` no proposal can ever contain. That is the `seedData` divergence
  // (cloud#2118) with a different key name; the nav key-parity pin below fails
  // if this line is removed.
  viewName: z.string().nullable()
    .describe('For type:"object" only — the `views[].name` this entry opens (e.g. "ticket_status_board"), or null for the object\'s default list. SET it whenever this blueprint authors a kanban/calendar/gallery/gantt view the menu should reach: give the object ONE entry per view (a 「工单列表」 entry with viewName null plus a 「工单看板」 entry with viewName "ticket_status_board"). Null on every entry means they all open the SAME default list, and a label/icon saying otherwise is decoration.'),
});

const StrictApp = z.object({
  name: strictIdent('App machine name (snake_case)'),
  label: z.string().nullable().describe('App display label, or null'),
  icon: z.string().nullable().describe('Lucide icon for the App Launcher, or null'),
  nav: z.array(StrictNavItem).nullable()
    .describe('Navigation entries; null to auto-surface every created object and dashboard'),
});

/**
 * OpenAI-strict-compatible mirror of {@link SolutionBlueprintSchema}, used only
 * as the `generateObject` output contract (see comment above). Validate / apply
 * still go through the lenient `SolutionBlueprintSchema`.
 */
export const SolutionBlueprintStrictSchema = z.object({
  summary: z.string().describe('One-line description of the proposed solution'),
  assumptions: z.array(z.string()).describe('Design assumptions made from the underspecified goal'),
  questions: z.array(z.string()).nullable()
    .describe('At most 1-2 structure-deciding questions to confirm before building, or null'),
  objects: z.array(StrictObject).describe('Objects (tables) to create'),
  views: z.array(StrictView).nullable().describe('Views to create, or null'),
  dashboards: z.array(StrictDashboard).nullable().describe('Dashboards to create, or null'),
  app: StrictApp.nullable()
    .describe('The navigation shell (app) that surfaces the created objects/dashboards, or null'),
});
export type SolutionBlueprintStrict = z.input<typeof SolutionBlueprintStrictSchema>;
