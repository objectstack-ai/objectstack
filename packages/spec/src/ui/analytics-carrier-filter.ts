// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The filter slot of every ANALYTICS carrier — a stored filter that is charted
 * through the analytics `where` door — declared once: `FilterConditionSchema`
 * plus the nested-relation walk that door's reach needs (see
 * {@link analyticsCarrierFilter}). Three carriers declare it: `DatasetSchema`'s
 * `filter` and `DatasetMeasureSchema`'s `filter` (`./dataset.zod.ts`, #20080),
 * and a dashboard widget's `filter` (`./dashboard.zod.ts`, #20116), which the
 * dataset executor ANDs into the same query as the selection's
 * `runtimeFilter`.
 *
 * A module of its own, and outside the `ui` barrel, so the carriers share one
 * declaration without it becoming published API. It moved here verbatim from
 * `./dataset.zod.ts` when the widget became its second file's carrier; the two
 * dataset carriers' published JSON Schema did not move with it.
 */

import type { z } from 'zod';
import { FieldOperatorsSchema, FilterConditionSchema } from '../data/filter.zod';
import { reportQueryFaceRefusals } from '../data/filter-save-door-refusals';

// ── [#20080] The analytics door's reach, on the analytics carriers ──────────

/**
 * A node the analytics `where` door walks: a plain object, not `null`, not an
 * array and not a `Date` — that door's own `isFilterObject`
 * (`service-analytics` `strategies/filter-normalizer.ts`), mirrored here.
 */
function isAnalyticsFilterObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value) && !(value instanceof Date);
}

/**
 * A NESTED-RELATION field spec, as the analytics door decides it
 * (`isNestedRelationSpec` in the same file): a plain object — prototype
 * `Object.prototype` or `null`, so a `Map` or a class instance stays a
 * comparand — carrying no `$` key.
 */
function isAnalyticsNestedRelationSpec(spec: unknown): spec is Record<string, unknown> {
  if (!isAnalyticsFilterObject(spec)) return false;
  const proto = Object.getPrototypeOf(spec);
  if (proto !== Object.prototype && proto !== null) return false;
  return !Object.keys(spec).some((key) => key.startsWith('$'));
}

/**
 * [#20116] A field value the analytics door hands to the query faces as the
 * COMPARAND of an implicit equality: anything but a PLAIN object (prototype
 * `Object.prototype` or `null`), the comparand-type face's own structure test.
 * A plain object that reaches this question carries a `$` key — one with none
 * is a nested relation, taken first — and is an operator map; a `Map`, a class
 * instance, a `Date`, an array or a scalar is a comparand.
 */
function isAnalyticsComparand(spec: unknown): boolean {
  if (!isAnalyticsFilterObject(spec)) return true;
  const proto = Object.getPrototypeOf(spec);
  return proto !== Object.prototype && proto !== null;
}

/**
 * [#20080] Refuse, when an analytics carrier's filter is SAVED, the list the
 * analytics `where` door refuses when that filter is CHARTED: an ARRAY in the
 * EQUALITY slot of a field inside a NESTED-RELATION condition —
 * `{ account: { region: ['a'] } }` and `{ account: { region: { $eq: ['a'] } } }`.
 * [#20116] And, since #20116, every other comparand slot that door refuses
 * there: the whole of the query faces' verdict, asked of the one function
 * `FilterConditionSchema`'s own walk asks (`reportQueryFaceRefusals`,
 * `../data/filter-save-door-refusals.ts`). See the last section.
 *
 * ## Why this is a carrier refinement and not the shared schema's
 *
 * `FilterConditionSchema` refuses an equality-slot list on the field entries
 * of a condition and of every `$and` / `$or` / `$not` member, and deliberately
 * NOT inside a field spec with no `$` key: that is the shared comparand face's
 * reach, and the engine reads such a spec as a deep-equality comparand (ruling
 * A on #19889, record 5805248669). That ruling stands, and this function does
 * not touch the shared schema.
 *
 * The analytics door reads the same spec differently. Its `fieldLeaves`
 * flattens a nested relation to the dotted member `account.region`, so the
 * entries inside are comparisons in their own right, and
 * `assertNoListInEqualitySlot` hands each equality-slot list among them to the
 * shared face, which refuses it with `INVALID_FILTER` / 400. A dataset `filter`
 * and a measure `filter` are charted through that door on every path: the
 * dataset executor hands them to the analytics query, and the native-SQL and
 * ObjectQL strategies and the draft preview each lower them through it. So
 * until this refinement such a dataset saved clean and every chart built on it
 * failed, for somebody else, later. Triage routed the fix to these two
 * carriers (record 5825670610, remedy A): the refusal moves to save, and no
 * filter changes meaning.
 *
 * ## The reach is the analytics door's, and only the part the schema lacks
 *
 * The walk is `mapWhereFieldEntries`' traversal: `$and` / `$or` arrays and
 * `$not` are descended; every other `$` key at node level is skipped; a
 * nested-relation spec is descended, at any depth; every other field entry is
 * judged as that door judges it — each slot handed to the query faces (see the
 * last section), of which the equality-slot list is one arm. No depth bound:
 * that door has none.
 *
 * Only an entry INSIDE a nested relation is reported. Every other entry the
 * walk visits is a field entry of the condition or of a combinator member,
 * which `FilterConditionSchema`'s own refinement already refuses with the same
 * words — reporting it here as well would raise the one refusal twice.
 *
 * ## The words are the face's
 *
 * `arrayEqualityComparandMessage` is the one builder the shared face and the
 * schema door both print from. The analytics door names the field it hands to
 * the face — the leaf key (`region`), with the location `at
 * where.account.region` appended. This refinement prints the same sentence and
 * leaves the location out, as the schema door does, because the issue's own
 * `path` carries it (`filter.account.region`,
 * `measures.0.filter.account.region.$eq`).
 *
 * Nothing is stripped: the parse fails, and a filter that is refused is never
 * a filter that is dropped.
 *
 * ## Every slot the door refuses inside a relation (#20116)
 *
 * The analytics door hands each entry inside a nested relation to the whole
 * comparand-shape face and to its `$null` / `$exists` flag check, not only to
 * the equality arm — so a `null` ordering comparand, a non-list `$in` / `$nin`,
 * a `null` list member, a malformed `$between` or a `null`, blank or
 * `{ $field }` endpoint, an array under `$ne` and a non-boolean flag inside a
 * relation all failed on chart while this walk saved them. Each such entry is
 * now asked of `reportQueryFaceRefusals`, the function `FilterConditionSchema`'s
 * walk asks about the entries IT reaches, so one slot is judged one way
 * whichever walk finds it, and a rule added there reaches this reach too. This
 * walk still decides only WHERE (the analytics door's traversal); the verdict
 * and the words are that function's. The equality lists above are two of its
 * arms and keep their sentence and their path. The list operators keep their
 * lists (`$in: []` / `$nin: []` included), and the null predicate, a
 * `{ $field }` reference as the whole comparand and every scalar pass, because
 * the face passes them.
 *
 * The analytics door hands the same entry to the comparand-TYPE face too, so
 * that function asks it as well: a plain object where a literal belongs, a
 * `Map` or a class instance, `undefined`, a function, a Symbol or a bigint
 * beyond ±2^53 inside a relation is refused here as on chart. Which values
 * are comparands is that face's classification — anything but a PLAIN object
 * ({@link isAnalyticsComparand}) — so a `Map` in a field's value position is
 * judged as the implicit comparand it is, never walked as an operator map with
 * no operators.
 */
function refuseNestedRelationComparands(
  node: unknown,
  ctx: z.RefinementCtx,
  path: (string | number)[] = [],
  insideRelation = false,
): void {
  if (!isAnalyticsFilterObject(node)) return;
  for (const [key, spec] of Object.entries(node)) {
    if (key === '$and' || key === '$or') {
      if (Array.isArray(spec)) {
        spec.forEach((member, index) =>
          refuseNestedRelationComparands(member, ctx, [...path, key, index], insideRelation));
      }
      continue;
    }
    if (key === '$not') {
      refuseNestedRelationComparands(spec, ctx, [...path, key], insideRelation);
      continue;
    }
    if (key.startsWith('$')) continue;
    if (isAnalyticsNestedRelationSpec(spec)) {
      refuseNestedRelationComparands(spec, ctx, [...path, key], true);
      continue;
    }
    if (!insideRelation) continue; // `FilterConditionSchema` judges this entry itself
    // [#20116] Every slot the analytics door hands to the query faces, asked of
    // the one function `FilterConditionSchema`'s own walk asks: an implicit
    // comparand, or each operator of an operator map (with the whole map, which
    // the type face classifies before it judges an operator).
    if (isAnalyticsComparand(spec)) {
      reportQueryFaceRefusals(ctx, [...path, key], key, undefined, spec, FieldOperatorsSchema);
      continue;
    }
    for (const [op, comparand] of Object.entries(spec)) {
      if (!op.startsWith('$')) continue;
      reportQueryFaceRefusals(ctx, [...path, key, op], key, op, comparand, FieldOperatorsSchema, spec);
    }
  }
}

/**
 * The optional filter every analytics carrier declares — `DatasetSchema.filter`,
 * `DatasetMeasureSchema.filter` and `DashboardWidgetSchema.filter` — which is
 * `FilterConditionSchema` plus {@link refuseNestedRelationComparands}. Every
 * other schema that carries a `FilterCondition` keeps the shared schema's
 * reach. A report's `runtimeFilter` (`ReportSchema`, `JoinedReportBlockSchema`)
 * is charted through the same door and is not a carrier yet; adopting this is
 * one line per slot.
 *
 * The check sits on the OPTIONAL wrapper, not on `FilterConditionSchema`
 * itself: refining the recursive schema would clone it, and the published JSON
 * Schema would then inline a second copy of the condition beside the `$ref` it
 * carries today. On the wrapper the condition keeps its identity, so the
 * published body of `ui/Dataset`, `ui/DatasetMeasure` and `ui/DashboardWidget`
 * is unchanged, and the rule is recorded as a dropped refinement at each
 * carrier's `filter` in `dropped-refinements.baseline.json`
 * (`z.toJSONSchema()` has no projection for it). An absent filter reaches the
 * check as `undefined`, which the walk passes.
 */
export function analyticsCarrierFilter() {
  return FilterConditionSchema.optional().superRefine((filter, ctx) =>
    refuseNestedRelationComparands(filter, ctx));
}
