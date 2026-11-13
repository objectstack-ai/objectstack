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
 *
 * ## A child that follows its parent's currency (ADR-0144 D6, amended)
 *
 * Ruling A, recorded in 6739066323: "A `summary` rolled up through that same
 * master_detail is single-currency by construction, and is admitted in the
 * parent's currency." When the child amount's `currencyField` is the path
 * `MASTER_DETAIL.CODE` and the `summary` rolls up through that very
 * `master_detail` (its `summaryOperations.relationshipField`, else the child's
 * one relation back to the parent, as the summary index reads it), every row
 * it totals is in the parent's currency, and it registers. Every other roll-up
 * over such an amount — through another relation, or over an amount following
 * another object — keeps the refusal, and so does every roll-up over a
 * sibling-code amount.
 *
 * The roll-up's own recompute asks the aggregate through the engine, and this
 * door would refuse it as ungrouped. It carries the module-private
 * {@link ROLLUP_AGGREGATE_OPTION}, naming the `master_detail` it totals one
 * parent's rows through (`aggregateSummaryValue`, `summary-aggregate.ts`); an
 * amount following its parent through that field is then one currency. No
 * door a caller reaches can set it.
 *
 * Every other aggregate over such an amount keeps the first bullet of D6
 * ("Every other aggregate over such a child amount is unchanged"). Grouping by
 * the parent path does not count as grouping by the code field (ADR-0144 Open
 * item 14, this card's reading of D6): the engine reads a group key
 * `MASTER_DETAIL.CODE` as a column of the child row, which no child stores, so
 * USD 100 and EUR 100 under two parents summed to 200 in one null group. Such
 * an aggregate is refused with the two shapes that are single-currency: the
 * stored home-currency field, or the parent's own roll-up.
 *
 * A `summary` that declares `currencyMode: 'record'` (the admitted roll-up, in
 * its parent's currency) is an amount in each parent row's own currency, the
 * code in the parent's code field. Both halves judge it as they judge a
 * `record`-mode `currency` field ({@link recordCurrencyAggregandOf}): a raw
 * aggregate over it refuses unless grouped by that code, and a roll-up of it
 * one level up refuses.
 */

import { StandardErrorCode } from '@objectstack/spec/api';
import { recordCurrencyFollowedCodeError, recordCurrencyUnfollowedRollupError } from '@objectstack/spec/data';
import { recordCurrencyFieldOf, recordCurrencyPathOf, type RecordCurrencyPath } from './validation/record-currency-code.js';

/**
 * [ADR-0144 D6, amended] The engine's own channel for a roll-up's aggregate:
 * the `master_detail` field it totals one parent's child rows through. A
 * module-private symbol on the aggregate's options, so no options object a
 * door builds can carry it. Set only by `aggregateSummaryValue`.
 */
export const ROLLUP_AGGREGATE_OPTION: unique symbol = Symbol('objectstack.objectql.rollupAggregateVia');

/**
 * The code pointer of an amount a raw aggregate or a roll-up would add, or
 * `undefined`: a `record`-mode `currency` field's `currencyField`, or a
 * `summary` declaring `currencyMode: 'record'` (the admitted roll-up, in its
 * parent's currency, whose code is the parent's sibling code field).
 */
export function recordCurrencyAggregandOf(def: unknown): string | undefined {
  const pointer = recordCurrencyFieldOf(def);
  if (pointer !== undefined) return pointer;
  if (def === null || typeof def !== 'object' || (def as { type?: unknown }).type !== 'summary') return undefined;
  const config = (def as { currencyConfig?: unknown }).currencyConfig;
  if (config === null || typeof config !== 'object') return undefined;
  const { currencyMode, currencyField } = config as { currencyMode?: unknown; currencyField?: unknown };
  return currencyMode === 'record' && typeof currencyField === 'string' && currencyField !== '' ? currencyField : undefined;
}

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
  /** Set when the amount follows its parent's code: no groupBy makes it one currency. */
  readonly path?: RecordCurrencyPath;
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
  /** The roll-up's own aggregate: the `master_detail` it totals one parent's rows through ({@link ROLLUP_AGGREGATE_OPTION}). */
  rollupVia?: unknown,
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
    const codeField = recordCurrencyAggregandOf((fields as Record<string, unknown>)[field]);
    if (codeField === undefined) continue;
    const path = recordCurrencyPathOf(codeField, fields);
    if (path) {
      // The roll-up's own aggregate, through the very master_detail the amount follows: one parent, one currency.
      if (typeof rollupVia === 'string' && rollupVia === path.via) continue;
      // No groupBy admits it: a dotted group key is read as a column of this row, which holds no code.
      hits.push({ fn: fn as string, field, codeField, position: `aggregations[${i}].field`, path });
      continue;
    }
    if (grouped.has(codeField)) continue;
    hits.push({ fn: fn as string, field, codeField, position: `aggregations[${i}].field` });
  }
  if (hits.length === 0) return;
  const [first] = hits;
  const also = hits.length > 1 ? ` (also: ${hits.slice(1).map((h) => `'${h.field}'`).join(', ')})` : '';
  const err = new Error(
    first.path
      ? `aggregate('${object}'): ${first.position} ${RAW_AMOUNT_FUNCTIONS[first.fn].does} '${first.field}', an amount `
        + `in each row's parent currency (currencyMode: 'record', following '${first.codeField}' through the `
        + `master_detail '${first.path.via}')${also}, and no groupBy makes it one currency: '${object}' stores no code, `
        + `and a group key '${first.codeField}' reads as a column of '${object}', blank on every row. The query was `
        + `NOT run. Aggregate a stored home-currency amount field for one consolidated figure, or total each `
        + `${first.path.master === undefined ? 'parent' : `'${first.path.master}'`} record's rows with a summary field `
        + `rolled up through '${first.path.via}', in that record's currency. USD 100 and EUR 100 summed to 200.`
      : `aggregate('${object}'): ${first.position} ${RAW_AMOUNT_FUNCTIONS[first.fn].does} '${first.field}', an amount `
        + `in each record's own currency (currencyMode: 'record', the code in '${first.codeField}'), and the query `
        + `does not group by '${first.codeField}'`
        + also
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

  constructor(
    parent: string,
    summaryField: string,
    fn: string,
    child: string,
    childField: string,
    codeField: string,
    /** Set when the child amount follows a parent's code, and the roll-up is not through that very `master_detail`. */
    follows?: { readonly path: RecordCurrencyPath; readonly relation: string | undefined },
  ) {
    const path = follows?.path;
    super(
      `summary field "${parent}.${summaryField}" rolls up ${fn}(${child}.${childField}), and ${child}.${childField} `
        + (path
          ? `is an amount in its parent's currency (currencyMode: 'record', following '${codeField}' through the `
            + `master_detail '${path.via}'), while this roll-up `
            + (path.master !== parent
              ? `totals the rows of '${parent}' records, not of the '${path.master ?? path.via}' record each row follows. `
              : (follows?.relation === undefined
                ? `names no relation of '${child}' back to '${parent}' it can be read through. `
                : `goes through '${follows.relation}', so the rows it totals may follow other records. `))
            + `A roll-up stores one number with no currency, so child rows in different currencies would be added `
            + `together: USD 100 and JPY 15000 rolled up to 15100. Roll up through the master_detail the amount follows `
            + `(summaryOperations.relationshipField: '${path.via}', on '${path.master ?? 'its parent'}'), use function: `
            + `'count', or roll up a stored home-currency amount field of '${child}' instead.`
          : `is an amount in each record's own currency (currencyMode: 'record', the code in '${codeField}'). A `
            + `roll-up stores one number with no currency, so child rows in different currencies would be added `
            + `together: USD 100 and JPY 15000 rolled up to 15100. Use function: 'count', or roll up a stored `
            + `home-currency amount field of '${child}' instead.`),
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

interface RawRollup {
  readonly fn: string;
  readonly child: string;
  readonly childField: string;
  /** `summaryOperations.relationshipField`, when written. */
  readonly relationshipField: string | undefined;
}

/** A `summary` field's roll-up when it reads the amount: `{ fn, child, childField, relationshipField }`. */
function rawRollupOf(def: unknown): RawRollup | undefined {
  if (def === null || typeof def !== 'object' || (def as { type?: unknown }).type !== 'summary') return undefined;
  const ops = (def as { summaryOperations?: unknown }).summaryOperations as
    { object?: unknown; field?: unknown; function?: unknown; relationshipField?: unknown } | undefined;
  if (!ops || !readsRecordCurrencyAmount(ops.function)) return undefined;
  if (typeof ops.object !== 'string' || typeof ops.field !== 'string') return undefined;
  const relationshipField = typeof ops.relationshipField === 'string' && ops.relationshipField !== '' ? ops.relationshipField : undefined;
  return { fn: ops.function as string, child: ops.object, childField: ops.field, relationshipField };
}

/**
 * The child relation a roll-up of `parent` reads through: its
 * `relationshipField`, else the child's first `master_detail` or `lookup`
 * field naming `parent` — the summary index's reading
 * (`ObjectQL.buildSummaryIndex`), so this door admits exactly the roll-up the
 * recompute then totals.
 */
function rollupRelationOf(rollup: RawRollup, parent: string, childFields: Record<string, unknown>): string | undefined {
  if (rollup.relationshipField !== undefined) return rollup.relationshipField;
  for (const [name, def] of Object.entries(childFields)) {
    const { type, reference } = (def ?? {}) as { type?: unknown; reference?: unknown };
    if ((type === 'master_detail' || type === 'lookup') && reference === parent) return name;
  }
  return undefined;
}

/**
 * The verdict on a roll-up of `parent` over a record-mode child amount:
 * `undefined` when it is the admitted one (the amount follows `parent`'s code
 * through the very `master_detail` the roll-up reads), else the refusal.
 */
function rollupVerdict(
  parent: string,
  summaryField: string,
  rollup: RawRollup,
  childFields: Record<string, unknown>,
  codeField: string,
): RecordCurrencySummaryRefusedError | undefined {
  const path = recordCurrencyPathOf(codeField, childFields);
  if (!path) {
    return new RecordCurrencySummaryRefusedError(parent, summaryField, rollup.fn, rollup.child, rollup.childField, codeField);
  }
  const relation = rollupRelationOf(rollup, parent, childFields);
  if (path.master === parent && relation === path.via) return undefined;
  return new RecordCurrencySummaryRefusedError(
    parent, summaryField, rollup.fn, rollup.child, rollup.childField, codeField, { path, relation },
  );
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
    const codeField = childFields ? recordCurrencyAggregandOf(childFields[rollup.childField]) : undefined;
    if (childFields && codeField !== undefined) {
      const refusal = rollupVerdict(name, summaryField, rollup, childFields, codeField);
      if (refusal) return refusal;
    }
  }

  // The incoming body's record-mode amounts, rolled up by a parent already registered.
  const recordAmounts = new Map<string, string>();
  for (const [field, def] of Object.entries(own)) {
    const codeField = recordCurrencyAggregandOf(def);
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
        const refusal = rollupVerdict(parentName, summaryField, rollup, own, codeField);
        if (refusal) return refusal;
      }
    }
  }
  return undefined;
}

/**
 * [ADR-0144 D2 and D6, amended] A declaration that claims a currency it does
 * not follow, refused at registration: the two cross-object halves
 * `defineStack` judges where a stack holds both objects
 * (`collectRecordCurrencyPathErrors`), for the single-object save that holds
 * one, in the same words (`@objectstack/spec/data`'s
 * `record-currency-path.ts`). See {@link recordCurrencyFollowRefusal}.
 * The ADR-0112 envelope (`code` + `status: 422`), never a bare throw.
 */
export class RecordCurrencyFollowRefusedError extends Error {
  readonly code = RECORD_CURRENCY_SUMMARY_REFUSED_CODE;
  readonly status = 422;
  /** ADR-0112 D5's spelling of the same number, as {@link RecordCurrencySummaryRefusedError} carries it. */
  readonly httpStatus = 422;
  /** The object declaring the refused field (the child, for an amount; the parent, for a roll-up). */
  readonly objectName: string;
  /** The refused field: a record-mode amount following its parent, or a `record` roll-up. */
  readonly fieldName: string;

  constructor(objectName: string, fieldName: string, message: string) {
    super(message);
    this.name = 'RecordCurrencyFollowRefusedError';
    this.objectName = objectName;
    this.fieldName = fieldName;
  }
}

/**
 * [ADR-0144 D2 and D6, amended] `refusal`, saying that it holds only against
 * what this server serves: `objects` are each served from the environment's
 * own object of that name, lying over the definition a package ships, and
 * against the packages' own definitions the pair is not refused. Asked by a
 * registration run at its end (`SchemaRegistry.restoringOnRefusal`), which
 * finds the objects; the one spelling of the sentence lives here, beside the
 * door's own. The refused object and field, the code and the status are
 * `refusal`'s. ⛔ It names no remedy: the product has none for this today.
 */
export function recordCurrencyFollowRefusalOverEnvironmentObjects(
  refusal: RecordCurrencyFollowRefusedError,
  objects: readonly string[],
): RecordCurrencyFollowRefusedError {
  const named = objects.map((name) => `'${name}'`).join(', ');
  return new RecordCurrencyFollowRefusedError(
    refusal.objectName,
    refusal.fieldName,
    `${refusal.message} On this server ${named} ${objects.length === 1 ? 'is' : 'are each'} served from the environment's own `
    + 'object of that name, which lies over the one a package ships. Read against the package\'s own definition this '
    + 'pair is not refused, so the correction above does not apply here, and the product has no remedy for it today.',
  );
}

/** A `summary` field declaring `currencyConfig.currencyMode: 'record'`. */
function declaresRecordCurrency(def: unknown): boolean {
  const config = (def as { currencyConfig?: unknown } | null)?.currencyConfig;
  return config !== null && typeof config === 'object' && (config as { currencyMode?: unknown }).currencyMode === 'record';
}

/** How {@link recordCurrencyFollowRefusal} reads the registry. */
export interface RecordCurrencyFollowRegistryView {
  /** A REGISTERED object by name, as served. */
  readonly lookup: (name: string) => ObjectLike | undefined;
  /** Every registered object, as served. */
  readonly all: () => readonly ObjectLike[];
  /** The fields the registered `extend` contributions of `name` add, a disabled package's withheld as the served fold withholds them (they fold onto any base that registers). */
  readonly extensionFieldsOf: (name: string) => Record<string, unknown> | undefined;
  /** The incoming body is an `extend` contribution: its fields are not the object's whole field map. */
  readonly partial: boolean;
}

/**
 * [ADR-0144 D2 and D6, amended] The refusal for an object about to register
 * (or one of a unit just registered, asked with the whole unit in the view),
 * or `undefined`. Two pairs, each judged at whichever registration completes
 * it; a pair with an end not registered yet is no verdict:
 *
 * - (a) a record-mode amount whose `currencyField` is the path
 *   `MASTER_DETAIL.CODE` (segment 1 is the spec object door's) and whose
 *   segment 2 names no field of the `master_detail` target, or a field that
 *   holds no ISO 4217 code. Judged at the child's registration with the
 *   parent registered, and at the parent's (re-)registration with a following
 *   child registered. Every write of such an amount is otherwise refused
 *   `ERR_CURRENCY_CODE_REQUIRED` (no code to read) or labelled with whatever
 *   the field holds;
 * - (c) a `summary` declaring `currencyMode: 'record'` that rolls up `sum` /
 *   `avg` / `min` / `max` of a child field following no record's currency (a
 *   `fixed` amount, a `dynamic` one, a plain number). Judged at the parent's
 *   registration with the child registered, and at the child's with the
 *   parent registered. A child amount in its own record currency, or
 *   following another record, is D6's ({@link recordCurrencySummaryRefusal}),
 *   which refuses any such roll-up whatever it declares.
 *
 * An `extend` body ({@link RecordCurrencyFollowRegistryView.partial}) holds
 * only the fields it adds, so only its own roll-ups are judged; a parent known
 * only through extensions is not registered, so it is no verdict, as
 * `defineStack` skips it. The parent's fields at its own registration are its
 * body with its registered extensions' fields under it.
 *
 * The registry asks this of a unit that is whole, and only once the cold boot
 * has ended (the AGENTS.md startup-registry rule): during the boot an `extend`
 * contribution or the other end can still register and contradict a verdict,
 * and a stored row is hydrated in no particular order. A multi-registration
 * unit after the boot — `registerApp`, whose `objectExtensions` register
 * after its `objects`; the packages of one artifact and its residual; a batch
 * writer's rows — has the same hazard at each of its registrations, so
 * `registerObject` never asks it. Who does:
 *
 * - a single save or publish, of its one body before it registers
 *   (`SchemaRegistry.objectRegistrationRefusal`'s `againstRegistry`), which
 *   relays the refusal to its author;
 * - a batch writer, of each row once all its rows are registered (the same
 *   option, from `@objectstack/metadata-protocol`'s
 *   `batch-object-registration.ts`), which answers the refused row in the
 *   batch's own result;
 * - a registration run on a running server — an install, an upgrade, a
 *   reload — of every object layer it registered, once at the end of the
 *   outermost run (`SchemaRegistry.restoringOnRefusal`). The refusal is
 *   thrown with the run put back: the install report answers it 422, and a
 *   reload keeps the definitions that served.
 */
export function recordCurrencyFollowRefusal(
  incoming: ObjectLike,
  view: RecordCurrencyFollowRegistryView,
): RecordCurrencyFollowRefusedError | undefined {
  const name = typeof incoming.name === 'string' ? incoming.name : undefined;
  const own = fieldsOf(incoming);
  if (!name || !own) return undefined;

  // (c) at the parent: the incoming body's `record` roll-ups, over a child already registered (or itself).
  for (const [summaryField, def] of Object.entries(own)) {
    const rollup = rawRollupOf(def);
    if (!rollup || !declaresRecordCurrency(def)) continue;
    const childFields = rollup.child === name && !view.partial ? own : fieldsOf(view.lookup(rollup.child));
    const childDef = childFields && Object.prototype.hasOwnProperty.call(childFields, rollup.childField)
      ? childFields[rollup.childField]
      : undefined;
    if (childDef === undefined || recordCurrencyAggregandOf(childDef) !== undefined) continue;
    return new RecordCurrencyFollowRefusedError(name, summaryField, recordCurrencyUnfollowedRollupError(
      { object: name, field: summaryField, fn: rollup.fn, childObject: rollup.child, childField: rollup.childField },
      childDef,
    ));
  }
  if (view.partial) return undefined;

  // (a) at the child: the incoming body's following amounts, under a parent already registered (or itself).
  for (const [field, def] of Object.entries(own)) {
    const pointer = recordCurrencyFieldOf(def);
    const path = pointer === undefined ? undefined : recordCurrencyPathOf(pointer, own);
    if (!path || path.master === undefined) continue;
    const parentFields = path.master === name ? parentFieldsAt(name, own, view) : fieldsOf(view.lookup(path.master));
    if (!parentFields) continue;
    const message = recordCurrencyFollowedCodeError({
      object: name, field, via: path.via, code: path.code, parent: path.master, parentFields,
    });
    if (message !== undefined) return new RecordCurrencyFollowRefusedError(name, field, message);
  }

  // The other ends, already registered: (a) at the parent, (c) at the child.
  let incomingAsParent: Record<string, unknown> | undefined;
  for (const other of view.all()) {
    const otherName = typeof other.name === 'string' ? other.name : undefined;
    const otherFields = fieldsOf(other);
    if (!otherName || otherName === name || !otherFields) continue;
    for (const [field, def] of Object.entries(otherFields)) {
      const pointer = recordCurrencyFieldOf(def);
      const path = pointer === undefined ? undefined : recordCurrencyPathOf(pointer, otherFields);
      if (path?.master === name) {
        incomingAsParent ??= parentFieldsAt(name, own, view);
        const message = recordCurrencyFollowedCodeError({
          object: otherName, field, via: path.via, code: path.code, parent: name, parentFields: incomingAsParent,
        });
        if (message !== undefined) {
          return new RecordCurrencyFollowRefusedError(
            otherName,
            field,
            `'${name}' does not hold the code a registered amount follows. ${message}`,
          );
        }
        continue;
      }
      const rollup = rawRollupOf(def);
      if (!rollup || rollup.child !== name || !declaresRecordCurrency(def)) continue;
      const childDef = Object.prototype.hasOwnProperty.call(own, rollup.childField) ? own[rollup.childField] : undefined;
      if (childDef === undefined || recordCurrencyAggregandOf(childDef) !== undefined) continue;
      return new RecordCurrencyFollowRefusedError(otherName, field, recordCurrencyUnfollowedRollupError(
        { object: otherName, field, fn: rollup.fn, childObject: name, childField: rollup.childField },
        childDef,
      ));
    }
  }
  return undefined;
}

/** The incoming body's fields as a parent: its registered extensions' fields under its own. */
function parentFieldsAt(name: string, own: Record<string, unknown>, view: RecordCurrencyFollowRegistryView): Record<string, unknown> {
  const extended = view.extensionFieldsOf(name);
  return extended ? { ...extended, ...own } : own;
}
