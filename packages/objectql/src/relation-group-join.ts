// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * An aggregate grouped by an attribute of a RELATED record, served as ONE
 * statement on the SQL family: `engine.aggregate('line', …)` grouped by
 * `opportunity.stage` reaches the driver as
 * `… FROM line LEFT JOIN (SELECT id, stage FROM opportunity WHERE <the
 * caller's read scope of opportunity> AND <tenant wall>) p ON line.opportunity
 * = p.id GROUP BY p.stage, <resolved>`, with no id list read first and no
 * bound-parameter ceiling, however many related records the rows point at.
 *
 * ## An engine-internal option, never a wire key
 *
 * The request rides on {@link RELATION_GROUP_BY}, a symbol-keyed READ option
 * (the `EngineReadOptions` third argument of `aggregate`): no wire request,
 * JSON body or spread author input can carry a symbol, so the public
 * `groupBy` vocabulary is unchanged — a dotted `groupBy` entry is still
 * refused at its door. The one in-repo caller is `@objectstack/service-analytics`
 * (`ObjectQLStrategy`), through its plugin's engine bridge; it is a
 * `Symbol.for` key because that package does not depend on this one at
 * runtime. Holding the key grants nothing: the engine plans the related read
 * itself, as the caller, below, and judges the base read as grouped by each
 * relation field.
 *
 * ## The base relation field is a group key to every door
 *
 * The FK-expand groups the base read by the relation field (`opportunity`),
 * so every guard that judges a group key — the field-level read gate on an
 * aggregate's inputs first among them — judges that field for the caller.
 * The join replaces that group key, but not that verdict: the AST the
 * middleware chain sees is grouped by each relation field `groupBy` does not
 * already name ({@link relationFieldsJudgedAsGroupKeys}), and only after
 * the chain has run does the engine take those keys back out of the
 * statement it hands the driver ({@link withoutJudgedRelationFields}), the
 * join taking their place. So a caller who may not read the relation field
 * is refused on this path by the same gate, in the same words, as on the
 * FK-expand — ⛔ no second copy of any field gate lives here.
 *
 * ## How the related half is built: the related object's own read, planned
 *
 * Exactly as the nested-relation semi-join builds its subquery
 * (`relation-semi-join.ts`, {@link RELATION_SCOPE_PLAN}): the related read is
 * this engine's own `aggregate` on the related object, under the caller's
 * context, grouped by `id` and the attributes — the read the FK-expand ran
 * (`ObjectQLStrategy#resolveFkAttr`), minus its id list. Its CRUD gate, every
 * read middleware (row scope, the field-level gate on a grouped field), its
 * group-by doors (a virtual or JSON attribute is refused in the related
 * object's words) all run. At the driver call the read is PLANNED, not run:
 * its final `where` and driver options are captured, and a
 * `ReadableIds` leaf carries them ({@link planRelationSemiJoinLeaf}). At the
 * outer read's executor boundary the leaf is answered by
 * {@link plannedRelationLeafVerdict} — the one rule that says when a planned
 * scope is the related read's own statement — and handed to the driver
 * composed. ⛔ No second copy of the read-scope composition lives here
 * (ADR-0139 D6): the scope is whatever the related read's own pipeline put
 * on its driver call.
 *
 * ## What the driver answers
 *
 * Per relation, the driver ({@link RELATION_GROUP_JOINS} on the AST) joins the
 * related rows the composed leaf admits — tenant-walled with the outer read's
 * options (ADR-0139 D3), which {@link plannedRelationLeafVerdict} has proved
 * are the related read's own — and groups by each attribute under its alias,
 * plus a `resolvedAlias` column: `1` when a readable related record joined,
 * `0` when none did (the relation is empty, or names a record the caller
 * cannot read, or one that does not exist). The attribute of an unresolved
 * group is `NULL`; the caller tells it from a real `NULL` attribute by the
 * resolved column, and so keeps its "restricted" bucket exactly.
 *
 * ## Refused, on a driver that compiles no semi-join
 *
 * [#33876] A read whose driver lacks the `DriverCapabilities.readableIdsLeaf`
 * bit (MongoDB, OData) is REFUSED before anything else is judged or read
 * ({@link relationGroupDriverRefusal}): the outcome is `refused`, carrying
 * an `INVALID_QUERY` / 400 the caller throws instead of serving its
 * FK-expand. The same bit decides a nested-relation `where` on that driver.
 *
 * ## Declined, never half-served
 *
 * Every other case this module cannot prove is the same read as the
 * FK-expand's is DECLINED: the engine runs nothing more and writes the reason to the
 * request's `outcome`, and the caller serves the dimension the way it always
 * has. Declined before anything is read when the registry already answers —
 * a driver outside {@link RELATION_GROUP_JOIN_COMPILING_DRIVERS} that does
 * declare the bit (memory and Turso keep their FK-expand), a federated
 * object, a field that is not a single-valued relation to the named object,
 * or a related object `relationSemiJoinServes` keeps the id read for; and
 * after planning, when the related read was not provably one planned
 * statement, when the outer read's driver options are not the related read's
 * own, or when the aggregate itself is not one the driver answers natively
 * (a bucket it cannot compute, a non-UTC zone, a measure filter it does not
 * compile). A request the caller built wrong (a duplicate or colliding
 * column) is a server fault, `INTERNAL_ERROR` / 500.
 */

import {
  isMultiValueField,
  referenceTargetOf,
  ReadableIds,
  type ComposedReadableIds,
  type FilterCondition,
} from '@objectstack/spec/data';
import { readableIdsRefusalError } from './filter-comparand-shape.js';
import { isFederatedObject } from './federated-object.js';
import { StandardErrorCode } from '@objectstack/spec/api';
import {
  driverCompilesReadableIdsLeaf,
  driverNameOf,
  planRelationSemiJoinLeaf,
  plannedRelationLeafVerdict,
  RELATION_SCOPE_PLAN,
  type RelationScopePlan,
} from './relation-semi-join.js';

/**
 * The read-option key of a relation group request: `aggregate(object, query,
 * { [RELATION_GROUP_BY]: request })`. A `Symbol.for` key — its one caller
 * lives in a package that does not import this one — and a symbol, so no wire
 * request can carry it.
 */
export const RELATION_GROUP_BY: unique symbol = Symbol.for('objectstack.objectql.relationGroupBy');

/**
 * The AST key the driver reads its relation joins from
 * ({@link DriverRelationGroupJoin}); `driver-sql`'s aggregate compiler reads
 * the same `Symbol.for` key. Set by the engine on the composed AST it hands
 * `driver.aggregate`, after every middleware has run — no middleware and no
 * caller sees it.
 */
export const RELATION_GROUP_JOINS: unique symbol = Symbol.for('objectstack.driver.aggregate.relationGroupJoins');

/** One related attribute grouped through a relation, and the column it answers under. */
export interface RelationGroupAttribute {
  /** A stored field of the related object (`id` included). */
  readonly attr: string;
  /** The output column of the aggregated row. */
  readonly alias: string;
}

/** One relation of a {@link RelationGroupByRequest}. */
export interface RelationGroupBy {
  /** A single-valued relation field (`lookup` / `master_detail`) of the aggregated object. */
  readonly field: string;
  /** The object `field` references — the request's own reading of it; a mismatch declines. */
  readonly object: string;
  /** A condition the related read applies beside its own read scope (the caller's policy filter). */
  readonly where?: FilterCondition;
  readonly attrs: readonly RelationGroupAttribute[];
  /** The output column that says whether a readable related record joined (`1`) or not (`0`). */
  readonly resolvedAlias: string;
}

/**
 * What the engine did with a {@link RelationGroupByRequest}. `refused`
 * ([#33876]): the read's driver compiles no `ReadableIds` leaf, so the
 * dimension is not served on ANY path — the caller throws `error` rather
 * than fall back to its FK-expand ({@link relationGroupDriverRefusal}).
 */
export type RelationGroupOutcome =
  | { readonly kind: 'joined' }
  | { readonly kind: 'declined'; readonly reason: string }
  | { readonly kind: 'refused'; readonly error: Error };

/**
 * The request: the relations to group by, and the slot the engine writes its
 * {@link RelationGroupOutcome} to. The aggregate's answer is grouped by the
 * relations only when the outcome is `joined`; on `declined` it is `[]` and
 * is not an answer.
 */
export interface RelationGroupByRequest {
  readonly relations: readonly RelationGroupBy[];
  outcome?: RelationGroupOutcome;
}

/** What the driver is handed per relation, on the AST under {@link RELATION_GROUP_JOINS}. */
export interface DriverRelationGroupJoin {
  readonly field: string;
  /**
   * The related rows the caller may read, as a composed leaf the driver
   * compiles exactly as it compiles a `ReadableIds` subquery (tenant wall
   * from the outer read's options). `null` when the planned scope is the deny
   * sentinel: no related record is readable, every group is unresolved.
   */
  readonly parent: ComposedReadableIds | null;
  readonly attrs: readonly RelationGroupAttribute[];
  readonly resolvedAlias: string;
}

/**
 * The drivers whose `aggregate` compiles {@link RELATION_GROUP_JOINS}. Named,
 * as `relation-semi-join.ts` names the semi-join compilers: no
 * capability bit says which drivers compile it, and an unnamed driver is
 * never handed one. The Turso driver is not named: its remote transport
 * compiles its own aggregates and would not read the joins.
 */
export const RELATION_GROUP_JOIN_COMPILING_DRIVERS: ReadonlySet<string> = new Set([
  'com.objectstack.driver.sql',
  'com.objectstack.driver.sqlite-wasm',
]);

/** The request on a read's options, when one rides there. */
export function relationGroupByRequestOf(options: unknown): RelationGroupByRequest | undefined {
  if (options === null || typeof options !== 'object') return undefined;
  const request = (options as Record<symbol, unknown>)[RELATION_GROUP_BY];
  return request === undefined ? undefined : (request as RelationGroupByRequest);
}

/** Records a decline on the request and answers `null`. */
export function declineRelationGroup(request: RelationGroupByRequest, reason: string): null {
  request.outcome = { kind: 'declined', reason };
  return null;
}

/** A request the caller built wrong: our own plumbing, a server fault. */
function malformed(object: string, detail: string): Error {
  return readableIdsRefusalError(
    object,
    `aggregate('${object}'): the engine-internal relation group request is malformed: ${detail}. ` +
    'The query was NOT run and no driver was asked.',
  );
}

/**
 * Judge the request's SHAPE against the query's own output columns — every
 * alias and resolved column distinct from each other and from the `groupBy`
 * columns and aggregation aliases — and throw on a request built wrong.
 */
export function assertRelationGroupRequestShape(
  object: string,
  request: RelationGroupByRequest,
  outputColumns: Iterable<string>,
): void {
  if (!Array.isArray(request.relations) || request.relations.length === 0) {
    throw malformed(object, 'it names no relation');
  }
  const taken = new Set<string>(outputColumns);
  const claim = (column: unknown, what: string): void => {
    if (typeof column !== 'string' || column === '') throw malformed(object, `${what} is not a column name`);
    if (taken.has(column)) throw malformed(object, `${what} '${column}' names a column the aggregated row already has`);
    taken.add(column);
  };
  const fields = new Set<string>();
  for (const relation of request.relations) {
    if (typeof relation?.field !== 'string' || fields.has(relation.field)) {
      throw malformed(object, `relation '${String(relation?.field)}' is named twice or is not a field name`);
    }
    fields.add(relation.field);
    if (!Array.isArray(relation.attrs) || relation.attrs.length === 0) {
      throw malformed(object, `relation '${relation.field}' groups by no attribute`);
    }
    const attrs = new Set<string>();
    for (const a of relation.attrs) {
      if (typeof a?.attr !== 'string' || a.attr === '' || attrs.has(a.attr)) {
        throw malformed(object, `relation '${relation.field}' names attribute '${String(a?.attr)}' twice or not at all`);
      }
      attrs.add(a.attr);
      claim(a.alias, `the alias of '${relation.field}.${a.attr}'`);
    }
    claim(relation.resolvedAlias, `the resolved column of '${relation.field}'`);
  }
}

/** The field a `groupBy` entry names: a plain string, or a structured `{ field }` item. */
function groupKeyField(entry: unknown): string | undefined {
  if (typeof entry === 'string') return entry;
  const field = (entry as { field?: unknown } | null | undefined)?.field;
  return typeof field === 'string' ? field : undefined;
}

/**
 * The relation fields the base read is judged as grouped by: each relation
 * field of the request that `groupBy` does not already name (a base
 * dimension that names the FK column itself keeps its own entry). The engine
 * adds them to the AST the middleware chain sees, so every guard that judges
 * a group key judges them as it does on the FK-expand's base read.
 */
export function relationFieldsJudgedAsGroupKeys(request: RelationGroupByRequest, groupBy: unknown): string[] {
  const named = new Set((Array.isArray(groupBy) ? groupBy : []).map(groupKeyField));
  return [...new Set(request.relations.map((r) => r.field))].filter((field) => !named.has(field));
}

/**
 * The statement the driver is handed: the chain's final AST without the
 * relation fields {@link relationFieldsJudgedAsGroupKeys} added for it — the
 * join replaces them as group keys. An AST whose own `groupBy` was absent
 * stays absent when nothing else is left in it.
 */
export function withoutJudgedRelationFields<T extends { groupBy?: unknown }>(
  ast: T,
  judged: readonly string[],
  ownGroupBy: unknown,
): T {
  if (judged.length === 0 || !Array.isArray(ast.groupBy)) return ast;
  const drop = new Set(judged);
  const kept = (ast.groupBy as unknown[]).filter((entry) => !(typeof entry === 'string' && drop.has(entry)));
  return { ...ast, groupBy: kept.length === 0 && !Array.isArray(ownGroupBy) ? undefined : kept };
}

/**
 * [#33876] The up-front refusal of a relation group request on a driver that
 * compiles no `ReadableIds` leaf (its `DriverCapabilities.readableIdsLeaf`
 * bit is absent: MongoDB, OData) — the analytics dimension through a lookup,
 * decided by the same bit as a nested-relation `where`
 * (`relationSemiJoinDriverRefusal`): the scope note on #33876 (6917475155)
 * under Prime Directive 5 (memory and mongo refuse what they cannot run with
 * a stable code). `undefined` when the driver declares the bit: `driver-memory` does, and
 * keeps its in-process FK-expand through the ordinary decline. Nothing is
 * read; the caller serves nothing and throws the error, `INVALID_QUERY` /
 * 400, naming the driver and the two-step route.
 */
export function relationGroupDriverRefusal(
  object: string,
  request: RelationGroupByRequest,
  driver: { readonly name?: unknown; readonly supports?: unknown } | undefined,
): Error | undefined {
  if (driverCompilesReadableIdsLeaf(driver)) return undefined;
  const relations: readonly RelationGroupBy[] = Array.isArray(request.relations) ? request.relations : [];
  const relation: RelationGroupBy | undefined = relations[0];
  const field = typeof relation?.field === 'string' ? relation.field : 'the relation field';
  const target = typeof relation?.object === 'string' ? relation.object : 'the related object';
  const declared: readonly RelationGroupAttribute[] = Array.isArray(relation?.attrs) ? relation.attrs : [];
  const attrs = declared
    .map((entry: RelationGroupAttribute | undefined) => entry?.attr)
    .filter((attr: unknown): attr is string => typeof attr === 'string');
  const what = attrs.length > 0 ? attrs.map((a) => `'${a}'`).join(', ') : 'its attributes';
  const err = new Error(
    `aggregate('${object}'): grouping by ${what} of '${target}' through '${object}.${field}' cannot run on `
    + `this read's driver '${driverNameOf(driver)}', which compiles no semi-join of '${target}'. Group by `
    + `'${field}' itself, then read '${target}' for ${what} by those ids. The query was NOT run and nothing `
    + 'was read. A driver that declares the readableIdsLeaf capability (the SQL drivers, the in-memory '
    + 'driver) serves it.',
  ) as Error & { code?: string; status?: number; httpStatus?: number; object?: string; param?: string };
  err.code = StandardErrorCode.enum.INVALID_QUERY;
  err.status = 400;
  // …and `httpStatus`, the same number under ADR-0112 D5's spelling — what a
  // consumer holding the THROWN error reads; `status` stays for the HTTP doors.
  err.httpStatus = 400;
  err.object = object;
  err.param = 'groupBy';
  return err;
}

/** What {@link relationGroupRegistryDecline} reads off the engine. */
export interface RelationGroupRegistryHost {
  getObjectSchema(object: string): unknown;
  getDriver(object: string): { readonly name?: unknown; readonly aggregate?: unknown } | undefined;
  /** `relation-semi-join.ts`'s `relationSemiJoinServes`, bound to the engine. */
  relationSemiJoinServes(object: string, target: string): boolean;
}

/**
 * The registry half of the decline: the reason the request cannot be served
 * on this read, or `undefined` when nothing in the registry declines it.
 * Nothing is read.
 */
export function relationGroupRegistryDecline(
  this: RelationGroupRegistryHost,
  object: string,
  request: RelationGroupByRequest,
): string | undefined {
  const driver = this.getDriver(object);
  const name = driver?.name;
  if (typeof name !== 'string' || !RELATION_GROUP_JOIN_COMPILING_DRIVERS.has(name) || typeof driver?.aggregate !== 'function') {
    return `the driver of '${object}' (${String(name)}) compiles no relation group join`;
  }
  const schema = this.getObjectSchema(object) as { fields?: Record<string, unknown> } | undefined;
  if (isFederatedObject(schema)) return `'${object}' is a federated object`;
  for (const relation of request.relations) {
    const def = schema?.fields?.[relation.field];
    const target = def === undefined ? undefined : referenceTargetOf(def);
    if (target === undefined) return `'${object}.${relation.field}' is not a relation field`;
    if (isMultiValueField(def as Parameters<typeof isMultiValueField>[0])) {
      return `'${object}.${relation.field}' holds a list of ids`;
    }
    if (target !== relation.object) {
      return `'${object}.${relation.field}' references '${target}', not '${relation.object}'`;
    }
    if (!this.relationSemiJoinServes(object, target)) {
      return `a read of '${target}' through '${object}.${relation.field}' is not plannable as one statement`;
    }
  }
  return undefined;
}

/** One relation, its related read planned. */
export interface PlannedRelationGroup {
  readonly relation: RelationGroupBy;
  /** The planned leaf over the related object ({@link planRelationSemiJoinLeaf}). */
  readonly leaf: object;
}

/** What {@link planRelationGroups} reads off the engine. */
export interface RelationGroupPlanHost {
  /** The engine's own `aggregate`. */
  aggregate(object: string, query: Record<string, unknown>, options?: Record<PropertyKey, unknown>): Promise<unknown>;
}

/**
 * Plan each relation's related read: the related object's own aggregate,
 * grouped by `id` and the attributes, as the caller (`context`), stopped at
 * its driver call. A refusal from that read propagates — it is the refusal
 * the FK-expand's read gave. Answers `null`, having recorded the decline,
 * when a read is not provably one planned statement.
 */
export async function planRelationGroups(
  this: RelationGroupPlanHost,
  request: RelationGroupByRequest,
  context: unknown,
): Promise<PlannedRelationGroup[] | null> {
  const planned: PlannedRelationGroup[] = [];
  for (const relation of request.relations) {
    // `id` is the key already: naming it twice is a groupBy the engine refuses.
    const groupBy = ['id', ...relation.attrs.map((a) => a.attr).filter((attr) => attr !== 'id')];
    const leaf = await planRelationSemiJoinLeaf(
      relation.object,
      (plan: RelationScopePlan) => this.aggregate(
        relation.object,
        {
          ...(relation.where !== undefined ? { where: relation.where } : {}),
          groupBy,
          aggregations: [{ function: 'count', field: 'id', alias: '_c' }],
          ...(context !== undefined ? { context } : {}),
        },
        { [RELATION_SCOPE_PLAN]: plan },
      ),
      // Never read: a planned leaf whose verdict is `read` is declined below.
      () => Promise.resolve([]),
    );
    if (leaf === null) {
      return declineRelationGroup(request, `the read of '${relation.object}' is not provably one planned statement`);
    }
    planned.push({ relation, leaf });
  }
  return planned;
}

/**
 * The executor boundary's answer for the planned relations, in a read whose
 * driver is handed `outerDriverOptions`: the joins the driver compiles, or
 * `null` (the decline recorded) when a planned scope is not the related
 * read's own statement under these options.
 */
export function relationGroupJoinsAtBoundary(
  request: RelationGroupByRequest,
  planned: readonly PlannedRelationGroup[],
  outerDriverOptions: unknown,
): DriverRelationGroupJoin[] | null {
  const joins: DriverRelationGroupJoin[] = [];
  for (const { relation, leaf } of planned) {
    const verdict = plannedRelationLeafVerdict(leaf, outerDriverOptions);
    if (verdict === undefined || verdict.kind === 'read') {
      return declineRelationGroup(
        request,
        `the read of '${relation.object}' was planned under driver options this read does not carry`,
      );
    }
    joins.push({
      field: relation.field,
      parent: verdict.kind === 'compose' ? ReadableIds.compose(leaf as ReadableIds, verdict.scope) : null,
      attrs: relation.attrs,
      resolvedAlias: relation.resolvedAlias,
    });
  }
  return joins;
}

/**
 * The driver's answer, checked: every row carries each relation's resolved
 * column. A row without it is a driver that did not compile the joins it was
 * handed — grouped by something else, so never an answer.
 */
export function assertRelationGroupRowsJoined(
  object: string,
  driverName: unknown,
  rows: unknown,
  joins: readonly DriverRelationGroupJoin[],
): void {
  if (!Array.isArray(rows)) return;
  for (const row of rows) {
    for (const join of joins) {
      if (row === null || typeof row !== 'object' || !(join.resolvedAlias in (row as object))) {
        throw readableIdsRefusalError(
          object,
          `aggregate('${object}'): the driver ${String(driverName)} answered a relation group join without its ` +
          `'${join.resolvedAlias}' column, so it did not compile the join it was handed. The answer was discarded.`,
        );
      }
    }
  }
}
