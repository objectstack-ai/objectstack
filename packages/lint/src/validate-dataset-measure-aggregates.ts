// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#16354 — the AUTHORING-TIME leg of the aggregate × field-type contract]
 * A dataset measure pairs an `aggregate` with a `field`. This rule refuses the
 * pairs `AGGREGATE_FIELD_TYPE_COMPATIBILITY` (`@objectstack/spec/data`, #16353)
 * does not accept, at the moment the author writes them.
 *
 * All judgement lives in the SHARED predicate —
 * `isAggregateCompatibleWithFieldType`, the same call the compile leg makes —
 * so this file is only the walk: where dataset measures live in a stack, how a
 * field name becomes a declared `FieldType`, and how a refused pair becomes a
 * finding with a location. ⛔ A second compatibility table here would BE the
 * two-accounts-of-one-pair drift the spec table exists to remove; if a verdict
 * seems wrong, the table is where to read and to argue.
 *
 * ## Why an authoring-time rule when the compile leg already refuses
 *
 * Both legs exist by the director ruling of decision batch #59 (2026-09-06,
 * 「both legs, table in spec」). The compile leg (`dataset-compiler`,
 * `service-analytics`) answers `400 DATASET_INVALID` when a query is built —
 * which is the last door before a backend, and the FIRST one a human sees only
 * if somebody happens to open the surface that binds this dataset. An
 * incoherent measure can sit in a config file, survive `os validate`, ship, and
 * surface as a 400 on someone else's dashboard weeks later, or — the dangerous
 * half the ruling was measured on — as a plausible number: SQLite coerces a
 * `datetime` column's canonical UTC text by its leading digits, so
 * `avg(submitted_at)` returns the average YEAR (`2025.5`) with no error and no
 * log, and the DEV datasource in this platform's default flow is SQLite.
 *
 * This rule puts the same verdict where the author is standing, before the
 * document is committed. The compile leg is unchanged: this is a second
 * consumer of one table, never a relaxation of the first.
 *
 * ## Where it reaches FURTHER than the compile leg, and why that is not a guess
 *
 * The compile leg returns early on a dotted `relationship.field` reference
 * (`if (field.includes('.')) return;`): its declared-type source is the host's
 * `AnalyticsServiceConfig.sourceFieldMeta`, which answers for the BASE object
 * only, so a column living on a joined object is *not judged rather than judged
 * wrongly*. At authoring time the whole object graph is in hand, so
 * {@link resolveFieldPath} resolves the hops and hands back the LEAF's declared
 * type — a read of the author's own declaration, not an inference. So a dotted
 * pair is judged here, and the spec module's instruction is honoured in the
 * direction that matters: a path whose type cannot be resolved is never handed
 * to the predicate as a guess (see the skips below).
 *
 * ## Its relation to the two neighbours that look like it
 *
 * - `measure-aggregate-incoherent` (`validate-widget-bindings.ts`) is the
 *   SEMANTIC opinion — "does this number mean anything" — and it is advisory
 *   and suppressible. It fires on `sum` / `count_distinct` over a `percent`
 *   field. The table refuses `sum` × `percent` too, on that predicate's own
 *   authority (`aggregate-field-type-compatibility.ts` says so), so that ONE
 *   pair is reported twice: an advisory about meaning, and this gating refusal
 *   about the contract. The overlap is deliberate rather than tidied away,
 *   because the two questions have different answers elsewhere —
 *   `count_distinct` × `percent` is advised and ACCEPTED by the table, and
 *   `avg` × `datetime` is refused here and not advised there.
 * - `rollup/non-numeric-aggregand` (`data-model-rules.ts`) judges a `summary`
 *   field's `summaryOperations`, and deliberately does NOT read this table:
 *   there the answer is STORED into a numeric column, so it refuses
 *   `min` / `max` over the temporal class, which this table accepts. Different
 *   question, different door, no shared verdict.
 *
 * ## Skips — never hand the predicate a guess
 *
 * `aggregate-field-type-compatibility.ts` states the consumer's tier:
 * *"a consumer that cannot resolve a field's type … must NOT call the predicate
 * with a guess — 'cannot answer, do not block' is the consumer's tier"*. So
 * this rule stays silent when:
 *
 *   1. the dataset names no base `object`, or one this stack does not define,
 *      or one that declares no readable field map (ADR-0015 `external` and
 *      datasource-introspected schemas) — `validate-object-references.ts` owns
 *      the first, and the rest are the object graph's `unknowable` verdicts;
 *   2. the measure writes no `aggregate` or no `field` — a plain `count` and a
 *      `derived` measure legitimately carry no field, and a non-string in
 *      either position is the schema's refusal to give, not this rule's;
 *   3. the path does not RESOLVE — a dangling reference is
 *      `dataset-field-unknown`'s finding (`validate-dataset-references.ts`),
 *      and one typo must not also yield a type verdict about a column that
 *      does not exist;
 *   4. the resolved leaf carries no declared `type` — an untyped field, and the
 *      driver-provisioned `id`, for which no definition table has an answer;
 *   5. the `aggregate` is outside the table's own vocabulary — `AggregationFunction`
 *      is a closed enum and a value outside it is a schema error, so refusing it
 *      here would report a vocabulary problem as a compatibility one.
 *
 * A registry-injected column is NOT a skip: since #16340 the graph carries the
 * registry's own definition, so `created_at` reads as the `datetime` it is and
 * `avg` over it is refused exactly as over an authored field — the pair reaches
 * the same backend either way.
 */

import {
  AGGREGATE_FIELD_TYPE_COMPATIBILITY,
  isAggregateCompatibleWithFieldType,
} from '@objectstack/spec/data';

import {
  indexObjectGraph,
  isUnjudgeable,
  recordsOf,
  resolveFieldPath,
  type ObjectGraph,
} from './object-graph.js';

/**
 * Stable diagnostic id. Named for the AXIS it judges — the field's declared
 * type — so it reads apart from its advisory neighbour
 * `measure-aggregate-incoherent`, which judges the same subject on the
 * semantic axis. `refused` is the ruling's own word for a pair outside the
 * table ("every other pair: refused").
 */
export const MEASURE_AGGREGATE_FIELD_TYPE_REFUSED = 'measure-aggregate-field-type-refused';

export interface DatasetMeasureAggregateFinding {
  /**
   * Always `error`. The pair is decidable from the author's own declarations —
   * no runtime state, no call graph — and the alternative to refusing it is a
   * number whose value is a property of the SQL dialect. The compile leg
   * answers the same pair with `400 DATASET_INVALID`, so an advisory here
   * would only mean the author hears about it later, from someone else's
   * dashboard.
   */
  severity: 'error';
  rule: typeof MEASURE_AGGREGATE_FIELD_TYPE_REFUSED;
  /** Human-readable location, e.g. `dataset "sales" › measure "avg_closed"`. */
  where: string;
  /** Config path, e.g. `datasets[0].measures[2].aggregate`. */
  path: string;
  message: string;
  hint: string;
}

type AnyRec = Record<string, unknown>;

const isRec = (v: unknown): v is AnyRec => !!v && typeof v === 'object' && !Array.isArray(v);

const strName = (v: unknown): string | undefined =>
  typeof v === 'string' && v.length > 0 ? v : undefined;

/**
 * The table as a Map, built once — for the MESSAGE only.
 *
 * A Map rather than property access on the frozen record because a
 * property-key lookup also answers for `Object.prototype` members, so an
 * author's `aggregate: 'toString'` would read as a declared row. The VERDICT
 * is never taken from here: it is
 * {@link isAggregateCompatibleWithFieldType}'s, which is fail-closed on both
 * vocabulary and shape. This Map only PRESENTS the same table — the accepted
 * set for the refused aggregate, and the aggregates that would accept this
 * field — so the message cannot name a set the verdict was not taken from.
 */
const ACCEPTED_TYPES_BY_AGGREGATE: ReadonlyMap<string, readonly string[]> = new Map(
  Object.entries(AGGREGATE_FIELD_TYPE_COMPATIBILITY).map(
    ([fn, types]) => [fn, types as readonly string[]] as const,
  ),
);

/** Every aggregate the table accepts for `fieldType` — always non-empty (`count` accepts any type). */
function aggregatesAccepting(fieldType: string): string[] {
  const accepting: string[] = [];
  for (const [fn] of ACCEPTED_TYPES_BY_AGGREGATE) {
    if (isAggregateCompatibleWithFieldType(fn, fieldType)) accepting.push(fn);
  }
  return accepting;
}

/**
 * Refuse every dataset measure whose `aggregate` the field's declared
 * `FieldType` cannot carry. Returns findings (empty = clean). Pure
 * `(stack) => Finding[]` (ADR-0019): no I/O, and safe on both the
 * schema-parsed stack and the raw config the `os lint` path carries.
 */
export function validateDatasetMeasureAggregates(stack: unknown): DatasetMeasureAggregateFinding[] {
  const findings: DatasetMeasureAggregateFinding[] = [];
  if (!isRec(stack)) return findings;

  const datasets = recordsOf(stack.datasets);
  if (datasets.length === 0) return findings;

  const graph: ObjectGraph = indexObjectGraph(stack);

  datasets.forEach((ds, di) => {
    // ── Skip 1: no base object, or one the graph cannot answer for ──
    const object = strName(ds.object);
    if (!object) return;
    if (!graph.has(object) || !graph.get(object)) return;

    const dsName = strName(ds.name) ?? `#${di}`;

    recordsOf(ds.measures).forEach((measure, k) => {
      // ── Skip 2: nothing written in one of the two positions ──
      const aggregate = strName(measure.aggregate);
      const field = strName(measure.field);
      if (!aggregate || !field) return;

      // ── Skip 5: the aggregate is outside the table's vocabulary ──
      const accepted = ACCEPTED_TYPES_BY_AGGREGATE.get(aggregate);
      if (!accepted) return;

      // ── Skip 3: the path does not resolve — `dataset-field-unknown`'s finding ──
      const verdict = resolveFieldPath(graph, object, field);
      if (!verdict || isUnjudgeable(verdict) || verdict.kind !== 'ok') return;

      // ── Skip 4: the leaf declares no type, so nothing can be asked about it ──
      const fieldType = verdict.meta?.type;
      if (!fieldType) return;

      if (isAggregateCompatibleWithFieldType(aggregate, fieldType)) return;

      const measureName = strName(measure.name) ?? `#${k}`;
      const onObject =
        verdict.object === object
          ? `object "${object}"`
          : `object "${verdict.object}" (reached through this dataset's join chain)`;
      findings.push({
        severity: 'error',
        rule: MEASURE_AGGREGATE_FIELD_TYPE_REFUSED,
        where: `dataset "${dsName}" › measure "${measureName}"`,
        path: `datasets[${di}].measures[${k}].aggregate`,
        message:
          `measure "${measureName}" applies aggregate "${aggregate}" to field "${field}", which ` +
          `${onObject} declares as \`${fieldType}\`. That pair is refused by the aggregate × ` +
          `field-type compatibility table in @objectstack/spec, so the number a backend returns ` +
          `for it is a property of the SQL dialect rather than of the data — one coerces the ` +
          `stored form and answers something plausible, another has no such function and fails ` +
          `at query time. "${aggregate}" accepts: ${accepted.join(', ')}.`,
        hint:
          `Either point "${aggregate}" at a field of an accepted type, or aggregate ` +
          `"${field}" with one its \`${fieldType}\` type accepts: ` +
          `${aggregatesAccepting(fieldType).join(', ')}. ` +
          `\`count\` / \`count_distinct\` accept every type because they read no arithmetic off ` +
          `the value; a quantity that must be added up or averaged has to be STORED as a ` +
          `numeric field (a computed column) and aggregated as one. The compile leg refuses ` +
          `this same pair with \`400 DATASET_INVALID\` before any SQL is emitted, so this is ` +
          `the same fix made earlier.`,
      });
    });
  });

  return findings;
}
