// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { z } from 'zod';
import { ProtectionSchema } from '../shared/protection.zod';
import { MetadataProtectionFields } from '../kernel/metadata-protection.zod';
import { strictObject, strictObjectError } from '../shared/strict-object';
import { SnakeCaseIdentifierSchema } from '../shared/identifiers.zod';
import { ExpressionInputSchema } from '../shared/expression.zod';
import { normalizeVisibleWhen, VISIBILITY_STRICT_OPTIONS } from '../shared/visibility';
import { I18nLabelSchema, AriaPropsSchema } from './i18n.zod';
import { ChartTypeSchema } from './chart.zod';
import { SharingConfigSchema } from './sharing.zod';
import { retiredKey } from '../shared/retired-key';
import { FieldType, SelectOptionSchema } from '../data/field.zod';
import { BulkActionDefSchema } from './bulk-action.zod';

/**
 * HTTP Method Enum & HTTP Request Schema
 * Migrated to shared/http.zod.ts. Re-exported here for backward compatibility.
 */
import { HttpMethodSubsetSchema, HttpRequestSchema } from '../shared/http.zod';
import { lazySchema } from '../shared/lazy-schema';

/**
 * Shared history for this file (#4001).
 *
 * Views are the surface an author iterates on visually, which is exactly why a
 * dropped key hides here: the view still renders, just not the way it was
 * described. `FormFieldBaseSchema` / `FormSectionSchema` / `FormButtonConfig`
 * were closed years ago (ADR-0089 D3a); the other forty-odd shapes in this file
 * kept the posture those three were rescued from.
 */
const VIEW_HISTORY =
  'Until #4001 closed these shapes an unknown key was dropped silently — the view still '
  + 'rendered, without whatever the key was meant to configure.';

export { HttpMethodSubsetSchema, HttpRequestSchema };

/**
 * [#4688] `HttpRequest` is RE-EXPORTED from its one declaration in
 * `shared/http.zod.ts` — never re-inferred here.
 *
 * The line this replaces was `export type HttpRequest = z.infer< typeof
 * HttpRequestSchema >` in the alias block at the bottom of this file. It looked
 * single-source: it inferred from the very schema object imported above, so the
 * resolved shape was identical. But it was a SECOND type declaration carrying
 * one name, and symbol identity — not shape — is what
 * `check:dual-source-exports` measures, and what an auto-import or a model
 * completion resolves by. That is how `./shared` and `./ui` came to name two
 * different declarations `HttpRequest` (the #4411 trap). A re-export keeps every
 * existing `import type { HttpRequest } from '@objectstack/spec/ui'` working
 * while leaving exactly one declaration that could ever diverge.
 */
export type { HttpRequest } from '../shared/http.zod';

/**
 * [#4691, renamed at #5832] The type of `HttpMethodSubsetSchema` is
 * `HttpMethodSubset`, RE-EXPORTED from its one declaration in
 * `shared/http.zod.ts`.
 *
 * `./ui` used to export that same 5-value type under the name `HttpMethod`
 * (`export type HttpMethod = z.infer< typeof HttpMethodSchema >`, in the alias
 * block at the bottom of this file). That name is already taken across the
 * package by a DIFFERENT declaration — `shared/http.zod.ts`'s 7-value
 * `z.enum([… 'HEAD', 'OPTIONS'])`, exported by `./shared` and `./api` — so one
 * name resolved to two incompatible types depending on the import path (the
 * #4411 trap; the last row of `dual-source-exports.baseline.json`).
 *
 * Converging by re-exporting `./shared`'s `HttpMethod` here — the fix #4688
 * used for `HttpRequest` — would have been WRONG: it silently widens `./ui`'s
 * type from 5 values to 7 while `HttpRequestSchema.method` still validates
 * against the 5-value subset. `method: 'HEAD'` would type-check and then throw
 * at `.parse()` — the type would start lying about the runtime. So the NAME is
 * dropped from `./ui` instead, and the 5-value type carries a name of its own.
 *
 * #4691 spelled that name `HttpMethodType`, which was merely the name left
 * over once `HttpMethod` was taken. #5832 renamed the whole trio to
 * `HttpMethodSubsetSchema` / `HttpMethodSubset` / `<category>/HttpMethodSubset`
 * because the CONST still collided one layer down: `schemaNameFromExportKey`
 * strips the `Schema` suffix, so `HttpMethodSchema` published as
 * `shared/HttpMethod` and overwrote the 7-value enum's own def.
 *
 * Re-exported here (rather than only left in `./shared`) so the shortest fix
 * for `import type { HttpMethod } from '@objectstack/spec/ui'` is also the
 * CORRECT one: TypeScript's "did you mean" points at `HttpMethodSubset` in the
 * same entry point, instead of tempting a path swap to `./shared`, where the
 * name `HttpMethod` does still exist and means the wider 7-value enum.
 */
export type { HttpMethodSubset } from '../shared/http.zod';

/**
 * View Data Source Configuration
 * Supports three modes:
 * 1. 'object': Standard Protocol - Auto-connects to ObjectStack Metadata and Data APIs
 * 2. 'api': Custom API - Explicitly provided API URLs
 * 3. 'value': Static Data - Hardcoded data array
 */
export const ViewDataSchema = lazySchema(() => z.discriminatedUnion('provider', [
  strictObject({
    surface: 'this `object` data source',
    history: VIEW_HISTORY,
    // `objectName` is the canonical spelling on the QUERY surface
    // (`data/query.zod.ts`); the view data source names it `object`, and an
    // author moving between the two writes the neighbouring word rather than a
    // typo edit distance could reach.
    // NOT aliased: a bare `name`. It is a real key on the view ITEM
    // (`ViewItemSchema.name`), so an author who wrote it here may have meant
    // the view's name, not the object's — and this campaign's own finding 7 is
    // that a confidently wrong prescription is worse than none.
    aliases: { objectName: 'object' },
  }, {
    provider: z.literal('object'),
    object: z.string().describe('Target object name'),
  }),
  strictObject({
    surface: 'this `api` data source',
    history: VIEW_HISTORY,
    // The HTTP verbs are the request BLOCKS' business (`read`/`write` each hold
    // an `HttpRequestSchema`), so an author who put the whole request inline is
    // pointed at the block that owns it rather than at a near-miss key.
    guidance: {
      url: 'Set the URL inside the request block: `read: { url, method }` (or `write: { … }`) — the data source itself declares only `read` / `write`.',
      method: 'Set the method inside the request block: `read: { url, method }` (or `write: { … }`).',
      fetch: 'Use `read` for the fetch request and `write` for the submit request.',
      submit: 'Use `write` for the submit request (and `read` for the fetch request).',
    },
  }, {
    provider: z.literal('api'),
    read: HttpRequestSchema.optional().describe('Configuration for fetching data'),
    write: HttpRequestSchema.optional().describe('Configuration for submitting data (for forms/editable tables)'),
  }),
  strictObject({
    surface: 'this `value` data source',
    history: VIEW_HISTORY,
    // `data`/`rows`/`records` are the words the surrounding surfaces use for a
    // row set; on this provider the static array is `items`.
    aliases: { data: 'items', rows: 'items', records: 'items', values: 'items' },
  }, {
    provider: z.literal('value'),
    items: z.array(z.unknown()).describe('Static data array'),
  }),
  /**
   * Schema-bound data source — used by standalone forms whose data is
   * shaped by a JSON Schema (or Zod-derived schema) rather than by an
   * ObjectQL object. Powers the metadata editor, action input dialogs,
   * and any Form that is not bound to a CRUD object.
   */
  strictObject({
    surface: 'this `schema` data source',
    history: VIEW_HISTORY,
    // `schemaId` and `schema` are one key apart in prose but not in edit
    // distance, and the pair is genuinely confusable: one NAMES a schema the
    // server resolves, the other INLINES it.
    aliases: { type: 'schemaId', metadataType: 'schemaId', jsonSchema: 'schema' },
  }, {
    provider: z.literal('schema'),
    /** Schema identifier (e.g. metadata type name "report"). Resolved at runtime against /meta entries. */
    schemaId: z.string().describe('Schema identifier — typically the metadata type name'),
    /** Optional inline JSON Schema; when omitted the runtime resolves schemaId from the server. */
    schema: z.record(z.string(), z.unknown()).optional().describe('Inline JSON Schema (Draft 2020-12). Optional when schemaId is resolvable.'),
  }),
]));

/**
 * Canonical filter operators for view filter rules.
 *
 * This is the SINGLE authoring vocabulary for `ViewFilterRule.operator`.
 * Exposing it as an enum (rather than a free `z.string()`) lets JSON-Schema
 * consumers — notably ObjectUI's SchemaForm — auto-render an operator
 * dropdown, and rejects genuinely unknown operators at parse time.
 *
 * Unary operators (`is_empty`, `is_not_empty`, `is_null`, `is_not_null`) take
 * no `value`. `before` / `after` are the date-friendly spellings of
 * `less_than` / `greater_than`; `between` expects a two-element `value` array.
 *
 * Note: relative-date operators (`this_quarter`, `last_7_days`, …) are NOT
 * filter-rule operators — they are date-range presets and live on dashboard
 * date-range config (`DashboardFilterSchema.defaultRange`), not here.
 */
export const VIEW_FILTER_OPERATORS = [
  'equals', 'not_equals',
  'contains', 'not_contains',
  'starts_with', 'ends_with',
  'greater_than', 'less_than',
  'greater_than_or_equal', 'less_than_or_equal',
  'in', 'not_in',
  'is_empty', 'is_not_empty',
  'is_null', 'is_not_null',
  'before', 'after', 'between',
] as const;

export type ViewFilterOperator = (typeof VIEW_FILTER_OPERATORS)[number];

/**
 * The operators whose `value` is a LIST rather than a scalar (#6227).
 *
 * These are the authoring spellings that lower to `$in` / `$nin`
 * (`AST_OPERATOR_MAP`, `data/filter.zod.ts`), which
 * {@link https://github.com/objectstack-ai/objectstack/issues/5869 | the runtime
 * gate} requires to be arrays. Exported so a producer can ask the question the
 * schema asks instead of hard-coding its own list: `@object-ui`'s filter builder
 * decides `isMultiOperator` from a local `["in", "notIn"]` literal
 * (`components/src/custom/filter-builder.tsx`), a second dialect of exactly this
 * fact that is already one spelling adrift — `notIn` is an alias, not the
 * canonical member. One declared vocabulary, same reasoning as
 * {@link VIEW_FILTER_OPERATOR_ALIASES}.
 */
export const VIEW_FILTER_LIST_VALUE_OPERATORS = [
  'in', 'not_in',
] as const satisfies readonly ViewFilterOperator[];

/**
 * The operators whose `value` is a two-element `[min, max]` array (#6227).
 *
 * Separate from {@link VIEW_FILTER_LIST_VALUE_OPERATORS} because the check is
 * different in kind: membership takes ANY arity (`[]` included), a range takes
 * exactly two bounds.
 */
export const VIEW_FILTER_PAIR_VALUE_OPERATORS = [
  'between',
] as const satisfies readonly ViewFilterOperator[];

/**
 * Legacy operator spellings normalized to the canonical vocabulary above.
 *
 * These are historical shorthand (`eq`, `gt`) and camelCase (`notEquals`,
 * `greaterThan`) forms that older authoring tools and already-stored view
 * metadata may still carry. They are folded to canonical on parse so every
 * downstream consumer sees exactly one vocabulary — one strict contract, not
 * N dialects. Deprecated: new producers MUST emit the canonical forms; these
 * aliases are a migration bridge and may be dropped in a future major.
 */
export const VIEW_FILTER_OPERATOR_ALIASES: Record<string, ViewFilterOperator> = {
  eq: 'equals',
  ne: 'not_equals', neq: 'not_equals', notequals: 'not_equals', notEquals: 'not_equals',
  notcontains: 'not_contains', notContains: 'not_contains',
  startswith: 'starts_with', startsWith: 'starts_with',
  endswith: 'ends_with', endsWith: 'ends_with',
  gt: 'greater_than', greaterthan: 'greater_than', greaterThan: 'greater_than',
  lt: 'less_than', lessthan: 'less_than', lessThan: 'less_than',
  gte: 'greater_than_or_equal', greaterorequal: 'greater_than_or_equal',
  greaterOrEqual: 'greater_than_or_equal', greaterThanOrEqual: 'greater_than_or_equal',
  lte: 'less_than_or_equal', lessorequal: 'less_than_or_equal',
  lessOrEqual: 'less_than_or_equal', lessThanOrEqual: 'less_than_or_equal',
  nin: 'not_in', notin: 'not_in', notIn: 'not_in',
  isempty: 'is_empty', isEmpty: 'is_empty',
  isnotempty: 'is_not_empty', isNotEmpty: 'is_not_empty',
  isnull: 'is_null', isNull: 'is_null',
  isnotnull: 'is_not_null', isNotNull: 'is_not_null',
};

/**
 * Fold a legacy operator spelling to its canonical form. Returns canonical
 * operators unchanged, maps known aliases, and returns unknown input verbatim
 * (so the enum's own validation reports it as invalid). Exported so producers
 * and renderers can normalize stored metadata against the SAME canonical map
 * the schema uses, instead of inventing a second dialect.
 */
export function normalizeFilterOperator(op: unknown): string {
  if (typeof op !== 'string') return op as string;
  if ((VIEW_FILTER_OPERATORS as readonly string[]).includes(op)) return op;
  return VIEW_FILTER_OPERATOR_ALIASES[op] ?? VIEW_FILTER_OPERATOR_ALIASES[op.toLowerCase()] ?? op;
}

// ───────────────────────────────────────────────────────────────────────────
// Write-time console decorations (#5074) — the mirror of `stripReadDecorations`
// ───────────────────────────────────────────────────────────────────────────
//
// `stripReadDecorations` (`kernel/metadata-read-decorations.ts`) exists because
// the READ path stamps keys onto a served document that were never part of it,
// so a served body is not a valid input to the schema that produced it. The
// console's row builders create the same problem from the other side, and this
// is that function's write-path twin.
//
// The producer is a React list key, not a protocol decision: the filter builder
// (`components/src/custom/filter-builder.tsx:228`, re-stamped on read-back at
// `plugin-view/src/config/view-config-utils.ts:146`/`:160`) and the sort builder
// (`components/src/custom/sort-builder.tsx:68`/`:94`) both stamp
// `id: crypto.randomUUID()` on every row they render. `saveMetaItem` validates
// the PUT body and persists the AUTHORED body verbatim, so those ids reach the
// wire and the store.
//
// ⚠️ Why a `.strip()` on the wire member cannot do this job — the #4001 批 18 /
// #5114 finding, and the reason this vocabulary exists at all: **`.strip()` does
// not recurse, any more than `.strict()` does.** Re-opening a union member
// re-opens its TOP level; every nested block is still reached through it at that
// block's own posture. `filter[]` and `sort[]` are nested blocks, so a top-level
// reopen leaves them 422ing the platform's own writes. Removing the decoration
// BEFORE validation is what makes the wire opening recursive-effective, and it
// is the only one of the two routes that does not require the authoring surface
// to declare a UI artifact (批 18 Q1: declaring `id` teaches an AI author to
// emit a UUID for a filter rule — a `??` fallback wearing a schema).
//
// Deliberately NOT solved by a second parallel schema tree: a hand-maintained
// wire twin of every carrier of `ViewFilterRuleSchema` is a second copy of the
// truth (PD#12's fork), and it rots silently the first time someone adds a new
// carrier. One declared vocabulary, applied at the wire door, covers every
// carrier that exists today and every one added later.

/** Keys the console stamps onto builder ROWS, which are therefore never authored. */
export const VIEW_CONSOLE_ROW_DECORATIONS = ['id'] as const;

/**
 * Keys whose array value holds console builder rows. Both are written by a
 * row-per-entry widget that needs a stable React key; neither element shape
 * declares `id`, on any surface, by design.
 */
const VIEW_DECORATED_ROW_CARRIERS: readonly string[] = ['filter', 'sort'];

/** Depth guard — a view body is a bounded document, not a general graph. */
const VIEW_DECORATION_MAX_DEPTH = 12;

/** The prescription an authored `id` gets on a row shape. Shared by both sites. */
const VIEW_CONSOLE_ROW_ID_GUIDANCE =
  '`id` is a console row key (the filter/sort builders stamp a `crypto.randomUUID()` '
  + 'per row for React) — it is not part of the authoring contract, and the write path '
  + 'removes it before validating. Delete it from authored metadata.';

function stripRowDecorations(value: unknown, isRow: boolean, depth: number): unknown {
  if (depth > VIEW_DECORATION_MAX_DEPTH || !value || typeof value !== 'object') return value;

  if (Array.isArray(value)) {
    let changed = false;
    const next = value.map((el) => {
      const out = stripRowDecorations(el, isRow, depth + 1);
      if (out !== el) changed = true;
      return out;
    });
    return changed ? next : value;
  }

  const dict = value as Record<string, unknown>;
  let next: Record<string, unknown> | undefined;

  if (isRow) {
    for (const k of VIEW_CONSOLE_ROW_DECORATIONS) {
      if (k in dict) {
        next ??= { ...dict };
        delete next[k];
      }
    }
  }

  for (const [k, v] of Object.entries(next ?? dict)) {
    const out = stripRowDecorations(v, VIEW_DECORATED_ROW_CARRIERS.includes(k), depth + 1);
    if (out !== v) {
      next ??= { ...dict };
      next[k] = out;
    }
  }

  return next ?? value;
}

/**
 * Remove {@link VIEW_CONSOLE_ROW_DECORATIONS} from the builder rows of a `view`
 * body, at every depth they occur — `filter[]` / `sort[]` under a flattened
 * overlay, under a ViewItem's `config`, under `userFilters.tabs[]`, under
 * `tabs[]`, and under any carrier added later.
 *
 * A **silent** removal, for the same reason `stripReadDecorations` is silent:
 * this is our own UI's decoration riding on a document that is otherwise exactly
 * what the author meant, so rejecting it would be hostile. It runs on the WIRE
 * door only ({@link ViewMetadataSchema}) — {@link defineViewItem} and the other
 * authoring doors keep rejecting the key by name, which is the whole point of
 * the split.
 *
 * Nothing is lost at rest: `saveMetaItem` persists the ORIGINAL body, so the
 * console still reads its own ids back.
 *
 * Returns the SAME reference when there is nothing to strip, so the common path
 * allocates nothing. Non-object inputs pass through — the schema owns those.
 */
export function stripViewConsoleDecorations(body: unknown): unknown {
  return stripRowDecorations(body, false, 0);
}

/** `string` / `number` / `an array of 3` / `null` … — the word the refusal uses. */
function describeFilterValue(value: unknown): string {
  if (value === null) return 'null';
  if (value === undefined) return 'no value';
  if (Array.isArray(value)) return `an array of ${value.length}`;
  return `a ${typeof value}`;
}

/**
 * A short, bounded rendering of the offending value.
 *
 * Bounded for the reason the runtime twin's `shapePreview` is: the value can be
 * arbitrarily large, and the message is for a human reading a refusal, not a
 * dump.
 */
function previewFilterValue(value: unknown): string {
  if (value === undefined) return '(omitted)';
  let text: string;
  try {
    text = JSON.stringify(value) ?? String(value);
  } catch {
    text = String(value);
  }
  return text.length > 40 ? `${text.slice(0, 39)}…` : text;
}

/**
 * [#6227] `value` must have the shape the rule's OPERATOR can execute.
 *
 * ## The two-stage failure this closes
 *
 * `{ field: 'stage', operator: 'not_in', value: 'won' }` — a set operator with a
 * scalar comparand — was a spec-VALID `ViewFilterRule`: `value` declared
 * `string | number | boolean | null | (string | number)[]` with no coupling to
 * `operator`, so every operator accepted every shape. The view published cleanly
 * and then failed at QUERY time, where #5869 / PR #6209 had already closed the
 * runtime half: `assertListComparandShapes` (`@objectstack/objectql`,
 * `filter-comparand-shape.ts`) refuses the lowered `{ stage: { $nin: 'won' } }`
 * with a named 400 `INVALID_FILTER`. Correct refusal, wrong moment — the author
 * is gone by then, and before #6209 the same shape was a 500. That file's own
 * module docblock names this schema as the reachable authoring source of the
 * defect.
 *
 * ## Why this mirrors the runtime gate EXACTLY, and refuses to go further
 *
 * The checks below are `assertListComparandShapes`' three constraints, one for
 * one: `$in`/`$nin` must be an array, `$between` must be a 2-array. Nothing else
 * is judged here, deliberately — #5685 already ruled on the opposite error, where
 * `FieldOperatorsSchema` declared `$gt` as `number | Date | FieldReference` while
 * every first-party producer put an ISO STRING there; the schema was ruled the
 * wrong side and widened to match the runtime. A publish-time gate refusing more
 * than the query path refuses would re-create that mismatch pointing the other
 * way, and would reject stored metadata that executes correctly today.
 * Specifically NOT refused, because the runtime does not refuse them:
 *
 * - **`in: []` / `not_in: []`.** An empty list is a legitimate declared predicate
 *   — "matches nothing" / "matches everything" — and the runtime gate says so in
 *   as many words. Arity is not this check's business for membership; only "is it
 *   a list at all".
 * - **A scalar operator carrying an array** (`equals: ['a','b']`). `equals`
 *   lowers to a bare `{ field: value }` deep-equality comparand
 *   (`convertComparison`), which every backend answers.
 * - **A string operator carrying a number** (`contains: 5`). Lowers to
 *   `$contains: 5`; no backend refuses it.
 * - **A unary operator carrying a value** (`is_empty: ''`). The null predicates
 *   take their direction from the operator NAME — `convertComparison` maps them
 *   to `{ $null: true|false }` and ignores the value position entirely — and the
 *   ObjectUI client deliberately sends a truthy PLACEHOLDER value for both
 *   `isnull` and `isnotnull`. Refusing it would break a live first-party producer
 *   to enforce nothing.
 *
 * ## Why `superRefine` and not `z.discriminatedUnion` (measured, not assumed)
 *
 * 1. **`z.discriminatedUnion` cannot read this discriminator — it does not
 *    construct.** `operator` is `z.preprocess(normalizeFilterOperator, z.enum(…))`
 *    — the alias fold that lets a stored `notIn` / `nin` / `gt` parse. Zod 4
 *    extracts a discriminator's literal values from the option's own def, and a
 *    preprocess wrapper hides them: building the union throws
 *    `Invalid discriminated union option at index "0"` before any parse happens.
 *    The alias fold is load-bearing ({@link VIEW_FILTER_OPERATOR_ALIASES} exists
 *    for stored metadata) and is not negotiable to buy a union.
 * 2. **A refinement adds no JSON-Schema structure.** Measured with
 *    `z.toJSONSchema` before and after: byte-identical output. `ui/ViewFilterRule`
 *    is a PUBLISHED def whose authorable key set is a ratchet of exactly three
 *    entries (`authorable-surface/ui.json`). A union fans that one def into N
 *    branches re-declaring the same three keys per branch — the phantom
 *    liveness-worklist inflation #7042 measured and refused for
 *    `ViewContainerWireSchema` one screen down — and ObjectUI's SchemaForm would
 *    stop rendering the single operator dropdown it renders today.
 * 3. **Error quality points at the defect.** A refinement emits ONE issue at path
 *    `['value']` naming the operator, the received shape and the expected one. A
 *    union emits every branch's failure and leads with the discriminator, i.e. it
 *    blames `operator` for a defect that is in `value`.
 *
 * In Zod 4 a refinement lives INSIDE the schema rather than wrapping it in a
 * `ZodEffects`, so `.shape` and the `ZodObject` class survive (measured) and
 * every carrier — `z.array(ViewFilterRuleSchema)` on `ListView.filter`, a tab
 * filter, `Page.filterBy`, a related-list filter and a lookup picker filter —
 * keeps working untouched.
 *
 * ## The wording is the runtime's wording (#5240)
 *
 * The leading sentence is kept verbatim from `nonListComparandError` /
 * `malformedRangeComparandError` so one condition keeps one wording across the
 * two moments it can be reported. The TAIL deliberately differs: the runtime's
 * closing fact is "the filter was NOT applied", which is false here — nothing
 * ran, the metadata is being refused — so this one prescribes the fix instead.
 */
function checkViewFilterRuleValueShape(
  rule: { field?: unknown; operator?: unknown; value?: unknown },
  ctx: z.RefinementCtx,
): void {
  // `operator` is read POST-parse, so it is already folded to canonical by
  // `normalizeFilterOperator`: a stored `notIn` is `not_in` here, and this check
  // never has to know the alias table.
  const operator = rule.operator as ViewFilterOperator;
  const value = rule.value;
  const field = typeof rule.field === 'string' ? rule.field : '<field>';

  const isList = (VIEW_FILTER_LIST_VALUE_OPERATORS as readonly string[]).includes(operator);
  const isPair = (VIEW_FILTER_PAIR_VALUE_OPERATORS as readonly string[]).includes(operator);

  if (isList) {
    if (Array.isArray(value)) return;
    ctx.addIssue({
      code: 'custom',
      path: ['value'],
      message:
        `Operator "${operator}" on field "${field}" requires an ARRAY of values. `
        + `Received ${describeFilterValue(value)} (${previewFilterValue(value)}). `
        + `"${operator}" tests membership of a list — write `
        + `${value === undefined ? '["…"]' : previewFilterValue([value])} for a single value, `
        + `or use ${operator === 'in' ? '"equals"' : '"not_equals"'} to compare against it. `
        + `An empty list [] is allowed and is a real predicate. This is refused at authoring `
        + `time because the query path refuses it too (400 INVALID_FILTER, #5869).`,
    });
    return;
  }

  if (!isPair) return;
  if (Array.isArray(value) && value.length === 2) return;
  ctx.addIssue({
    code: 'custom',
    path: ['value'],
    message:
      `Operator "${operator}" on field "${field}" requires a [min, max] value array. `
      + `Received ${describeFilterValue(value)} (${previewFilterValue(value)}). `
      + `A range needs exactly two bounds, in order. This is refused at authoring time `
      + `because the query path refuses it too (400 INVALID_FILTER, #5869).`,
  });
}

/**
 * View Filter Rule Schema
 * Standardized filter condition used in list views, tabs, and page-level filters.
 * Uses a declarative array-of-objects format: [{ field, operator, value }].
 *
 * ⚠️ [#5074] CLOSED — this is the authoring shape, and it rejects the console's
 * row `id`. #5114 had reopened it as a provisional hotfix, explicitly pending
 * this split; that hotfix is now retired rather than left standing.
 *
 * **Why the reopen was needed, and why it no longer is.** The filter builder
 * objectui renders stamps `id: crypto.randomUUID()` on every row it creates
 * (`components/src/custom/filter-builder.tsx:228`; stamped again when a stored
 * filter is read back into the builder —
 * `plugin-view/src/config/view-config-utils.ts:146`/`:160`). `saveMetaItem`
 * validates the PUT body and then persists the AUTHORED body verbatim, so that
 * `id` is on the wire and in the store. Closed *without* a wire route, this
 * shape turned every filter write carrying one into a 422 — measured on all
 * three paths, including the flattened personalization overlay that is the body
 * the console actually PUTs.
 *
 * The mechanism is the part worth carrying, and it is why a top-level reopen
 * could never have rescued this block: **`.strip()` does not recurse**, any more
 * than `.strict()` does. `ViewMetadataSchema` re-opens its wire members' TOP
 * level only, so a nested block closed here is still reached through those
 * members at full strictness. Same finding as `ListView.sort` at #4001 批 18
 * (#5070), one block over.
 *
 * `id` is still NOT declared here. It is a React list key, not protocol:
 * declaring it would put a UI artifact on the authorable surface and tell an AI
 * author to generate a UUID for a filter rule — a `??` fallback wearing a
 * schema. Instead the WIRE door removes it before validating, via the declared
 * {@link VIEW_CONSOLE_ROW_DECORATIONS} vocabulary and
 * {@link stripViewConsoleDecorations} — the write-path mirror of
 * `stripReadDecorations`, and the piece that makes the wire opening
 * recursive-effective where a `.strip()` cannot reach. So the authoring surface
 * stays exactly three keys and the console's own writes still parse.
 *
 * Recorded in three places: this JSDoc, `view-filter-rule-wire-id.test.ts`, and
 * the `ui/` row of `docs/audits/2026-07-unknown-key-strictness-ledger.md`.
 *
 * @example
 * ```ts
 * filter: [
 *   { field: 'status', operator: 'equals', value: 'active' },
 *   { field: 'close_date', operator: 'after', value: '2024-01-01' },
 *   { field: 'archived_at', operator: 'is_empty' },
 * ]
 * ```
 */
export const ViewFilterRuleSchema = lazySchema(() => strictObject({
  surface: 'this filter rule',
  history: VIEW_HISTORY,
  guidance: {
    id: VIEW_CONSOLE_ROW_ID_GUIDANCE,
  },
}, {
  /** Field name to filter on */
  field: z.string().describe('Field name to filter on'),
  /**
   * Filter operator (canonical vocabulary). Legacy shorthand/camelCase
   * spellings (`eq`, `gt`, `isNull`, …) are accepted and normalized to
   * canonical on parse.
   */
  operator: z.preprocess(normalizeFilterOperator, z.enum(VIEW_FILTER_OPERATORS))
    .describe('Filter operator'),
  /**
   * Filter value (optional for unary operators like is_empty, is_null).
   *
   * The accepted SHAPE is coupled to `operator` by
   * {@link checkViewFilterRuleValueShape} (#6227).
   */
  value: z.union([z.string(), z.number(), z.boolean(), z.null(), z.array(z.union([z.string(), z.number()]))])
    .optional().describe(
      'Filter value. The accepted SHAPE depends on the operator: `in` / `not_in` take an '
      + 'array (any length, including []), `between` takes exactly [min, max], every other '
      + 'operator takes a scalar. The unary operators (is_empty / is_not_empty / is_null / '
      + 'is_not_null) take their direction from the operator name and ignore this key.',
    ),
}).superRefine(checkViewFilterRuleValueShape).describe('View filter rule'));

export type ViewFilterRule = z.input<typeof ViewFilterRuleSchema>;
/** Post-parse shape of {@link ViewFilterRule} — defaults applied, transforms run (ADR-0122). */
export type ViewFilterRuleParsed = z.infer<typeof ViewFilterRuleSchema>;

/**
 * Column Summary Function Schema
 * Aggregation function for column footer (Airtable-style column summaries)
 */
export const ColumnSummarySchema = lazySchema(() => z.enum([
  'none',
  'count',
  'count_empty',
  'count_filled',
  'count_unique',
  'percent_empty',
  'percent_filled',
  'sum',
  'avg',
  'min',
  'max',
]).describe('Aggregation function for column footer summary'));

/**
 * Column Summary Configuration Schema
 *
 * The object form of `ListColumn.summary`. Use it when the footer aggregates a
 * field OTHER than the column's own — e.g. an `amount` column whose footer sums
 * `amount_in_base_currency`. The shorthand (`summary: 'sum'`) stays the common
 * case and always aggregates the column's own `field`.
 *
 * `type` reuses `ColumnSummarySchema`, so both forms share one aggregation
 * vocabulary and cannot drift apart.
 */
export const ColumnSummaryConfigSchema = lazySchema(() => strictObject({
  surface: 'this column summary configuration',
  history: VIEW_HISTORY,
}, {
  type: ColumnSummarySchema.describe('Aggregation function'),
  field: z.string().optional().describe('Field to aggregate (defaults to the column field)'),
}).describe('Column footer summary configuration'));

/**
 * Column Prefix Configuration Schema (Airtable-style compound cells)
 *
 * Renders a second field's value inline before the cell value — e.g. a status
 * badge in front of the record name — so a list can carry two signals in one
 * column without spending a second column on it.
 */
export const ColumnPrefixSchema = lazySchema(() => strictObject({
  surface: 'this column prefix',
  history: VIEW_HISTORY,
}, {
  field: z.string().describe('Field whose value renders before the cell value'),
  type: z.enum(['badge', 'text']).default('text').describe('How the prefix value is rendered'),
}).describe('Compound-cell prefix configuration'));

/**
 * List Column Configuration Schema
 * Detailed configuration for individual list view columns
 */
export const ListColumnSchema = lazySchema(() => strictObject({
  surface: 'this list column',
  history: VIEW_HISTORY,
}, {
  field: z.string().describe('Field name (snake_case)'),
  label: I18nLabelSchema.optional().describe('Display label override'),
  width: z.number().positive().optional().describe('Column width in pixels'),
  align: z.enum(['left', 'center', 'right']).optional().describe('Text alignment'),
  hidden: z.boolean().optional().describe('Hide column by default'),
  sortable: z.boolean().optional().describe('Allow sorting by this column'),
  resizable: z.boolean().optional().describe('Allow resizing this column'),
  wrap: z.boolean().optional().describe('Allow text wrapping'),
  type: z.string().optional().describe('Renderer type override (e.g., "currency", "date")'),

  /** Pinning (Airtable-style frozen columns) */
  pinned: z.enum(['left', 'right']).optional().describe('Pin/freeze column to left or right side'),

  /** Column Footer Summary (Airtable-style aggregation) */
  summary: z.union([ColumnSummarySchema, ColumnSummaryConfigSchema]).optional()
    .describe('Footer aggregation for this column — the function alone, or { type, field } to aggregate another field'),

  /** Compound cell (Airtable-style): render another field inline before the value */
  prefix: ColumnPrefixSchema.optional().describe('Field rendered inline before this cell value'),

  /** Interaction */
  link: z.boolean().optional().describe('Functions as the primary navigation link (triggers View navigation)'),
  action: z.string().optional().describe('Registered Action ID to execute when clicked'),
}));

/**
 * List View Selection Configuration
 */
export const SelectionConfigSchema = lazySchema(() => strictObject({
  surface: 'this selection configuration',
  history: VIEW_HISTORY,
}, {
  type: z.enum(['none', 'single', 'multiple']).default('none').describe('Selection mode'),
}));

/**
 * List View Pagination Configuration
 */
export const PaginationConfigSchema = lazySchema(() => strictObject({
  surface: 'this pagination configuration',
  history: VIEW_HISTORY,
}, {
  pageSize: z.number().int().positive().default(25).describe('Number of records per page'),
  pageSizeOptions: z.array(z.number().int().positive()).optional().describe('Available page size options'),
}));

/**
 * Row Height / Density Schema (Airtable-style)
 * Controls the visual density of rows in a list view.
 */
export const RowHeightSchema = lazySchema(() => z.enum([
  'compact',     // Minimal padding, single line
  'short',       // Reduced padding
  'medium',      // Default padding
  'tall',        // Extra padding, multi-line preview
  'extra_tall',  // Maximum padding, rich content preview
]).describe('Row height / density setting for list view'));

/**
 * Grouping Field Configuration
 * Defines a single grouping level for record grouping.
 */
export const GroupingFieldSchema = lazySchema(() => strictObject({
  surface: 'this grouping field',
  history: VIEW_HISTORY,
}, {
  field: z.string().describe('Field name to group by'),
  order: z.enum(['asc', 'desc']).default('asc').describe('Group sort order'),
  collapsed: z.boolean().default(false).describe('Collapse groups by default'),
}));

/**
 * Grouping Configuration Schema (Airtable-style)
 * Supports multi-level grouping for grid/gallery views.
 */
export const GroupingConfigSchema = lazySchema(() => strictObject({
  surface: 'this grouping configuration',
  history: VIEW_HISTORY,
}, {
  fields: z.array(GroupingFieldSchema).min(1).describe('Fields to group by, in nesting order — the first entry is the outermost group and each later entry nests one level deeper (at least one field)'),
}).describe('Record grouping configuration'));

/**
 * Gallery View Configuration (Airtable-style)
 * Configures card layout for gallery/card views.
 */
export const GalleryConfigSchema = lazySchema(() => strictObject({
  surface: 'this gallery configuration',
  history: VIEW_HISTORY,
}, {
  coverField: z.string().optional().describe('Attachment/image field to display as card cover'),
  coverFit: z.enum(['cover', 'contain']).default('cover').describe('Image fit mode for card cover'),
  cardSize: z.enum(['small', 'medium', 'large']).default('medium').describe('Card size in gallery view'),
  titleField: z.string().optional().describe('Field to display as card title'),
  visibleFields: z.array(z.string()).optional().describe('Fields to display on card body'),
}).describe('Gallery/card view configuration'));

/**
 * Timeline View Configuration (Airtable-style)
 * Configures timeline/chronological views.
 */
export const TimelineConfigSchema = lazySchema(() => strictObject({
  surface: 'this timeline configuration',
  history: VIEW_HISTORY,
}, {
  startDateField: z.string().describe('Field for timeline item start date'),
  endDateField: z.string().optional().describe('Field for timeline item end date'),
  titleField: z.string().describe('Field to display as timeline item title'),
  groupByField: z.string().optional().describe('Field to group timeline rows'),
  colorField: z.string().optional().describe('Field to determine item color'),
  scale: z.enum(['hour', 'day', 'week', 'month', 'quarter', 'year']).default('week').describe('Default timeline scale'),
}).describe('Timeline view configuration'));

/**
 * View Sharing Configuration (Airtable-style)
 * Defines who can see and modify a view.
 */
export const ViewSharingSchema = lazySchema(() => strictObject({
  surface: 'this view sharing',
  history: VIEW_HISTORY,
}, {
  type: z.enum(['personal', 'collaborative']).default('collaborative').describe('View ownership type'),
  lockedBy: z.string().optional().describe('User who locked the view configuration'),
}).describe('View sharing and access configuration'));

/**
 * Row Color Configuration (Airtable-style)
 * Defines how rows are colored based on field values.
 */
export const RowColorConfigSchema = lazySchema(() => strictObject({
  surface: 'this row color configuration',
  history: VIEW_HISTORY,
}, {
  field: z.string().describe('Field to derive color from (typically a select/status field)'),
  colors: z.record(z.string(), z.string()).optional().describe('Map of field value to color (hex/token)'),
}).describe('Row color configuration based on field values'));

/**
 * Visualization Type Schema
 * Whitelist of visualization types the user can switch between.
 * Maps to Airtable's "Visualizations" setting in Appearance panel.
 */
export const VisualizationTypeSchema = lazySchema(() => z.enum([
  'grid',
  'kanban',
  'gallery',
  'calendar',
  'timeline',
  'gantt',
  'map',
  'chart',
  'tree',
]).describe('Visualization type that users can switch to'));

/**
 * User Actions Configuration Schema (Airtable Interface parity)
 * Controls which interactive actions are available to users in the view toolbar.
 * Each boolean toggles the corresponding toolbar element on/off.
 *
 * @see Airtable Interface → "User actions" panel
 */
export const UserActionsConfigSchema = lazySchema(() => strictObject({
  surface: 'this user actions configuration',
  history: VIEW_HISTORY,
}, {
  sort: z.boolean().default(true).describe('Allow users to sort records'),
  search: z.boolean().default(true).describe('Allow users to search records'),
  filter: z.boolean().default(true).describe('Allow users to filter records'),
  refresh: z.boolean().default(true).describe('Allow users to reload the view data from the backend without a full page reload'),
  rowHeight: z.boolean().default(true).describe('Allow users to toggle row height/density'),
  addRecordForm: z.boolean().default(false).describe('Add records through a form instead of inline'),
  editInline: z.boolean().default(false).describe('Allow users to edit records inline — click a cell to edit it with the field\'s type-aware widget (the same control the form uses). Off by default: the list is read-only unless the author opts in.'),
  buttons: z.array(z.string()).optional().describe('Custom action button IDs to show in the toolbar'),
}).describe('User action toggles for the view toolbar'));

/**
 * Appearance Configuration Schema (Airtable Interface parity)
 * Controls visual presentation options for the view.
 *
 * @see Airtable Interface → "Appearance" panel
 */
export const AppearanceConfigSchema = lazySchema(() => strictObject({
  surface: 'this appearance configuration',
  history: VIEW_HISTORY,
}, {
  showDescription: z.boolean().default(true).describe('Show the view description text'),
  allowedVisualizations: z.array(VisualizationTypeSchema).optional()
    .describe('Whitelist of visualization types users can switch between (e.g. ["grid", "gallery", "kanban"])'),
}).describe('Appearance and visualization configuration'));

/**
 * View Tab Schema (Airtable Interface parity)
 * Defines a tab in a multi-tab view interface.
 * Each tab references a named list view and can be ordered, pinned, or set as default.
 *
 * @see Airtable Interface → "Tabs" panel
 */
export const ViewTabSchema = lazySchema(() => strictObject({
  surface: 'this view tab',
  history: VIEW_HISTORY,
}, {
  name: SnakeCaseIdentifierSchema.describe('Tab identifier (snake_case)'),
  label: I18nLabelSchema.optional().describe('Display label'),
  icon: z.string().optional().describe('Tab icon name'),
  view: z.string().optional().describe('Referenced list view name from listViews'),
  filter: z.array(ViewFilterRuleSchema).optional().describe('Tab-specific filter criteria'),
  order: z.number().int().min(0).optional().describe('Tab display order'),
  pinned: z.boolean().default(false).describe('Pin tab (cannot be removed by users)'),
  isDefault: z.boolean().default(false).describe('Set as the default active tab'),
  visible: z.boolean().default(true).describe('Tab visibility'),
}).describe('Tab configuration for multi-tab view interface'));

/**
 * User Filter Field Schema (ADR-0047)
 * One field exposed as a quick-filter control in the end-user filter bar.
 * Rendering details (widget, options) default to inference from the field
 * definition on the source object — authors only override when needed.
 *
 * @see Airtable Interface → "User filters" panel (Dropdowns element)
 */
export const UserFilterFieldSchema = lazySchema(() => strictObject({
  surface: 'this user filter field',
  history: VIEW_HISTORY,
}, {
  field: z.string().describe('Field name on the source object (must exist — checked by reference diagnostics)'),
  label: I18nLabelSchema.optional().describe('Display label override (defaults to the field label)'),
  type: z.enum(['select', 'multi-select', 'boolean', 'date-range', 'text']).optional()
    .describe('Filter control type. Omit to infer from the field definition'),
  options: z.array(strictObject({
    surface: 'this user filter option',
    history: VIEW_HISTORY,
    // Measured against the renderer that consumes these entries
    // (objectui `plugin-list/src/UserFilters.tsx` — `ResolvedOption`): it
    // declares exactly `label` / `value` / `color` plus a `count` it COMPUTES
    // from a data snapshot on every render. `count` is therefore not an
    // authoring key — an authored one is overwritten before it is read, which
    // is why it gets a wrong-layer prescription instead of being declared.
    guidance: {
      count: 'Per-option record counts are computed from the data, not authored. Set `showCount: true` on the filter FIELD to display them.',
    },
  }, {
    value: z.union([z.string(), z.number(), z.boolean()]).describe('Option value'),
    label: I18nLabelSchema.describe('Option label'),
    color: z.string().optional().describe('Option color token/hex'),
  })).optional().describe('Static options. Omit to derive from the field definition (select options / lookup records)'),
  showCount: z.boolean().optional().describe('Show per-option record counts'),
  defaultValues: z.array(z.union([z.string(), z.number(), z.boolean()])).optional()
    .describe('Pre-selected values when the view loads'),
}).describe('Quick-filter field configuration'));

/**
 * User Filters Schema (ADR-0047, Airtable Interface parity)
 * The end-user-facing quick-filter surface above a list. The author picks the
 * element style and which fields/presets are exposed; end users combine them
 * at runtime (session-scoped — selections never persist as metadata).
 *
 * Distinct from `ListView.filter` (the always-on base criteria) and from the
 * advanced filter builder (`userActions.filter` toggle).
 *
 * @see Airtable Interface → "User filters" panel (Elements: tabs / dropdowns)
 */
/**
 * CLOSED at **#5073** — the last shape #4001 批 18 left open in this file, and
 * the one that needed a protocol decision before strictness could touch it.
 *
 * ## Why it could not just be closed (the 批 18 blocker)
 *
 * objectui's renderer reads `config.allowAddTab` and renders an "add tab"
 * affordance from it (`packages/plugin-list/src/UserFilters.tsx:182` and
 * `:742`); its own `UserFiltersSchema` declared the key. The spec's did not —
 * and the difference between the two shapes was *exactly* that one key.
 *
 * That gap was not inert, because the metadata write path does NOT persist
 * `parsed.data`: `saveMetaItem` validates with `safeParse` and then stores the
 * ORIGINAL body verbatim, precisely so Studio-only auxiliary keys survive
 * (`metadata-protocol/src/protocol.ts`, "Validation policy"). So an authored
 * `allowAddTab` was stripped only from the parse RESULT, which is discarded —
 * the stored document kept it and the renderer read it. **The capability
 * worked.** Closing the shape without declaring the key would have converted a
 * working, shipped config into a 422 whose message named a key the author was
 * right to write — this campaign's finding 7 (the platform's own authority
 * steering an author into deleting something that worked), not the silent-strip
 * defect the campaign exists to kill.
 *
 * ## The resolution: promote, then close (maintainer adjudication, 2026-08-04)
 *
 * `allowAddTab` is DECLARED here (additive), so the capability is discoverable
 * from the contract — JSON Schema, Studio's SchemaForm and an AI author all see
 * it, instead of it living only in one React file. Then the shape closes, in
 * the same change, so there is no intermediate state where the key is declared
 * but neighbours still vanish silently. Rejected alternative: judging it an
 * objectui-only extension (`SANCTIONED_LOCAL`), which would have made
 * `packages/spec` and objectui two sources of truth for one contract — the
 * fork #2231's derive-by-reference unification exists to prevent (PD#12).
 *
 * ⚠️ Scope of the promotion, and its RESOLUTION (#5236 → #6961). At promotion
 * time `allowAddTab` was described as declaring only that the tab bar RENDERS
 * an add-tab affordance: the button objectui rendered carried no click handler,
 * so it was presentational, and the narrower wording was deliberate — a
 * contract promising "end users can add presets" would have advertised a
 * capability the runtime did not deliver (PD#10). The maintainer then ruled
 * **A1 — implement, session-scoped** (#5236, 2026-08-06), objectui#3926
 * delivered it (`packages/plugin-list/src/UserFilters.tsx` — naming popover,
 * snapshot of the applied filters, component state only, remove affordance on
 * the added tab), and the `.describe()` below was upgraded back to the real
 * semantics. The narrowing was the interim state the ruling closed, not the
 * contract: the key now promises the behaviour, and PD#10 is satisfied by the
 * delivery rather than by the hedge.
 *
 * ## What closing flips, and why that flip is wanted (批 6e's question)
 *
 * 批 6e left this open pending "does anything rely on the strip to NARROW a
 * page-shaped block?". It does, and the relier is in this file:
 * {@link ObjectUserFiltersSchema} is `UserFiltersSchema.omit({ tabs,
 * showAllRecords, allowAddTab })`, and `.omit()` inherits the base's posture,
 * so closing this base flips `object-list-view.test.ts`'s pin from "drops the
 * page-only keys" to "rejects" them. That flip is CORRECT and wanted: the CLI
 * lint (`packages/lint/src/validate-list-view-mode.ts`) already reports a
 * `tabs`-carrying `userFilters` on an object view, so the two doors used to
 * disagree — the bespoke guard warning while the schema silently dropped.
 * Closing makes them agree. See {@link ObjectUserFiltersSchema} for why that
 * inheritance is not left bare.
 */
export const UserFiltersSchema = lazySchema(() => strictObject({
  surface: 'these user filters',
  history: VIEW_HISTORY,
}, {
  // `toggle` is DEPRECATED (ADR-0047 §3.4a): it overlaps `tabs` (presets) and
  // `dropdown` (per-field values) without adding expressive power, needs
  // per-field defaultValues to be useful, and authoring tooling no longer
  // offers it (None / Tabs / Dropdown only). Kept in the enum so existing
  // configs keep rendering; do not author new `toggle` filters.
  element: z.enum(['dropdown', 'tabs', 'toggle']).default('dropdown')
    .describe('Filter control style: "dropdown" (per-field value selectors) or "tabs" (named presets). "toggle" is deprecated.'),
  fields: z.array(UserFilterFieldSchema).optional()
    .describe('Fields exposed as quick filters (dropdown/toggle elements)'),
  tabs: z.array(ViewTabSchema).optional()
    .describe('Named filter presets rendered as tabs (tabs element). Reuses ViewTabSchema'),
  showAllRecords: z.boolean().optional()
    .describe('Show an "All records" tab before the presets (tabs element)'),
  allowAddTab: z.boolean().optional()
    .describe('Let end users add their own tab after the presets (tabs element): the affordance asks for a name and snapshots the filters currently applied as a new tab. SESSION-SCOPED — an added tab lives only for the current mount, is never written back as metadata (ADR-0047), and carries a remove control the authored presets do not. Page lists only — object views use `listViews` for named presets'),
}).describe('End-user quick-filter configuration (Airtable "User filters" parity)'));

/**
 * Add Record Configuration Schema (Airtable Interface parity)
 * Configures the "Add Record" entry point for a list view.
 *
 * @see Airtable Interface → "+ Add record" button
 */
export const AddRecordConfigSchema = lazySchema(() => strictObject({
  surface: 'this add record configuration',
  history: VIEW_HISTORY,
}, {
  enabled: z.boolean().default(true).describe('Show the add record entry point'),
  position: z.enum(['top', 'bottom', 'both']).default('bottom').describe('Position of the add record button'),
  mode: z.enum(['inline', 'form', 'modal']).default('inline').describe('How to add a new record'),
  formView: z.string().optional().describe('Named form view to use when mode is "form" or "modal"'),
}).describe('Add record entry point configuration'));

/**
 * Kanban Settings
 */
export const KanbanConfigSchema = lazySchema(() => strictObject({
  surface: 'this kanban configuration',
  history: VIEW_HISTORY,
}, {
  groupByField: z.string().describe('Field to group columns by (usually status/select)'),
  summarizeField: z.string().optional().describe('Field to sum at top of column (e.g. amount)'),
  columns: z.array(z.string()).describe('Fields to show on cards'),
}));

/**
 * List Chart View Configuration (Airtable-style)
 * Configures aggregate chart visualizations (bar/line/pie/area/scatter)
 * when used as a `type: 'chart'` ListView. Distinct from the full-featured
 * `ChartConfigSchema` in `chart.zod.ts` (which is for embedded reports).
 */
export const ListChartConfigSchema = lazySchema(() => strictObject({
  surface: 'this list chart configuration',
  history: VIEW_HISTORY,
}, {
  /**
   * Narrowed from `ChartTypeSchema` with `.extract()` rather than retyped.
   * Same five members as before — this is a de-duplication, not a widening —
   * but a member renamed in the chart taxonomy now fails here at build time
   * instead of leaving a second list quietly disagreeing with the first.
   */
  chartType: ChartTypeSchema.extract(['bar', 'line', 'pie', 'area', 'scatter'])
    .default('bar').describe('Chart visualisation type'),
  /**
   * ADR-0021 — the semantic-layer `dataset` this chart binds to. Selects
   * dimensions/measures BY NAME so the chart's numbers stay consistent with
   * every other surface using the same dataset. This is the single author-facing
   * shape (the legacy inline `xAxisField` + `yAxisFields` + `aggregation` query
   * was removed in the cutover).
   */
  dataset: SnakeCaseIdentifierSchema.describe('Dataset name to bind (ADR-0021)'),
  /** Dimension names (from the dataset) for X / group / split. */
  dimensions: z.array(z.string()).optional().describe('Dimension names — X/group/split'),
  /** Measure names (from the dataset) for the value axis. */
  values: z.array(z.string()).min(1).describe('Measure names — Y (at least one)'),
}).describe('List chart view configuration'));

/**
 * Calendar Settings
 */
export const CalendarConfigSchema = lazySchema(() => strictObject({
  surface: 'this calendar configuration',
  history: VIEW_HISTORY,
}, {
  startDateField: z.string().describe('Field providing the event start date/time'),
  endDateField: z.string().optional().describe('Field providing the event end date/time (defaults to a single-day event)'),
  titleField: z.string().describe('Field displayed as the event title'),
  colorField: z.string().optional().describe('Field whose value determines the event color'),
}));

/**
 * Quick filter dimension for the Gantt toolbar.
 */
export const GanttQuickFilterSchema = lazySchema(() => strictObject({
  surface: 'this gantt quick filter',
  history: VIEW_HISTORY,
}, {
  field: z.string().describe('Record field / dot-path the dimension filters on'),
  label: z.string().optional().describe('Trigger label (falls back to the field label)'),
  options: z.array(z.union([
    z.string(),
    strictObject({
      surface: 'this gantt quick-filter option',
      history: VIEW_HISTORY,
      // Sibling contract: the user-filter option entry two blocks up spells the
      // display text `label` and the stored value `value`. Gantt's entry is the
      // same pair minus `color`, so the same near-misses apply.
      aliases: { text: 'label', title: 'label', name: 'label', key: 'value', id: 'value' },
    }, {
      value: z.union([z.string(), z.number()]),
      label: z.string().optional(),
    }),
  ])).optional().describe('Explicit option override for fixed enums'),
}));

/**
 * Gantt Settings
 *
 * Beyond the core timeline fields, the renderer supports a two-level
 * parent/child hierarchy (parentField/typeField), planned-vs-actual baselines,
 * dynamic grouping, a resource/workload view, hover tooltips and quick filters.
 */
export const GanttConfigSchema = lazySchema(() => strictObject({
  surface: 'this gantt configuration',
  history: VIEW_HISTORY,
}, {
  startDateField: z.string().describe('Field providing the task start date'),
  endDateField: z.string().describe('Field providing the task end date'),
  titleField: z.string().describe('Field displayed as the task title'),
  progressField: z.string().optional().describe('Field providing the task completion percentage'),
  dependenciesField: z.string().optional().describe("Field listing the task's predecessor (dependency) record ids"),
  colorField: z.string().optional().describe('Field that drives the bar color'),
  // Two-level hierarchy: a parent task id (summary bar) and a row type.
  parentField: z.string().optional().describe('Field holding the parent task id (builds the summary → step tree)'),
  typeField: z.string().optional().describe('Field whose value maps to task/summary/milestone'),
  // Planned-vs-actual reference bars.
  baselineStartField: z.string().optional().describe('Baseline (planned) start field'),
  baselineEndField: z.string().optional().describe('Baseline (planned) end field'),
  // Dynamic grouping: bucket leaf tasks under one synthesized summary per value.
  groupByField: z.string().optional().describe('Field to group leaf tasks by (synthesized summary rows)'),
  // Resource / workload view.
  resourceView: z.boolean().optional().describe('Render a per-resource workload histogram instead of the timeline'),
  assigneeField: z.string().optional().describe('Resource field to bucket load by (resource view)'),
  effortField: z.string().optional().describe('Per-task load units (resource view; default 1)'),
  capacity: z.number().optional().describe('Per-resource capacity ceiling; loads above this flag overload'),
  // Hover tooltip + quick filters.
  tooltipFields: z.array(z.union([
    z.string(),
    strictObject({
      surface: 'this gantt tooltip field',
      history: VIEW_HISTORY,
      // ⚠️ The PARENT (`GanttConfigSchema`) is deliberately `.passthrough()` so
      // renderer-ahead knobs reach plugin-gantt. That openness is the parent's
      // and does NOT recurse: this entry is a closed `{ field, label }` pair,
      // which is exactly the shape objectui's `GanttView` tooltip resolver
      // reads. Closing the entry inside an open parent is the nested hole 批 13
      // found on `responsive` — strictness is per object, not per subtree.
      aliases: { name: 'field', fieldName: 'field', text: 'label', title: 'label' },
    }, { field: z.string(), label: z.string().optional() }),
  ])).optional().describe('Fields to surface in the hover tooltip, in display order'),
  quickFilters: z.array(GanttQuickFilterSchema).optional().describe('Multi-select filter dropdowns rendered above the chart'),
  autoZoomToFilter: z.boolean().optional().describe('When true (default), filtering zooms the range to the filtered tasks'),
// Forward-compatible: the gantt renderer (objectui plugin-gantt) keeps adding
// config knobs (e.g. lockField / defaultCollapsedDepth) ahead of this schema.
// Passthrough lets those extra fields reach the renderer instead of being
// stripped here, so a renderer release no longer has to wait on a spec release.
}).passthrough());

/**
 * Tree (tree-grid) Settings
 *
 * Renders a self-referencing object as an indented, expand/collapse tree-grid.
 * Flat records are nested via a single-parent pointer field (`parentField`).
 * Unlike a fixed-depth `grouping`, a tree handles arbitrary depth (org charts,
 * category trees, BOMs, nested comments). When `parentField` is omitted the
 * renderer auto-detects the object's `tree`/self-reference field.
 */
export const TreeConfigSchema = lazySchema(() => strictObject({
  surface: 'this tree configuration',
  history: VIEW_HISTORY,
}, {
  parentField: z.string().optional().describe('Single-parent pointer field (auto-detected from the object schema when omitted)'),
  labelField: z.string().optional().describe('Field rendered indented in the first column (defaults to "name")'),
  fields: z.array(z.string()).optional().describe('Additional fields rendered as flat columns alongside the label'),
  defaultExpandedDepth: z.number().int().min(0).optional().describe('Initial expansion depth (0 = roots only; omit = expand all)'),
// Forward-compatible: let renderer-ahead config knobs reach plugin-tree.
}).passthrough());

/**
 * Navigation Mode Enum
 * Defines how to navigate to the detail view from a list item.
 */
export const NavigationModeSchema = lazySchema(() => z.enum([
  'page',       // Navigate to a new route (default)
  'drawer',     // Open details in a side drawer/panel
  'modal',      // Open details in a modal dialog
  'split',      // Show details side-by-side with the list (master-detail)
  'popover',    // Show details in a popover (lightweight)
  'new_window', // Open in new browser tab/window
  'none'        // No navigation (read-only list)
]));

/**
 * Navigation Configuration Schema
 */
export const NavigationConfigSchema = lazySchema(() => strictObject({
  surface: 'this navigation configuration',
  history: VIEW_HISTORY,
}, {
  mode: NavigationModeSchema.default('page'),
  
  /** Target View Config */
  view: z.string().optional().describe('Name of the form view to use for details (e.g. "summary_view", "edit_form")'),
  
  /** Interaction Triggers */
  preventNavigation: z.boolean().default(false).describe('Disable standard navigation entirely'),
  openNewTab: z.boolean().default(false).describe('Force open in new tab (applies to page mode)'),
  
  /**
   * [#2578] Overlay size for a drawer/modal detail — coarse T-shirt buckets,
   * aligned with `FormView.modalSize` (`page` mode ignores it). `'auto'`
   * (default): the renderer derives the size from the object's field count and
   * clamps it to the client viewport, so AI writes nothing — it cannot know the
   * client width. Explicit buckets are a coarse, viewport-independent override.
   */
  size: z.enum(['auto', 'sm', 'md', 'lg', 'xl', 'full']).default('auto')
    .describe("[#2578] Overlay size bucket for drawer/modal detail: 'auto' (default — renderer derives from field count + viewport; AI writes nothing) or a coarse override sm/md/lg/xl/full. Prefer this over the pixel `width`; page mode ignores it."),

  /**
   * @deprecated [#2578 → `size`] A pixel/percent width cannot be authored blind:
   * the author (often an AI) does not know the client viewport. Kept only as a
   * renderer fallback for pre-#2578 metadata; new metadata sets `size` (or omits
   * it for `auto`).
   */
  width: z.union([z.string(), z.number()]).optional().describe('[DEPRECATED → size] Pixel/percent width of the drawer/modal (e.g. "600px"). A pixel width cannot be chosen at authoring time without knowing the client viewport — use the `size` bucket.'),
}));

/**
 * List View Schema (Expanded)
 * Defines how a collection of records is displayed to the user.
 * 
 * **NAMING CONVENTION:**
 * View names (when provided) are machine identifiers and must be lowercase snake_case.
 * 
 * @example Standard Grid
 * {
 *   name: "all_active",
 *   label: "All Active",
 *   type: "grid",
 *   columns: ["name", "status", "created_at"],
 *   filter: [["status", "=", "active"]]
 * }
 * 
 * @example Kanban Board
 * {
 *   type: "kanban",
 *   columns: ["name", "amount"],
 *   kanban: {
 *     groupByField: "stage",
 *     summarizeField: "amount",
 *     columns: ["name", "close_date"]
 *   }
 * }
 */
export const ListViewSchema = lazySchema(() => strictObject({
  surface: 'this list view',
  history: VIEW_HISTORY,
}, {
  name: SnakeCaseIdentifierSchema.optional().describe('Internal view name (lowercase snake_case)'),
  label: I18nLabelSchema.optional(), // Display label override (supports i18n)
  type: z.enum([
    'grid',       // Standard Data Table
    'kanban',     // Board / Columns
    'gallery',    // Card Deck / Masonry
    'calendar',   // Monthly/Weekly/Daily
    'timeline',   // Chronological Stream (Feed)
    'gantt',      // Project Timeline
    'map',        // Geospatial
    'chart',      // Aggregate visualisation
    'tree'        // Self-referencing hierarchy (tree-grid)
  ]).default('grid'),
  
  /** Data Source Configuration */
  data: ViewDataSchema.optional().describe('Data source configuration (defaults to "object" provider)'),
  
  /** Shared Query Config */
  columns: z.union([
    z.array(z.string()), // Legacy: simple field names
    z.array(ListColumnSchema), // Enhanced: detailed column config
  ]).describe('Fields to display as columns'),
  filter: z.array(ViewFilterRuleSchema).optional().describe('Filter criteria (JSON Rules)'),
  /**
   * Sort order. Prefer the structured `{ field, order }[]` form.
   *
   * @deprecated The bare string form (`"field desc"`) is legacy and retained
   * only for backward compatibility (it was the exact shape that crashed the
   * renderer in objectui#2601 — kept covered by a live fixture). Removal will
   * go through its own deprecation cycle; do not drop it here.
   */
  /**
   * ⚠️ [#5074] CLOSED — the entry is the authoring shape and rejects the
   * console's row `id`. 批 18 closed it, hit a live 422, and reverted (#5070);
   * that revert was explicitly provisional pending this split.
   *
   * The close carries `direction → order`, the #4721 alias for the identical
   * tuple: `{ field, direction: 'desc' }` used to parse to `{ field, order:
   * 'asc' }` — a silently REVERSED sort, which is the reason closing this entry
   * was worth doing at all.
   *
   * What made the first attempt a regression: `view-metadata-schema.test.ts`
   * pins `sort: [{ id, field, order }]` as *"the exact shape
   * normalizeViewMetadata persists on a console column-sort PUT"*, and `id` is
   * a UI row identity objectui stamps per row
   * (`components/src/custom/sort-builder.tsx:68`, `:94` —
   * `crypto.randomUUID()`), persisted verbatim because `saveMetaItem` stores the
   * original body. **`.strip()` on a wire member could not rescue it** — it
   * re-opens the TOP level only, and this is a nested block reached through that
   * member. See {@link stripViewConsoleDecorations}, which removes the
   * decoration on the wire door instead, at every depth.
   *
   * `id` is still NOT declared: it is a React list key, and declaring it would
   * put a UI artifact on the authorable surface and teach an AI author to emit
   * one (批 18 Q1, two-axis rejection on record).
   */
  sort: z.union([
    z.string(), //Legacy "field desc"
    z.array(strictObject({
      surface: 'this sort entry',
      history: VIEW_HISTORY,
      aliases: {
        // #4721: the same tuple under a different word. Edit distance cannot
        // reach it, and getting it wrong reverses the sort silently.
        direction: 'order',
      },
      guidance: {
        id: VIEW_CONSOLE_ROW_ID_GUIDANCE,
      },
    }, {
      field: z.string(),
      order: z.enum(['asc', 'desc'])
    }))
  ]).optional(),
  
  /** Search & Filter */
  searchableFields: z.array(z.string()).optional().describe('Fields enabled for search'),
  filterableFields: z.array(z.string()).optional().describe('Legacy shorthand for userFilters.fields — bare field names enabled for end-user filtering. Prefer userFilters'),

  /** User Filters (ADR-0047, Airtable Interface parity) */
  userFilters: UserFiltersSchema.optional()
    .describe('End-user quick-filter bar: dropdown/toggle fields or tab presets. Omit to let the renderer derive filters from select/boolean fields'),

  /** Grid Features */
  resizable: z.boolean().optional().describe('Enable column resizing'),
  striped: z.boolean().optional().describe('Striped row styling'),
  bordered: z.boolean().optional().describe('Show borders'),
  compactToolbar: z.boolean().optional().describe('Collapse Group/Color/Density/Hide-fields into a single View settings popover'),

  /** Selection */
  selection: SelectionConfigSchema.optional().describe('Row selection configuration'),

  /** Navigation / Interaction */
  navigation: NavigationConfigSchema.optional().describe('Configuration for item click navigation (page, drawer, modal, etc.)'),

  /** Pagination */
  pagination: PaginationConfigSchema.optional().describe('Pagination configuration'),

  /** Type Specific Config */
  kanban: KanbanConfigSchema.optional().describe('Kanban-board configuration — applies when the view renders as a kanban layout'),
  calendar: CalendarConfigSchema.optional().describe('Calendar configuration — applies when the view renders as a calendar layout'),
  gantt: GanttConfigSchema.optional().describe('Gantt-timeline configuration — applies when the view renders as a gantt layout'),
  gallery: GalleryConfigSchema.optional(),
  timeline: TimelineConfigSchema.optional(),
  chart: ListChartConfigSchema.optional(),
  tree: TreeConfigSchema.optional().describe('Tree/hierarchy configuration — applies when the view renders as a tree layout'),

  /** View Metadata (Airtable-style view management) */
  description: I18nLabelSchema.optional().describe('View description for documentation/tooltips'),
  sharing: ViewSharingSchema.optional().describe('View sharing and access configuration'),

  /** Row Height / Density (Airtable-style) */
  rowHeight: RowHeightSchema.optional().describe('Row height / density setting'),

  /** Record Grouping (Airtable-style) */
  grouping: GroupingConfigSchema.optional().describe('Group records by one or more fields'),

  /** Row Color (Airtable-style) */
  rowColor: RowColorConfigSchema.optional().describe('Color rows based on field value'),

  /** Field Visibility & Ordering per View (Airtable-style) */
  hiddenFields: z.array(z.string()).optional().describe('Fields to hide in this specific view'),
  fieldOrder: z.array(z.string()).optional().describe('Explicit field display order for this view'),

  /** Row & Bulk Actions */
  rowActions: z.array(z.string()).optional().describe('Actions available for individual row items'),
  bulkActions: z.array(z.string()).optional().describe('Actions available when multiple rows are selected'),
  bulkActionDefs: z.array(BulkActionDefSchema).optional().describe(
    'Rich bulk action definitions (schema-driven, executed via BulkActionDialog). Use a def for a '
    + "mass data-plane mutation ('update' with a `patch` / 'delete') that no action expresses, or for "
    + "an `operation: 'custom'` + `execution: 'aggregate'` entry (objectui#3139) that dispatches the "
    + 'action it NAMES once for the whole selection — the renderer injects `params._selectedIds: '
    + 'string[]` (read that on the server, not `recordId`) so a single call can produce one aggregate '
    + 'artifact (zip of QR codes, merged PDF, batch print). Aggregate results are all-or-nothing: a '
    + 'handler that cannot cover the whole selection must reject, and per-row retry is replaced by '
    + 're-running the action. `batchSize` does not apply (the call is never chunked); set `maxRecords` '
    + "on defs whose server work is expensive. For the PER-RECORD dispatch use `bulkActions: ['<name>']` "
    + 'instead — the bare-string form, promoted with the action\'s own label, params and `visible`; a '
    + "'custom' def without `execution: 'aggregate'` has no dispatcher and is refused at parse time "
    + '(#4457). Toolbar url/api actions can also interpolate the current selection via '
    + '`${ctx.selection.ids}` / `${ctx.selection.count}`.',
  ),

  /** Performance */
  virtualScroll: z.boolean().optional().describe('Enable virtual scrolling for large datasets'),

  /** Conditional Formatting */
  conditionalFormatting: z.array(strictObject({
    surface: 'this conditional formatting rule',
    history: VIEW_HISTORY,
    // `visibleWhen` is the ADR-0089 spelling for a predicate on view/page, so
    // an author borrowing it here is using a neighbouring surface's correct
    // word — the `visibleWhen → visible` category #3746 named, not a typo.
    aliases: { when: 'condition', expression: 'condition', visibleWhen: 'condition', rule: 'condition', styles: 'style', css: 'style' },
    // `rowColor` is a real, DIFFERENT capability on the same view; pointing a
    // colour-only author at the block that already does it beats making them
    // hand-write a style map.
    guidance: {
      color: 'Row colouring by field value has its own block — see `rowColor` on this list view. To set a CSS colour from a predicate, put it in `style`: `{ condition, style: { color: "#b91c1c" } }`.',
    },
  }, {
    condition: ExpressionInputSchema.describe('Predicate (CEL) to evaluate.'),
    style: z.record(z.string(), z.string()).describe('CSS styles to apply when condition is true'),
  })).optional().describe('Conditional formatting rules for list rows'),

  /** Inline Edit */
  inlineEdit: z.boolean().optional().describe('Allow inline editing of records directly in the list view'),

  /** Export */
  exportOptions: z.array(z.enum(['csv', 'xlsx', 'pdf', 'json'])).optional().describe('Available export format options'),

  /** User Actions (Airtable Interface parity) */
  userActions: UserActionsConfigSchema.optional().describe('User action toggles for the view toolbar'),

  /** Appearance (Airtable Interface parity) */
  appearance: AppearanceConfigSchema.optional().describe('Appearance and visualization configuration'),

  /** Tabs (Airtable Interface parity) */
  tabs: z.array(ViewTabSchema).optional().describe('Tab definitions for multi-tab view interface'),

  /** Add Record (Airtable Interface parity) */
  addRecord: AddRecordConfigSchema.optional().describe('Add record entry point configuration'),

  /** Record Count Display (Airtable Interface parity) */
  showRecordCount: z.boolean().optional().describe('Show record count at the bottom of the list'),

  /** Advanced: Allow Printing (Airtable Interface parity) */
  allowPrinting: z.boolean().optional().describe('Allow users to print the view'),

  /** Empty State */
  emptyState: strictObject({
    surface: 'this empty state',
    history: VIEW_HISTORY,
    // `description`/`text`/`subtitle` are the words the neighbouring empty-state
    // vocabularies use for the secondary line; here it is `message`.
    aliases: { description: 'message', text: 'message', subtitle: 'message', heading: 'title', label: 'title', image: 'icon' },
    // The add-record entry point is a real, separate block on this same view —
    // an author wiring a CTA into the empty state is reaching for it.
    guidance: {
      action: 'The empty state renders text only. Configure the "add record" entry point in the `addRecord` block on this list view.',
      button: 'The empty state renders text only. Configure the "add record" entry point in the `addRecord` block on this list view.',
    },
  }, {
    title: I18nLabelSchema.optional(),
    message: I18nLabelSchema.optional(),
    icon: z.string().optional(),
  }).optional().describe('Empty state configuration when no records found'),

  /** ARIA accessibility attributes */
  aria: AriaPropsSchema.optional().describe('ARIA accessibility attributes for the list view'),

  // `responsive` / `performance` REMOVED (#3896 audit close-out): authorable
  // and inert — no renderer in either repo read them (re-grepped 2026-07-16,
  // objectui@fb35e48; ledger: dead).
  responsive: retiredKey(
    '`view.responsive` was removed in @objectstack/spec 17.0.0 (#3896 audit close-out) — ' +
    'no renderer ever read it; the grid is responsive by its own layout rules. Delete the key. ' +
    'Run `os migrate meta --from 16` to rewrite existing sources automatically.',
  ),
  performance: retiredKey(
    '`view.performance` was removed in @objectstack/spec 17.0.0 (#3896 audit close-out) — ' +
    'no renderer or runtime read it; list-view performance tuning was never implemented. ' +
    'Delete the key. ' +
    'Run `os migrate meta --from 16` to rewrite existing sources automatically.',
  ),
}));

/**
 * Non-recursive half of {@link FormFieldSchema} — every key except the
 * recursive `fields`.
 *
 * Split out so the recursion can be TYPED. `z.lazy()` needs an explicit
 * annotation to break the circular inference, and the `z.ZodType<any>` this
 * schema used to carry made `FormField` resolve to `any` for every consumer
 * (#4171): a precise 30-key contract silently reduced to a type that constrains
 * nothing, with no compile error anywhere to say so. Inferring the base and
 * closing the recursive loop in the type instead keeps the keys derived from the
 * schema — the `QueryAST` pattern in `data/query.zod.ts`.
 *
 * Still `lazySchema`-wrapped: splitting the literal out of the exported schema's
 * factory would otherwise have moved its construction back to module load, which
 * is the allocation `lazySchema` exists to defer.
 */
/**
 * [#4001 批 18] Deliberately still a BARE `z.object` — and the ledger row for
 * this site is a measurement artifact, not open surface.
 *
 * Two reasons were recorded; #6619 retired one of them and left the other
 * standing, which is why the posture here did not move with the fold:
 *
 * 1. **The posture here was never the live one.** This base is module-private
 *    and has exactly ONE consumer, {@link FormFieldSchema}, which applies
 *    `.strict()` after extending it (ADR-0089 D3a). An unknown form-field key
 *    is already rejected at the only door; the ledger reads `strip` because it
 *    counts the BASE, and the base is not a door. Still true — and it is why
 *    this site takes `strictObjectError` rather than `strictObject`: the fold
 *    is a change to what the message can SAY, and closing this shape as a side
 *    effect would have been an acceptance change smuggled in with it.
 * 2. ~~It already carries a bespoke error map.~~ **Retired by #6619.** The
 *    ADR-0089 map that resolves the `visibleWhen` / `visibility` pair is no
 *    longer bespoke: it is `VISIBILITY_STRICT_OPTIONS`, a shared `strictObject`
 *    options fragment whose prescription rides the template's set-keyed
 *    `guidance` channel. `strictObjectError` builds exactly the map
 *    `strictObject` would and registers the surface with
 *    `alias-integrity.test.ts` — the audit this site used to sit outside — with
 *    the shape left open for the extension to close.
 *
 * `extraKeys: ['fields']` is the base/extension boundary the helper documents:
 * the candidate list is read from THIS shape, and `fields` is declared one
 * level up by the extension that also closes it, so naming it here is what
 * keeps `feilds` pointing at `fields` instead of at `field`.
 *
 * Spelled as a literal `z.object(shape, { error: strictObjectError(…) })`
 * rather than through a wrapper on purpose: the strictness ledger's AST reader
 * (`scripts/lib/strictness-ledger.ts`) recognises the `z.object(` idiom and
 * counts this site's OPEN posture — the row `ui/view.zod.ts` carries as its
 * one `authorable` strip site. A wrapper would hide the site from the
 * instrument entirely, which is a gate going quiet, not a posture change.
 *
 * The nested `keyField` block below IS converted: strictness does not recurse,
 * so a closed parent said nothing about it.
 */
/**
 * [#7467] Public-lookup opt-in for a lookup / `master_detail` / `user` field on
 * an ANONYMOUS public form.
 *
 * This block GATES the REST public-lookup capability: `GET
 * /forms/:slug/lookup/:field` answers a picker search only for a field whose
 * form declaration carries `publicPicker`. Without it the route answers `403
 * LOOKUP_NOT_PUBLIC` — loud by design (#3022), so a misconfigured form is a
 * visible refusal rather than a silently empty picker. The public-form resolve
 * route enforces the same opt-in from the other side: an undeclared
 * lookup/master_detail/user field is stripped from the rendered sections, so an
 * anonymous form can never expose unrestricted record search by accident.
 *
 * Until #7467 this key was ENFORCED but declared nowhere — the mirror image of
 * ADR-0049's "declared ≠ enforced": `FormFieldSchema` is strict (ADR-0089 D3a),
 * so every authoring path refused a form carrying a picker and the capability
 * was unreachable. Declaring it is the maintainer-ruled direction (option 1 of
 * that card's fork).
 *
 * Every key below mirrors a read the route actually performs
 * (`packages/rest/src/rest-server.ts`, `GET /forms/:slug/lookup/:field`
 * handler), and NOTHING else: this block opens an unauthenticated search
 * surface, so the schema deliberately admits no option the route does not
 * enforce. The route's own hard bounds are encoded rather than restated in
 * prose — `displayFields` beyond the first 5 are never projected (the route
 * slices), a `maxResults` above 50 is never honored (the route clamps), so
 * authoring either is refused here instead of silently meaning less than it
 * says. Anonymous visitors can search but cannot paginate (`offset` is pinned
 * to 0 server-side), which is what keeps a leaked endpoint from enumerating
 * the table.
 *
 * @example Opt a lookup field into the public picker
 * { field: 'owner', publicPicker: { displayFields: ['name'], maxResults: 10 } }
 */
export const FormFieldPublicPickerSchema = lazySchema(() => strictObject({
  surface: 'this public picker configuration',
  history: VIEW_HISTORY,
}, {
  /**
   * Projection: the fields returned for each picker row (plus `id`), and the
   * search target — the visitor's `q` is matched with `contains` against the
   * FIRST entry. The route projects at most 5 and defaults to `['name']` when
   * omitted, so more than 5 (or an empty list) is refused here rather than
   * silently truncated / silently replaced.
   */
  displayFields: z.array(z.string()).min(1).max(5).optional().describe(
    'Fields projected into each picker result (with `id`); the visitor\'s search matches '
    + '`contains` on the first entry. At most 5 (the route projects no more); omitted → [\'name\'].',
  ),
  /**
   * Per-request result cap. The route clamps to a hard ceiling of 50 and
   * defaults to 20; anonymous visitors cannot paginate, so this bounds what a
   * single request can pull. Values the route would never honor (0, negatives,
   * fractions, > 50) are refused at authoring time.
   */
  maxResults: z.number().int().min(1).max(50).optional().describe(
    'Maximum rows a lookup returns (default 20, hard ceiling 50 — the route clamps; anonymous '
    + 'visitors cannot paginate past it).',
  ),
  /**
   * Static pre-filter, ANDed ahead of the visitor's search predicate. Same
   * rule dialect as every other view filter (`ViewFilterRuleSchema`) — the
   * route composes these rows with its own `{ field, operator: 'contains',
   * value: q }` search row in one filters list.
   */
  filter: z.array(ViewFilterRuleSchema).optional().describe(
    'Static pre-filter rows ANDed ahead of the visitor\'s search (e.g. only active records are '
    + 'searchable). Same `{ field, operator, value }` dialect as list-view filters.',
  ),
  /**
   * Referenced-object override. Omitted, the route resolves the target from
   * the field definition on the parent object (`referenceTo`); set it only
   * when that resolution is wrong for this form.
   */
  object: z.string().optional().describe(
    'Referenced-object override for the picker search; omitted → resolved from the field '
    + 'definition (`referenceTo`).',
  ),
}).describe('Public-lookup opt-in: enables GET /forms/:slug/lookup/:field for this field on an anonymous public form (without it the route answers 403 LOOKUP_NOT_PUBLIC).'));

/** Authoring shape of {@link FormFieldPublicPickerSchema}. */
export type FormFieldPublicPicker = z.input<typeof FormFieldPublicPickerSchema>;
/** Post-parse shape of {@link FormFieldPublicPicker} — filter-rule operator aliases folded (ADR-0122). */
export type FormFieldPublicPickerParsed = z.infer<typeof FormFieldPublicPickerSchema>;

const FormFieldBaseSchema = lazySchema(() => {
  const shape = {
  /** Field name (snake_case) */
  field: z.string().describe('Field name (snake_case)'),
  
  /** Field type — reuses Data.FieldType. When set, widget is auto-inferred (can be overridden). */
  type: FieldType.optional().describe('Field type (auto-infers widget if omitted)'),
  
  /** Select/multiselect options — only needed when type=select/multiselect/radio/checkboxes */
  options: z.array(SelectOptionSchema).optional().describe('Options for select/multiselect/radio/checkboxes fields'),
  
  /** Reference object for lookup/master_detail fields */
  reference: z.string().optional().describe('Target object name for lookup/master_detail fields'),

  /**
   * [#7467] Public-lookup opt-in (lookup / master_detail / user fields on an
   * anonymous public form). Gates `GET /forms/:slug/lookup/:field` — absent,
   * the route answers 403 LOOKUP_NOT_PUBLIC (loud by design, #3022) and the
   * resolve route strips the field from the rendered sections. See
   * {@link FormFieldPublicPickerSchema}.
   */
  publicPicker: FormFieldPublicPickerSchema.optional().describe(
    'Opt this field into the anonymous public-form lookup picker (GET /forms/:slug/lookup/:field). '
    + 'Without it the route answers 403 LOOKUP_NOT_PUBLIC and the field is stripped from the '
    + 'rendered public form.',
  ),
  
  /** Text constraints */
  maxLength: z.number().optional().describe('Maximum character length (for text/textarea/email/url/phone)'),
  minLength: z.number().optional().describe('Minimum character length'),
  
  /** Number constraints */
  min: z.number().optional().describe('Minimum value (for number/currency/percent/slider)'),
  max: z.number().optional().describe('Maximum value'),
  precision: z.number().optional().describe('Total digits (for number/currency)'),
  scale: z.number().optional().describe('Decimal places'),
  
  /** Multi-value flag */
  multiple: z.boolean().optional().describe('Allow multiple values (for select/lookup/file/image)'),
  
  /** UI overrides */
  label: I18nLabelSchema.optional().describe('Display label override'),
  placeholder: I18nLabelSchema.optional().describe('Placeholder text'),
  helpText: I18nLabelSchema.optional().describe('Help/hint text'),
  readonly: z.boolean().optional().describe('Read-only override'),
  immutable: z.boolean().optional().describe('Editable on create, locked once the record exists (e.g. machine names).'),
  required: z.boolean().optional().describe('Required override'),
  hidden: z.boolean().optional().describe('Hidden override'),
  colSpan: z.number().int().min(1).max(4).optional().describe('[legacy — prefer `span`] Absolute column span (1-4). Fragile when the column count is derived per surface (mobile 1 / modal 2 / page 3-4): a fixed span only lines up at the width the author imagined. The renderer clamps it to the current column count. Prefer `span`.'),
  /**
   * [#2578] Relative field width — decoupled from the (often auto-derived)
   * column count, so it stays correct at 1/2/3/4 columns.
   */
  span: z.enum(['auto', 'full']).default('auto').describe("Relative field width. 'auto' (default — omit it): the renderer sizes the field from its widget type × the current column count (wide widgets like textarea/richtext/json/file/subform take the whole row). 'full': whole row at any column count. Prefer this over the absolute `colSpan`."),

  /** Custom widget override — only needed when auto-inference is insufficient */
  widget: z.string().optional().describe('Custom widget/component name (overrides type-based inference)'),

  /** For `code` fields: source language (e.g. 'javascript', 'sql', 'json', 'typescript', 'expression', 'cel'). Drives syntax highlighting. */
  language: z.string().optional().describe('Code editor language (for type=code)'),

  /**
   * For `record`-typed fields only. Declares how the map key is sourced,
   * displayed, and validated when an admin creates a new entry.
   *
   * The same identifier is also stored as `name` on the inner value (so
   * `record.fields[k].name === k`). Most callers can omit this and accept
   * the defaults: `{ field: 'name', label: 'Name', regex: /^[a-z_][a-z0-9_]*$/, immutable: true }`.
   *
   * See ADR-0007 (record form field type).
   */
  keyField: strictObject({
    surface: 'this record key field',
    history: VIEW_HISTORY,
    // The enclosing form field IS strict (ADR-0089 D3a `.strict()` on
    // `FormFieldSchema`), but strictness does not recurse — this nested block
    // kept dropping keys silently inside a closed parent, the same nested hole
    // 批 13 measured on `responsive`.
    aliases: { key: 'field', name: 'field', pattern: 'regex', placeHolder: 'placeholder', help: 'helpText', hint: 'helpText' },
  }, {
    field: z.string().default('name').describe('Property name that holds the key inside each item (defaults to "name")'),
    label: I18nLabelSchema.optional().describe('Display label for the key column'),
    placeholder: I18nLabelSchema.optional().describe('Placeholder when entering a new key'),
    helpText: I18nLabelSchema.optional().describe('Help text under the key input'),
    /** Validation pattern serialised as a regex source string (no flags). */
    regex: z.string().optional().describe('JS regex source string the key must match (no flags)'),
    /** Renamable after creation? Defaults to false — keys are usually identifiers. */
    immutable: z.boolean().default(true).describe('If true, the key is read-only after creation'),
  }).optional().describe('Key column config for record-typed fields'),

  dependsOn: z.string().optional().describe('Parent field name for cascading'),
  /**
   * Conditional-visibility predicate (CEL) — the field is shown only when TRUE
   * (ADR-0089, canonical `*When` name). Binding root depends on the surface:
   * runtime record forms bind `record` (plus `previous`, the saved record, and
   * `parent` for master-detail line items); metadata-editing forms
   * (`*.form.ts`) bind the row under edit as `data`.
   *
   * ⚠️ **No `current_user` here** (#6146). Field-level rules are evaluated by
   * `evalFieldPredicate` / `resolveFieldRuleState` (`@object-ui/core`), which
   * binds `record` + `previous` + an `extra` scope and nothing else — the
   * autocomplete pins the same set (objectui#1582). A predicate referencing
   * `current_user` is an UNBOUND identifier: the evaluation faults and falls
   * back, and visibility's fallback is `true`, so the field a `current_user`
   * test was meant to hide stays **permanently visible**. `current_user` IS
   * bound for **per-option** `visibleWhen` (a different evaluator —
   * `resolveCascadingOptions` against the host's predicate scope, ADR-0068 /
   * objectui#2284); that is the only `*When` surface where it resolves.
   *
   * **Inside a repeater, `data` is the ROW, not the whole document** (#6254).
   * A sub-field of a `type: 'record'` / repeater field is rendered with its own
   * activation — the metadata form renderer evaluates each sub-field predicate
   * as `evaluatePredicate(spec.visibleOn, { data: row })` — so `data.type`
   * means *this row's* `type`, which is what a per-entry rule wants. The root
   * is still spelled `data` at every depth: there is no implicit row scope, so
   * a BARE identifier (`type == 'formula'`) is unbound and the predicate faults
   * open, showing the field for every row — the same fail-open direction the
   * `current_user` note above describes, arriving from the other end. Prefix
   * every reference with `data.` whether the field sits at the top level or
   * inside a repeater.
   */
  visibleWhen: ExpressionInputSchema.optional().describe("Visibility predicate (CEL) — field shown only when TRUE. Root: `record` (+ `previous`, `parent`) in runtime forms, or `data` in metadata forms. No `current_user` at field level — it is unbound here and the predicate would fault open (per-option `visibleWhen` is the surface that binds it). Inside a repeater `data` is the ROW, but it is still spelled `data` — a bare identifier is unbound and faults open too. e.g. P`record.priority == 'urgent'`"),
  /** @deprecated ADR-0089 — use `visibleWhen`. Accepted and normalized to `visibleWhen` at parse. */
  visibleOn: ExpressionInputSchema.optional().describe('[DEPRECATED → `visibleWhen`] Visibility predicate (CEL). Normalized to `visibleWhen` at parse.'),
  disclosure: z.enum(['inline', 'popover']).optional().describe('Composite rendering: inline bordered box (default) or a summary line + gear popover (progressive disclosure).'),
  };
  return z.object(shape, {
    error: strictObjectError({
      ...VISIBILITY_STRICT_OPTIONS,
      extraKeys: ['fields'],
      // The one member of the `visibleWhen` family that can answer `disabled`
      // with a key of its own (#7832). `VISIBILITY_STRICT_OPTIONS` is shared
      // with `FormSectionSchema` and `PageComponentSchema`, and neither of those
      // declares a read-only or disabled slot, so this row belongs HERE rather
      // than in the shared table — filed there it would name a key two of its
      // three surfaces do not accept. `visible` / `showWhen` need nothing: they
      // match `VISIBILITY_KEY_PATTERN` and are already answered by the shared
      // ADR-0089 prescription, which consumes the key before the rename channel
      // is consulted, so an alias for either would be dead on arrival.
      aliases: { disabled: 'readonly' },
    }, shape),
  });
});

/**
 * A parsed form field — the TYPE half of {@link FormFieldSchema}.
 *
 * `visibleOn` is absent by construction: ADR-0089 D2 folds it into
 * `visibleWhen` at the schema boundary, so it is accepted on input and never
 * present on output.
 */
export type FormField = Omit<z.infer<typeof FormFieldBaseSchema>, 'visibleOn'> & {
  /**
   * Sub-fields for `composite` / `repeater` / `record` types — declares
   * the inner shape of an embedded sub-object (composite), each row of
   * an embedded sub-object array (repeater), or each entry of a name-keyed
   * map (record). Recursive: any of the three can nest.
   *
   * Use `lookup` / `master_detail` instead when the children are independent
   * records with their own IDs in a separate object/table.
   */
  fields?: FormField[];
};

/**
 * The authoring shape of a form field — the INPUT half of
 * {@link FormFieldSchema} (#4195).
 *
 * Differs from {@link FormField} in both directions, which is exactly why it
 * has to be declared: `span` is `.default('auto')` so it is optional here and
 * required there, and the deprecated `visibleOn` is accepted here and stripped
 * by the ADR-0089 D2 transform before it reaches the output.
 *
 * Without this, `z.input<typeof FormFieldSchema>` was `unknown` — so a form
 * section's `fields` were unchecked at every authoring site.
 */
export type FormFieldInput = z.input<typeof FormFieldBaseSchema> & {
  /** Sub-fields for composite/repeater/record types. Recursive. */
  fields?: FormFieldInput[];
};

/**
 * Form Field Configuration Schema
 * Detailed configuration for individual form fields.
 *
 * Reuses Data.FieldType and related constraints from the Data protocol to avoid duplication.
 * The `type` field auto-infers widget rendering; explicit `widget` overrides are only needed
 * for custom components.
 *
 * @example Auto-inferred select widget
 * { field: 'status', type: 'select', options: [{ label: 'Open', value: 'open' }] }
 *
 * @example Lookup field with reference
 * { field: 'account_id', type: 'lookup', reference: 'account', label: 'Account' }
 *
 * @example Custom widget override
 * { field: 'filter', widget: 'filter-builder' }
 */
export const FormFieldSchema: z.ZodType<FormField, FormFieldInput> = lazySchema(() =>
  FormFieldBaseSchema.extend({
    fields: z.array(z.lazy(() => FormFieldSchema)).optional()
      .describe('Sub-fields for composite/repeater/record types'),
  }).strict().transform(normalizeVisibleWhen));

/**
 * Form Layout Section
 *
 * Closed under ADR-0089 D3a, and — since #6619 — closed with the SHARED
 * template rather than a bespoke map. #4001 skipped this shape because
 * converting it meant re-expressing `strictVisibilityError` as `guidance`, and
 * `guidance` could not express a family of keys; #6619 gave the channel a
 * set-keyed form and the conversion became the same one call every other closed
 * shape in this package makes. The `.transform()` that folds
 * `visibleOn` → `visibleWhen` is unchanged and still runs after the parse.
 */
export const FormSectionSchema = lazySchema(() => strictObject(VISIBILITY_STRICT_OPTIONS, {
  /**
   * Stable identifier for translation lookup. snake_case convention.
   * When provided, translation bundles can target this section's `label`
   * and `description` via `metadataForms.<type>.sections.<name>`.
   * Optional for backward-compat with sections that only have a `label`.
   */
  name: z.string().optional().describe('Stable section identifier for i18n lookup (snake_case)'),
  label: I18nLabelSchema.optional(),
  description: z.string().optional().describe('Optional description rendered under the section header.'),
  collapsible: z.boolean().default(false),
  collapsed: z.boolean().default(false),
  /**
   * Conditional-visibility predicate (CEL) — the whole section is shown only
   * when TRUE (ADR-0089, canonical `*When` name). Same per-layer binding root as
   * {@link FormFieldSchema.visibleWhen}: `record` (+ `previous`, `parent`) in
   * runtime forms, `data` in metadata-editing forms — and, as there, **no
   * `current_user`**: it is unbound at this level, so such a predicate faults
   * and falls back to visible (#6146).
   */
  visibleWhen: ExpressionInputSchema.optional().describe('Visibility predicate (CEL) — section shown only when TRUE. Root: `record` (+ `previous`, `parent`) in runtime forms, or `data` in metadata forms. No `current_user` at section level — it is unbound here and the predicate would fault open.'),
  /** @deprecated ADR-0089 — use `visibleWhen`. Accepted and normalized to `visibleWhen` at parse. */
  visibleOn: ExpressionInputSchema.optional().describe('[DEPRECATED → `visibleWhen`] Visibility predicate (CEL). Hides the whole section when false. Normalized to `visibleWhen` at parse.'),
  columns: z.union([
    z.enum(['1', '2', '3', '4']),
    z.literal(1),
    z.literal(2),
    z.literal(3),
    z.literal(4),
  ]).default(1).transform(val => (typeof val === 'string' ? parseInt(val) : val) as 1 | 2 | 3 | 4),
  /**
   * Which pane of a split form this section renders in (`type: 'split'` only —
   * any other form type rejects the key at parse, see the FormViewSchema
   * refinement). Placement is explicit and PER SECTION so it survives
   * reordering: with the old first-vs-rest positional rule the assignment was
   * invisible in the metadata, and an edit that reordered sections silently
   * moved them across the divider. Defaults by position when omitted: the
   * first section renders in `primary`, every other section in `secondary`
   * (exactly the legacy rule, so keyless metadata keeps its layout).
   */
  pane: z.enum(['primary', 'secondary']).optional().describe(
    "Split pane this section renders in (split forms only; a parse error elsewhere). Omitted → first section 'primary', others 'secondary'.",
  ),
  fields: z.array(z.union([
    z.string(), // Legacy: simple field name
    FormFieldSchema, // Enhanced: detailed field config
  ])),
}).transform(normalizeVisibleWhen));

/**
 * A single form action button (submit / cancel / reset): visibility + label.
 * Leaf of the {@link FormViewSchema} `buttons` block (#2998).
 * `.strict()` per ADR-0089 D3a so a typo'd key errors instead of vanishing.
 */
export const FormButtonConfigSchema = lazySchema(() => strictObject({
  surface: 'this form button configuration',
  history: VIEW_HISTORY,
}, {
  show: z.boolean().optional().describe('Whether the button is rendered (renderer default applies when omitted)'),
  label: I18nLabelSchema.optional().describe('Button label (i18n-capable; renderer default when omitted)'),
}).strict());
export type FormButtonConfig = z.input<typeof FormButtonConfigSchema>;

/** An object that may carry the `groups` alias beside canonical `sections`. */
type WithFormSectionAlias = { sections?: unknown; groups?: unknown };

/**
 * Fold the legacy `groups` alias onto the canonical `sections` and drop
 * `groups` from the output (#6926) — the whole-array counterpart of
 * `normalizeVisibleWhen`.
 *
 * ## What this makes true
 *
 * `groups` was declared with the inline comment *"Legacy support -> alias to
 * sections"* since the schema existed, and nothing in this repo ever performed
 * the fold. The alias was honored exactly ONE boundary downstream, inside the
 * renderer (objectui `spec-bridge/bridges/form-view.ts` `spec.sections ??
 * spec.groups`, and `plugin-form/ObjectForm.tsx`'s full legacy fold, shipped by
 * objectui#2545 because a `groups`-only spec had rendered nothing). Every
 * framework consumer that is NOT that renderer read `sections` only — so the
 * same authored form rendered in the console and degraded on the REST
 * public-form routes. Folding at the producer makes the declared alias true for
 * every consumer of a parsed form at once, instead of teaching each consumer a
 * second key to read (the lenient-consumer shape this package rejects).
 *
 * ## Precedence: `sections` wins
 *
 * Deliberately the renderer's own rule (`spec.sections ?? spec.groups`), so no
 * form that renders today changes what it renders. `??` treats an EMPTY array
 * as present, and so does this: `{ sections: [], groups: [...] }` folds to
 * `sections: []`, matching the renderer rather than inventing a merge.
 *
 * ⚠️ The two objectui folds disagree on exactly that input, and this rule picks
 * the PRIMARY path's answer. `spec-bridge/bridges/form-view.ts` uses `??`, so
 * an empty `sections` wins; `plugin-form/ObjectForm.tsx` gates on
 * `!folded.sections?.length`, so there the alias wins when `sections` is empty.
 * An alias is consulted when the canonical key is ABSENT — a fallback-on-empty
 * is a lenient-consumer accommodation, which is the shape this fold exists to
 * remove. Also note ObjectForm's fold rewrites sub-keys (`title` → `label`,
 * `defaultCollapsed` → `collapsed`): that is a renderer-local shape adaptation,
 * NOT spec semantics. This fold is `FormSectionSchema` → `FormSectionSchema`,
 * verbatim, with no sub-key rewriting.
 *
 * ## Why `.overwrite()` and not `.transform()` (measured, #6926)
 *
 * Both fold identically at parse. `.transform()` returns a `ZodPipe`, and this
 * schema is consumed as an OBJECT in two places in this file that a pipe breaks:
 * {@link FormViewOverlayWireSchema} builds the flattened form-overlay union
 * member with `FormViewSchema.extend(...)` (a pipe has no `.extend`), and
 * {@link selectViewMetadataBranch} reads `._zod.def.shape.type` through
 * `overlayTypeValues` — which a pipe answers with an EMPTY set, i.e. a silent
 * mis-dispatch rather than an error. Splitting into an object schema plus a
 * piped export would require re-applying the fold on the overlay branch by
 * hand, which is the re-transcription that lets two doors disagree.
 *
 * `.overwrite()` is zod 4's "transform that does not change the type", which is
 * precisely what a `FormSectionSchema[]` → `FormSectionSchema[]` alias fold is.
 * It keeps the schema a `ZodObject`, and `.extend()` INHERITS the check, so the
 * fold reaches every parse door with one declaration: `FormViewSchema` itself,
 * `ViewSchema.form` / `.formViews.*`, both `ViewItemSchema` form arms, and the
 * flattened `formOverlay` member of `ViewMetadataSchema`. The cost is that the
 * INFERRED output type still declares `groups?` even though a parsed form never
 * carries it; the runtime contract is the enforced one. (Narrowing the exported
 * `FormViewParsed` by hand is not the fix — ADR-0122's gate requires it to read
 * `z.infer<typeof FormViewSchema>` verbatim.)
 *
 * Deliberately NOT exported: it is an implementation detail of this one schema,
 * and a public fold helper is an invitation to fold a second time somewhere
 * else. Export it if and when a pre-parse door is ruled to need the same fold
 * (see "What this does NOT reach").
 *
 * ## Ordering: the `pane` refinement above still sees `groups`
 *
 * Checks run in attachment order, so the `.superRefine` is evaluated BEFORE
 * this fold and keeps reporting a misplaced `pane` at the path the author
 * actually wrote (`groups.0.pane`, not `sections.0.pane`). Attaching the fold
 * first would have re-pathed that message onto a key the author never typed.
 *
 * ## What this does NOT reach
 *
 * Only PARSED forms. Pre-parse consumers still see the authored key and are
 * right to: `packages/lint`'s view rules walk authored sources
 * (`validate-form-layout.ts`, `validate-visibility-predicates.ts`), and a
 * `sys_metadata` row saved through `saveMetaItem` is persisted VERBATIM (the
 * save validates and then discards `parsed.data` on purpose) and re-read
 * through the ADR-0087 stored-row conversion chain, which is not a zod parse.
 * The alias therefore stays legal at input — this fold narrows output, never
 * acceptance.
 */
function foldFormGroupsIntoSections<T extends WithFormSectionAlias>(
  input: T,
): Omit<T, 'groups'> {
  if (input.groups === undefined) return input as Omit<T, 'groups'>;
  const { groups, ...rest } = input;
  // `sections` wins when present — including when it is an empty array, which
  // is what the renderer's `??` does and therefore what authored forms already
  // render.
  if (rest.sections !== undefined) return rest as Omit<T, 'groups'>;
  return { ...rest, sections: groups } as Omit<T, 'groups'>;
}

/**
 * `submitBehavior: { kind: 'redirect' }` — the ruled shape of `url` (#7496,
 * maintainer ruling of 2026-08-11).
 *
 * ## What was ruled, and why the schema is where it lands
 *
 * objectui's `FormPage` performs a **verbatim redirect** on this value, and
 * objectui#4190 dead-ended asking what the value may be: nothing in this
 * package said whether it was a path, an address, or a template, so the
 * consumer could not be hardened without inventing the contract. The ruling
 * picked the narrowest shape with measured pull:
 *
 *  1. **relative paths only** — an absolute URL is refused. This is the
 *     open-redirect face: the post-submit target is authored metadata, and
 *     AI-authored metadata is exactly where an `https://` someone else chose
 *     gets copied in. Refusing the scheme form at the authoring door is a
 *     structural fix; escaping or allowlisting it at the consumer is not.
 *  2. **interpolation only from declared record fields**, every interpolated
 *     value **URL-escaped** when the redirect is built.
 *  3. a **verbatim redirect on the resolved relative path IS the intended
 *     consumption** — so the value that reaches `window.location.assign` is
 *     this string with its tokens substituted, and nothing else.
 *
 * Widening (e.g. an allowlist of absolute origins) waits for measured demand.
 *
 * ## Why `{{record.<field>}}` and not a fourth dialect
 *
 * The token spelling is not invented here: it is the ADR-0032 §3 double-brace
 * text template, whose variable scope is the CEL scope (`{{record.x}}` — see
 * `shared/expression.zod.ts`, `tmpl`). It is narrowed twice against that
 * dialect, because a redirect target has a much smaller honest scope than a
 * notification body: only the `record.` root is accepted (the record just
 * submitted is all the post-submit moment has), and only a **flat** field
 * segment, spelled with the same grammar `object.fields` keys are declared
 * under (`/^[a-z_][a-z0-9_]*$/`, `data/object.zod.ts`). A token that could
 * never name a field is refused here rather than substituted into a URL.
 *
 * ## What this refine can and cannot decide
 *
 * Parse time knows the *string*; it does not know the *object*. So the shape
 * (relative-only, token grammar, no smuggling) is enforced here, and whether
 * `{{record.foo}}` names a field this form's object actually declares is for
 * the layer that holds both — the reference-integrity family in
 * `@objectstack/lint`, which already resolves field references against object
 * declarations. Enforcing half loudly beats enforcing none.
 */
const SUBMIT_REDIRECT_RULING = 'ruled 2026-08-11 on #7496';

/** The ONE interpolation `submitBehavior.url` accepts. Global — used to strip. */
const SUBMIT_REDIRECT_URL_TOKEN_RE = /\{\{record\.[a-z_][a-z0-9_]*\}\}/g;

/**
 * A leading `scheme:` — `https:`, but equally `javascript:` and `data:`, which
 * are the same refusal for a stronger reason.
 */
const URL_SCHEME_RE = /^[a-z][a-z0-9+.-]*:/i;

/**
 * Whitespace and C0/DEL controls. Browsers **strip** leading control characters
 * and whitespace before resolving a URL, so any check that merely looks at
 * `raw[0]` can be walked past by prefixing one; refusing them outright is what
 * makes the leading-`/` rule mean what it reads like.
 */
const URL_SMUGGLE_RE = /[\s\u0000-\u001f\u007f]/;

/**
 * Validate a `submitBehavior: { kind: 'redirect' }` `url` against the ruling.
 * Returns the author-facing refusal, or `undefined` when the value conforms.
 *
 * Ordered most-specific first: an author who wrote `https://example.com/thanks`
 * is told about the open-redirect rule, not that their string lacks a `/`.
 */
function checkSubmitRedirectUrl(raw: string): string | undefined {
  if (raw === '') {
    return 'A `redirect` submit behavior needs a `url` — an empty string is not a destination. '
      + `Write the in-app path the submitter should land on, e.g. \`/thanks\` (${SUBMIT_REDIRECT_RULING}).`;
  }

  if (URL_SCHEME_RE.test(raw)) {
    return '`submitBehavior.url` accepts a RELATIVE path only, and this is an absolute URL '
      + `(${SUBMIT_REDIRECT_RULING}). A post-submit redirect that can leave the app is an open `
      + 'redirect, so the scheme form is refused at the authoring door rather than sanitized at the '
      + 'renderer. Write the in-app path instead — `/thanks`, not `https://example.com/thanks`. '
      + 'To send the browser OUT of the app deliberately, that is an app navigation item '
      + "(`{ type: 'url', url }`), which is declared for external addresses.";
  }

  if (raw.startsWith('//')) {
    return '`submitBehavior.url` accepts a RELATIVE path only, and a leading `//` is '
      + `protocol-relative — the browser reads \`//example.com/thanks\` as ANOTHER ORIGIN despite `
      + `the leading slash (${SUBMIT_REDIRECT_RULING}). Use a single leading slash for an in-app `
      + 'path; for a deliberate external link use an app navigation item (`{ type: \'url\', url }`).';
  }

  if (raw.includes('\\')) {
    return '`submitBehavior.url` must not contain a backslash — browsers normalise `\\` to `/` '
      + 'while resolving, so `/\\example.com` navigates off-origin exactly like `//example.com` '
      + `and would walk straight past the relative-only rule (${SUBMIT_REDIRECT_RULING}). `
      + 'Write the path with forward slashes; percent-encode a backslash that is genuinely part of '
      + 'a path segment (`%5C`).';
  }

  if (URL_SMUGGLE_RE.test(raw)) {
    return '`submitBehavior.url` must not contain whitespace or control characters — browsers strip '
      + 'them before resolving, so a leading one hides what the address really starts with and '
      + `defeats the relative-only rule (${SUBMIT_REDIRECT_RULING}). Percent-encode a space that `
      + 'belongs in the path (`%20`).';
  }

  // Braces are checked before the leading-`/` rule only in the sense that a
  // malformed token is reported on its own terms; the leading `/` is still
  // required, and a token therefore cannot open the path.
  const withoutTokens = raw.replace(SUBMIT_REDIRECT_URL_TOKEN_RE, '');
  if (withoutTokens.includes('{') || withoutTokens.includes('}')) {
    const offender = withoutTokens.match(/\{\{?[^{}]*\}?\}?/)?.[0] ?? '{';
    return '`submitBehavior.url` interpolates ONLY declared record fields, spelled '
      + `\`{{record.field_name}}\` — \`${offender}\` is not that shape (${SUBMIT_REDIRECT_RULING}). `
      + 'The record just submitted is the whole scope a post-submit redirect has, and the field '
      + 'segment takes the same lowercase snake_case grammar fields are declared under. Every '
      + 'interpolated value is URL-escaped when the redirect is built, so a token is a value in the '
      + 'path or query — never a way to add path structure.';
  }

  if (!raw.startsWith('/')) {
    return '`submitBehavior.url` must start with `/` — a document-relative path like `thanks` '
      + 'resolves against whichever console route the form happened to be opened from, so one form '
      + `lands in different places depending on how it was reached (${SUBMIT_REDIRECT_RULING}). `
      + 'Write the rooted in-app path: `/thanks`.';
  }

  return undefined;
}

/**
 * Form View Schema
 * Defines the layout for creating or editing a single record.
 *
 * @example Simple Sectioned Form
 * {
 *   type: "simple",
 *   sections: [
 *     {
 *       label: "General Info",
 *       columns: 2,
 *       fields: ["name", "status"]
 *     },
 *     {
 *       label: "Details",
 *       fields: ["description", { field: "priority", widget: "rating" }]
 *     }
 *   ]
 * }
 */
export const FormViewSchema = lazySchema(() => strictObject({
  surface: 'this form view',
  history: VIEW_HISTORY,
}, {
  type: z.enum([
    'simple',  // Single column or sections
    'tabbed',  // Tabs
    'wizard',  // Step by step
    'split',   // Side-by-side resizable panes; sections placed via `section.pane`
    'drawer',  // Side panel
    'modal'    // Dialog
  ]).default('simple'),

  // --- Presentation options (per `type` variant). These mirror what the
  // ObjectForm component accepts so the protocol declares them; all optional. ---
  /** Field layout within the form body. */
  layout: z.enum(['vertical', 'horizontal', 'inline', 'grid']).optional().describe('Field layout direction'),
  /** Number of columns for the form body (grid/multi-column layouts). */
  columns: z.number().int().min(1).optional().describe('Number of columns for the form body'),
  /** Optional form title / description (for embedded or standalone forms). */
  title: z.string().optional().describe('Form title'),
  description: z.string().optional().describe('Form description'),
  /** Tabbed (`type: 'tabbed'`). */
  defaultTab: z.string().optional().describe('Initially active tab (tabbed forms)'),
  tabPosition: z.enum(['top', 'bottom', 'left', 'right']).optional().describe('Tab strip position (tabbed forms)'),
  /** Wizard (`type: 'wizard'`). */
  allowSkip: z.boolean().optional().describe('Allow skipping steps (wizard forms)'),
  showStepIndicator: z.boolean().optional().describe('Show the step indicator (wizard forms)'),
  /** Split (`type: 'split'`). */
  splitDirection: z.enum(['horizontal', 'vertical']).optional().describe('Split orientation (split forms)'),
  splitSize: z.number().optional().describe('Primary split panel size, % (split forms)'),
  splitResizable: z.boolean().optional().describe('Whether the split is resizable (split forms)'),
  /** Drawer (`type: 'drawer'`). */
  drawerSide: z.enum(['top', 'bottom', 'left', 'right']).optional().describe('Drawer side (drawer forms)'),
  /** @deprecated [#2578 → `modalSize` / size buckets] A pixel width can't be authored blind (unknown client viewport); the renderer derives width from content + viewport. */
  drawerWidth: z.string().optional().describe('[DEPRECATED → size buckets] Drawer width, e.g. "480px". A pixel width cannot be chosen without knowing the client viewport — the renderer derives it.'),
  /** Modal (`type: 'modal'`). */
  modalSize: z.enum(['sm', 'default', 'lg', 'xl', 'full']).optional().describe('Modal size (modal forms)'),

  /**
   * Data Source Configuration. NOT removed in the #3896 sweep despite the
   * ledger's dead verdict — the removal attempt broke the build and thereby
   * re-verified the entry: `defineForm` (below) writes
   * `data: { provider: 'schema', schemaId }` onto EVERY metadata form, and
   * `metadata-protocol` serves it to the metadata-admin pipeline. The
   * record-form provider values (`object`/`api`/`value`) may still be
   * unread — that is a narrower value-subset audit, not a key removal.
   */
  data: ViewDataSchema.optional().describe('Data source configuration (defaults to "object" provider)'),

  sections: z.array(FormSectionSchema).optional(), // For simple layout
  /**
   * Legacy alias of {@link FormViewSchema.sections} — accepted at INPUT, folded
   * onto `sections` at parse (#6926), and therefore never present in a parsed
   * form. See {@link foldFormGroupsIntoSections} for the fold and why it lives
   * here rather than in each consumer.
   */
  groups: z.array(FormSectionSchema).optional().describe(
    '[LEGACY ALIAS → `sections`] Accepted for back-compat and folded onto `sections` at parse; `sections` wins when both are present. Prefer `sections`.',
  ),

  /**
   * Inline child collections (master-detail). When present, the standard
   * create/edit form for this object renders as a master-detail form — the
   * object's own fields on top, an editable grid per child collection below,
   * persisted together in ONE atomic transaction — with no bespoke page. Each
   * entry needs only `childObject`; the relationship FK and grid columns are
   * derived from the child object's metadata (override via
   * `relationshipField` / `columns`).
   */
  subforms: z.array(strictObject({
    surface: 'this subform',
    history: VIEW_HISTORY,
    // `object` is the word every OTHER block on this surface uses for an object
    // name (`ViewDataSchema.object`, `ViewItemSchema.object`), so writing it
    // here is an author being consistent — not making a typo.
    aliases: {
      object: 'childObject', childObjectName: 'childObject', child: 'childObject',
      foreignKey: 'relationshipField', relationField: 'relationshipField', parentField: 'relationshipField',
      fields: 'columns', label: 'title', sumField: 'amountField', rollupField: 'totalField',
    },
  }, {
    childObject: z.string().describe('Child object whose records are entered inline'),
    relationshipField: z.string().optional().describe('FK on the child pointing back to the parent (auto-detected when omitted)'),
    columns: z.array(z.any()).optional().describe('Editable grid columns (derived from the child object when omitted)'),
    amountField: z.string().optional().describe('Numeric child column summed for the running total'),
    totalField: z.string().optional().describe('Parent field to receive the rolled-up sum'),
    title: z.string().optional().describe('Section title'),
    addLabel: z.string().optional().describe('Add-row button label'),
    minRows: z.number().optional(),
    maxRows: z.number().optional(),
  })).optional().describe('Inline master-detail child collections'),

  // `defaultSort` REMOVED (#3896 audit close-out): no reader in either repo —
  // related lists sort by their OWN list view's sort, never by this.
  defaultSort: retiredKey(
    '`form.defaultSort` was removed in @objectstack/spec 17.0.0 (#3896 audit close-out) — ' +
    'nothing read it: a related list inside a form sorts by its own list view\'s `sort`. ' +
    'Delete the key and set the sort on the related list view instead. ' +
    'Run `os migrate meta --from 16` to rewrite existing sources automatically.',
  ),

  /** Public form sharing configuration */
  sharing: SharingConfigSchema.optional().describe('Public sharing configuration for this form'),

  /**
   * What happens after a successful submit.
   *
   * The default when this is omitted is **mode-aware**, not a single fixed
   * kind (ruled 2026-08-10 on #7245): the public `/console/f/:slug` path
   * defaults to `thank-you` — there is no record an anonymous submitter is
   * allowed to read back, so a confirmation panel is all there is to show.
   * The internal `/console/forms/:name` path — where `type: 'form'` actions
   * send operators — defaults to redirecting to the record that was just
   * created, since an operator who just created a record belongs on that
   * record. An explicit `submitBehavior` always wins, in either mode.
   *
   * - `thank-you` — show a confirmation panel
   * - `redirect` — send the browser to a URL
   * - `continue` — reset the form so another response can be entered
   * - `next-record` — advance to the next record (internal queues only)
   */
  // ⚠️ `discriminatedUnion`, not `union` — deliberately, and it is the closing
  // that forces the choice. A plain `z.union` of four STRICT members reports a
  // bad key as `invalid_union` carrying four sub-errors, one per member, and
  // #5014 measured that the renderers flatten those to a bare "Invalid input" —
  // so the prescription this campaign exists to deliver would never reach the
  // author. Discriminating on the `kind` literal that is already there picks
  // the ONE intended member and reports its message verbatim. No input changes
  // shape: every member already required its own `kind` literal.
  submitBehavior: z.discriminatedUnion('kind', [
    strictObject({
      surface: 'this `thank-you` submit behavior',
      history: VIEW_HISTORY,
      aliases: { heading: 'title', text: 'message', body: 'message', description: 'message' },
    }, {
      kind: z.literal('thank-you'),
      title: z.string().optional(),
      message: z.string().optional(),
    }),
    strictObject({
      surface: 'this `redirect` submit behavior',
      history: VIEW_HISTORY,
      // `delay` / `delayMS` are one keystroke and one capital from `delayMs`;
      // the unit is in the name, so a bare `delay` is genuinely ambiguous and
      // gets pointed at the spelled-out key rather than silently dropped.
      aliases: { delay: 'delayMs', delayMS: 'delayMs', timeout: 'delayMs', to: 'url', href: 'url', target: 'url' },
    }, {
      kind: z.literal('redirect'),
      // The ruled shape — see `checkSubmitRedirectUrl` above for what each
      // refusal defends and why the refine, not the consumer, is where it
      // lands. `z.string()` stays the type on purpose: the consumption ruled in
      // is a verbatim redirect on the resolved path, so this key must keep
      // arriving at the renderer as the string the author wrote (an
      // `Expression` envelope would change what `FormPage` reads).
      url: z.string()
        .superRefine((raw, ctx) => {
          const refusal = checkSubmitRedirectUrl(raw);
          if (refusal) ctx.addIssue({ code: 'custom', message: refusal });
        })
        .describe(
          'Where the browser goes after a successful submit. Ruled 2026-08-11 (#7496): '
          + '(1) RELATIVE paths only — it must start with `/`, and absolute or protocol-relative '
          + 'URLs are refused, which is what closes the open-redirect face; '
          + '(2) interpolation ONLY from declared record fields, spelled `{{record.field_name}}`, '
          + 'and every interpolated value is URL-escaped when the redirect is built; '
          + '(3) a verbatim redirect on the resolved relative path is the intended consumption. '
          + "To send the browser OUT of the app, use an app navigation item (`{ type: 'url', url }`) instead.",
        ),
      delayMs: z.number().int().min(0).optional(),
    }),
    strictObject({
      surface: 'this `continue` submit behavior',
      history: VIEW_HISTORY,
      // `continue` resets the form and takes no options; an author configuring
      // confirmation text wanted the `thank-you` kind instead.
      guidance: {
        title: 'The `continue` behavior takes no options — it just resets the form. For a confirmation panel use `{ kind: "thank-you", title, message }`.',
        message: 'The `continue` behavior takes no options — it just resets the form. For a confirmation panel use `{ kind: "thank-you", title, message }`.',
      },
    }, { kind: z.literal('continue') }),
    strictObject({
      surface: 'this `next-record` submit behavior',
      history: VIEW_HISTORY,
      guidance: {
        title: 'The `next-record` behavior takes no options — it advances to the next record. For a confirmation panel use `{ kind: "thank-you", title, message }`.',
        message: 'The `next-record` behavior takes no options — it advances to the next record. For a confirmation panel use `{ kind: "thank-you", title, message }`.',
      },
    }, { kind: z.literal('next-record') }),
  // The `url` describe below carries the ruling in full, but it reaches only
  // the generated JSON Schema: the references page renders a union as one type
  // expression, so a member's inner key gets no row of its own. The headline
  // therefore rides HERE, where the reference table does have a row (#7496).
  ]).optional().describe(
    "Post-submit behavior. On the `redirect` arm, `url` is relative-only and interpolates "
    + 'only declared record fields as `{{record.field_name}}`, URL-escaped (ruled 2026-08-11, #7496).',
  ),

  /**
   * Structured action-button config: per-button visibility + label for
   * `submit` / `cancel` / `reset`. The spec home for the flat renderer-invented
   * keys ObjectUI's `ObjectForm` used to read (`showSubmit`/`submitText`/
   * `showCancel`/`cancelText`/`showReset`) — now consumed: `ObjectForm` folds
   * `buttons.*` down onto those flat props at render (framework#1894, #2998),
   * with the flat keys kept only as deprecated back-compat. Authoring `buttons`
   * takes effect; a stale flat key still wins where explicitly set.
   */
  buttons: z.object({
    submit: FormButtonConfigSchema.optional().describe('Submit button'),
    cancel: FormButtonConfigSchema.optional().describe('Cancel button'),
    reset: FormButtonConfigSchema.optional().describe('Reset button'),
  }).strict().optional()
    .describe('Form action-button visibility & labels; folded onto the flat renderer props by ObjectUI ObjectForm (framework#1894 / #2998).'),

  /**
   * Initial field values for create-mode forms, keyed by field machine name —
   * the spec home for ObjectUI's renderer-invented `initialValues`. Consumed:
   * `ObjectForm` folds `defaults` into its create-mode initial values at render
   * (framework#1894, #2998); an explicit `initialValues` (e.g. URL prefill)
   * still wins.
   */
  defaults: z.record(z.string(), z.unknown()).optional()
    .describe('Initial field values for create-mode forms (folded into ObjectUI ObjectForm initial values; framework#1894 / #2998).'),

  // `aria` REMOVED from the FORM view (#3896 audit close-out): no form
  // renderer applied it (plugin-form/SchemaForm never read schema.aria) — an
  // ACCESSIBILITY claim that is merely accepted is false compliance, the
  // requiresConfirmation shape.
  aria: retiredKey(
    '`form.aria` was removed in @objectstack/spec 17.0.0 (#3896 audit close-out) — no form ' +
    'renderer ever applied it, so declared ARIA attributes silently did not reach the DOM. ' +
    'Delete the key. The form renderer emits its own semantic markup; report gaps as ' +
    'renderer issues rather than per-view attribute overrides. ' +
    'Run `os migrate meta --from 16` to rewrite existing sources automatically.',
  ),
}).superRefine((view, ctx) => {
  // `section.pane` is split-only vocabulary. On any other form type it would
  // be a silent no-op — the worst failure mode for authored (and especially
  // AI-authored) metadata, where "accepted but ignored" reads as working.
  // Reject it loudly at parse instead. `.extend()` keeps this check (zod 4
  // attaches refinements to the schema), so the flattened runtime-overlay
  // variant in ViewMetadataSchema enforces it too.
  if (view.type === 'split') return;
  for (const [key, sections] of [['sections', view.sections], ['groups', view.groups]] as const) {
    sections?.forEach((section, index) => {
      if (section?.pane != null) {
        ctx.addIssue({
          code: 'custom',
          path: [key, index, 'pane'],
          message:
            `\`pane\` places a section in a split pane and is only valid on \`type: 'split'\` ` +
            `form views (this form is '${view.type}'). Remove the key or change the form type.`,
        });
      }
    });
  }
  // ⚠️ Anything added below this loop still runs BEFORE the `.overwrite()`
  // fold — see {@link foldFormGroupsIntoSections} — so a refinement that
  // reads sections must keep reading BOTH buckets.
}).overwrite(foldFormGroupsIntoSections));

/**
 * Object-scoped user filters (ADR-0047 amendment, framework #2679 / objectui #2338).
 *
 * A {@link UserFiltersSchema} restricted to the styles that make sense on an object
 * list view: `dropdown` (per-field value chips — the Airtable "quick filter" pills)
 * and the deprecated `toggle`. The `tabs` element and its two companions
 * (`showAllRecords`, `allowAddTab`) are OMITTED because an object view's saved-view
 * switcher (`ViewTabBar`) already owns the tab-bar role — a `tabs` user-filter would
 * render a second, conflicting tab bar. Need named presets on an object? Use
 * `listViews` (each becomes a segmented tab).
 *
 * ## Why this carries its OWN error map instead of inheriting the base's (#5073)
 *
 * The shape is still DERIVED — `.omit()` off {@link UserFiltersSchema}, so a key
 * added upstream flows in rather than being re-transcribed (#2231). What is not
 * inherited is the unknown-key message, and that is deliberate: `.omit()` keeps the
 * base's `strictObject` error map, whose `knownKeys` were read from the base's shape
 * — which still contains the three omitted keys. Measured before this was written:
 * an author who typed `tab` on an object view got *"Did you mean `tab` → `tabs`?"*,
 * a suggestion to write the one key this surface refuses, and a bare `tabs` was
 * rejected with no prescription at all. Both are the campaign's finding 7 — the fix
 * signposting the way into the failure it exists to kill — and #5073 is the change
 * that turned these keys from silently-dropped into rejected, so the message is this
 * change's own responsibility. Rebuilding the map over the OMITTED shape drops the
 * three keys out of the suggestion pool, and `guidance` gives each the pointer the
 * CLI lint (`packages/lint/src/validate-list-view-mode.ts`) already carries.
 */
export const ObjectUserFiltersSchema = lazySchema(() => strictObject({
  surface: 'these object user filters',
  history: VIEW_HISTORY,
  guidance: {
    tabs: '`tabs` presets are page-only: an object view\'s tab bar is its saved-view switcher (ViewTabBar), and a second one would collide. Define each preset as a named entry under the object\'s `listViews` instead — every one renders as a segmented tab.',
    showAllRecords: '`showAllRecords` configures the page-only `tabs` element. On an object view the default list view already is the "all records" entry; use `listViews` for the named presets beside it.',
    allowAddTab: '`allowAddTab` configures the page-only `tabs` element. An object view\'s tab bar is the saved-view switcher (ViewTabBar), which owns its own add control.',
  },
}, {
  ...UserFiltersSchema.omit({ tabs: true, showAllRecords: true, allowAddTab: true }).shape,
  element: z.enum(['dropdown', 'toggle']).default('dropdown')
    .describe('Filter control style on object views: "dropdown" (per-field value chips). "toggle" is deprecated. "tabs" is page-only — use `listViews` for named presets.'),
}));

/**
 * ADR-0047 "views" mode — an object's default list + named list views.
 *
 * Structurally a {@link ListViewSchema} whose `userFilters` is narrowed to
 * {@link ObjectUserFiltersSchema}: `dropdown` value chips are allowed (ADR-0047
 * amendment, framework #2679), but the page-only `tabs` preset bar is not — that
 * belongs to a page list (`InterfaceListPage`, "filters" mode), because an object
 * view's only tab-bar nav is the `ViewTabBar`. The narrowed schema makes a `tabs`
 * user-filter untypable at author time (tsc); the CLI `validate` list-view-mode rule
 * reports it pre-parse. See objectui #2338.
 */
export const ObjectListViewSchema = lazySchema(() =>
  ListViewSchema.omit({ userFilters: true }).extend({ userFilters: ObjectUserFiltersSchema.optional() }));

/**
 * Master View Schema
 * Can define multiple named views.
 */
/**
 * View Container Schema
 * Aggregates all view definitions for a specific object or context.
 * 
 * @example
 * {
 *   list: { type: "grid", columns: ["name"] },
 *   form: { type: "simple", fields: ["name"] },
 *   listViews: {
 *     "all": { label: "All", filter: [] },
 *     "my": { label: "Mine", filter: [["owner", "=", "{current_user_id}"]] }
 *   }
 * }
 */
export const ViewSchema = lazySchema(() => strictObject({
  surface: 'this view container',
  history: VIEW_HISTORY,
  // The one mistake this shape actually sees: a FLAT list view written where a
  // CONTAINER goes. `defineView` has guarded it since the container was
  // introduced, with a comment saying why — "`ViewSchema` strips unknown
  // top-level keys, so a flat list view would parse to an empty container".
  // Another bespoke guard built to work around silent stripping, and like every
  // other one this campaign has found, it covered ONE door: `defineView`. The
  // metadata door (Studio, the API, an agent) got the empty container in
  // silence. Closing the shape covers both; the guard stays for the case strict
  // cannot see — `defineView({})`, an empty container with no unknown keys at
  // all, which is still zero views registered.
  //
  // `name`, `label` and `object` are NOT in this list, and the first draft had
  // all three — wrongly. A container carries its own identity and its object
  // binding: `saveMetaItem` sends the name, artifact-shipped containers do
  // (`service-ai/ai_traces`), the validation sweep injects it, and a
  // stack-level `views: [...]` entry needs `object` to say which object it
  // belongs to (this file's own note on `ObjectListViewSchema` calls the
  // container "view definitions for a specific object", and `getViewsByObject()`
  // is what reads that binding). Tombstoning them rejected shapes the platform
  // itself writes.
  //
  // The list below is what survived an EMPIRICAL check rather than a confident
  // one: every container literal in the repo was scanned for these nine keys,
  // and only `name` / `label` / `object` ever appear on one. That check should
  // have come before the guidance, not after three CI failures — a guidance
  // entry is a claim about the schema, and claims need verifying like code.
  guidance: Object.fromEntries(
    ['type', 'columns', 'data', 'viewKind', 'filters', 'sort']
      .map((k) => [k, `\`${k}\` belongs to a single VIEW, not to the container. Wrap it: \`defineView({ list: { type, data, columns, … } })\`, or name it — \`defineView({ listViews: { my_view: { … } } })\`. The container's own keys are \`list\`, \`form\`, \`listViews\`, \`formViews\`.`]),
  ),
}, {
    // Item identity. The container is a registered metadata item, so the door
    // supplies these — declared for the same reason `translation` needed them
    // (#4001 batch 5): undeclared, they were stripped, and the metadata door
    // quietly discarded an item's own name on the way through.
    name: z.string().optional().describe('Item name — supplied by the metadata door; for an object-scoped container it is the object name.'),
    label: I18nLabelSchema.optional().describe('Human-readable label shown in metadata lists.'),
    object: z.string().optional().describe('Object this container binds to — how a stack-level `views: [...]` entry says which object its views belong to; read by `getViewsByObject()` / `GET /meta/view?object=`.'),
    list: ObjectListViewSchema.optional(), // Default list view (views mode — dropdown userFilters allowed, no tabs; ADR-0047)
    form: FormViewSchema.optional(), // Default form view
    listViews: z.record(z.string(), ObjectListViewSchema).optional().describe('Additional named list views (views mode — dropdown userFilters allowed, no tabs; ADR-0047)'),
    formViews: z.record(z.string(), FormViewSchema).optional().describe('Additional named form views'),
  /**
   * ADR-0010 §3.7 — Package-level protection envelope. Package
   * authors declare lock policy here; the loader translates it
   * into the private `_lock` envelope at registration time and
   * strips this block before persistence. See
   * `shared/protection.zod.ts`.
   */
  protection: ProtectionSchema.optional().describe(
    'Package author protection block — lock policy for this view.',
  ),

  // ADR-0010 — runtime protection envelope (internal — set by loader).
  ...MetadataProtectionFields,

}));

/**
 * Type-safe factory for creating view definitions.
 *
 * Validates the config at creation time using Zod `.parse()`, and rejects a
 * container that defines no views: `ViewSchema` strips unknown top-level keys,
 * so a *flat* list view (`{ name, label, type, columns, ... }`) would parse to
 * an empty container — zero views register and the Console silently renders
 * nothing. Failing here surfaces that authoring mistake at build time.
 *
 * @example
 * ```ts
 * const taskViews = defineView({
 *   list: {
 *     type: 'grid',
 *     data: { provider: 'object', object: 'task' },
 *     columns: ['subject', 'status', 'priority', 'due_date'],
 *   },
 *   form: {
 *     type: 'simple',
 *     sections: [{ label: 'Details', fields: [{ field: 'subject' }] }],
 *   },
 * });
 * ```
 */
export function defineView(config: z.input<typeof ViewSchema>): ViewParsed {
  const parsed = ViewSchema.parse(config);
  const viewCount =
    (parsed.list ? 1 : 0) +
    (parsed.form ? 1 : 0) +
    Object.keys(parsed.listViews ?? {}).length +
    Object.keys(parsed.formViews ?? {}).length;
  if (viewCount === 0) {
    throw new Error(
      'defineView: the container defines no views — nothing registers and no view appears in the Console. '
      + 'Declare at least one of `list`, `form`, `listViews`, `formViews`. '
      + 'If you passed a flat list view ({ name, label, type, columns, ... }), wrap it: '
      + 'defineView({ list: { type, data, columns, ... } }).'
    );
  }
  return parsed;
}

// ───────────────────────────────────────────────────────────────────────────
// Independent View Item model (Object has-many View)
// ───────────────────────────────────────────────────────────────────────────
//
// The {@link ViewSchema} *container* above aggregates every view of an object
// into one document. That model cannot express runtime-authored views (a user
// adding "My high-value leads" at runtime cannot append to a developer's source
// file), and it forces multiple distinct views into a single designer.
//
// {@link ViewItemSchema} promotes each named view to a first-class, independently
// addressable entity bound to its object by a foreign key. The object↔view
// switcher is then a *query* (`getViewsByObject`) rather than embedded storage —
// mirroring Airtable / Salesforce / Notion, where a table/object has-many views.
//
// `defineView` is retained as authoring sugar: the backend loader expands an
// aggregated document into N ViewItems at registration time, so existing
// `*.view.ts` files and the published spec keep working unchanged.

/**
 * Qualified view-item identity: `<object>.<viewKey>` — dotted snake_case
 * segments, e.g. `crm_lead.pipeline`. Globally unique, and the object can be
 * recovered from the prefix, so the registry key never collides across objects.
 */
export const ViewItemNameSchema = z
  .string()
  .regex(
    /^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$/,
    'View item name must be a dotted snake_case qualified name, e.g. "crm_lead.pipeline".',
  )
  .describe('Globally-unique view id, `<object>.<viewKey>`.');

/**
 * Identity layer for a view item — its visibility scope and ownership.
 *
 * - `package`  — shipped from `*.view.ts` source / an installed package.
 *                Not deletable (reinstall restores it); customisable via an
 *                override layer; hideable from the switcher.
 * - `shared`   — authored at runtime, visible org-wide. Creating one is gated
 *                by the `view.manageShared` capability.
 * - `personal` — authored at runtime, scoped to `owner`. Any user with read
 *                access to the object may create one.
 *
 * Named `scope` (not `provenance`) to avoid colliding with the loader-set
 * `_provenance` envelope field, which tracks a different axis
 * (package | org | env-forced).
 */
export const ViewScopeSchema = z
  .enum(['package', 'shared', 'personal'])
  .describe('View identity layer: package | shared | personal.');

/** Discriminator for the kind of view a {@link ViewItemSchema} carries. */
export const ViewKindSchema = z
  .enum(['list', 'form'])
  .describe('Whether `config` is a ListView (list family) or a FormView.');

/**
 * Fields shared by every independent view item, regardless of kind. Returned
 * as a raw Zod shape so it composes into each discriminated-union member
 * without forcing eager schema construction.
 */
function viewItemBaseShape() {
  return {
    name: ViewItemNameSchema,
    object: z
      .string()
      .describe('Bound object name — the foreign key used to aggregate views.'),
    label: I18nLabelSchema.optional().describe('Display label (supports i18n).'),
    isDefault: z
      .boolean()
      .optional()
      .describe("Whether this is the object's default view in the switcher."),
    order: z
      .number()
      .int()
      .optional()
      .describe("Sort order within the object's view switcher / left rail."),
    scope: ViewScopeSchema.optional().describe(
      'Identity layer (defaults to `package` for source-loaded views).',
    ),
    owner: z
      .string()
      .optional()
      .describe('Owner user id — set when `scope` is `personal`.'),
    hidden: z
      .boolean()
      .optional()
      .describe('Hidden from the switcher (per-user / per-org declutter).'),
    /**
     * Package author protection block — same envelope as {@link ViewSchema};
     * the loader translates it into the private `_lock` envelope.
     */
    protection: ProtectionSchema.optional().describe(
      'Package author protection block — lock policy for this view.',
    ),
    // ADR-0010 — runtime protection envelope (internal — set by loader).
    ...MetadataProtectionFields,
  };
}

/**
 * Independent View Item — a single named view bound to one object.
 *
 * Discriminated on `viewKind`: a `list` item carries a {@link ListViewSchema}
 * config (grid / kanban / calendar / …), a `form` item carries a
 * {@link FormViewSchema} config.
 *
 * @example
 * ```ts
 * const pipeline = defineViewItem({
 *   name: 'crm_lead.pipeline',
 *   object: 'crm_lead',
 *   viewKind: 'list',
 *   label: 'Pipeline',
 *   config: {
 *     type: 'kanban',
 *     data: { provider: 'object', object: 'crm_lead' },
 *     columns: ['name', 'stage', 'amount'],
 *   },
 * });
 * ```
 */
/**
 * One arm of the ViewItem discriminated union, as a raw shape.
 *
 * Both postures below are built from THIS function, so the authoring gate and
 * the wire member cannot drift into two transcriptions of one contract (#2231's
 * derive-by-reference; the fork PD#12 exists to prevent). The two differ in
 * exactly two ways, both visible at the call site: the unknown-key posture, and
 * the round-trip keys the wire arm additionally declares.
 */
function viewItemArmShape<K extends 'list' | 'form'>(viewKind: K, config: z.ZodTypeAny) {
  return {
    viewKind: z.literal(viewKind),
    config,
    ...viewItemBaseShape(),
  };
}

/** The authoring surface `defineViewItem` and Studio's create form are judged by. */
const VIEW_ITEM_SURFACE = {
  surface: 'this view item',
  history: VIEW_HISTORY,
  guidance: {
    // The failure this close exists for (#5074): one letter, and the author got
    // a ViewItem with NO view configuration that parsed clean.
    confg: 'Did you mean `config`? A ViewItem carries its whole view definition under `config`.',
    // Wire keys, named so the rejection tells an author where they belong
    // instead of leaving them to guess.
    isPinned: 'Pinning is per-user Studio state, not authored metadata — the console writes it through the `view` metadata API. Remove it from authored metadata.',
    sortOrder: 'Switcher position is per-user Studio state, not authored metadata — use `order` for the authored default. Remove it from authored metadata.',
  },
} as const;

/**
 * [#5074] The AUTHORING gate — strict. Split from the wire member it used to be.
 *
 * Until #5074 one schema wore two contracts. It is what {@link defineViewItem}
 * parses and what objectui's view-create form validates `createBuildBody`'s
 * output against (`app-shell/src/views/metadata-admin/view-create-body.test.ts`)
 * — an authoring door that genuinely wants strict. It was ALSO the first member
 * of {@link ViewMetadataSchema}, the union `saveMetaItem` validates every
 * persisted `view` body against — a wire role that genuinely needs Studio's
 * round-trip keys through.
 *
 * Traced end to end rather than inferred, and the trace is why the split was
 * necessary rather than cosmetic. objectui's "pin this view" control calls
 * `dataSource.updateView(object, id, { isPinned })`
 * (`app-shell/src/views/ObjectView.tsx:882`), and `updateView`
 * (`data-objectstack/src/index.ts:2801`) GETs the stored item and PUTs
 * `{ ...current, ...partial }`. For a standalone ViewItem record `current`
 * carries `viewKind` AND `config`, so the merged body matches member 1 — the
 * flattened-overlay members are excluded by their `config: z.undefined()` guard
 * — and it arrives carrying `isPinned`, which the authoring shape does not
 * declare. That body is now judged by {@link ViewItemWireSchema} instead.
 *
 * What closing this buys, in the words of the ruling that ordered it:
 * `defineViewItem({ name, object, viewKind, confg: {…} })` — one letter wrong —
 * used to strip the typo and hand back a ViewItem with **no view configuration
 * at all**, parsed clean. That is #1535's `workflows: [...]` replayed on the
 * surface with the highest author density in the file.
 */
export const ViewItemSchema = lazySchema(() =>
  z.discriminatedUnion('viewKind', [
    strictObject(VIEW_ITEM_SURFACE, viewItemArmShape('list', ListViewSchema.describe('List-family view configuration.'))),
    strictObject(VIEW_ITEM_SURFACE, viewItemArmShape('form', FormViewSchema.describe('Form view configuration.'))),
  ]),
);

/**
 * Auxiliary Studio round-trip keys, given an explicit DECLARED home on the wire
 * variant (#5074) instead of living implicitly on "the member nobody closed".
 *
 * These are per-user switcher state the console writes through the `view`
 * metadata API and reads back; `saveMetaItem` persists the body verbatim, so
 * they are on the wire and in the store. They are deliberately declared HERE and
 * not on {@link ViewItemSchema}: an author who writes `isPinned` in a `*.view.ts`
 * gets a named rejection pointing at `order`, while the console's own PUT parses.
 */
function viewItemWireFields() {
  return {
    isPinned: z.boolean().optional()
      .describe('Studio round-trip: view pinned in the switcher (per-user state, written by the console — not authored).'),
    sortOrder: z.number().int().optional()
      .describe('Studio round-trip: position within the switcher (per-user state, written by the console — not authored).'),
  };
}

/**
 * [#5074] The WIRE variant of {@link ViewItemSchema} — member 1 of
 * {@link ViewMetadataSchema}, re-opened with `.strip()`.
 *
 * Exactly the pattern the two flattened members below already use
 * (`ListViewSchema.extend(flattenedViewOverlayFields()).strip()`), reached one
 * member further. `z.discriminatedUnion` cannot be `.extend()`ed, so the two
 * postures share {@link viewItemArmShape} rather than a `.extend()` chain —
 * derive-by-reference either way, one shape, two doors.
 *
 * `.strip()` covers the TOP level only. Nested console decorations
 * (`config.filter[].id`, `config.sort[].id`) are handled by
 * {@link stripViewConsoleDecorations} on the wire door — see that function for
 * why a recursive strip is the piece a posture flip cannot provide.
 */
export const ViewItemWireSchema = lazySchema(() =>
  z.discriminatedUnion('viewKind', [
    z.object({
      ...viewItemArmShape('list', ListViewSchema.describe('List-family view configuration.')),
      ...viewItemWireFields(),
    }).strip(),
    z.object({
      ...viewItemArmShape('form', FormViewSchema.describe('Form view configuration.')),
      ...viewItemWireFields(),
    }).strip(),
  ]),
);

/**
 * Type-safe factory for an independent {@link ViewItem}.
 *
 * Validates the config at creation time using Zod `.parse()`.
 *
 * @example
 * ```ts
 * const allLeads = defineViewItem({
 *   name: 'crm_lead.all',
 *   object: 'crm_lead',
 *   viewKind: 'list',
 *   isDefault: true,
 *   config: { type: 'grid', data: { provider: 'object', object: 'crm_lead' }, columns: ['name'] },
 * });
 * ```
 */
export function defineViewItem(config: z.input<typeof ViewItemSchema>): ViewItem {
  return ViewItemSchema.parse(config);
}

// ───────────────────────────────────────────────────────────────────────────
// Canonical persisted-`view`-body schema (the runtime metadata-type schema)
// ───────────────────────────────────────────────────────────────────────────
//
// #3095 — the `view` metadata type maps to THIS schema in
// `metadata-type-schemas.ts` (both the save-time 422 validator and the
// read-time `computeMetadataDiagnostics` badge consult it). A single
// container schema ({@link ViewSchema}) is a NO-OP for two of the three shapes
// a `view` body actually carries at runtime: Zod strips unknown keys, so a
// standalone {@link ViewItemSchema} record ({ name, object, viewKind, config })
// and a console personalization overlay (raw view config + inherited identity)
// both parse to `{}` — silently "valid" while their `config` is never checked.
//
// The three legitimate runtime shapes, each validated GENUINELY here:
//
//   1. `defineView` aggregate **container** — at least one of
//      `list`/`form`/`listViews`/`formViews`. An empty container is rejected
//      (it registers zero views; mirrors the {@link defineView} guard).
//   2. Standalone **ViewItem record** — `{ viewKind, config, … }`; the nested
//      `config` is validated against ListView/FormView.
//   3. **Flattened runtime overlay** — a raw ListView/FormView config at the
//      top level plus optional identity fields (`viewKind`/`object`/`label`,
//      inherited from the shadowed registry entry by `normalizeViewMetadata`;
//      see #2555). This is what a personalization PUT (column sort, inline
//      edit, …) sends. Discriminated from a record by the ABSENCE of a nested
//      `config`, and from a container by the ABSENCE of container slots — the
//      structural guards below make those exclusions explicit so a malformed
//      record/container can never be rescued by this lenient branch.
//
// Auxiliary Studio round-trip keys (`isPinned`, `sortOrder`, …) ride along on
// the shapes Studio actually round-trips, matching the "persist the payload
// verbatim" contract in `saveMetaItem` (it validates but stores the original
// item). ⚠️ [#5074] The line that used to stand here said "all four members
// strip-parse (no `.strict()`)". It was true when written, then half-false and
// half-load-bearing (批 18 measured it), and is now replaced by the split. As
// it stands, measured:
//
//   • member 1 is `ViewItemWireSchema` — the `.strip()` WIRE variant of
//     `ViewItemSchema`. The authoring schema of the same shape is strict and
//     lives at its own name; this is the body `updateView` PUTs for a
//     standalone ViewItem record, and `isPinned`/`sortOrder` are DECLARED on it
//     rather than surviving because nobody closed the member.
//   • member 2 (the container) IS strict. `ViewSchema` was closed by an earlier
//     batch, so `{ list: …, isPinned: true }` 422s. Not a regression: nothing
//     sends it. `updateView` unwraps a container to its inner list config
//     (`if (current?.list) current = current.list`) before merging, so a
//     container body never reaches this union carrying an aux key.
//   • members 3 and 4 are the flattened overlays, `.strip()` and saying so.
//
// ⚠️ All three `.strip()`s re-open the TOP level ONLY — `.strip()` no more
// recurses than `.strict()` does. The nested console decorations
// (`filter[].id`, `sort[].id`) are removed by `stripViewConsoleDecorations`
// BEFORE the union runs, which is what makes the wire opening
// recursive-effective and what let `ViewFilterRuleSchema` / `ListView.sort`
// close for authoring. Anyone closing a member here must re-run that trace,
// not re-read this comment.
//
// [#5599] …and the cost of that opening, before the identity precondition
// below existed: member 4 both `.strip()`s AND declares no required key
// (`FormViewSchema.type` even carries a `'simple'` default), so it matched
// ANY object. `{ nope: 1 }` did not merely pass — it passed as a *view*,
// reduced to `{ type: 'simple' }`, and `saveMetaItem` (which persists the
// ORIGINAL body, not the parse output) wrote `{"nope":1,"name":"…"}` into
// `sys_metadata` as an ACTIVE view overlay. The read path then re-parsed the
// same body through the same schema and badged it `_diagnostics.valid: true`
// (#5598), so Studio agreed. `view` was the one common overlay type whose
// declared write-path spec gate (ADR-0005 §Validation) could be bypassed by
// an arbitrary body — Prime Directive #10's "declared ≠ enforced", one layer
// above the object schemas #4001 closed: at union-MEMBER SELECTION, not at
// any single member. The fix is a precondition, NOT a strictness flip on the
// members — see {@link assertViewIdentity} and {@link viewMetadataVocabulary}.

/**
 * Optional identity + structural-guard fields layered onto the two "flattened
 * runtime overlay" members. The `config`/`list`/`form`/`listViews`/`formViews`
 * guards pin those keys to `undefined`: a body carrying any of them is a record
 * or a container, not a flattened overlay, so it must be validated by the
 * dedicated member instead of slipping through here with its real payload
 * stripped away.
 */
function flattenedViewOverlayFields() {
  return {
    name: z.string().optional().describe('Save name / qualified view id (stamped by the write path).'),
    object: z.string().optional().describe('Bound object name (inherited from the shadowed entry — #2555).'),
    viewKind: ViewKindSchema.optional().describe('View family (inherited from the shadowed entry — #2555).'),
    label: I18nLabelSchema.optional().describe('Display label (inherited from the shadowed entry — #2555).'),
    isDefault: z.boolean().optional(),
    order: z.number().int().optional(),
    scope: ViewScopeSchema.optional(),
    owner: z.string().optional(),
    hidden: z.boolean().optional(),
    protection: ProtectionSchema.optional(),
    ...MetadataProtectionFields,
    // Structural guards — a flattened overlay is neither a record nor a container.
    config: z.undefined().optional(),
    list: z.undefined().optional(),
    form: z.undefined().optional(),
    listViews: z.undefined().optional(),
    formViews: z.undefined().optional(),
  };
}

/**
 * True when a `view` container defines at least one view. The bare
 * {@link ViewSchema} accepts `{}` (every slot optional), which would let an
 * empty overlay pass validation and register nothing — the same footgun
 * {@link defineView} rejects at authoring time.
 */
function containerHasAView(v: unknown): boolean {
  if (!v || typeof v !== 'object') return false;
  const c = v as Record<string, unknown>;
  return Boolean(
    c.list ||
    c.form ||
    (c.listViews && typeof c.listViews === 'object' && Object.keys(c.listViews).length > 0) ||
    (c.formViews && typeof c.formViews === 'object' && Object.keys(c.formViews).length > 0),
  );
}

/**
 * [#5599] The keys the WRITE PATH itself puts on a `view` body, which therefore
 * cannot be evidence that the author sent a view.
 *
 * `saveMetaItem` normalizes before it validates. `normalizeViewMetadata`
 * (`@objectstack/metadata-protocol`) stamps `name` onto **every** view body at
 * the single write chokepoint — it exists precisely to guarantee one — and, when
 * the overlay shadows a registry entry, `viewIdentityPatch` inherits `viewKind`,
 * `object` and `label` from it (#2555). A key present on 100% of the bodies
 * reaching the gate has zero discriminating power: counting `name` as evidence
 * would leave this precondition unable to reject anything on the write path at
 * all — which is the one path #5599 is about, since `{ nope: 1 }` arrives at the
 * schema as `{ nope: 1, name: 'garbage_view' }`, exactly the body the issue
 * reports as persisted.
 *
 * So the bar is *shape*, not identity — which is how the ruling worded it too.
 * A body may be very lean, but it must say something about what the view IS; a
 * body of these keys alone says only which view it is attached to.
 *
 * Exported so the producer side can be pinned against it: `normalizeViewMetadata`
 * must never stamp a key that is not listed here, or that key silently becomes
 * evidence again and re-opens this hole. That pin lives with the producer, in
 * `metadata-protocol`'s `view-write-path-identity.test.ts`.
 */
export const VIEW_WRITE_PATH_IDENTITY_KEYS: ReadonlySet<string> = new Set([
  'name',
  'viewKind',
  'object',
  'label',
]);

/**
 * [#5599] Every top-level key ANY member of {@link ViewMetadataSchema} declares,
 * MINUS {@link VIEW_WRITE_PATH_IDENTITY_KEYS} — the vocabulary the identity
 * precondition judges "is this a `view` at all?" against.
 *
 * **Derived from the members, never hand-listed.** A literal array here would be
 * a second declaration of the union's own surface, and the two would drift on
 * the first member that grows a key — the precondition would then reject a body
 * the union accepts, which is a 422 on a shape the platform itself writes. So it
 * walks the members' Zod defs instead: objects contribute their `shape` keys,
 * unions recurse into their options (member 1 is a discriminated union of two
 * arms), and wrappers (`.refine()`, `.strip()`, pipes) are unwrapped. Adding a
 * key to any arm widens this set in the same edit, with no bookkeeping.
 *
 * Computed once, on first parse rather than at schema-construction time: the
 * members are {@link lazySchema} proxies whose factories run on first `_zod`
 * touch, and deriving eagerly would force every view schema in the file to
 * materialise as a side effect of this module loading (ADR-0089 D3a).
 */
function collectDeclaredTopLevelKeys(schema: unknown, into: Set<string>, depth = 0): void {
  const def = (schema as { _zod?: { def?: Record<string, unknown> } } | undefined)?._zod?.def;
  if (!def || depth > 6) return;
  if (def.type === 'object') {
    for (const key of Object.keys((def.shape ?? {}) as object)) into.add(key);
    return;
  }
  if (def.type === 'union') {
    for (const option of (def.options ?? []) as unknown[]) collectDeclaredTopLevelKeys(option, into, depth + 1);
    return;
  }
  // `.refine()` keeps the object def; these cover pipes / wrappers defensively.
  for (const hop of ['innerType', 'in', 'out', 'schema'] as const) {
    if (def[hop]) collectDeclaredTopLevelKeys(def[hop], into, depth + 1);
  }
}

/**
 * [#5599] The precondition's predicate half, extracted (#6391) so
 * {@link diagnoseViewMetadata} can ask the SAME question the parse path asks
 * without having to recognise the issue text the other half writes.
 *
 * True for anything this precondition does not judge (non-objects, arrays —
 * left to the union, which already rejects them) and for any object carrying at
 * least one key some member declares that the write path did not stamp itself.
 */
function speaksViewVocabulary(body: unknown): boolean {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) return true;
  const vocabulary = viewMetadataVocabulary();
  return Object.keys(body as Record<string, unknown>).some((key) => vocabulary.has(key));
}

/**
 * [#5599] The minimal identity precondition, run BEFORE the four-arm union.
 *
 * A `view` body must speak the `view` vocabulary — carry at least one key some
 * member declares that the write path did not stamp itself
 * ({@link VIEW_WRITE_PATH_IDENTITY_KEYS}). That is the whole bar, deliberately:
 * it rejects bodies that are **not a view at all** (`{ nope: 1 }`, `{}`,
 * `{ id: 'x' }`, and identity with no content) while making no judgement about
 * whether the view is *complete* — which is what keeps it compatible with every
 * lean shape the platform round-trips. A pin PUT (`{ isPinned: true }`), a hide
 * PUT (`{ hidden: true }`), a reorder (`{ sortOrder: 3 }`) and a column-sort PUT
 * all carry declared non-identity keys and are unaffected.
 *
 * "Complete" is deliberately NOT the bar, and the distinction is the whole
 * reason this is safe: `{ isPinned: true }` is not a renderable view either, but
 * it is unambiguously a *view operation*, and 422-ing the platform's own writes
 * would be a worse defect than the one being fixed.
 *
 * **Why a precondition and not a required floor on member 4.** Giving the form
 * arm a required key (the other candidate fix) would 422 the flattened overlays
 * Studio writes, whose required-ness nobody has measured; the ruling on #5599
 * took this route and deferred that one explicitly. This route also leaves every
 * arm's `.strip()` untouched — the round-trip capability #5074 traced and
 * documented is load-bearing and is not what was broken. What was broken is that
 * an arm which strips AND requires nothing is a wildcard for the whole union, so
 * the fix belongs one level up, at the union's door.
 *
 * **Why it lives in the existing `z.preprocess` stage.** `/api/v1/meta/types/view`
 * serves `z.toJSONSchema()` of this schema to Studio's SchemaForm, and both pins
 * (`view-metadata-schema.test.ts`, `view-authoring-wire-split.test.ts`) require a
 * four-member `anyOf` in the OUTPUT *and* INPUT directions. Adding a stage to the
 * pipe (`z.unknown().superRefine(…).pipe(union)`) satisfies the output direction
 * and silently degrades the input one to `{}` — the form would render nothing.
 * Reporting through the preprocess's own `ctx` changes no types, so the emitted
 * `anyOf` is byte-identical. It also short-circuits: `z.NEVER` aborts the pipe,
 * so a rejected body yields ONE named issue instead of that issue plus four
 * `invalid_union` branches for arms that were never the point.
 */
function assertViewIdentity(body: unknown, ctx: z.RefinementCtx): boolean {
  // Non-objects and arrays are left to the union, which already rejects them —
  // this precondition answers "which object is not a view", nothing else.
  if (typeof body !== 'object' || body === null || Array.isArray(body)) return true;
  if (speaksViewVocabulary(body)) return true;
  const keys = Object.keys(body as Record<string, unknown>);
  // Report the two halves separately. Lumping them together would call `name`
  // "unrecognized", which is false and would send an author to fix the wrong
  // key: `name` is declared, it is just discounted as evidence.
  const identity = keys.filter((key) => VIEW_WRITE_PATH_IDENTITY_KEYS.has(key));
  const unknown = keys.filter((key) => !VIEW_WRITE_PATH_IDENTITY_KEYS.has(key));
  const quote = (list: string[], cap = 5) =>
    `${list.slice(0, cap).map((k) => `\`${k}\``).join(', ')}${list.length > cap ? ', …' : ''}`;
  ctx.addIssue({
    code: 'custom',
    path: [],
    message:
      'Not a `view` body: no recognized `view` key. Expected at least one of a container slot ' +
      '(`list` / `form` / `listViews` / `formViews`), a ViewItem record (`viewKind` + `config`), ' +
      'or an inline view config (`type`, `columns`, `sections`, `filter`, …). ' +
      (keys.length === 0 ? 'Received `{}`.' : 'Received ') +
      (unknown.length > 0 ? `unrecognized ${unknown.length === 1 ? 'key' : 'keys'} ${quote(unknown)}` : '') +
      (unknown.length > 0 && identity.length > 0 ? ', and ' : '') +
      (identity.length > 0
        ? `only identity fields (${quote(identity)}) — these say which view this attaches to, ` +
          'not what the view is, and the write path stamps them itself'
        : '') +
      (keys.length === 0 ? '' : '.'),
  });
  return false;
}

// ───────────────────────────────────────────────────────────────────────────
// [#6391] The union's members, named and published
// ───────────────────────────────────────────────────────────────────────────
//
// Measured from the consumer side (objectui#3606 / PR objectui#3624, against
// `@objectstack/spec` 17.0.0-rc.5): a consumer that has to turn a
// `ViewMetadataSchema` failure back into per-field diagnostics had exactly two
// routes, and both couple to spec internals. It could index the nested
// `invalid_union` `errors[]` BY MEMBER POSITION — position is an internal
// detail nobody promised, so objectui pinned it with a CANARY test that rings
// on every reorder — or it could re-declare each member itself, which is a
// deeper coupling still and was measured and rejected there.
//
// The cause was never the union: member 1 was already the exported
// `ViewItemWireSchema`, and a consumer could reference THAT contractually. The
// other three were inline expressions with no name, so member 2 was merely
// "shaped like `ViewSchema`" — key-for-key identical, behaviourally identical,
// and NOT the same object, which is precisely the difference between a contract
// and a resemblance.
//
// So the members get names, the union is built FROM those names (the identity
// is guaranteed by construction, not maintained by hand), and a branch-naming
// diagnostic entry point sits beside them so a consumer never has to know the
// order at all — {@link diagnoseViewMetadata}.
//
// The names are published as ONE export — {@link VIEW_METADATA_MEMBERS}, keyed
// by branch — rather than as three individual `…Schema` consts, and that is a
// decision rather than a style: a top-level exported schema binding mints a new
// protocol def (`ui/ViewContainerWire`, …) in `json-schema.manifest/` and, for
// anything with a derivable object shape, a full set of keys in the ratcheted
// `authorable-surface/`. The container member's 15 keys ARE `ui/View`'s 15
// keys — duplicating them there would add 15 phantom authorable properties to
// the ADR-0049 liveness worklist for a wire door nobody authors against. The
// record gives a consumer the same contractual handle
// (`VIEW_METADATA_MEMBERS.container`) with none of that.
//
// ⛔ What this deliberately does NOT do: convert the union to
// `z.discriminatedUnion`. That was the filer's other option, and it would move
// the ACCEPTANCE face — a discriminated union refuses an unknown discriminant
// outright where this union falls through all four members, and several of
// these shapes have no discriminant key at all (a flattened overlay may carry
// nothing but `columns`). The dispatch below is therefore a DIAGNOSTIC
// dispatch: it names the branch a failure belongs to, and decides nothing about
// whether the body is accepted. `ViewMetadataSchema` remains the only judge.

/**
 * [#6391] Member 2 of {@link ViewMetadataSchema} — a non-empty `defineView`
 * container. Published as `VIEW_METADATA_MEMBERS.container`.
 *
 * `ViewSchema` itself accepts `{}` (every slot optional), which would register
 * zero views; the refinement is what makes this member "a container that
 * actually defines a view" — see {@link containerHasAView}. It is published
 * because that refinement, not `ViewSchema`, is what the union holds: a
 * consumer selecting "the container branch" needs the object the union is
 * actually going to run, or its diagnosis diverges from the platform's on
 * exactly the empty-container case.
 */
const ViewContainerWireSchema = lazySchema(() =>
  ViewSchema.refine(containerHasAView, {
    message:
      'A view container must define at least one of `list`, `form`, `listViews`, or `formViews`.',
  }),
);

/**
 * [#6391] Member 3 of {@link ViewMetadataSchema} — a flattened runtime LIST
 * overlay: an inline `ListView` config at the top level plus the optional
 * identity/round-trip fields a personalization PUT carries. Published as
 * `VIEW_METADATA_MEMBERS.listOverlay`.
 *
 * `.strip()` is load-bearing, not leftover. `.extend()` INHERITS strictness, so
 * closing `ListViewSchema` for authoring (#4001) silently made this overlay
 * strict too — and this member exists precisely to carry Studio's auxiliary
 * round-trip keys (`isPinned`, `sortOrder`, …) that `saveMetaItem` persists
 * verbatim. Strict here is a 422 on a shape the platform itself writes. The
 * ledger names this as the trap to watch while batching: a response-side
 * extension of an authoring schema must strip back, or an upstream field
 * addition becomes a crash.
 */
const ListViewOverlayWireSchema = lazySchema(() =>
  ListViewSchema.extend(flattenedViewOverlayFields()).strip(),
);

/**
 * [#6391] Member 4 of {@link ViewMetadataSchema} — a flattened runtime FORM
 * overlay, published as `VIEW_METADATA_MEMBERS.formOverlay`. Same construction
 * and the same `.strip()` rationale as {@link ListViewOverlayWireSchema}; the
 * list member is tried first, and a flattened form (no required `columns`,
 * disjoint `type` enum) then matches here.
 */
const FormViewOverlayWireSchema = lazySchema(() =>
  FormViewSchema.extend(flattenedViewOverlayFields()).strip(),
);

/**
 * [#6391] The branch names of {@link ViewMetadataSchema}'s union, in
 * declaration order.
 *
 * The order is still the union's evaluation order — that has not changed and is
 * observable — but a consumer no longer has to *encode* it: it can ask for a
 * branch by name via {@link VIEW_METADATA_MEMBERS}, or let
 * {@link diagnoseViewMetadata} name the branch for it.
 */
export const VIEW_METADATA_BRANCHES = ['viewItem', 'container', 'listOverlay', 'formOverlay'] as const;

/** [#6391] One branch of {@link ViewMetadataSchema}'s union, by name. */
export type ViewMetadataBranch = (typeof VIEW_METADATA_BRANCHES)[number];

/**
 * [#6391] Branch name → the schema {@link ViewMetadataSchema}'s union actually
 * holds for that branch.
 *
 * This record IS the union's member list: the schema below is built by mapping
 * {@link VIEW_METADATA_BRANCHES} over it, so "member N is the published schema"
 * is guaranteed by construction rather than by two declarations agreeing. Add a
 * member here and it is in the union, named, in one edit.
 *
 * The values are {@link lazySchema} proxies, so naming them costs no eager
 * materialisation (ADR-0089 D3a) — reading this record does not build a single
 * view schema.
 */
export const VIEW_METADATA_MEMBERS = {
  // 1. Standalone ViewItem record — nested config validated genuinely, and the
  //    WIRE variant, so Studio's round-trip keys have a declared home.
  viewItem: ViewItemWireSchema,
  // 2. Non-empty defineView container.
  container: ViewContainerWireSchema,
  // 3/4. Flattened runtime overlay — inline ListView / FormView config + identity.
  listOverlay: ListViewOverlayWireSchema,
  formOverlay: FormViewOverlayWireSchema,
} as const satisfies Record<ViewMetadataBranch, z.ZodTypeAny>;

/**
 * [#5599] The `view` vocabulary, derived once from the members on first use.
 *
 * Hoisted out of {@link ViewMetadataSchema}'s factory closure (#6391) so
 * {@link diagnoseViewMetadata} can consult the SAME derivation the parse path
 * consults. Two copies of this rule would be two answers to "is this a view
 * body at all?", and the diagnostic one would be the wrong one.
 *
 * Still computed on first call rather than at module load: the members are
 * {@link lazySchema} proxies whose factories run on first `_zod` touch, and
 * deriving eagerly would force every view schema in the file to materialise as
 * a side effect of this module loading (ADR-0089 D3a).
 */
let viewVocabularyCache: Set<string> | undefined;
function viewMetadataVocabulary(): Set<string> {
  if (!viewVocabularyCache) {
    const vocabulary = new Set<string>();
    for (const branch of VIEW_METADATA_BRANCHES) {
      collectDeclaredTopLevelKeys(VIEW_METADATA_MEMBERS[branch], vocabulary);
    }
    // Identity the write path supplies is not evidence of shape — see
    // `VIEW_WRITE_PATH_IDENTITY_KEYS` for why this subtraction is the
    // difference between closing #5599 and only appearing to.
    for (const key of VIEW_WRITE_PATH_IDENTITY_KEYS) vocabulary.delete(key);
    viewVocabularyCache = vocabulary;
  }
  return viewVocabularyCache;
}

/**
 * [#6391] The `type` values that tell the two flattened overlay branches apart.
 *
 * `ListViewSchema.type` and `FormViewSchema.type` are disjoint enums — the
 * property the union's own comment already relies on ("a flattened form (no
 * required `columns`, disjoint `type` enum) then matches the form member"). Read
 * off the schemas rather than re-listed, so a new view type cannot make the
 * dispatch disagree with the members.
 */
function overlayTypeValues(schema: z.ZodTypeAny): ReadonlySet<string> {
  const shape = (schema as unknown as { _zod?: { def?: { shape?: Record<string, unknown> } } })
    ._zod?.def?.shape;
  const values = (shape?.type as { _zod?: { values?: Set<unknown> } } | undefined)?._zod?.values;
  return new Set([...(values ?? [])].filter((v): v is string => typeof v === 'string'));
}

/**
 * [#6391] Which branch of {@link ViewMetadataSchema} a body CLAIMS to be, by
 * its structural discriminants — or `null` when nothing in the body settles it.
 *
 * This is the "select the member by body" entry the filer asked for, and it
 * encodes exactly the discriminants the members themselves already declare:
 *
 * - a nested `config` means a ViewItem record — both overlay members pin
 *   `config: z.undefined()` precisely to exclude that shape;
 * - a container slot (`list` / `form` / `listViews` / `formViews`) means a
 *   container — both overlay members pin those `undefined` too;
 * - otherwise the body is a flattened overlay, and `viewKind` (when the write
 *   path inherited one — #2555) or the disjoint `type` enums say which family.
 *
 * ⚠️ A `null` answer is not a rejection and a non-`null` one is not an
 * acceptance. This function decides which branch is worth EXPLAINING; whether
 * the body parses is `ViewMetadataSchema`'s answer and only its answer.
 */
export function selectViewMetadataBranch(body: unknown): ViewMetadataBranch | null {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) return null;
  const b = body as Record<string, unknown>;
  if (b.config !== undefined) return 'viewItem';
  if (b.list !== undefined || b.form !== undefined || b.listViews !== undefined || b.formViews !== undefined) {
    return 'container';
  }
  if (b.viewKind === 'form') return 'formOverlay';
  if (b.viewKind === 'list') return 'listOverlay';
  if (typeof b.type === 'string') {
    if (overlayTypeValues(FormViewSchema).has(b.type)) return 'formOverlay';
    if (overlayTypeValues(ListViewSchema).has(b.type)) return 'listOverlay';
  }
  return null;
}

/**
 * [#7510] What a branch reports once {@link focusClaimedBranch} has taken its
 * own complaint off the table.
 *
 * The shape is chosen, not decorative: `code: 'invalid_type'` at path `[]` is
 * exactly the "this branch only says the value is the wrong KIND" shape that
 * every consumer of a failed union in this repo already drops before ranking —
 * `isKindMismatchOnly` in `shared/error-map.zod.ts`, in `metadata-protocol`'s
 * `zodIssuesToMetadataIssues`, and in `rest`'s `zodIssuesToFields`, one
 * predicate written three times. So a muted branch does not become a quieter
 * competitor for the reader's attention; it leaves the competition, and the
 * branch the body actually claims is what remains to be rendered.
 *
 * The message still has to be true if some future consumer prints it anyway,
 * so it says what happened (this is not the branch the body claims) and where
 * the diagnosis is (the branch that is).
 */
function unclaimedBranchIssue(
  branch: ViewMetadataBranch,
  claimed: ViewMetadataBranch,
  input: unknown,
): z.core.$ZodIssue {
  return {
    code: 'invalid_type',
    expected: 'object',
    input,
    path: [],
    message:
      `Not the \`${branch}\` branch — this body reads as \`${claimed}\`, `
      + `so that branch carries the diagnosis.`,
  } as z.core.$ZodIssue;
}

/**
 * [#7510] Focus a FAILED `ViewMetadataSchema` union on the branch the body
 * claims, so the branch that got furthest is the one whose prescription the
 * author reads.
 *
 * ## The defect this closes
 *
 * Measured through the real write path (`saveMetaItem` → this union) on
 * `origin/main` @ `9051802`: a form ViewItem whose field carries an unknown
 * `publicPicker` subkey is correctly refused, and the message the author gets
 * is the CONTAINER branch's —
 *
 * ```
 * <root>: Unrecognized key(s) on this view container: `viewKind`, `config`.
 *   • `viewKind` belongs to a single VIEW, not to the container. Wrap it: …
 * ```
 *
 * — a confident, detailed prescription to restructure a container that was
 * correct all along, with the word the author actually mistyped appearing
 * nowhere. Not a `publicPicker` quirk: any ViewItem-branch failure whose
 * top-level issue is not itself an `unrecognized_keys` reproduces it (#7510
 * measured four — a picker subkey, an unknown form-field key, a bad field enum,
 * a typo'd column summary — all four surfaced the container text).
 *
 * The cause is a tie the shared ranking cannot break on content it can see. It
 * ranks a branch by `[issue count, carries an unrecognized_keys]`, and on such
 * a body the container branch reports exactly ONE root `unrecognized_keys`
 * (`viewKind`, `config` are not container keys) while the ViewItem branch
 * reports exactly ONE nested `invalid_union` — the real key sits one level
 * further down, inside it, where the tiebreak does not look. One issue each,
 * and the unknown-key bonus hands it to the branch that understood the body
 * least.
 *
 * ## Why the fix is here and not in the ranking
 *
 * The ranking is shared by every union in the repo and is right about unions in
 * general; what it lacks is what only this file knows — which branch this body
 * IS. That answer already exists here, as {@link selectViewMetadataBranch}, and
 * {@link diagnoseViewMetadata} has been giving objectui the branch-correct
 * reading from it since #6391. The union's own error path was the one door that
 * did not consult it, which is why Studio's 422 and `diagnoseViewMetadata`
 * could describe the same body two different ways. Now they cannot: one rule,
 * one source, both doors.
 *
 * ## What it does and does not touch
 *
 * ⛔ **Not a gate.** A `$ZodCheck` runs after the union has already reached its
 * verdict, and this one only ever REPLACES entries inside an existing
 * `invalid_union` issue's `errors` — it never adds an issue, never removes one,
 * and returns without touching anything when the parse succeeded. The
 * accept/reject verdict of every input is therefore the union's, byte for byte,
 * by construction rather than by test (and pinned anyway, over the 42-body
 * corpus in `view-union-diagnostics.test.ts`).
 *
 * `when: () => true` is what lets it run at all: a check is skipped by default
 * once parsing has produced aborting issues, which is precisely the state this
 * one exists to describe. It is a declared field of `$ZodCheckDef`, not a
 * reach into zod's internals.
 *
 * Three things deliberately stay exactly as they were:
 *
 * - **The `errors` array keeps its length and its ORDER.** A muted branch is
 *   replaced in place, not filtered out, so a positional consumer (objectui's
 *   canary read `errors[2]`) still finds branch 2 where branch 2 was.
 * - **The wrapper itself is untouched.** Whether zod emits the
 *   `invalid_union` wrapper or returns a lone non-aborted branch's issues
 *   verbatim is decided in `handleUnionResults` before any check runs, so
 *   nothing about the envelope's shape or issue codes moves.
 * - **An unclaimed body is left alone.** When no discriminant settles the claim
 *   (`selectViewMetadataBranch` → `null`) the ranking keeps the case, exactly as
 *   {@link diagnoseViewMetadata} keeps it (`candidates = claimed ? [claimed] :
 *   all`). A genuinely bad CONTAINER claims `container`, so the #4001 guidance
 *   text that made this defect visible is also what a real container failure
 *   still gets.
 */
function focusClaimedBranch(): z.core.$ZodCheck<unknown> {
  const check = new z.core.$ZodCheck({ check: 'custom', when: () => true }) as z.core.$ZodCheck<unknown>;
  check._zod.check = (payload) => {
    if (payload.issues.length === 0) return;
    const claimed = selectViewMetadataBranch(payload.value);
    if (claimed === null) return;

    for (let index = 0; index < payload.issues.length; index += 1) {
      const issue = payload.issues[index] as { code?: string; errors?: readonly z.core.$ZodIssue[][] };
      if (issue?.code !== 'invalid_union' || !Array.isArray(issue.errors)) continue;
      // Defensive: the branch↔position mapping below is only meaningful for
      // THIS union's own issue. A nested union that bubbled up unwrapped would
      // have a different arity, and renaming its branches would be a lie.
      if (issue.errors.length !== VIEW_METADATA_BRANCHES.length) continue;

      payload.issues[index] = {
        ...(payload.issues[index] as object),
        errors: issue.errors.map((branchIssues, position) => {
          const branch = VIEW_METADATA_BRANCHES[position]!;
          return branch === claimed
            ? branchIssues
            : [unclaimedBranchIssue(branch, claimed, payload.value)];
        }),
      } as typeof payload.issues[number];
    }
  };
  return check;
}

/** [#6391] The result of {@link diagnoseViewMetadata}. */
export type ViewMetadataDiagnosis =
  | { success: true; branch: ViewMetadataBranch; data: ViewMetadataParsed }
  | { success: false; branch: ViewMetadataBranch | null; issues: readonly z.core.$ZodIssue[] };

/**
 * [#6391] Explain a `view` body the way a consumer needs it explained: with the
 * failing BRANCH named and that branch's own per-field issues, flat.
 *
 * The problem this closes, measured in objectui#3624: `ViewMetadataSchema`
 * failing produces ONE root `invalid_union` issue with the per-field truth
 * buried in nested `errors[]`, addressable only by member position. Here the
 * position never appears — the caller gets `branch: 'listOverlay'` and the list
 * overlay's own issues, with real field paths.
 *
 * Three outcomes, and the middle one is the one worth reading twice:
 *
 * 1. **The body parses.** `ViewMetadataSchema` accepted it; the branch reported
 *    is the first member that accepts it.
 * 2. **The body is not a `view` at all** (#5599's identity precondition —
 *    `{ nope: 1 }`, `{}`, identity keys only). `branch` is `null` and the
 *    issues are the precondition's own. Naming a branch here would be a lie:
 *    the union never ran, and pointing the author at "the form overlay" would
 *    send them to fix a shape they were not writing.
 * 3. **The body claims a branch and that branch rejects it.** `branch` names
 *    it, `issues` are that member's, resolved against the body's own paths.
 *    When no discriminant settles the claim, every member is tried and the one
 *    complaining LEAST is reported — the same "fewest issues wins" ranking
 *    `selectUnionBranches` (`shared/error-map.zod.ts`) already uses for this
 *    family, so one mistake gets one prescription across every surface.
 *
 * ⛔ **Acceptance is not decided here.** This function delegates the verdict to
 * `ViewMetadataSchema` and only ever explains a verdict it did not make: if the
 * schema accepts, this reports success no matter what the branch dispatch
 * thinks. Pinned in `view-union-diagnostics.test.ts`.
 */
export function diagnoseViewMetadata(body: unknown): ViewMetadataDiagnosis {
  const parsed = ViewMetadataSchema.safeParse(body);
  const stripped = stripViewConsoleDecorations(body);

  if (parsed.success) {
    const accepting = VIEW_METADATA_BRANCHES.find(
      (branch) => VIEW_METADATA_MEMBERS[branch].safeParse(stripped).success,
    );
    // The union accepted, so some member did; `selectViewMetadataBranch` is the
    // fallback only for the impossible case, never the primary answer.
    return { success: true, branch: accepting ?? selectViewMetadataBranch(stripped) ?? 'viewItem', data: parsed.data };
  }

  // (2) The identity precondition short-circuited the pipe with `z.NEVER`, so
  // the union never ran and there is no branch to name. Detected by re-running
  // the precondition's own predicate rather than by pattern-matching its issue
  // text — same rule, one source.
  if (!speaksViewVocabulary(body)) {
    return { success: false, branch: null, issues: parsed.error.issues };
  }

  const claimed = selectViewMetadataBranch(stripped);
  const candidates = claimed ? [claimed] : [...VIEW_METADATA_BRANCHES];
  let best: { branch: ViewMetadataBranch; issues: readonly z.core.$ZodIssue[] } | undefined;
  for (const branch of candidates) {
    const result = VIEW_METADATA_MEMBERS[branch].safeParse(stripped);
    // A member that accepts what the union rejected cannot happen (the union is
    // exactly these members), but if it ever did, reporting zero issues under a
    // `success: false` would be the worst possible answer — so skip it.
    if (result.success) continue;
    if (!best || result.error.issues.length < best.issues.length) {
      best = { branch, issues: result.error.issues };
    }
  }
  return best
    ? { success: false, branch: best.branch, issues: best.issues }
    : { success: false, branch: claimed, issues: parsed.error.issues };
}

/**
 * Canonical schema for ANY persisted `view` metadata body — the schema the
 * `view` type registers in `metadata-type-schemas.ts`. A union over the three
 * runtime shapes (see the block comment above), so save-time validation and
 * read-time diagnostics finally see through `ViewItem`/personalization bodies
 * instead of stripping them to `{}` (#3095).
 *
 * `z.toJSONSchema()` emits this as an `anyOf` of the four members, which the
 * `/api/v1/meta/types/view` endpoint serves to Studio's SchemaForm. That still
 * holds through the #5074 `z.preprocess` wrapper — a pipe converts to its
 * output side, so the top level is still an `anyOf` of four. Pinned in
 * `view-metadata-schema.test.ts` and `view-authoring-wire-split.test.ts`,
 * because the endpoint is what feeds every generated view form.
 *
 * [#5074] The `z.preprocess` is the WIRE door's decoration strip — see
 * {@link stripViewConsoleDecorations}. It runs once, ahead of every member, so
 * the openness this union needs reaches nested blocks that a member-level
 * `.strip()` can never reach.
 *
 * [#5599] That same stage now also carries the identity precondition — see
 * {@link assertViewIdentity} for why the check has to live here rather than as
 * an extra pipe stage, and why it is a precondition rather than a required floor
 * on member 4.
 */
export const ViewMetadataSchema = lazySchema(() => {
  // [#6391] The members ARE {@link VIEW_METADATA_MEMBERS}, read in
  // {@link VIEW_METADATA_BRANCHES} order. Built by mapping rather than
  // re-listed, so "the published schema is the member the union runs" cannot
  // drift into "the published schema resembles it" — the exact gap objectui had
  // to bridge with a canary test.
  const members = VIEW_METADATA_BRANCHES.map((branch) => VIEW_METADATA_MEMBERS[branch]);

  return z.preprocess(
    (body, ctx) => (assertViewIdentity(body, ctx) ? stripViewConsoleDecorations(body) : z.NEVER),
    // [#7510] The `.check()` rides the UNION rather than the pipe, so the body
    // it reads is the stripped one the members were actually judged against —
    // the same input `diagnoseViewMetadata` claims a branch from. It changes no
    // verdict; see {@link focusClaimedBranch}.
    z.union(members as unknown as readonly [z.ZodTypeAny, z.ZodTypeAny, ...z.ZodTypeAny[]])
      .check(focusClaimedBranch()),
  );
});

// ───────────────────────────────────────────────────────────────────────────
// defineView container → ViewItem expansion (shared by every loader)
//
// `defineView({ list, form, listViews, formViews })` aggregates an object's
// views into one document. Each registration path that ingests such a
// container (the ObjectQL engine boot loop AND the metadata HMR plugin) must
// expand it into N independent ViewItems registered under `<object>.<viewKey>`,
// so each view is individually addressable and `getViewsByObject()` can rebuild
// the switcher. The original container is ALSO kept under the bare `<object>`
// key for backward-compatible reads. This logic lives in `@objectstack/spec`
// (depended on by both objectql and metadata) so the two loaders cannot drift.

/** A ViewItem materialised from an aggregated container (always `package`). */
export interface ExpandedViewItem {
  name: string;
  object: string;
  viewKind: 'list' | 'form';
  label?: unknown;
  config: any;
  isDefault?: boolean;
  order: number;
  scope: 'package';
  /** Non-blocking expansion diagnostics (MetadataValidationResult wire shape).
   *  Present only when the item's name had to be rewritten to avoid a
   *  collision — loaders surface `warnings` in their boot/HMR logs and
   *  Studio can badge the view. */
  _diagnostics?: { valid: boolean; warnings: Array<{ path: string; message: string }> };
}

/** True when a raw view artifact still uses the aggregated container shape
 *  (and is not already an independent ViewItem, which carries `viewKind`). */
export function isAggregatedViewContainer(item: any): boolean {
  if (!item || typeof item !== 'object') return false;
  if (item.viewKind) return false; // already an independent ViewItem
  return Boolean(item.list || item.form || item.listViews || item.formViews);
}

/** Structural signature used to collapse a container's default `list`/`form`
 *  with a redundant `listViews`/`formViews` restatement of the same view (the
 *  common "default == listViews.all" authoring pattern). */
function viewSignature(v: any): string {
  if (!v || typeof v !== 'object') return '';
  try {
    return JSON.stringify({ type: v.type ?? null, label: v.label ?? null, columns: v.columns ?? null });
  } catch {
    return '';
  }
}

/** Allocate a collision-free `<object>.<key>` name within one expansion. */
function uniqueViewName(base: string, used: Set<string>): string {
  let name = base;
  let i = 2;
  while (used.has(name)) name = `${base}_${i++}`;
  used.add(name);
  return name;
}

/** Stamp a rename warning on an expanded item whose `<object>.<key>` name was
 *  already taken (e.g. `formViews.default` vs the implicit default `list`).
 *  The rename itself is kept for backward compatibility — this makes it LOUD:
 *  loaders log the warning and Studio can render it, so authors discover that
 *  references to the requested name (form action `target`s, navigation
 *  `viewName`s) resolve to a DIFFERENT view. */
function stampRenameWarning(item: ExpandedViewItem, requestedName: string): void {
  if (item.name === requestedName) return;
  item._diagnostics = {
    valid: true,
    warnings: [{
      path: 'name',
      message:
        `View key collision: '${requestedName}' is already registered by another view in this `
        + `defineView container (list and form views share one '<object>.<key>' namespace, and the `
        + `default 'list' implicitly claims '<object>.default'). This ${item.viewKind} view was `
        + `renamed to '${item.name}'. References targeting '${requestedName}' — form action `
        + `targets, navigation viewNames — will resolve to the OTHER view. Rename the view key `
        + `to something unique to remove this warning.`,
    }],
  };
}

function cloneViewConfig(v: any): any {
  try {
    return structuredClone(v);
  } catch {
    return JSON.parse(JSON.stringify(v));
  }
}

/**
 * A view-key collision detected while expanding one `defineView` container.
 *
 * List and form views share a single `<object>.<key>` namespace during
 * expansion (see {@link expandViewContainer}), and the default `list`
 * implicitly claims `<object>.default`. When a later view competes for a name
 * already taken, it is renamed (`<object>.<key>` → `<object>.<key>_2`) to keep
 * the runtime registry key unique. That rename is a silent footgun: references
 * to the requested name (form action `target`s, navigation `viewName`s) resolve
 * to the OTHER view. The build-time view-ref lint turns each collision into a
 * hard error so the author fixes the key instead of shipping a broken reference.
 */
export interface ViewKeyCollision {
  /** The `<object>.<key>` name that was already registered by an earlier view. */
  requested: string;
  /** The disambiguated name the colliding view was renamed to (e.g. `…_2`). */
  renamedTo: string;
  /** Which family the renamed (losing) view belongs to. */
  viewKind: 'list' | 'form';
  /** The raw author-supplied key that collided. */
  key: string;
}

/** Result of {@link expandViewContainerWithDiagnostics}. */
export interface ExpandViewResult {
  items: ExpandedViewItem[];
  collisions: ViewKeyCollision[];
}

/**
 * Expand an aggregated view container into independent ViewItems, ALSO reporting
 * every name collision that forced a rename.
 *
 * List family: `listViews` entries first (keys taken from the author), then the
 * default `list` — deduped by structural signature so a `listViews.all` that
 * merely restates `list` collapses into one item. The view matching the
 * declared default is flagged `isDefault`. Form family: `formViews` entries,
 * then the default `form`.
 *
 * Collisions are captured at the exact points the shared `used` set forces a
 * rename, so the diagnostic can never drift from the expansion it describes.
 */
export function expandViewContainerWithDiagnostics(object: string, container: any): ExpandViewResult {
  const out: ExpandedViewItem[] = [];
  const collisions: ViewKeyCollision[] = [];
  const used = new Set<string>();
  let order = 0;

  // ---- list family ----
  const listSigToName = new Map<string, string>();
  const listViews =
    container.listViews && typeof container.listViews === 'object' ? container.listViews : {};
  for (const [k, v] of Object.entries<any>(listViews)) {
    if (!v || typeof v !== 'object') continue;
    const requested = `${object}.${k}`;
    const name = uniqueViewName(requested, used);
    if (name !== requested) collisions.push({ requested, renamedTo: name, viewKind: 'list', key: k });
    listSigToName.set(viewSignature(v), name);
    const item: ExpandedViewItem = { name, object, viewKind: 'list', label: v.label, config: cloneViewConfig(v), order: order++, scope: 'package' };
    stampRenameWarning(item, requested);
    out.push(item);
  }
  const defaultList = container.list;
  let defaultListName: string | undefined;
  if (defaultList && typeof defaultList === 'object') {
    const dup = listSigToName.get(viewSignature(defaultList));
    if (dup) {
      defaultListName = dup; // already represented by a named listViews entry
    } else {
      const key = typeof defaultList.name === 'string' && defaultList.name ? defaultList.name : 'default';
      const requested = `${object}.${key}`;
      const name = uniqueViewName(requested, used);
      if (name !== requested) collisions.push({ requested, renamedTo: name, viewKind: 'list', key });
      const item: ExpandedViewItem = { name, object, viewKind: 'list', label: defaultList.label, config: cloneViewConfig(defaultList), order: order++, scope: 'package' };
      stampRenameWarning(item, requested);
      out.push(item);
      defaultListName = name;
    }
  }
  if (!defaultListName && out.length) defaultListName = out[0].name;
  for (const item of out) {
    if (item.viewKind === 'list' && item.name === defaultListName) item.isDefault = true;
  }

  // ---- form family ----
  const formStart = out.length;
  const formSigSeen = new Set<string>();
  const formViews =
    container.formViews && typeof container.formViews === 'object' ? container.formViews : {};
  for (const [k, v] of Object.entries<any>(formViews)) {
    if (!v || typeof v !== 'object') continue;
    const requested = `${object}.${k}`;
    const name = uniqueViewName(requested, used);
    if (name !== requested) collisions.push({ requested, renamedTo: name, viewKind: 'form', key: k });
    formSigSeen.add(viewSignature(v));
    const item: ExpandedViewItem = { name, object, viewKind: 'form', label: v.label, config: cloneViewConfig(v), order: order++, scope: 'package' };
    stampRenameWarning(item, requested);
    out.push(item);
  }
  const defaultForm = container.form;
  let defaultFormName: string | undefined;
  if (defaultForm && typeof defaultForm === 'object' && !formSigSeen.has(viewSignature(defaultForm))) {
    const key = typeof defaultForm.name === 'string' && defaultForm.name ? defaultForm.name : 'form';
    const requested = `${object}.${key}`;
    const name = uniqueViewName(requested, used);
    if (name !== requested) collisions.push({ requested, renamedTo: name, viewKind: 'form', key });
    const item: ExpandedViewItem = { name, object, viewKind: 'form', label: defaultForm.label, config: cloneViewConfig(defaultForm), order: order++, scope: 'package' };
    stampRenameWarning(item, requested);
    out.push(item);
    defaultFormName = name;
  }
  if (!defaultFormName && out.length > formStart) defaultFormName = out[formStart].name;
  for (let i = formStart; i < out.length; i++) {
    if (out[i].name === defaultFormName) out[i].isDefault = true;
  }

  return { items: out, collisions };
}

/**
 * Expand an aggregated view container into independent ViewItems.
 *
 * Thin wrapper over {@link expandViewContainerWithDiagnostics} that discards the
 * collision diagnostics — the shape every runtime loader consumes. Behaviour is
 * unchanged: colliding names are still renamed so the registry key stays unique.
 */
export function expandViewContainer(object: string, container: any): ExpandedViewItem[] {
  return expandViewContainerWithDiagnostics(object, container).items;
}

/**
 * Type-safe factory for a standalone {@link FormView} bound to a JSON Schema
 * rather than to an ObjectQL object.
 *
 * Use this for forms that edit **metadata** (e.g. `report.form.ts`,
 * `dashboard.form.ts`), **action inputs**, or **flow screens** — anywhere the
 * data shape is described by a Zod-derived JSON Schema instead of an Object
 * field set.
 *
 * The returned FormView is validated at definition time; the runtime form
 * renderer (`@object-ui/plugin-form`) inspects `data.provider === 'schema'`
 * and pulls field metadata from the resolved JSON Schema instead of from
 * ObjectQL.
 *
 * @example
 * ```ts
 * export const reportForm = defineForm({
 *   schemaId: 'report',
 *   type: 'tabbed',
 *   sections: [
 *     { label: 'Basics', columns: 2, fields: [
 *       { field: 'name' },
 *       { field: 'label' },
 *       { field: 'objectName', widget: 'ref:object' },
 *       { field: 'type' },
 *     ]},
 *     { label: 'Columns', fields: [{ field: 'columns', widget: 'master-detail' }] },
 *     { label: 'Advanced', collapsible: true, collapsed: true, fields: [
 *       { field: 'filter', widget: 'filter-builder' },
 *       { field: 'chart', widget: 'chart-config' },
 *     ]},
 *   ],
 * });
 * ```
 */
export function defineForm(
  config: Omit<z.input<typeof FormViewSchema>, 'data'> & { schemaId: string },
): FormViewParsed {
  const { schemaId, ...rest } = config;
  return FormViewSchema.parse({
    ...rest,
    data: { provider: 'schema', schemaId },
  });
}

export type View = z.input<typeof ViewSchema>;
/** Post-parse shape of {@link View} — defaults applied, transforms run (ADR-0122). */
export type ViewParsed = z.infer<typeof ViewSchema>;
export type ViewItem = z.input<typeof ViewItemSchema>;
/** A ViewItem record as it travels the WIRE — the authoring shape plus Studio's round-trip keys (#5074). */
export type ViewItemWire = z.input<typeof ViewItemWireSchema>;
/** Any persisted `view` metadata body: container | ViewItem record | flattened overlay (#3095). */
export type ViewMetadata = z.input<typeof ViewMetadataSchema>;
/** Post-parse shape of {@link ViewMetadata} — defaults applied, transforms run (ADR-0122). */
export type ViewMetadataParsed = z.infer<typeof ViewMetadataSchema>;
export type ViewScope = z.input<typeof ViewScopeSchema>;
export type ViewKind = z.input<typeof ViewKindSchema>;
export type ListView = z.input<typeof ListViewSchema>;
/** Post-parse shape of {@link ListView} — defaults applied, transforms run (ADR-0122). */
export type ListViewParsed = z.infer<typeof ListViewSchema>;
export type FormView = z.input<typeof FormViewSchema>;
/** Post-parse shape of {@link FormView} — defaults applied, transforms run (ADR-0122). */
export type FormViewParsed = z.infer<typeof FormViewSchema>;
export type FormSection = z.input<typeof FormSectionSchema>;
/** Post-parse shape of {@link FormSection} — defaults applied, transforms run (ADR-0122). */
export type FormSectionParsed = z.infer<typeof FormSectionSchema>;
export type ListColumn = z.input<typeof ListColumnSchema>;
/** Post-parse shape of {@link ListColumn} — defaults applied, transforms run (ADR-0122). */
export type ListColumnParsed = z.infer<typeof ListColumnSchema>;
// `FormField` is declared next to FormFieldSchema — it IS that schema's
// annotation, so it cannot be inferred back out of it (#4171).
export type SelectionConfig = z.input<typeof SelectionConfigSchema>;
/** Post-parse shape of {@link SelectionConfig} — defaults applied, transforms run (ADR-0122). */
export type SelectionConfigParsed = z.infer<typeof SelectionConfigSchema>;
export type NavigationConfig = z.input<typeof NavigationConfigSchema>;
/** Post-parse shape of {@link NavigationConfig} — defaults applied, transforms run (ADR-0122). */
export type NavigationConfigParsed = z.infer<typeof NavigationConfigSchema>;
export type PaginationConfig = z.input<typeof PaginationConfigSchema>;
/** Post-parse shape of {@link PaginationConfig} — defaults applied, transforms run (ADR-0122). */
export type PaginationConfigParsed = z.infer<typeof PaginationConfigSchema>;
export type ViewData = z.input<typeof ViewDataSchema>;
/** Post-parse shape of {@link ViewData} — defaults applied, transforms run (ADR-0122). */
export type ViewDataParsed = z.infer<typeof ViewDataSchema>;
// `HttpRequest` is NOT inferred here — it is re-exported from its single
// declaration in `shared/http.zod.ts` next to the schema re-export at the top of
// this file (#4688). Re-adding `= z.infer<typeof HttpRequestSchema>` below would
// re-create the dual-source row this change removed, even though the inferred
// shape is identical.
//
// `HttpMethod` is not declared here either — and is no longer exported from
// `./ui` at all (#4691). It used to be `= z.infer<typeof HttpMethodSchema>`,
// the 5-value UI subset, while `./shared` and `./api` export a DIFFERENT,
// 7-value declaration under that same name. Re-exporting theirs would widen
// this entry's type past what `HttpRequestSchema.method` actually validates, so
// the name was dropped instead; the 5-value type is re-exported as
// `HttpMethodSubset` at the top of this file (`HttpMethodType` until #5832),
// where the full rationale lives.
export type ColumnSummary = z.input<typeof ColumnSummarySchema>;
export type ColumnSummaryConfig = z.input<typeof ColumnSummaryConfigSchema>;
export type ColumnPrefix = z.input<typeof ColumnPrefixSchema>;
/** Post-parse shape of {@link ColumnPrefix} — defaults applied, transforms run (ADR-0122). */
export type ColumnPrefixParsed = z.infer<typeof ColumnPrefixSchema>;
export type RowHeight = z.input<typeof RowHeightSchema>;
export type GroupingConfig = z.input<typeof GroupingConfigSchema>;
/** Post-parse shape of {@link GroupingConfig} — defaults applied, transforms run (ADR-0122). */
export type GroupingConfigParsed = z.infer<typeof GroupingConfigSchema>;
export type GalleryConfig = z.input<typeof GalleryConfigSchema>;
/** Post-parse shape of {@link GalleryConfig} — defaults applied, transforms run (ADR-0122). */
export type GalleryConfigParsed = z.infer<typeof GalleryConfigSchema>;
export type TimelineConfig = z.input<typeof TimelineConfigSchema>;
/** Post-parse shape of {@link TimelineConfig} — defaults applied, transforms run (ADR-0122). */
export type TimelineConfigParsed = z.infer<typeof TimelineConfigSchema>;
export type ListChartConfig = z.input<typeof ListChartConfigSchema>;
/** Post-parse shape of {@link ListChartConfig} — defaults applied, transforms run (ADR-0122). */
export type ListChartConfigParsed = z.infer<typeof ListChartConfigSchema>;
export type ViewSharing = z.input<typeof ViewSharingSchema>;
/** Post-parse shape of {@link ViewSharing} — defaults applied, transforms run (ADR-0122). */
export type ViewSharingParsed = z.infer<typeof ViewSharingSchema>;
export type RowColorConfig = z.input<typeof RowColorConfigSchema>;
export type VisualizationType = z.input<typeof VisualizationTypeSchema>;
export type UserActionsConfig = z.input<typeof UserActionsConfigSchema>;
/** Post-parse shape of {@link UserActionsConfig} — defaults applied, transforms run (ADR-0122). */
export type UserActionsConfigParsed = z.infer<typeof UserActionsConfigSchema>;
export type AppearanceConfig = z.input<typeof AppearanceConfigSchema>;
/** Post-parse shape of {@link AppearanceConfig} — defaults applied, transforms run (ADR-0122). */
export type AppearanceConfigParsed = z.infer<typeof AppearanceConfigSchema>;
export type ViewTab = z.input<typeof ViewTabSchema>;
/** Post-parse shape of {@link ViewTab} — defaults applied, transforms run (ADR-0122). */
export type ViewTabParsed = z.infer<typeof ViewTabSchema>;
export type UserFilterField = z.input<typeof UserFilterFieldSchema>;
export type UserFilters = z.input<typeof UserFiltersSchema>;
/** Post-parse shape of {@link UserFilters} — defaults applied, transforms run (ADR-0122). */
export type UserFiltersParsed = z.infer<typeof UserFiltersSchema>;
export type AddRecordConfig = z.input<typeof AddRecordConfigSchema>;
/** Post-parse shape of {@link AddRecordConfig} — defaults applied, transforms run (ADR-0122). */
export type AddRecordConfigParsed = z.infer<typeof AddRecordConfigSchema>;
export type CalendarConfig = z.input<typeof CalendarConfigSchema>;
export type GanttConfig = z.input<typeof GanttConfigSchema>;
export type GanttQuickFilter = z.input<typeof GanttQuickFilterSchema>;
export type KanbanConfig = z.input<typeof KanbanConfigSchema>;
export type NavigationMode = z.input<typeof NavigationModeSchema>;
export type TreeConfig = z.input<typeof TreeConfigSchema>;
export type ViewItemName = z.input<typeof ViewItemNameSchema>;
