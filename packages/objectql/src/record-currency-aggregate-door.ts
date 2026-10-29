// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [ADR-0144 D6] A raw aggregate over a `record`-mode amount refuses unless it
 * groups by that amount's code field; a `summary` roll-up over one refuses at
 * registration.
 *
 * ## What ran before
 *
 * The measurement round on epic #8345 (comment 6041378776) modelled a record
 * currency the way authors do today, as a sibling text field, and probed a
 * real engine. `sum` over a USD row of 100 and an EUR row of 100 answered
 * `200` under one currency label (PROBE-A); a `summary` roll-up over child
 * rows of USD 100 and JPY 15000 stored `15100`, and `avg` `7550` (PROBE-R).
 * Grouped by the code, every per-group value was right (PROBE-C). A declared
 * `record` mode makes the mixed rows knowable, so the engine refuses the two
 * shapes that add them.
 *
 * ## Which aggregates are raw
 *
 * `sum`, `avg`, `min` and `max` read the amount (ADR-0144 Open item 10).
 * `count` reads no amount, and `count_distinct` counts values without adding
 * them, so neither is judged. Grouping by the code field makes every group one
 * currency, which is the one shape the ruling admits; a consolidated total
 * reads the stored home-currency field instead (D6), an ordinary currency
 * field this door never judges.
 *
 * ## Where it stands
 *
 * The aggregate half stands in `ObjectQL.aggregate` beside the aggregate ×
 * field-type door (`aggregate-field-type-door.ts`), before any driver is
 * asked, so it holds for every caller that reaches the engine — the REST
 * query door, a flow, a hook, a roll-up's recompute and the analytics
 * strategy. It answers that door's `INVALID_FIELD` / 400: the verdict is about
 * the named field at a position. ADR-0144 assigns no new wire code to it.
 *
 * The roll-up half stands in `SchemaRegistry.registerObject`, the one door
 * every metadata path passes, before anything is materialized, so a refused
 * declaration leaves nothing behind. It answers `INVALID_METADATA` / 422, the
 * registry's code for a programmatically supplied body it refuses. The pair is
 * judged at whichever registration completes it: the parent's, when the child
 * is registered already, or the child's, when a registered parent rolls up the
 * field the child now declares `record`. A pair with an end not registered yet
 * is no verdict: the other end's registration judges it.
 */

import { StandardErrorCode } from '@objectstack/spec/api';
import { recordCurrencyFieldOf } from './validation/record-currency-code.js';

/** The aggregate functions that read the amount — ADR-0144 Open item 10. */
const RAW_AMOUNT_FUNCTIONS: Readonly<Record<string, { readonly does: string }>> = {
  sum: { does: 'sums' },
  avg: { does: 'averages' },
  min: { does: 'takes the min of' },
  max: { does: 'takes the max of' },
};

/** Is `fn` an aggregate that reads the amount? */
export function readsRecordCurrencyAmount(fn: unknown): boolean {
  return typeof fn === 'string' && Object.prototype.hasOwnProperty.call(RAW_AMOUNT_FUNCTIONS, fn);
}

/** The field names a `groupBy` groups on — its string entries and its `{ field }` entries. */
function groupedFields(groupBy: unknown): Set<string> {
  const names = new Set<string>();
  if (!Array.isArray(groupBy)) return names;
  for (const entry of groupBy) {
    if (typeof entry === 'string') names.add(entry);
    else if (entry !== null && typeof entry === 'object' && typeof (entry as { field?: unknown }).field === 'string') {
      names.add((entry as { field: string }).field);
    }
  }
  return names;
}

interface UngroupedAmount {
  readonly fn: string;
  readonly field: string;
  readonly codeField: string;
  readonly position: string;
}

/**
 * Refuse a raw aggregation over a declared `record`-mode amount when the query
 * does not group by its code field — `INVALID_FIELD` / 400, before any driver
 * is asked. See the module header.
 *
 * The route comes before the reason so it lands inside the 500 characters the
 * REST door keeps of a 4xx message.
 */
export function assertRecordCurrencyAggregatesGrouped(
  object: string,
  schema: unknown,
  groupBy: unknown,
  aggregations: unknown,
): void {
  if (!Array.isArray(aggregations) || aggregations.length === 0) return;
  const fields = (schema as { fields?: unknown } | undefined)?.fields;
  if (!fields || typeof fields !== 'object') return;
  const grouped = groupedFields(groupBy);
  const hits: UngroupedAmount[] = [];
  for (const [i, agg] of aggregations.entries()) {
    if (agg === null || typeof agg !== 'object' || Array.isArray(agg)) continue;
    const fn = (agg as { function?: unknown }).function;
    if (!readsRecordCurrencyAmount(fn)) continue;
    const field = (agg as { field?: unknown }).field;
    if (typeof field !== 'string' || !Object.prototype.hasOwnProperty.call(fields, field)) continue;
    const codeField = recordCurrencyFieldOf((fields as Record<string, unknown>)[field]);
    if (codeField === undefined || grouped.has(codeField)) continue;
    hits.push({ fn: fn as string, field, codeField, position: `aggregations[${i}].field` });
  }
  if (hits.length === 0) return;
  const [first] = hits;
  const err = new Error(
    `aggregate('${object}'): ${first.position} ${RAW_AMOUNT_FUNCTIONS[first.fn].does} '${first.field}', an amount `
      + `in each record's own currency (currencyMode: 'record', the code in '${first.codeField}'), and the query `
      + `does not group by '${first.codeField}'`
      + (hits.length > 1 ? ` (also: ${hits.slice(1).map((h) => `'${h.field}'`).join(', ')})` : '')
      + `. The query was NOT run. Add '${first.codeField}' to groupBy for one ${first.fn} per currency, or `
      + `aggregate a stored home-currency amount field for one consolidated figure. Amounts in different `
      + `currencies do not add: USD 100 and EUR 100 summed to 200 under one label.`,
  ) as Error & {
    code?: string; status?: number; httpStatus?: number;
    field?: string; fields?: string[]; object?: string; param?: string;
  };
  err.code = StandardErrorCode.enum.INVALID_FIELD;
  err.status = 400;
  err.httpStatus = 400;
  err.field = first.field;
  err.fields = hits.map((h) => h.field);
  err.object = object;
  err.param = 'aggregations';
  throw err;
}

/**
 * [ADR-0144 D6] The registry's code for this refusal: `INVALID_METADATA`, its
 * spelling for a programmatically supplied body it refuses. ⛔ Not a new code;
 * the condition is named by the error's `name`.
 */
export const RECORD_CURRENCY_SUMMARY_REFUSED_CODE = 'INVALID_METADATA' as const;

/**
 * A `summary` field rolls up `sum` / `avg` / `min` / `max` of a child field
 * declared `currencyMode: 'record'`. The roll-up adds the child rows' amounts
 * into one stored number with no currency. The ADR-0112 envelope (`code` +
 * `status: 422`), never a bare throw.
 */
export class RecordCurrencySummaryRefusedError extends Error {
  readonly code = RECORD_CURRENCY_SUMMARY_REFUSED_CODE;
  readonly status = 422;
  /** The same number under ADR-0112 D5's spelling — what a consumer holding the THROWN error reads. `status` stays for the HTTP doors, which read it. */
  readonly httpStatus = 422;
  /** The object declaring the `summary` field. */
  readonly objectName: string;
  /** The `summary` field. */
  readonly fieldName: string;
  /** The child object it rolls up. */
  readonly childObject: string;
  /** The child's record-mode amount. */
  readonly childField: string;

  constructor(parent: string, summaryField: string, fn: string, child: string, childField: string, codeField: string) {
    super(
      `summary field "${parent}.${summaryField}" rolls up ${fn}(${child}.${childField}), and ${child}.${childField} `
        + `is an amount in each record's own currency (currencyMode: 'record', the code in '${codeField}'). A `
        + `roll-up stores one number with no currency, so child rows in different currencies would be added `
        + `together: USD 100 and JPY 15000 rolled up to 15100. Use function: 'count', or roll up a stored `
        + `home-currency amount field of '${child}' instead.`,
    );
    this.name = 'RecordCurrencySummaryRefusedError';
    this.objectName = parent;
    this.fieldName = summaryField;
    this.childObject = child;
    this.childField = childField;
  }
}

interface ObjectLike {
  readonly name?: unknown;
  readonly fields?: unknown;
}

function fieldsOf(obj: ObjectLike | undefined): Record<string, unknown> | undefined {
  const f = obj?.fields;
  return f && typeof f === 'object' && !Array.isArray(f) ? (f as Record<string, unknown>) : undefined;
}

/** A `summary` field's roll-up when it reads the amount: `{ fn, child, childField }`. */
function rawRollupOf(def: unknown): { fn: string; child: string; childField: string } | undefined {
  if (def === null || typeof def !== 'object' || (def as { type?: unknown }).type !== 'summary') return undefined;
  const ops = (def as { summaryOperations?: unknown }).summaryOperations as
    { object?: unknown; field?: unknown; function?: unknown } | undefined;
  if (!ops || !readsRecordCurrencyAmount(ops.function)) return undefined;
  if (typeof ops.object !== 'string' || typeof ops.field !== 'string') return undefined;
  return { fn: ops.function as string, child: ops.object, childField: ops.field };
}

/**
 * The refusal for an object about to register, or `undefined` — see the
 * module header. `lookup` resolves a REGISTERED object by name and `all`
 * lists the registered objects; both are asked only as far as the incoming
 * body's own fields make necessary.
 */
export function recordCurrencySummaryRefusal(
  incoming: ObjectLike,
  lookup: (name: string) => ObjectLike | undefined,
  all: () => readonly ObjectLike[],
): RecordCurrencySummaryRefusedError | undefined {
  const name = typeof incoming.name === 'string' ? incoming.name : undefined;
  const own = fieldsOf(incoming);
  if (!name || !own) return undefined;

  // The incoming body's own roll-ups, over a child already registered (or over itself).
  for (const [summaryField, def] of Object.entries(own)) {
    const rollup = rawRollupOf(def);
    if (!rollup) continue;
    const childFields = rollup.child === name ? own : fieldsOf(lookup(rollup.child));
    const codeField = childFields ? recordCurrencyFieldOf(childFields[rollup.childField]) : undefined;
    if (codeField !== undefined) {
      return new RecordCurrencySummaryRefusedError(name, summaryField, rollup.fn, rollup.child, rollup.childField, codeField);
    }
  }

  // The incoming body's record-mode amounts, rolled up by a parent already registered.
  const recordAmounts = new Map<string, string>();
  for (const [field, def] of Object.entries(own)) {
    const codeField = recordCurrencyFieldOf(def);
    if (codeField !== undefined) recordAmounts.set(field, codeField);
  }
  if (recordAmounts.size === 0) return undefined;
  for (const parent of all()) {
    const parentName = typeof parent.name === 'string' ? parent.name : undefined;
    if (!parentName || parentName === name) continue;
    for (const [summaryField, def] of Object.entries(fieldsOf(parent) ?? {})) {
      const rollup = rawRollupOf(def);
      if (!rollup || rollup.child !== name) continue;
      const codeField = recordAmounts.get(rollup.childField);
      if (codeField !== undefined) {
        return new RecordCurrencySummaryRefusedError(parentName, summaryField, rollup.fn, name, rollup.childField, codeField);
      }
    }
  }
  return undefined;
}
