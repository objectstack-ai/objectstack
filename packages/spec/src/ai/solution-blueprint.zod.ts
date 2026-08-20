// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { z } from 'zod';
import { lazySchema } from '../shared/lazy-schema';
import { FieldType } from '../data/field.zod';
import { FilterConditionSchema } from '../data/filter.zod';

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

const SNAKE_CASE = /^[a-z_][a-z0-9_]*$/;

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
  })).optional().describe('Choices for select / multiselect / radio fields'),
  summaryOperations: BlueprintSummaryOperationsSchema.optional()
    .describe('REQUIRED when `type` is "summary" (a roll-up of child records: 任务总数 / 报名人数 / 合计金额 / 已完成任务数). Names the child object, the aggregation, and — for a qualified count/sum — the condition. A "summary" field without it materializes runtime-dead.'),
  expression: z.string().optional()
    .describe('REQUIRED when `type` is "formula" — the CEL body the field computes, e.g. "record.quantity * record.unit_price", or "record.order_no + \' · \' + record.customer" for a composed title. A "formula" field without it materializes runtime-dead: the engine builds its formula plan only from fields that HAVE an expression, so the field reads null everywhere, forever. Same failure shape as a "summary" with no `summaryOperations`. Note `nameField` on the object recommends a formula for numbered entities (invoice/ticket) — that formula needs THIS key, or the record title is blank on every card, lookup chip and breadcrumb.'),
}));
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
    .describe('The record title field — which field holds the human-readable name shown on cards, lookup chips, breadcrumbs and search (ADR-0079). Set it to the object\'s text label field (e.g. "product_name"). For a numbered entity (invoice/ticket), set it to a formula field that composes number + name (e.g. "{order_no} · {customer}"). Omitting it lets the platform auto-pick a text field, but declaring it is strongly preferred.'),
}));
export type BlueprintObject = z.input<typeof BlueprintObjectSchema>;

/** A proposed list/form/kanban/calendar/gallery/gantt view over an object. */
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
      .describe('The field this widget aggregates (e.g. "amount", "probability"), or "count" to count records. The aggregation is chosen automatically from the field type — a money field SUMs, a percentage/rate AVERAGEs — so name the FIELD, not "total_amount". A "total revenue" widget sets measure:"amount"; an "average win rate" widget sets measure:"win_rate"; a "number of deals" widget sets measure:"count". Omit to let the builder infer from the title.'),
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
 */
export const BlueprintNavItemSchema = lazySchema(() => z.object({
  type: z.enum(['object', 'dashboard']).default('object').describe('What this nav entry opens'),
  target: z.string().regex(SNAKE_CASE).describe('Object or dashboard machine name to surface (snake_case)'),
  label: z.string().optional().describe('Nav entry label (defaults to the target label/name)'),
  icon: z.string().optional().describe('Lucide icon name for the nav entry'),
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

// The roll-up config, strict-shaped: every key present, "optional" → nullable,
// and the predicate as a flat `conditions` ARRAY because strict mode cannot
// express the canonical `filter` map (open-ended additionalProperties). The
// blueprint tools compile `conditions` back into a real query filter.
const StrictSummaryOperations = z.object({
  object: z.string().describe('The CHILD object whose records are aggregated (snake_case). It MUST have a lookup/master_detail field pointing back at this parent.'),
  function: z.enum(['count', 'sum', 'avg', 'min', 'max']).describe('Aggregation: "数量/个数/计数" → count; "合计/总额/累计" → sum; "平均" → avg'),
  field: z.string().nullable().describe('Numeric field on the CHILD to aggregate; null (or "id") for count'),
  relationshipField: z.string().nullable().describe('Child FK field back to this parent, or null to auto-detect'),
  conditions: z.array(z.object({
    field: z.string().describe('Field on the CHILD object'),
    op: z.enum(['lt', 'lte', 'gt', 'gte', 'eq', 'ne']).describe('Comparison operator'),
    value: z.union([z.number(), z.string(), z.boolean()]).describe('Comparison value — a select field\'s option VALUE, never its label'),
  })).nullable()
    .describe('CONDITIONAL roll-up: aggregate only child rows matching these (ANDed), or null to aggregate every child. REQUIRED whenever the field name carries a qualifier ("已完成任务数 / 已收货金额 / 待处理工单数", any 已X / 未X / <某状态>的 count-or-sum) — e.g. [{field:"status",op:"eq",value:"completed"}]. Without it the roll-up counts EVERYTHING and reports a plausible WRONG number.'),
});

const StrictField = z.object({
  name: z.string().describe('Field machine name (snake_case)'),
  label: z.string().nullable().describe('Human-readable field label, or null'),
  type: FieldType.describe('Field data type'),
  required: z.boolean().nullable().describe('Whether the field is required, or null'),
  reference: z.string().nullable().describe('Target object for lookup/master_detail, or null'),
  options: z.array(z.object({ label: z.string(), value: z.string() })).nullable()
    .describe('Choices for select-family fields, or null'),
  summaryOperations: StrictSummaryOperations.nullable()
    .describe('REQUIRED when type is "summary" (a roll-up of child records onto this parent: 任务总数 / 报名人数 / 合计金额 / 已完成任务数); null for every other field type. A "summary" field without it is runtime-dead — it reads 0/empty everywhere.'),
  expression: z.string().nullable()
    .describe('REQUIRED when type is "formula" — the CEL body the field computes, e.g. "record.quantity * record.unit_price", or "record.order_no + \' · \' + record.customer" for a composed record title; null for every other field type. A "formula" field without it is runtime-dead — it reads null everywhere, forever. This is the formula analogue of summaryOperations: name the type and you must supply the body.'),
});

const StrictObject = z.object({
  name: z.string().describe('Object machine name (snake_case)'),
  label: z.string().nullable().describe('Human-readable singular label, or null'),
  description: z.string().nullable().describe('What this object represents, or null'),
  fields: z.array(StrictField).describe('Fields to create on the object'),
  sharingModel: z.enum(['private', 'public_read', 'public_read_write', 'controlled_by_parent']).nullable()
    .describe('Org-Wide Default record visibility (OWD) for INTERNAL users (ADR-0090), or null to accept the platform default (business object → public_read_write; master-detail child → controlled_by_parent). SET it when the user\'s description implies a visibility intent: personal/private data (HR, 绩效, salary, 个人隐私) → "private" (owner-only); "public_read" = everyone reads, owner writes; "public_read_write" = everyone reads+writes; "controlled_by_parent" ONLY for an object with a master_detail reference field. Null on privacy-sensitive data silently over-shares it.'),
});

const StrictView = z.object({
  object: z.string().describe('Object this view displays (snake_case)'),
  name: z.string().describe('View machine name (snake_case)'),
  label: z.string().nullable().describe('Human-readable view label, or null'),
  type: z.enum(['list', 'form', 'kanban', 'calendar', 'gallery', 'gantt']).nullable().describe('View kind, or null for list. "gallery" = visual card/cover browse (画廊/相册/卡片墙/封面/海报, or an object with an image/avatar/file field); "gantt" = timeline/schedule (甘特图/时间线/排期, object with BOTH a start and an end date field); "kanban" = board grouped by a status/select field; "calendar" = single-date schedule; "form" = record editor.'),
  columns: z.array(z.string()).nullable().describe('Field names shown as columns, or null. For a gallery, INCLUDE the image/avatar/file field (becomes the card cover); for a gantt, INCLUDE the start date column before the end date column.'),
  groupBy: z.string().nullable().describe('REQUIRED for kanban: the select/status field whose options become the board columns (e.g. "stage"). Optional for gantt (groups leaf tasks). Null for list/form/calendar/gallery.'),
});

const StrictDashboard = z.object({
  name: z.string().describe('Dashboard machine name (snake_case)'),
  label: z.string().nullable().describe('Human-readable dashboard label, or null'),
  widgets: z.array(z.object({
    id: z.string().describe('Widget id (snake_case)'),
    title: z.string().nullable().describe('Widget title, or null'),
    object: z.string().nullable().describe('Source object, or null'),
    chart: z.enum(['metric', 'bar', 'line', 'pie', 'table']).nullable().describe('Visualization, or null'),
    measure: z.string().nullable()
      .describe('The field this widget aggregates (e.g. "amount", "probability"), or "count" to count records, or null to infer from the title. The aggregation (sum vs average) is chosen automatically from the field type — name the FIELD, not "total_amount". "total revenue" → "amount"; "average win rate" → "win_rate"; "number of deals" → "count".'),
    groupBy: z.string().nullable()
      .describe('The field to break the widget down by — the category or time axis (e.g. "stage", "created_at"), or null for a single-number metric. A "by status" chart MUST set this to the status field; the title and this field MUST name the SAME field.'),
    condition: z.object({
      field: z.string().describe('Field on the widget object to filter by (e.g. "stock_quantity", "status")'),
      op: z.enum(['lt', 'lte', 'gt', 'gte', 'eq', 'ne']).describe('Comparison operator'),
      value: z.union([z.number(), z.string(), z.boolean()]).describe('Comparison value (e.g. 10, "open")'),
    }).nullable()
      .describe('Restrict WHICH records the widget counts/aggregates when its title implies a threshold or status (e.g. "stock below 10" → {field:"stock_quantity",op:"lt",value:10}; "open tickets" → {field:"status",op:"eq",value:"open"}), or null when the widget covers every record. Without it a "低于10的预警" / "overdue" card wrongly counts ALL rows.'),
  })).nullable().describe('Widgets to place on the dashboard, or null'),
});

const StrictNavItem = z.object({
  type: z.enum(['object', 'dashboard']).describe('What this nav entry opens'),
  target: z.string().describe('Object or dashboard machine name to surface (snake_case)'),
  label: z.string().nullable().describe('Nav entry label, or null'),
  icon: z.string().nullable().describe('Lucide icon name, or null'),
});

const StrictApp = z.object({
  name: z.string().describe('App machine name (snake_case)'),
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
