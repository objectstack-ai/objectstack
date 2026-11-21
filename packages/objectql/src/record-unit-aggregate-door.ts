// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [ADR-0158 U7 R1] A raw aggregate over a `record`-mode quantity refuses
 * unless it groups by that quantity's unit field; a `summary` roll-up over one
 * refuses at registration. It mirrors ADR-0144 D6, whose doors stand beside
 * these (`record-currency-aggregate-door.ts`).
 *
 * ## What ran before
 *
 * A `number` field declaring `unitConfig: { unitMode: 'record', unitField }`
 * holds a bare quantity whose unit is the code in the sibling `text` field
 * `unitField` names (ADR-0158 L3). Measured on a real engine (ObjectQL over
 * SqlDriver / better-sqlite3) before this door: `sum` over a row of 10 KGM and
 * a row of 10 LBR answered `20`, `avg` `10`; a `summary` roll-up over child
 * rows of 10 KGM and 10 LBR registered and stored `20`. Grouped by the unit
 * field, each per-group value was right (KGM 10, LBR 10). A declared `record`
 * mode makes the mixed rows knowable, so the engine refuses the two shapes
 * that add them.
 *
 * ## Which aggregates are raw (ADR-0158 Open item 12, the aggregate half)
 *
 * `sum`, `avg`, `min` and `max` read the quantity, as ADR-0144 Open item 10
 * reads the amount. `count` reads no quantity, and `count_distinct` counts
 * values without adding them, so neither is judged. Grouping by the
 * quantity's own `unitField` makes every group one unit, the one shape U7 R1
 * admits. A `fixed`-mode quantity (one unit for every row) and a `number`
 * field with no `unitConfig` are never judged. R1 has no base quantity (that
 * is U7 R2), so no consolidated-total remedy exists yet: the refusal names
 * the grouping alone.
 *
 * The set is this module's own constant, not the currency door's: ADR-0158
 * Open item 12 hands it to this card, so it is stated here even where it
 * equals ADR-0144's.
 *
 * ## Where it stands
 *
 * The aggregate half stands in `ObjectQL.aggregate` right after the
 * record-currency door, before any driver is asked, so it holds for every
 * caller that reaches the engine: the REST query door, a flow, a hook and the
 * analytics strategy. It answers that door's `INVALID_FIELD` / 400: the
 * verdict is about the named field at a position. No new wire code, as
 * ADR-0144 assigned none to its twin.
 *
 * The roll-up half stands in `SchemaRegistry.registerObject`, beside
 * `recordCurrencySummaryRefusal`, before anything is materialized, so a
 * refused declaration leaves nothing behind. It answers `INVALID_METADATA` /
 * 422. The pair is judged at whichever registration completes it: the
 * parent's, when the child is registered already, or the child's, when a
 * registered parent rolls up the field the child now declares `record`.
 *
 * ## No roll-up is admitted (ADR-0158 L3)
 *
 * "In R1, a `summary` over `record`-mode child quantities is therefore always
 * refused, as every such currency roll-up was before ADR-0144's D6
 * amendment." A child quantity cannot follow its parent's unit through a
 * `master_detail` (the object door refuses a dotted `unitField`), so no
 * roll-up is single-unit by construction. For the same reason the roll-up's
 * own recompute has no channel past the aggregate half, unlike the currency
 * door's `ROLLUP_AGGREGATE_OPTION`: no admitted roll-up exists to carry it.
 */

import { StandardErrorCode } from '@objectstack/spec/api';

/**
 * The unit field of a `record`-mode quantity, or `undefined`: a `number`
 * field declaring `unitConfig: { unitMode: 'record', unitField }`, read as
 * the write-time membership check reads it (`unitCodeSources`).
 */
export function recordUnitFieldOf(def: unknown): string | undefined {
  if (def === null || typeof def !== 'object') return undefined;
  const { type, unitConfig } = def as { type?: unknown; unitConfig?: unknown };
  if (type !== 'number' || unitConfig === null || typeof unitConfig !== 'object') return undefined;
  const { unitMode, unitField } = unitConfig as { unitMode?: unknown; unitField?: unknown };
  return unitMode === 'record' && typeof unitField === 'string' && unitField !== '' ? unitField : undefined;
}

/** The aggregate functions that read the quantity: ADR-0158 Open item 12, mirroring ADR-0144 Open item 10. */
const RAW_QUANTITY_FUNCTIONS: Readonly<Record<string, { readonly does: string }>> = {
  sum: { does: 'sums' },
  avg: { does: 'averages' },
  min: { does: 'takes the min of' },
  max: { does: 'takes the max of' },
};

/** Is `fn` an aggregate that reads the quantity? */
export function readsRecordUnitQuantity(fn: unknown): boolean {
  return typeof fn === 'string' && Object.prototype.hasOwnProperty.call(RAW_QUANTITY_FUNCTIONS, fn);
}

/** The field names a `groupBy` groups on: its string entries and its `{ field }` entries. */
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

interface UngroupedQuantity {
  readonly fn: string;
  readonly field: string;
  readonly unitField: string;
  readonly position: string;
}

/**
 * Refuse a raw aggregation over a declared `record`-mode quantity when the
 * query does not group by its unit field: `INVALID_FIELD` / 400, before any
 * driver is asked. See the module header.
 *
 * The route comes before the reason so it lands inside the 500 characters the
 * REST door keeps of a 4xx message.
 */
export function assertRecordUnitAggregatesGrouped(
  object: string,
  schema: unknown,
  groupBy: unknown,
  aggregations: unknown,
): void {
  if (!Array.isArray(aggregations) || aggregations.length === 0) return;
  const fields = (schema as { fields?: unknown } | undefined)?.fields;
  if (!fields || typeof fields !== 'object') return;
  const grouped = groupedFields(groupBy);
  const hits: UngroupedQuantity[] = [];
  for (const [i, agg] of aggregations.entries()) {
    if (agg === null || typeof agg !== 'object' || Array.isArray(agg)) continue;
    const fn = (agg as { function?: unknown }).function;
    if (!readsRecordUnitQuantity(fn)) continue;
    const field = (agg as { field?: unknown }).field;
    if (typeof field !== 'string' || !Object.prototype.hasOwnProperty.call(fields, field)) continue;
    const unitField = recordUnitFieldOf((fields as Record<string, unknown>)[field]);
    if (unitField === undefined || grouped.has(unitField)) continue;
    hits.push({ fn: fn as string, field, unitField, position: `aggregations[${i}].field` });
  }
  if (hits.length === 0) return;
  const [first] = hits;
  const also = hits.length > 1 ? ` (also: ${hits.slice(1).map((h) => `'${h.field}'`).join(', ')})` : '';
  const err = new Error(
    `aggregate('${object}'): ${first.position} ${RAW_QUANTITY_FUNCTIONS[first.fn].does} '${first.field}', a quantity `
      + `in each record's own unit (unitMode: 'record', the unit code in '${first.unitField}'), and the query does `
      + `not group by '${first.unitField}'`
      + also
      + `. The query was NOT run. Add '${first.unitField}' to groupBy for one ${first.fn} per unit. Quantities in `
      + `different units do not add: 10 KGM and 10 LBR summed to 20.`,
  ) as Error & {
    code?: string; status?: number; httpStatus?: number;
    field?: string; fields?: string[]; object?: string; param?: string; unitField?: string;
  };
  err.code = StandardErrorCode.enum.INVALID_FIELD;
  err.status = 400;
  err.httpStatus = 400;
  err.field = first.field;
  err.fields = hits.map((h) => h.field);
  err.object = object;
  err.param = 'aggregations';
  err.unitField = first.unitField;
  throw err;
}

/**
 * [ADR-0158 U7 R1] The registry's code for this refusal: `INVALID_METADATA`,
 * its spelling for a programmatically supplied body it refuses, as
 * `RECORD_CURRENCY_SUMMARY_REFUSED_CODE` is. Not a new code; the condition is
 * named by the error's `name`.
 */
export const RECORD_UNIT_SUMMARY_REFUSED_CODE = 'INVALID_METADATA' as const;

/**
 * A `summary` field rolls up `sum` / `avg` / `min` / `max` of a child field
 * declared `unitMode: 'record'`. The roll-up adds the child rows' quantities
 * into one stored number with no unit. The ADR-0112 envelope (`code` +
 * `status: 422`), never a bare throw.
 */
export class RecordUnitSummaryRefusedError extends Error {
  readonly code = RECORD_UNIT_SUMMARY_REFUSED_CODE;
  readonly status = 422;
  /** ADR-0112 D5's spelling of the same number, as `RecordCurrencySummaryRefusedError` carries it. */
  readonly httpStatus = 422;
  /** The object declaring the `summary` field. */
  readonly objectName: string;
  /** The `summary` field. */
  readonly fieldName: string;
  /** The child object it rolls up. */
  readonly childObject: string;
  /** The child's record-mode quantity. */
  readonly childField: string;
  /** The child's unit field, which the quantity's `unitField` names. */
  readonly unitField: string;

  constructor(parent: string, summaryField: string, fn: string, child: string, childField: string, unitField: string) {
    super(
      `summary field "${parent}.${summaryField}" rolls up ${fn}(${child}.${childField}), and ${child}.${childField} `
        + `is a quantity in each record's own unit (unitMode: 'record', the unit code in '${unitField}'). A roll-up `
        + `stores one number with no unit, so child rows in different units would be added together: 10 KGM and `
        + `10 LBR rolled up to 20. No roll-up over such a quantity is admitted. Use function: 'count', or total `
        + `'${child}.${childField}' with an aggregate that groups by '${unitField}', for one total per unit.`,
    );
    this.name = 'RecordUnitSummaryRefusedError';
    this.objectName = parent;
    this.fieldName = summaryField;
    this.childObject = child;
    this.childField = childField;
    this.unitField = unitField;
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

/** A `summary` field's roll-up when it reads the quantity: `{ fn, child, childField }`. */
function rawRollupOf(def: unknown): { fn: string; child: string; childField: string } | undefined {
  if (def === null || typeof def !== 'object' || (def as { type?: unknown }).type !== 'summary') return undefined;
  const ops = (def as { summaryOperations?: unknown }).summaryOperations as
    { object?: unknown; field?: unknown; function?: unknown } | undefined;
  if (!ops || !readsRecordUnitQuantity(ops.function)) return undefined;
  if (typeof ops.object !== 'string' || typeof ops.field !== 'string') return undefined;
  return { fn: ops.function as string, child: ops.object, childField: ops.field };
}

/**
 * The refusal for an object about to register, or `undefined`: see the
 * module header. `lookup` resolves a REGISTERED object by name and `all`
 * lists the registered objects; both are asked only as far as the incoming
 * body's own fields make necessary.
 */
export function recordUnitSummaryRefusal(
  incoming: ObjectLike,
  lookup: (name: string) => ObjectLike | undefined,
  all: () => readonly ObjectLike[],
): RecordUnitSummaryRefusedError | undefined {
  const name = typeof incoming.name === 'string' ? incoming.name : undefined;
  const own = fieldsOf(incoming);
  if (!name || !own) return undefined;

  // The incoming body's own roll-ups, over a child already registered (or over itself).
  for (const [summaryField, def] of Object.entries(own)) {
    const rollup = rawRollupOf(def);
    if (!rollup) continue;
    const childFields = rollup.child === name ? own : fieldsOf(lookup(rollup.child));
    const unitField = childFields ? recordUnitFieldOf(childFields[rollup.childField]) : undefined;
    if (unitField !== undefined) {
      return new RecordUnitSummaryRefusedError(name, summaryField, rollup.fn, rollup.child, rollup.childField, unitField);
    }
  }

  // The incoming body's record-mode quantities, rolled up by a parent already registered.
  const recordQuantities = new Map<string, string>();
  for (const [field, def] of Object.entries(own)) {
    const unitField = recordUnitFieldOf(def);
    if (unitField !== undefined) recordQuantities.set(field, unitField);
  }
  if (recordQuantities.size === 0) return undefined;
  for (const parent of all()) {
    const parentName = typeof parent.name === 'string' ? parent.name : undefined;
    if (!parentName || parentName === name) continue;
    for (const [summaryField, def] of Object.entries(fieldsOf(parent) ?? {})) {
      const rollup = rawRollupOf(def);
      if (!rollup || rollup.child !== name) continue;
      const unitField = recordQuantities.get(rollup.childField);
      if (unitField !== undefined) {
        return new RecordUnitSummaryRefusedError(parentName, summaryField, rollup.fn, name, rollup.childField, unitField);
      }
    }
  }
  return undefined;
}
