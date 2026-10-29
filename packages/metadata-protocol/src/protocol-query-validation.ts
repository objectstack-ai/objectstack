// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#25467 cut 3] The query validation of `ObjectStackProtocolImplementation`
 * — the checks `findData`, `getData` and the write verbs run on a request
 * before the engine sees it: the object is registered (`assertObjectRegistered`),
 * every field a query names exists, can be sorted, projected, expanded,
 * searched, grouped or aggregated (`assert*FieldsExist` and their siblings),
 * and no internal field is evaluated or served (`assertNoInternalFieldEvaluated`,
 * the `refuseInternal*` walks, `servedExpand`) — moved out of `protocol.ts`
 * whole.
 *
 * A MOVE, not a redesign. Each function below is the body of the
 * `ObjectStackProtocolImplementation` method of the same name as it stood,
 * re-indented one level and otherwise unedited: the same lookups, refusing
 * exactly where they did with the same codes and messages. The module-level
 * declarations only these bodies read moved with them, also unedited.
 *
 * ## How the moved bodies reach the class
 *
 * The shape #23050 set for `rest-server.ts` (its `data-action-routes.ts`
 * header carries the full reasoning), as `protocol-batch-data.ts` applies it.
 * The class keeps every method — the published `dist/*.d.ts` lists each one's
 * name and docblock — and each body is one literal of exactly the
 * {@link QueryValidationHost} members that method reads, plus a `.call`; a
 * body that reads no member takes no host and is called directly. A method is
 * handed over as a closure that calls it on the protocol at call time, so a
 * test double or spy set on the instance is still the one the body reaches,
 * and the moved bodies that call one another (the `refuseInternal*` walks
 * recurse) do so through the protocol, exactly as before.
 *
 * The one field the bodies read, `engine`, goes as a GETTER, so each read
 * happens when the body makes it: tests replace it on a constructed protocol.
 *
 * The other module-level declarations the bodies read stay in `protocol.ts`,
 * most of them because code that did not move reads them too, and are imported
 * from there:
 * the module cycle is evaluation-safe because every one of them is read only
 * inside a function body, never while the two modules are first evaluated.
 * `index.ts` names what it publishes from `protocol.ts` one by one, so the
 * `export` they gained for this keeps them off the published surface, and
 * nothing re-exports this module, so the published surface does not move.
 */

import type { ObjectStackProtocolImplementation } from './protocol.js';
import { FILTER_LOGICAL_KEYS, ODATA_SPELLING, QUERY_PARAM_NEAR_MISS, collectFilterReads, invalidSortError, isObjectOfDisabledPackage, isPlainRecord, nearMissKey, objectPackageDisabledError, quotedQueryValue, suggestFieldName } from './protocol.js';
import { objectNotFoundError, relationConditionSites } from '@objectstack/core';
import { collectInternalWriteResponseFields } from './write-response-internal-fields.js';
import { AggregationFunction, DateGranularity, REFERENCE_VALUE_TYPES, SEARCHABLE_ENUM_TYPES, SEARCHABLE_TEXTUAL_TYPES, SEARCH_AUTO_EXCLUDED_FIELDS, apiExposureDenialReason, canServeApiOperation, classifyDottedFilterHead, effectiveOperationsArray, isFilterAST, isVirtualSearchField, parseFilterAST, referenceTargetOf, resolveEffectiveApiMethods, resolveSearchFieldResolution } from '@objectstack/spec/data';

/**
 * [#20802] The nested-relation spelling of a dotted relation path, as the
 * dotted filter refusal names it: `'owner.region'` → `{ "owner": { "region":
 * VALUE } }` — the form the engine serves at `where`. A path deeper than one
 * relation is given the generic one-level shape. The engine door
 * (`@objectstack/objectql`'s `nestedRelationRoute`) words it the same:
 * `query-expression-conformance.test.ts` holds the two doors' routes equal.
 */
function nestedRelationRoute(dotted: string): string {
    const [head, ...rest] = dotted.split('.');
    return rest.length === 1
        ? `{ "${head}": { "${rest[0]}": VALUE } }`
        : `{ "${head}": { "FIELD": VALUE } }, one level deep`;
}

// [#5488] `PUBLISH_DRAFTS_NAMESPACE_REMEDY` stood here (#5206 step 2): the
// "so where do I declare the namespace, from here?" sentence appended to the
// ADR-0121 D2 gate's own message on this path. It is retired with
// `gateApiDraftsForPublish`, the only thing that ever appended it — this path
// no longer reports endpoint violations, because it can no longer receive an
// `api` draft to violate anything.

/**
 * [#3770] One-shot flag for the "engine has no schema registry" warning emitted
 * by {@link ObjectStackProtocolImplementation.assertObjectRegistered}. The
 * condition is a property of how the host constructed the engine, so it is
 * constant for the process — warn once, not once per request.
 */
let warnedNoRegistryForDataGate = false;

/**
 * [#4254] The two aggregation vocabularies, read off the SPEC's own enums so a
 * function or granularity added there is admitted here without a second edit —
 * the same both-directions pinning `QUERY_AST_KEYS` gets from `keyof QueryAST`.
 * They exist because the in-memory aggregation path answers an unknown member
 * with a silent placeholder (`null` result / raw-value buckets) rather than an
 * error, so the ingress must be the layer that refuses one.
 */
const AGGREGATION_FUNCTIONS: ReadonlySet<string> = new Set(AggregationFunction.options);

const DATE_GRANULARITIES: ReadonlySet<string> = new Set(DateGranularity.options);

/**
 * [#6994] Field types whose value NO driver materialises, so no driver can
 * ORDER BY them.
 *
 * `formula` is the whole set today, and deliberately not a synonym for
 * "computed": the three computed types diverge exactly here.
 *
 * | type | column | sortable |
 * |---|---|---|
 * | `formula` | none — `SqlDriver.createColumn` returns early; `driver-turso`'s transport skips it with the same `Virtual — no column` note | **no** |
 * | `summary` | an engine-maintained numeric column — `table.decimal` on tables created since #16318, `table.float` on earlier ones | yes (measured #6924: `orderBy <summary> desc` -> E D C B A over 5 4 3 2 1) |
 * | `autonumber` | `table.string`, engine-assigned | yes |
 *
 * So the spec's own `COMPUTED_VALUE_TYPES` (`formula`/`summary`/`autonumber`)
 * is the WRITE contract — "never client-written" — and is the wrong set to
 * gate a sort with: it would refuse the two types that sort correctly.
 *
 * This is a local set rather than a shared spec constant because the same fact
 * is currently spelled in five places, none of them in `packages/spec`:
 * `driver-sql`'s `fieldHasColumn` and `createColumn`, `driver-turso`'s
 * `remote-transport`, `objectql`'s `planFormulaProjection` and
 * `search-companion`, and `plugin-audit`'s `VIRTUAL_FIELD_TYPES`.
 * Consolidating them is a cross-package change and is filed separately; adding
 * a sixth local spelling here — with that ledger written down — keeps this fix
 * inside one package rather than opening a spec-wide edit for one string.
 *
 * One deliberate divergence from `fieldHasColumn`: that helper short-circuits
 * on `multiple` (a `multiple` field is a JSON column whatever its type), so it
 * would answer "has a column" for a `multiple` formula. This set does not,
 * because the questions differ — `fieldHasColumn` asks whether DDL emits a
 * column, this asks whether there is a persisted VALUE to order by, and a
 * formula's value is computed on read and never written, so that JSON column
 * is always empty. Ordering by it degrades exactly as the bare case does.
 */
const UNMATERIALIZED_SORT_TYPES: ReadonlySet<string> = new Set(['formula']);

/**
 * [#4254] An aggregation-axis value (`groupBy` / `aggregations`) whose SHAPE
 * the spec's `QueryAST` cannot read — a non-array, an entry that names no
 * field, a function or granularity outside the spec enums, a missing alias.
 *
 * Carries `INVALID_QUERY` — the standard-catalog code (`errors.zod.ts`,
 * "Malformed query syntax") that had sat in the catalog with no emitter since
 * it was written, exactly as `INVALID_SORT` had before #4226. Shape mistakes
 * get their own code because they are not about any FIELD: `INVALID_FIELD` on
 * these axes is reserved for a well-formed entry naming a column the object
 * does not have.
 *
 * The message spells out what the dropped/misread value used to do, because
 * that is the part the caller cannot infer: every one of these shapes was
 * silently ignored (rows returned ungrouped) or silently mis-answered
 * (`null` aggregates, one raw-value bucket per row) with an ordinary 200.
 */
function invalidQueryError(
    param: string,
    detail: string,
    opts?: { hint?: string, extra?: Record<string, unknown> },
): Error {
    const err: any = new Error(
        `Query parameter '${param}' ${detail}.`
        + (opts?.hint ?? ''),
    );
    err.status = 400;
    err.code = 'INVALID_QUERY';
    err.param = param;
    Object.assign(err, opts?.extra ?? {});
    return err;
}

/**
 * [#4134] Actionable tail for an unknown list query parameter: the canonical
 * spelling when the caller used a known dialect (`pageSize` → `$top`), else the
 * closest real field name when it reads like a typo (`stauts` → `status`).
 * Returns `''` when nothing is close enough to be worth guessing.
 */
function suggestQueryParam(param: string, knownFields: readonly string[]): string {
    const canonical = QUERY_PARAM_NEAR_MISS[nearMissKey(param)];
    if (canonical) {
        const odata = ODATA_SPELLING[canonical];
        return ` Did you mean the '${canonical}' query parameter`
            + (odata ? ` (OData spelling '${odata}')` : '')
            + '?';
    }
    return suggestFieldName(param, knownFields);
}

/**
 * [#7534] Every key of a `FilterCondition` that NAMES A FIELD, structure
 * discarded — whether a predicate sits under an `$or` changes nothing about
 * whether its column exists.
 *
 * Two rules, and both are deliberately conservative in the direction that
 * cannot invent a rejection:
 *
 * - **A `$`-prefixed key is never a field.** `$and`/`$or`/`$not` are recursed
 *   into; any OTHER `$` key is skipped WITHOUT descending. An unrecognised
 *   combinator therefore leaves the fields beneath it ungated — a hole, not a
 *   false 400 — which is the right failure direction for a gate whose whole
 *   purpose is to stop wrong answers, not to invent new ones.
 * - **A field key's VALUE is not descended into.** It is either an operator bag
 *   (`{$gte: 18}`) or a nested-relation condition (`{owner: {region: 'NA'}}`),
 *   and the latter's keys belong to a DIFFERENT object whose field map this
 *   gate has not resolved. Judging them against THIS object's fields would
 *   refuse legitimate relation filters. The head segment — `owner` — is a field
 *   of this object and IS judged, which is the same reach
 *   {@link ObjectStackProtocolImplementation.assertQueryParamsAreFields} has on
 *   a dotted path (`owner_id.name`).
 *
 * `depth` is a cheap backstop against a self-referential `where`. JSON cannot
 * produce one, but `POST /data/:object/query` is not the only door — the RPC
 * dispatcher and in-process callers hand over live objects — and a gate that
 * can hang the read path is worse than the defect it closes.
 *
 * [#21544] ⛔ This answers the ingress gate's question — does each named KEY
 * exist — and its failure direction (a hole, never a false 400) is right only
 * for that question. It is NOT what the stored-metadata family's evaluate
 * refusals read: a filter can read a column without naming it as a key (a
 * cross-field comparand), and a hole there is a leak, not a missing 400. That
 * question has its own collector, {@link collectStoredMetadataFilterFields}.
 */
function collectFilterFieldKeys(
    where: unknown,
    out: string[] = [],
    depth = 0,
): string[] {
    if (depth > 32) return out;
    if (!where || typeof where !== 'object' || Array.isArray(where)) return out;
    for (const [key, value] of Object.entries(where as Record<string, unknown>)) {
        if (key.startsWith('$')) {
            if (!FILTER_LOGICAL_KEYS.has(key)) continue;
            if (Array.isArray(value)) {
                for (const arm of value) collectFilterFieldKeys(arm, out, depth + 1);
            } else {
                collectFilterFieldKeys(value, out, depth + 1);
            }
            continue;
        }
        out.push(key);
    }
    return out;
}

/**
 * [#22646] How deep the data door's `internal: true` walk follows nested
 * relation conditions and `expand` levels — a backstop against a
 * self-referential in-process value, well above anything the engine executes
 * (one nested-relation hop; `expand` stops at its own depth cap).
 */
const INTERNAL_FIELD_WALK_DEPTH = 8;

/**
 * [#22661] The operation an `$expand` entry's TARGET object is judged as, by
 * the spec's one exposure decision (`canServeApiOperation`, ADR-0049): `get`.
 *
 * An expansion replaces an id the caller already holds with the record it
 * names, which is the read `GET /data/{target}/{id}` performs, and that route
 * is judged `get`. It never enumerates the target: the engine's sub-read is
 * bounded to `id $in` the source rows' own values, so a nested `where` can only
 * narrow records the caller could fetch by id. `list` would refuse an object
 * that serves exactly those records by id; it is not the read this is. The
 * dataset door's dimension-label pass asks the same operation of the same
 * target (`@objectstack/service-analytics`), so a lookup renders its name, or
 * its stored id, alike on both doors.
 */
const EXPANSION_TARGET_OPERATION = 'get';

/**
 * [#22737] The operation a NESTED-RELATION condition's TARGET object is judged
 * as, by the same decision: `list`. Not {@link EXPANSION_TARGET_OPERATION}'s
 * `get`, because the read is not the same one: a condition is a PREDICATE over
 * the target. The engine runs `find(target, { where: condition })` across the
 * whole object, bounded by a match cap rather than by ids the source rows hold
 * (`ObjectQL.lowerRelationConditions`), which is the read
 * `GET /data/{target}?filter=…` performs, and that route is judged `list`.
 */
const RELATION_CONDITION_TARGET_OPERATION = 'list';

/**
 * The `ObjectStackProtocolImplementation` members the functions below read —
 * every one of them, and no other; each function's `this` is the `Pick` of the
 * members IT reads. Each is typed AS the class member (an indexed access on
 * the class), so a change to a member's signature on the class is a change
 * here too, and naming a member the class does not have is a compile error.
 * See the module header for which members are getters.
 */
export interface QueryValidationHost {
    assertFilterFieldsExist: ObjectStackProtocolImplementation['assertFilterFieldsExist'];
    readonly engine: ObjectStackProtocolImplementation['engine'];
    groupByFieldNames: ObjectStackProtocolImplementation['groupByFieldNames'];
    orderByFieldNames: ObjectStackProtocolImplementation['orderByFieldNames'];
    refuseInternalInExpand: ObjectStackProtocolImplementation['refuseInternalInExpand'];
    refuseInternalInFilter: ObjectStackProtocolImplementation['refuseInternalInFilter'];
    refuseInternalNames: ObjectStackProtocolImplementation['refuseInternalNames'];
    refuseUnservedRelationTarget: ObjectStackProtocolImplementation['refuseUnservedRelationTarget'];
    resolveQueryFields: ObjectStackProtocolImplementation['resolveQueryFields'];
    servedExpand: ObjectStackProtocolImplementation['servedExpand'];
    servesExpansionTarget: ObjectStackProtocolImplementation['servesExpansionTarget'];
}

/** The body of `ObjectStackProtocolImplementation#assertObjectRegistered`; the method's docblock there is its contract. */
export function assertObjectRegistered(
    this: Pick<QueryValidationHost, 'engine'>,
    object: string): void {
    const registry: any = this.engine?.registry;
    if (!registry || typeof registry.getObject !== 'function') {
        if (!warnedNoRegistryForDataGate) {
            warnedNoRegistryForDataGate = true;
            console.warn(
                '[Protocol] engine exposes no schema registry — the data-plane object-existence '
                + 'gate is INACTIVE for this process; unregistered object names reach the '
                + 'driver as raw table names.',
            );
        }
        return;
    }
    if (registry.getObject(object)) {
        // [#7557] Registered is not the same as SERVING. A disabled package
        // keeps its objects registered on purpose — disable is reversible
        // and destroys no data, and the schema stays resolvable for the
        // machinery that needs it (the runtime authoring gate resolves its
        // object universe through `listItems('object')`, migrations and
        // cross-package references through `getObject`). What must stop is
        // the API serving its rows, which until now it did: nav and views
        // dropped on disable while `GET /data/<object>` still answered 200
        // with every row.
        //
        // Refused LOUDLY rather than by silent absence. The 404 status
        // matches the closest sibling in this codebase — `OBJECT_API_DISABLED`
        // for `enable.apiEnabled: false` (rest-server.ts) — so "this object
        // exists but is switched off" keeps ONE status across both switches,
        // and it keeps the data plane consistent with the metadata listing,
        // which now drops the object too (`getMetaItems`). The distinct code
        // is what makes it loud: a bare `OBJECT_NOT_FOUND` sends a caller —
        // an AI agent especially — hunting for a typo or re-creating an
        // object that is merely switched off, while this one names the cause
        // and therefore the fix (re-enable the package).
        //
        // [#24097] The by-name `/meta` reads raise the same refusal, from
        // the same constructor ({@link objectPackageDisabledError}).
        if (isObjectOfDisabledPackage(registry, object)) throw objectPackageDisabledError(object);
        return;
    }
    // The one envelope, shared with the engine's in-process verbs, which
    // refuse an unresolved name the same way (`objectNotFoundError`).
    throw objectNotFoundError(object);
}

/** The body of `ObjectStackProtocolImplementation#resolveQueryFields`; the method's docblock there is its contract. */
export function resolveQueryFields(
    this: Pick<QueryValidationHost, 'engine'>,
    object: string): { known: ReadonlySet<string>, declared: readonly string[], fields: any, schema: any } | null {
    const schema: any = this.engine?.registry?.getObject?.(object);
    const declared = schema?.fields;
    if (!declared || typeof declared !== 'object') return null;
    // A legacy ARRAY field map is not checkable: `Object.keys` on it yields
    // '0', '1', '2' …, so every gate below would reject every real field
    // name. Skipping is the same call the no-field-map case makes — there
    // is nothing here to answer "does this field exist" with.
    if (Array.isArray(declared)) return null;
    const fieldNames = Object.keys(declared);
    if (fieldNames.length === 0) return null;
    const known = new Set(fieldNames);
    known.add('id');
    known.add('created_at');
    known.add('updated_at');
    return { known, declared: fieldNames, fields: declared, schema };
}

/** The body of `ObjectStackProtocolImplementation#assertQueryParamsAreFields`; the method's docblock there is its contract. */
export function assertQueryParamsAreFields(
    this: Pick<QueryValidationHost, 'resolveQueryFields'>,
    object: string, params: readonly string[]): void {
    const gate = this.resolveQueryFields(object);
    if (!gate) return;
    const unknown = params.filter((p) => !gate.known.has(String(p).split('.')[0]));
    if (unknown.length === 0) return;
    const first = unknown[0];
    const err: any = new Error(
        `Unknown field '${first}' on object '${object}'`
        + (unknown.length > 1 ? ` (also: ${unknown.slice(1).join(', ')})` : '')
        + '. Query parameters that are not reserved are read as field filters, so an '
        + 'unknown name can only match zero records.'
        + suggestQueryParam(first, gate.declared),
    );
    err.code = 'INVALID_FIELD';
    err.status = 400;
    err.field = first;
    err.fields = unknown;
    err.object = object;
    throw err;
}

/** The body of `ObjectStackProtocolImplementation#assertFilterFieldsExist`; the method's docblock there is its contract. */
export function assertFilterFieldsExist(
    this: Pick<QueryValidationHost, 'resolveQueryFields'>,
    object: string, where: unknown, param: string): void {
    if (!where || typeof where !== 'object') return;
    const names = collectFilterFieldKeys(where);
    if (names.length === 0) return;
    const gate = this.resolveQueryFields(object);
    if (!gate) return;
    // Head segment only, exactly as the bare-key door judges `owner_id.name`.
    const unknown = names.filter((f) => !gate.known.has(f.split('.')[0]));
    if (unknown.length > 0) {
        const first = unknown[0];
        const err: any = new Error(
            `Query parameter '${param}' filters on '${first}', which is not a field on object `
            + `'${object}'`
            + (unknown.length > 1 ? ` (also: ${unknown.slice(1).join(', ')})` : '')
            + '. A filter on a field that does not exist can only match zero records, so the '
            + 'query was refused instead of answered with an empty list.'
            + suggestFieldName(first, gate.declared),
        );
        err.code = 'INVALID_FIELD';
        err.status = 400;
        err.field = first;
        err.fields = unknown;
        err.object = object;
        err.param = param;
        throw err;
    }

    // [#8371] The DOTTED verdict — second in precedence, mirroring the
    // sort axis' `unknown` > `dotted` > unmaterializable ladder exactly
    // (identity errors first, then shape, then type). A dotted key with a
    // REAL head cleared the check above precisely BECAUSE the head is
    // declared, then reached a driver that answers it with zero rows —
    // measured on ALL THREE drivers (the #8371 table): a relation head
    // stores the related record's scalar id (Mongo's dotted paths traverse
    // embedded documents, not references), a virtual head materialises no
    // column anywhere, a scalar head has nothing beneath it. Every answer
    // was a silent 200 + empty list — and the virtual case answered one
    // unserviceable intent two ways by spelling ({ is_open: true } refused
    // below since #8296, { 'is_open.x': true } rode through).
    //
    // Judged by the ONE classification both doors share
    // ({@link classifyDottedFilterHead}, `@objectstack/spec/data`), never a
    // ladder minted here — the same one-source move the #8296 verdict below
    // makes with `isVirtualSearchField`. ⛔ A structured/JSON head
    // (`address.city`) answers `null` there and stays DELIBERATELY
    // unjudged: the drivers genuinely disagree on it (live on memory and
    // mongodb, silently empty on sql), so a refusal would delete a working
    // capability — the carve-out the #8371 ruling names. Array-valued,
    // file and unknown heads answer `null` for the same fail-open reason
    // the collector documents: a hole, never a false 400.
    //
    // The nested-relation OBJECT form `{ owner: { region: 'NA' } }` is NOT
    // this shape and keeps working: the collector never descends into a
    // field key's value, so only the head `owner` is judged — undotted,
    // real, and passed. The refusal targets the DOTTED-STRING spelling
    // alone.
    const dotted = names.filter(
        (f) => f.includes('.') && classifyDottedFilterHead(gate.fields[f.split('.')[0]]) !== null,
    );
    if (dotted.length > 0) {
        const first = dotted[0];
        const head = first.split('.')[0];
        const headDef = gate.fields[head];
        const headClass = classifyDottedFilterHead(headDef);
        const headType = String(headDef?.type ?? '');
        // [#20802] The relation head names the route the engine now
        // SERVES — the condition nested beneath the relation field — in the
        // engine door's words (`@objectstack/objectql`'s
        // `assertFilterIsMaterializable`). One vocabulary across the doors.
        const body = headClass === 'relation'
            ? `filters on '${first}', which follows the relationship '${head}' into another `
              + `object as a dotted path, and '${head}' stores the related record's id, not an `
              + 'embedded document — to filter on the related record\'s fields, nest the condition '
              + `beneath the relation field: ${nestedRelationRoute(first)}`
            : headClass === 'virtual'
                ? `filters on '${first}', a dotted path whose head '${head}' is a virtual `
                  + `'${headType}' field on object '${object}' — its value is computed on read, `
                  + 'so no driver materialises a column for the path to reach into'
                : `filters on '${first}', a dotted path into '${head}', a '${headType}' field `
                  + `on object '${object}' that stores a single scalar value — there is nothing `
                  + 'beneath it for a path to reach';
        const err: any = new Error(
            `Query parameter '${param}' ${body}`
            + (dotted.length > 1 ? ` (also: ${dotted.slice(1).join(', ')})` : '')
            + '. No backend serves the path, so the predicate can only match zero records: the '
            + 'query was refused instead of answered with an empty list.'
            // Deliberately the same remedy, in the same words, as this
            // axis' #8296 virtual refusal below and the SORT axis' dotted
            // refusal (#4256/#6924), with only the verb naming this axis.
            // One vocabulary across the doors.
            + ` Denormalise the value onto '${object}' (a stored field, written when the source`
            + ' changes) and filter that.',
        );
        err.code = 'INVALID_FIELD';
        err.status = 400;
        err.field = first;
        err.fields = dotted;
        err.object = object;
        err.param = param;
        throw err;
    }

    // [#8296] The unmaterializable verdict — third in precedence since
    // #8371 slotted the dotted verdict above it, exactly where the sort
    // axis keeps its own third verdict. A name that is a REAL field
    // of this object and still cannot be filtered on, because its TYPE
    // materialises no column. It is the FILTER axis finally growing the
    // verdict its two neighbours already have — {@link
    // assertSortFieldsExist} splits `unknown` from unmaterializable
    // (#6994) and {@link assertSearchFieldsAreSearchable} splits `unknown`
    // from `virtual` (#6674) — and it was the last axis on which a
    // declaration the platform cannot honour still answered 200.
    //
    // Measured on a real `ObjectQL` + this protocol, base cb43296ef
    // (`is_open` a `formula` over the stored `status` column):
    //
    // ```
    // where { is_open: true }          -> 0 rows, NO ERROR
    // where { is_open: false }         -> 0 rows, NO ERROR
    // CONTROL where { status: 'open' } -> 4 rows
    // CONTROL where { subtask_total: 5 } -> 1 row   (`summary` HAS a column)
    // ```
    //
    // BOTH directions are wrong and the `false` one is the dangerous one:
    // the same predicate against a STORED boolean returns every row, so a
    // filter meaning "not yet done" silently becomes "no records at all".
    // The response is indistinguishable from an empty table, and the
    // formula READS correctly in that very same response (`applyFormulaPlan`
    // hydrates it), so the field is visibly populated and simultaneously
    // unfilterable.
    //
    // Judged by the same `@objectstack/spec/data` predicate the SEARCH axis
    // uses ({@link isVirtualSearchField} / `SEARCH_VIRTUAL_TYPES`) rather
    // than a list minted here, so this gate and the drivers cannot disagree
    // about which types have a column. `summary` and `autonumber` are NOT
    // in it and must not be: both get real stored columns and filter
    // correctly — a gate widened to the spec's `COMPUTED_VALUE_TYPES` (the
    // WRITE contract) would refuse two working types.
    //
    // PRECEDENCE — `unknown` > `dotted` (#8371) > this, the sort axis'
    // ladder verdict for verdict: identity errors before shape errors
    // before type errors. DOTTED names are excluded HERE because the
    // dotted verdict above already judged them — a dotted path whose head
    // is a formula field keeps the dotted answer, exactly as it does on
    // the sort axis (it is wrong about the shape too, and the shape is
    // what the caller wrote).
    const virtual = names.filter((f) => !f.includes('.') && isVirtualSearchField(gate.fields[f]));
    if (virtual.length === 0) return;
    const virtualFirst = virtual[0];
    const virtualType = String(gate.fields[virtualFirst]?.type ?? 'formula');
    const err: any = new Error(
        `Query parameter '${param}' filters on '${virtualFirst}', a virtual '${virtualType}' `
        + `field on object '${object}'`
        + (virtual.length > 1 ? ` (also: ${virtual.slice(1).join(', ')})` : '')
        + '. Its value is computed on read and never stored, so no driver materializes a '
        + 'column to filter on: the predicate reaches the driver, matches nothing, and the '
        + 'query answers an empty list under a 200 — in BOTH directions, so a false test '
        + 'returns no records where the same test against a stored boolean returns every '
        + 'record.'
        // Deliberately the same remedy, in the same words, as the SORT
        // axis' formula refusal (#6994), with only the verb changed to
        // name this axis. One vocabulary across the doors: an author
        // refused on two axes must not be sent two different ways.
        // [commit e5eeb499c] The SEARCH axis (#6673) agrees in SUBSTANCE and words it
        // its own way — "Mirror the computed value onto a stored text
        // field on '<object>' and search that instead." Same prescription,
        // narrowed to the column type that axis can scan; claiming
        // word-identity with it was false. `query-expression-conformance
        // .test.ts` pins both halves — each door's exact sentence, and the
        // substance all three axes share.
        + ` Denormalise the value onto '${object}' (a stored field, written when the source`
        + ' changes) and filter that.',
    );
    err.code = 'INVALID_FIELD';
    err.status = 400;
    err.field = virtualFirst;
    err.fields = virtual;
    err.object = object;
    err.param = param;
    throw err;
}

/** The body of `ObjectStackProtocolImplementation#assertSortFieldsExist`; the method's docblock there is its contract. */
export function assertSortFieldsExist(
    this: Pick<QueryValidationHost, 'resolveQueryFields'>,
    object: string, orderBy: ReadonlyArray<{ field: string }>, param: string): void {
    if (orderBy.length === 0) return;
    const gate = this.resolveQueryFields(object);
    if (!gate) return;
    const names = orderBy.map((s) => String(s.field));
    const unknown = names.filter((f) => !gate.known.has(f.split('.')[0]));
    if (unknown.length > 0) {
        const first = unknown[0];
        const hint = first.includes(':')
            ? ` The list route spells a direction with a space or a leading '-'`
              + ` ('sort=${first.split(':')[0]} desc', 'sort=-${first.split(':')[0]}');`
              + " 'field:direction' is the export route's spelling."
            : suggestFieldName(first, gate.declared);
        throw invalidSortError(
            param,
            `sorts by '${first}', which is not a field on object '${object}'`
            + (unknown.length > 1 ? ` (also: ${unknown.slice(1).join(', ')})` : ''),
            { hint, extra: { field: first, fields: unknown, object } },
        );
    }
    const dotted = names.filter((f) => f.includes('.'));
    if (dotted.length > 0) {
        const first = dotted[0];
        const head = first.split('.')[0];
        const headDef: any = gate.fields[head];
        const crossesRelation = headDef != null && REFERENCE_VALUE_TYPES.has(headDef.type);
        throw invalidSortError(
            param,
            (crossesRelation
                ? `sorts by '${first}', which follows the relationship '${head}' into another object — `
                  + `sort reaches only columns of '${object}' itself`
                : `sorts by '${first}', a dotted path — sort reaches only whole columns of '${object}', `
                  + "not values inside them")
            + (dotted.length > 1 ? ` (also: ${dotted.slice(1).join(', ')})` : ''),
            {
                hint: ` Denormalise the value onto '${object}' (a stored field, written when the`
                    + ' source changes) and sort by that. Not a formula field: it is virtual,'
                    + ' no driver materialises a column for one, and ORDER BY on it is silently'
                    + ' dropped.',
                extra: { field: first, fields: dotted, object },
            },
        );
    }

    // [#6994] The third verdict on this axis: a name that is a REAL,
    // non-dotted field of this object and still cannot be ordered by,
    // because its TYPE materialises no column ({@link
    // UNMATERIALIZED_SORT_TYPES} — `formula`, today the whole set).
    //
    // This is the shape the doc comment above already describes and this
    // gate already let through: being in `gate.known` is what carried it
    // past the unknown check, being undotted is what carried it past the
    // check just above. Re-measured on this branch's base (real `SqlDriver`
    // over better-sqlite3, real `ObjectQL`, real protocol on top):
    //
    // ```
    // FORMULA  orderBy sort_key asc  -> ["C","A","E","B","D"]  5 rows, 200
    //   its sort_key values          -> ["C","A","E","B","D"]
    // FORMULA  orderBy sort_key desc -> ["C","A","E","B","D"]  asc === desc
    // RAW SQL  order by sort_key     -> sqlite: no such column: sort_key
    // ```
    //
    // The response literally carries the values it was asked to sort by,
    // out of order, under a 200 — so the answer contradicts the request in
    // plain view and still reports success.
    //
    // PRECEDENCE — `unknown` > `dotted` > this. It is last for the same
    // reason the expand gate reports `unknown` before `not-a-reference`:
    // identity errors first, then shape, then type. The two above are
    // therefore unchanged verdict-for-verdict, and a dotted path whose head
    // is a formula field keeps the dotted answer (it is wrong about the
    // shape too, and the shape is what the caller wrote).
    const unmaterialized = names.filter(
        (f) => UNMATERIALIZED_SORT_TYPES.has(String(gate.fields[f]?.type ?? '')),
    );
    if (unmaterialized.length === 0) return;
    const virtualFirst = unmaterialized[0];
    const virtualType = String(gate.fields[virtualFirst]?.type);
    throw invalidSortError(
        param,
        `sorts by '${virtualFirst}', a ${virtualType} field on '${object}' — a ${virtualType} `
        + 'value is computed on read, so no driver materialises a column to order by'
        + (unmaterialized.length > 1 ? ` (also: ${unmaterialized.slice(1).join(', ')})` : ''),
        {
            // Deliberately the same remedy, in the same words, as the
            // dotted refusal above: one vocabulary across the doors, so an
            // author refused twice is not sent two different ways.
            // [commit e5eeb499c] #6673's SEARCH-axis correction agrees in SUBSTANCE,
            // in its own words ("Mirror the computed value onto a stored
            // text field on '<object>' and search that instead") — the
            // same prescription with a TEXT target, not the same sentence.
            // Pinned as such in `query-expression-conformance.test.ts`.
            hint: ` Denormalise the value onto '${object}' (a stored field, written when the`
                + ' source changes) and sort by that. A formula field is virtual: with no'
                + ' column behind it the ORDER BY reaches the driver, finds nothing, and is'
                + ' dropped — the arbitrary order this refusal replaces.',
            extra: { field: virtualFirst, fields: unmaterialized, object },
        },
    );
}

/** The body of `ObjectStackProtocolImplementation#assertProjectionFieldsExist`; the method's docblock there is its contract. */
export function assertProjectionFieldsExist(
    this: Pick<QueryValidationHost, 'resolveQueryFields'>,
    object: string, fields: unknown, param: string): void {
    if (!Array.isArray(fields) || fields.length === 0) return;
    // [#4196] A non-string entry is the retired nested-select object form
    // (`{ field, fields, alias }`). It is checked BEFORE the field map,
    // because it is wrong about the shape rather than about this object —
    // and a registry-less host, which returns no gate below, would
    // otherwise let it through to a driver that cannot read it. Until now
    // it reached `.map(String)` and was refused as the unknown field
    // `"[object Object]"`: a 400 naming something the caller never wrote.
    const badShape = fields.findIndex((f) => typeof f !== 'string');
    if (badShape !== -1) {
        const entry = fields[badShape];
        // Only the shape that used to be legal earns the retirement clause.
        const retiredForm = typeof entry === 'object' && entry !== null && !Array.isArray(entry);
        const err: any = new Error(
            `'${param}' entry #${badShape + 1} on object '${object}' is not a field name.`
            + (retiredForm
                ? ' The nested-select object form `{ field, fields, alias }` was removed in '
                  + '@objectstack/spec 17 — no engine or driver ever read it.'
                : '')
            // [#7532] The dotted-path half of this prescription is GONE.
            // It pointed at a spelling this same gate now refuses — and
            // before that refusal it pointed at a spelling no driver
            // resolves, which answered with every field. Naming it here
            // sent the author from one refusal straight into the widening
            // defect, the same dead end #6924 removed from the SORT axis'
            // hint. `expand` is the one door for related data on this axis.
            + " Select related records with `expand` (`expand=owner`, or `{ expand: { owner: "
            + "{ object: 'user', fields: ['name'] } } }` to choose its columns).",
        );
        err.code = 'INVALID_FIELD';
        err.status = 400;
        err.object = object;
        err.param = param;
        throw err;
    }
    const gate = this.resolveQueryFields(object);
    if (!gate) return;
    const names = fields as string[];
    const unknown = names.filter((f) => !gate.known.has(f.split('.')[0]));
    if (unknown.length > 0) {
        const first = unknown[0];
        const unknownErr: any = new Error(
            `Unknown field '${first}' on object '${object}'`
            + (unknown.length > 1 ? ` (also: ${unknown.slice(1).join(', ')})` : '')
            + `. '${param}' chooses which fields to return; dropping an unknown one silently `
            + 'answered a NARROWER projection with a WIDER one — a projection naming no known '
            + 'field fell all the way back to every field.'
            + suggestFieldName(first, gate.declared),
        );
        unknownErr.code = 'INVALID_FIELD';
        unknownErr.status = 400;
        unknownErr.field = first;
        unknownErr.fields = unknown;
        unknownErr.object = object;
        unknownErr.param = param;
        throw unknownErr;
    }
    // [#7532] The DOTTED verdict — the leg the head-segment check above
    // does not cover, and the one that made this axis fail in the very
    // direction its own docblock warns about.
    //
    // Ordered `unknown` > `dotted`, the same precedence
    // {@link assertSortFieldsExist} applies, so the two axes agree about
    // which complaint a caller hears first when an entry is both.
    //
    // It sits AFTER the `gate` early-return for the same reason the sort
    // axis' dotted verdict does: the relation-vs-not split below reads
    // `gate.fields`, and a registry-less host has no field map to read.
    const dotted = names.filter((f) => f.includes('.'));
    if (dotted.length === 0) return;
    const first = dotted[0];
    const head = first.split('.')[0];
    const headDef: any = gate.fields[head];
    const crossesRelation = headDef != null && REFERENCE_VALUE_TYPES.has(headDef.type);
    const dottedErr: any = new Error(
        (crossesRelation
            ? `Field '${first}' on object '${object}' follows the relationship '${head}' into `
              + `another object — '${param}' reaches only columns of '${object}' itself`
            : `Field '${first}' on object '${object}' is a dotted path — '${param}' reaches only `
              + `whole columns of '${object}', not values inside them`)
        + (dotted.length > 1 ? ` (also: ${dotted.slice(1).join(', ')})` : '')
        + '. No driver resolves it: the path reaches the driver as a column name, matches no '
        + 'column, and the projection falls back to EVERY field — a narrower request answered '
        + 'with a wider response, which is the same failure the unknown-name refusal above '
        + 'exists to stop.'
        + (crossesRelation
            ? ` Read the related record with 'expand' (\`expand=${head}\`, or `
              + `\`{ expand: { ${head}: { object: '<target>', fields: ['<column>'] } } }\` to `
              + `choose its columns), or denormalise the value onto '${object}' (a stored `
              + 'field, written when the source changes) and name that.'
            : ` Name the whole column ('${head}') and read into its value in the caller.`),
    );
    dottedErr.code = 'INVALID_FIELD';
    dottedErr.status = 400;
    dottedErr.field = first;
    dottedErr.fields = dotted;
    dottedErr.object = object;
    dottedErr.param = param;
    throw dottedErr;
}

/** The body of `ObjectStackProtocolImplementation#assertExpandTargetsExist`; the method's docblock there is its contract. */
export function assertExpandTargetsExist(
    this: Pick<QueryValidationHost, 'resolveQueryFields'>,
    object: string, names: readonly string[]): void {
    if (names.length === 0) return;
    const gate = this.resolveQueryFields(object);
    if (!gate) return;
    const unknown: string[] = [];
    const notRelations: string[] = [];
    const targetless: string[] = [];
    for (const raw of names) {
        const name = String(raw);
        const def: any = gate.fields[name.split('.')[0]];
        if (!def) { unknown.push(name); continue; }
        if (!REFERENCE_VALUE_TYPES.has(def.type)) { notRelations.push(name); continue; }
        // A reference-typed field that names no target object leaves
        // `expandRelatedRecords` nothing to batch-load. That is an
        // authoring bug on the OBJECT, not on the request, and saying "not
        // a relationship" about a declared lookup would send the caller
        // looking in the wrong place.
        //
        // `referenceTargetOf` — not a raw `def.reference` read — because
        // some reference types carry their target in the TYPE (`user` ⇒
        // `sys_user`) rather than in an author-written `reference`. The
        // engine's expand loop resolves the target through the same
        // function, which is what keeps this gate from refusing a field
        // expansion would have delivered (cloud#983).
        if (!referenceTargetOf(def)) targetless.push(name);
    }
    const [offenders, reason] =
        unknown.length > 0 ? [unknown, 'unknown' as const]
        : notRelations.length > 0 ? [notRelations, 'not-a-reference' as const]
        : [targetless, 'targetless' as const];
    if (offenders.length === 0) return;
    const first = offenders[0];
    const err: any = new Error(
        (reason === 'unknown'
            ? `Unknown field '${first}' on object '${object}'`
            : reason === 'not-a-reference'
                ? `Field '${first}' on object '${object}' is not a relationship`
                : `Field '${first}' on object '${object}' declares no target object`)
        + (offenders.length > 1 ? ` (also: ${offenders.slice(1).join(', ')})` : '')
        + '. \'expand\' resolves a reference field into the related record, so '
        + (reason === 'unknown'
            ? 'a name the object does not declare can never be expanded.'
            : reason === 'not-a-reference'
                ? `only ${[...REFERENCE_VALUE_TYPES].join(' / ')} fields can be expanded.`
                : "the field's `reference` must name the object it points at.")
        + (reason === 'unknown' ? suggestFieldName(first, gate.declared) : ''),
    );
    err.code = 'INVALID_FIELD';
    err.status = 400;
    err.field = first;
    err.fields = offenders;
    err.object = object;
    err.param = 'expand';
    throw err;
}

/** The body of `ObjectStackProtocolImplementation#assertSearchFieldsAreSearchable`; the method's docblock there is its contract. */
export function assertSearchFieldsAreSearchable(
    this: Pick<QueryValidationHost, 'resolveQueryFields'>,
    object: string, requested: unknown, param: string): void {
    // Shape first, BEFORE the field-map tiering below — same order as the
    // projection gate (#4196): a registry-less host, which skips the name
    // checks, still must not carry an unreadable override to an engine
    // that would ignore it and scan the default set.
    let names: readonly string[];
    if (typeof requested === 'string') {
        names = requested.split(',').map((s) => s.trim()).filter(Boolean);
    } else if (Array.isArray(requested)) {
        const badShape = requested.findIndex((f) => typeof f !== 'string');
        if (badShape !== -1) {
            const err: any = new Error(
                `'${param}' entry #${badShape + 1} on object '${object}' is not a field name. `
                + `'${param}' narrows which columns 'search' scans, as a comma-separated string `
                + 'or an array of field names.',
            );
            err.code = 'INVALID_FIELD';
            err.status = 400;
            err.object = object;
            err.param = param;
            throw err;
        }
        names = requested;
    } else {
        const err: any = new Error(
            `'${param}' on object '${object}' must be a comma-separated string or an array of `
            + `field names, received ${requested === null ? 'null' : typeof requested}. It narrows `
            + "which columns 'search' scans; a value the server cannot read would have been "
            + 'ignored, leaving the search over the DEFAULT columns instead.',
        );
        err.code = 'INVALID_FIELD';
        err.status = 400;
        err.object = object;
        err.param = param;
        throw err;
    }
    // [#27484] …and an override naming NO field is refused, not read as
    // absent. A blank or comma-only string, an empty array, or an empty
    // object-form `search.fields` used to return here, and the engine then
    // scanned the object's whole default set: a caller who wrote the
    // parameter meant to narrow, so its silent widening to the defaults is
    // the failure this gate exists for. Absent stays absent (the caller
    // passes no override, and the door never calls this gate). The
    // projection's envelope (`projectionFieldsValue`, #26644), so `$select`
    // and `$searchFields` answer a value naming no field alike.
    if (names.length === 0) {
        const err: any = new Error(
            `Query parameter '${param}' names no field; got ${quotedQueryValue(requested)}. The query was not `
            + "run: an empty search-field list was read as no narrowing, which scans the object's default "
            + 'search fields. Name at least one field, or leave the parameter out to search the default fields.',
        );
        err.status = 400;
        err.code = 'VALIDATION_ERROR';
        err.param = param;
        throw err;
    }
    const gate = this.resolveQueryFields(object);
    if (!gate) return;
    // [#22646] A field declared `internal: true` is never a search target,
    // refused FIRST and regardless of whether it resolves into the scanned
    // set: a non-hidden internal text column (an auth digest, a token)
    // enters the auto-default, so `$searchFields` naming one would be
    // ACCEPTED here and a `$search` over it would confirm a guessed prefix
    // of a withheld credential. The engine already drops internal fields
    // from the auto-default set it scans (a withhold), but an EXPLICIT
    // narrowing to one has to be a loud 400 rather than a silent widening
    // back to the default set — the #4254 posture. Judged by the ONE flag
    // reader (`@objectstack/core`'s cross-package twin of
    // `collectInternalReadFields`), the same reader the evaluate refusal uses.
    const internalSet = new Set(collectInternalWriteResponseFields(gate.schema));
    const internalNamed = names.filter((n) => internalSet.has(n));
    if (internalNamed.length > 0) {
        const first = internalNamed[0] as string;
        const err: any = new Error(
            `Field '${first}' on object '${object}' is declared \`internal: true\` and cannot be searched`
            + (internalNamed.length > 1 ? ` (also: ${internalNamed.slice(1).join(', ')})` : '')
            + `. Its value is never returned on a generic data exit, so '${param}' may not name it — a `
            + 'search over it would confirm a guessed value by whether the row comes back. Search '
            + 'another column instead.',
        );
        err.code = 'INVALID_FIELD';
        err.status = 400;
        err.httpStatus = 400;
        err.field = first;
        err.fields = internalNamed;
        err.object = object;
        err.param = param;
        throw err;
    }
    const { allowed, source } = resolveSearchFieldResolution({
        fields: gate.fields,
        searchableFields: gate.schema?.searchableFields,
        // [ADR-0079] Same precedence the engine's search expansion applies:
        // `nameField` is canonical, `displayNameField` the honored alias.
        displayField: gate.schema?.nameField ?? gate.schema?.displayNameField,
    });
    const allowedSet = new Set(allowed);
    // A name in the object's own `searchableFields` that names no field is
    // a STALE DECLARATION — a bug on the OBJECT, not on the request. It
    // matters because clients echo the declaration verbatim (objectui's
    // list search sends `$searchFields: schema.searchableFields`), so
    // calling it "unknown" would send the caller hunting a typo they
    // never made. Same split the expand axis draws for a lookup whose
    // `reference` was never authored.
    const declaredSet = new Set<string>(Array.isArray(gate.schema?.searchableFields) ? gate.schema.searchableFields : []);
    const unknown = names.filter((n) => !allowedSet.has(n) && !gate.known.has(n) && !declaredSet.has(n));
    const staleDeclared = names.filter((n) => !allowedSet.has(n) && !gate.known.has(n) && declaredSet.has(n));
    // [#6674] A VIRTUAL field is its own rejection, split out of
    // `unsearchable` before the source branch below rather than after it,
    // because BOTH of that branch's messages are wrong for it. The declared
    // one ("a field outside it cannot be a search target until it is added
    // there") is false — it may already BE in the list, which is exactly the
    // shape this closes; the auto one prescribes "declare `searchableFields`
    // to choose the searchable set explicitly", which for a formula field is
    // an instruction to author the refused declaration. The fix is neither:
    // the value has no column anywhere, so it must be mirrored onto a stored
    // one. Judged by the same `@objectstack/spec/data` predicate the
    // resolution applies, so gate and engine cannot disagree about which
    // types have a column.
    const virtual = names.filter((n) => !allowedSet.has(n) && gate.known.has(n) && isVirtualSearchField(gate.fields[n]));
    const unsearchable = names.filter((n) => !allowedSet.has(n) && gate.known.has(n) && !isVirtualSearchField(gate.fields[n]));
    const [offenders, reason] =
        unknown.length > 0 ? [unknown, 'unknown' as const]
        : staleDeclared.length > 0 ? [staleDeclared, 'stale-declared' as const]
        : virtual.length > 0 ? [virtual, 'virtual' as const]
        : [unsearchable, 'unsearchable' as const];
    if (offenders.length === 0) return;
    const first = offenders[0];
    let detail: string;
    if (reason === 'stale-declared') {
        detail = `Field '${first}' on object '${object}' is declared in 'searchableFields' but `
            + 'does not exist'
            + (offenders.length > 1 ? ` (also: ${offenders.slice(1).join(', ')})` : '')
            + '. The declaration is stale — searching it can never match, and the engine '
            + "silently skipped it. Fix the object's 'searchableFields' to name real fields.";
    } else if (reason === 'virtual') {
        const vtype = gate.fields[first]?.type ?? 'formula';
        detail = `Field '${first}' on object '${object}' is a virtual '${vtype}' field and cannot be searched`
            + (offenders.length > 1 ? ` (also: ${offenders.slice(1).join(', ')})` : '')
            + `. Its value is computed on read and never stored, so no driver materializes a `
            + `column for 'search' to scan and the entry can never match — measured as 0 rows, `
            + 'with no error, on both the in-memory and the SQL backends.'
            + (declaredSet.has(first)
                ? ` The object's 'searchableFields' declares it, which is what made the entry `
                  + 'look like coverage; remove it there as well.'
                : '')
            + ` Mirror the computed value onto a stored text field on '${object}' and search that instead.`;
    } else if (reason === 'unknown') {
        // A dotted path is a special unknown: plausible vocabulary from the
        // select/sort axes, but search scans this object's own columns.
        const dottedHint = first.includes('.') && gate.known.has(first.split('.')[0])
            ? " 'search' scans this object's own columns; a related record's column cannot be a search target."
            : suggestFieldName(first, gate.declared);
        detail = `Unknown field '${first}' on object '${object}'`
            + (offenders.length > 1 ? ` (also: ${offenders.slice(1).join(', ')})` : '')
            + `. '${param}' narrows which columns 'search' scans, so a name the object does not `
            + 'declare cannot narrow anything — and the engine used to drop it and scan the '
            + 'default columns instead, answering a NARROWER search with a WIDER one.'
            + dottedHint;
    } else if (source === 'declared') {
        detail = `Field '${first}' on object '${object}' is not searchable`
            + (offenders.length > 1 ? ` (also: ${offenders.slice(1).join(', ')})` : '')
            + `. The object declares 'searchableFields' (${allowed.join(', ')}), which is the set `
            + "'search' scans — a field outside it cannot be a search target until it is added there.";
    } else {
        const meta = gate.fields[first];
        const why = !meta || SEARCH_AUTO_EXCLUDED_FIELDS.has(first)
            ? 'a system/audit column, which the default never includes'
            : meta.hidden
                ? 'hidden'
                : `type '${meta.type}'`;
        detail = `Field '${first}' on object '${object}' is not searchable`
            + (offenders.length > 1 ? ` (also: ${offenders.slice(1).join(', ')})` : '')
            + `. With no 'searchableFields' declared, 'search' scans the text-like columns `
            + `(${[...SEARCHABLE_TEXTUAL_TYPES, ...SEARCHABLE_ENUM_TYPES].join(' / ')}), and '${first}' is `
            + why
            + ". Declare 'searchableFields' on the object to choose the searchable set explicitly.";
    }
    const err: any = new Error(detail);
    err.code = 'INVALID_FIELD';
    err.status = 400;
    err.field = first;
    err.fields = offenders;
    err.object = object;
    err.param = param;
    throw err;
}

/** The body of `ObjectStackProtocolImplementation#assertGroupByFieldsExist`; the method's docblock there is its contract. */
export function assertGroupByFieldsExist(
    this: Pick<QueryValidationHost, 'resolveQueryFields'>,
    object: string, groupBy: unknown): void {
    if (groupBy === undefined || groupBy === null) return;
    if (!Array.isArray(groupBy)) {
        throw invalidQueryError(
            'groupBy',
            `must be an array of grouping targets (a field name, or { field, dateGranularity } `
            + `for date bucketing), received ${typeof groupBy}`,
            {
                hint: ' A value the server cannot read used to be ignored — the rows came back '
                    + 'UNGROUPED, looking exactly like a query that never asked for grouping. '
                    + `Send e.g. { "groupBy": ["status"] } in the 'POST /data/:object/query' body.`,
                extra: { object },
            },
        );
    }
    if (groupBy.length === 0) return;
    const fieldsToCheck: string[] = [];
    for (let i = 0; i < groupBy.length; i++) {
        const entry = groupBy[i];
        if (typeof entry === 'string') {
            fieldsToCheck.push(entry);
            continue;
        }
        if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) {
            throw invalidQueryError(
                'groupBy',
                `entry #${i + 1} on object '${object}' is not a grouping target — expected a `
                + `field name or { field, dateGranularity }, received `
                + `${entry === null ? 'null' : Array.isArray(entry) ? 'an array' : typeof entry}`,
                { extra: { object } },
            );
        }
        if (typeof entry.field !== 'string' || entry.field.length === 0) {
            throw invalidQueryError(
                'groupBy',
                `entry #${i + 1} on object '${object}' names no field — the structured form is `
                + `{ field, dateGranularity?, alias? }`,
                { extra: { object } },
            );
        }
        if (entry.dateGranularity !== undefined && !DATE_GRANULARITIES.has(entry.dateGranularity)) {
            throw invalidQueryError(
                'groupBy',
                `entry #${i + 1} on object '${object}' buckets by '${String(entry.dateGranularity)}', `
                + `which is not a date granularity (${[...DATE_GRANULARITIES].join(' / ')})`,
                {
                    hint: ' An unknown granularity used to fall through to one bucket per raw '
                        + 'value — date bucketing that silently never bucketed.',
                    extra: { object },
                },
            );
        }
        fieldsToCheck.push(entry.field);
    }
    const gate = this.resolveQueryFields(object);
    if (!gate) return;
    const unknown = fieldsToCheck.filter((f) => !gate.known.has(f));
    if (unknown.length === 0) return;
    const first = unknown[0];
    const dottedHint = first.includes('.') && gate.known.has(first.split('.')[0])
        ? " Grouping runs over this object's own columns; a related record's column cannot be a "
          + 'grouping target.'
        : suggestFieldName(first, gate.declared);
    const err: any = new Error(
        `Unknown field '${first}' on object '${object}'`
        + (unknown.length > 1 ? ` (also: ${unknown.slice(1).join(', ')})` : '')
        + `. 'groupBy' buckets rows by a column's values, so an unknown column puts every row `
        + 'in ONE bucket keyed null — a result indistinguishable from a column that really '
        + 'holds a single value.'
        + dottedHint,
    );
    err.code = 'INVALID_FIELD';
    err.status = 400;
    err.field = first;
    err.fields = unknown;
    err.object = object;
    err.param = 'groupBy';
    throw err;
}

/** The body of `ObjectStackProtocolImplementation#assertAggregationFieldsExist`; the method's docblock there is its contract. */
export function assertAggregationFieldsExist(
    this: Pick<QueryValidationHost, 'assertFilterFieldsExist' | 'resolveQueryFields'>,
    object: string, aggregations: unknown): void {
    if (aggregations === undefined || aggregations === null) return;
    if (!Array.isArray(aggregations)) {
        throw invalidQueryError(
            'aggregations',
            `must be an array of { function, field?, alias } entries, received `
            + `${typeof aggregations}`,
            {
                hint: ' A value the server cannot read used to be ignored — the rows came back '
                    + 'raw and unaggregated. Send e.g. { "aggregations": [{ "function": "sum", '
                    + `"field": "amount", "alias": "total" }] } in the 'POST /data/:object/query' body.`,
                extra: { object },
            },
        );
    }
    if (aggregations.length === 0) return;
    const fieldsToCheck: string[] = [];
    for (let i = 0; i < aggregations.length; i++) {
        const entry = aggregations[i];
        if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) {
            throw invalidQueryError(
                'aggregations',
                `entry #${i + 1} on object '${object}' is not an aggregation — expected `
                + `{ function, field?, alias }, received `
                + `${entry === null ? 'null' : Array.isArray(entry) ? 'an array' : typeof entry}`,
                { extra: { object } },
            );
        }
        if (typeof entry.function !== 'string' || !AGGREGATION_FUNCTIONS.has(entry.function)) {
            throw invalidQueryError(
                'aggregations',
                `entry #${i + 1} on object '${object}' uses `
                + (typeof entry.function === 'string'
                    ? `'${entry.function}', which is not an aggregation function`
                    : 'no aggregation function')
                + ` (${[...AGGREGATION_FUNCTIONS].join(' / ')})`,
                {
                    hint: ' An unknown function used to compute null for every group while the '
                        + 'response looked served.',
                    extra: { object },
                },
            );
        }
        if (typeof entry.alias !== 'string' || entry.alias.length === 0) {
            throw invalidQueryError(
                'aggregations',
                `entry #${i + 1} on object '${object}' has no 'alias' — the alias names the `
                + `result column (without one it came back keyed "undefined")`,
                { extra: { object } },
            );
        }
        if (entry.field === undefined || entry.field === null) {
            if (entry.function !== 'count') {
                throw invalidQueryError(
                    'aggregations',
                    `entry '${entry.alias}' on object '${object}' applies '${entry.function}' to no `
                    + `field. Only 'count' may omit the field (count(*), every row); '${entry.function}' `
                    + 'needs a column to compute over — without one it answered null while looking served',
                    { extra: { object } },
                );
            }
            continue;
        }
        if (typeof entry.field !== 'string') {
            throw invalidQueryError(
                'aggregations',
                `entry '${entry.alias}' on object '${object}' has a non-string 'field' `
                + `(received ${typeof entry.field})`,
                { extra: { object } },
            );
        }
        if (entry.field === '*') {
            if (entry.function !== 'count') {
                throw invalidQueryError(
                    'aggregations',
                    `entry '${entry.alias}' on object '${object}' applies '${entry.function}' to '*'. `
                    + `'*' is the count-all sentinel and only 'count' reads it`,
                    { extra: { object } },
                );
            }
            continue;
        }
        fieldsToCheck.push(entry.field);
    }
    const gate = this.resolveQueryFields(object);
    if (!gate) return;
    const unknown = fieldsToCheck.filter((f) => !gate.known.has(f));
    if (unknown.length === 0) {
        // [#20148] The filter keys, entry by entry, through `where`'s own
        // gate — see this method's doc. A filter that is not a plain object
        // names no key here and is left to the engine's shape gate.
        aggregations.forEach((entry, i) => {
            this.assertFilterFieldsExist(object, entry.filter, `aggregations[${i}].filter`);
        });
        return;
    }
    const first = unknown[0];
    const dottedHint = first.includes('.') && gate.known.has(first.split('.')[0])
        ? " Aggregation runs over this object's own columns; a related record's column cannot "
          + 'be aggregated.'
        : suggestFieldName(first, gate.declared);
    const err: any = new Error(
        `Unknown field '${first}' on object '${object}'`
        + (unknown.length > 1 ? ` (also: ${unknown.slice(1).join(', ')})` : '')
        + `. An aggregation computes over a column's values, so an unknown column could only `
        + 'aggregate blanks — sum answered 0 and avg/min/max answered null, each '
        + 'indistinguishable from the same result over real data.'
        + dottedHint,
    );
    err.code = 'INVALID_FIELD';
    err.status = 400;
    err.field = first;
    err.fields = unknown;
    err.object = object;
    err.param = 'aggregations';
    throw err;
}

/** The body of `ObjectStackProtocolImplementation#assertNoInternalFieldEvaluated`; the method's docblock there is its contract. */
export function assertNoInternalFieldEvaluated(
    this: Pick<QueryValidationHost, 'groupByFieldNames' | 'orderByFieldNames' | 'refuseInternalInExpand' | 'refuseInternalInFilter' | 'refuseInternalNames' | 'resolveQueryFields'>,
    object: string, options: Record<string, any>): void {
    const gate = this.resolveQueryFields(object);
    if (!gate) return;
    const internal = new Set(collectInternalWriteResponseFields(gate.schema));
    // where + the `filter` alias a direct bag may still carry, each with its
    // nested-relation conditions.
    this.refuseInternalInFilter(object, options.where, 'filter', 0);
    this.refuseInternalInFilter(object, options.filter, 'filter', 0);
    this.refuseInternalNames(object, this.orderByFieldNames(options.orderBy), internal, 'sort');
    this.refuseInternalNames(object, this.groupByFieldNames(options.groupBy), internal, 'groupBy');
    if (Array.isArray(options.aggregations)) {
        options.aggregations.forEach((agg: any, i: number) => {
            const field = agg?.field;
            if (typeof field === 'string' && field !== '*') {
                this.refuseInternalNames(object, [field], internal, `aggregations[${i}].field`);
            }
            this.refuseInternalInFilter(object, agg?.filter, `aggregations[${i}].filter`, 0);
        });
    }
    // The whole expand tree, every level against its own target.
    this.refuseInternalInExpand(object, options.expand, 'expand', 0);
}

/** The body of `ObjectStackProtocolImplementation#refuseInternalInFilter`; the method's docblock there is its contract. */
export function refuseInternalInFilter(
    this: Pick<QueryValidationHost, 'refuseInternalInFilter' | 'refuseInternalNames' | 'refuseUnservedRelationTarget' | 'resolveQueryFields'>,
    object: string, where: unknown, param: string, depth: number): void {
    if (where == null || depth > INTERNAL_FIELD_WALK_DEPTH) return;
    const gate = this.resolveQueryFields(object);
    if (!gate) return;
    const condition = isFilterAST(where) ? parseFilterAST(where) : where;
    const internal = new Set(collectInternalWriteResponseFields(gate.schema));
    if (internal.size > 0) {
        const reads = new Set<string>();
        collectFilterReads(condition, reads);
        this.refuseInternalNames(object, [...reads], internal, param);
    }
    for (const site of relationConditionSites(gate.fields, condition)) {
        const position = `${param}.${site.field}`;
        // [#22737] The target's exposure before anything of it is judged.
        this.refuseUnservedRelationTarget(site.target, position);
        this.refuseInternalInFilter(site.target, site.condition, position, depth + 1);
    }
}

/** The body of `ObjectStackProtocolImplementation#refuseUnservedRelationTarget`; the method's docblock there is its contract. */
export function refuseUnservedRelationTarget(
    this: Pick<QueryValidationHost, 'engine'>,
    target: string, param: string): void {
    const enable = this.engine?.registry?.getObject?.(target)?.enable;
    const reason = apiExposureDenialReason(enable, RELATION_CONDITION_TARGET_OPERATION);
    if (reason === null) return;
    const consequence = `, so the condition on it at '${param}' was not evaluated and the query was not run. `
        + 'Filter on the lookup\'s stored id instead, or remove the condition.';
    const err: any = new Error(reason === 'api-disabled'
        ? `Object '${target}' is not exposed via the API${consequence}`
        : `API operation '${RELATION_CONDITION_TARGET_OPERATION}' is not allowed on object '${target}'${consequence}`);
    if (reason === 'api-disabled') {
        err.code = 'OBJECT_API_DISABLED';
        err.status = 404;
    } else {
        err.code = 'OBJECT_API_METHOD_NOT_ALLOWED';
        err.status = 405;
        err.allowed = effectiveOperationsArray(resolveEffectiveApiMethods(enable));
    }
    err.object = target;
    err.param = param;
    throw err;
}

/** The body of `ObjectStackProtocolImplementation#refuseInternalInExpand`; the method's docblock there is its contract. */
export function refuseInternalInExpand(
    this: Pick<QueryValidationHost, 'orderByFieldNames' | 'refuseInternalInExpand' | 'refuseInternalInFilter' | 'refuseInternalNames' | 'resolveQueryFields'>,
    source: string, expand: unknown, prefix: string, depth: number): void {
    if (!isPlainRecord(expand) || depth > INTERNAL_FIELD_WALK_DEPTH) return;
    const gate = this.resolveQueryFields(source);
    if (!gate) return;
    for (const [rel, entry] of Object.entries(expand)) {
        if (!isPlainRecord(entry)) continue;
        const sourceField = gate.fields?.[rel];
        const target = sourceField != null && REFERENCE_VALUE_TYPES.has(sourceField.type)
            ? referenceTargetOf(sourceField)
            : undefined;
        if (!target) continue;
        const path = `${prefix}['${rel}']`;
        this.refuseInternalInFilter(target, entry.where, `${path}.filter`, 0);
        const targetGate = this.resolveQueryFields(target);
        if (targetGate) {
            const targetInternal = new Set(collectInternalWriteResponseFields(targetGate.schema));
            this.refuseInternalNames(target, this.orderByFieldNames(entry.orderBy), targetInternal, `${path}.sort`);
        }
        this.refuseInternalInExpand(target, entry.expand, `${path}.expand`, depth + 1);
    }
}

/** The body of `ObjectStackProtocolImplementation#servedExpand`; the method's docblock there is its contract. */
export function servedExpand(
    this: Pick<QueryValidationHost, 'resolveQueryFields' | 'servedExpand' | 'servesExpansionTarget'>,
    source: string, expand: Record<string, any>, depth: number): Record<string, any> {
    const gate = this.resolveQueryFields(source);
    let served: Record<string, any> | undefined;
    for (const [rel, entry] of Object.entries(expand)) {
        const def = gate?.fields?.[rel];
        const target = def != null && REFERENCE_VALUE_TYPES.has(def.type) ? referenceTargetOf(def) : undefined;
        if (!target) continue;
        if (depth >= INTERNAL_FIELD_WALK_DEPTH || !this.servesExpansionTarget(target)) {
            served ??= { ...expand };
            delete served[rel];
            continue;
        }
        if (isPlainRecord(entry) && isPlainRecord(entry.expand)) {
            const nested = this.servedExpand(target, entry.expand, depth + 1);
            if (nested !== entry.expand) {
                served ??= { ...expand };
                const { expand: _withheld, ...rest } = entry;
                served[rel] = Object.keys(nested).length > 0 ? { ...rest, expand: nested } : rest;
            }
        }
    }
    return served ?? expand;
}

/** The body of `ObjectStackProtocolImplementation#servesExpansionTarget`; the method's docblock there is its contract. */
export function servesExpansionTarget(
    this: Pick<QueryValidationHost, 'engine'>,
    target: string): boolean {
    const schema: any = this.engine?.registry?.getObject?.(target);
    return canServeApiOperation(schema?.enable, EXPANSION_TARGET_OPERATION);
}

/** The body of `ObjectStackProtocolImplementation#orderByFieldNames`; the method's docblock there is its contract. */
export function orderByFieldNames(orderBy: unknown): string[] {
    if (!Array.isArray(orderBy)) return [];
    return orderBy
        .map((e) => (typeof e === 'string' ? e : (e as { field?: unknown })?.field))
        .filter((f): f is string => typeof f === 'string' && f.length > 0)
        .map((f) => f.split('.')[0] as string);
}

/** The body of `ObjectStackProtocolImplementation#groupByFieldNames`; the method's docblock there is its contract. */
export function groupByFieldNames(groupBy: unknown): string[] {
    if (!Array.isArray(groupBy)) return [];
    return groupBy
        .map((e) => (typeof e === 'string' ? e : (e as { field?: unknown })?.field))
        .filter((f): f is string => typeof f === 'string' && f.length > 0)
        .map((f) => f.split('.')[0] as string);
}

/** The body of `ObjectStackProtocolImplementation#refuseInternalNames`; the method's docblock there is its contract. */
export function refuseInternalNames(object: string, names: readonly string[], internal: ReadonlySet<string>, param: string): void {
    const hit = names.filter((n) => internal.has(n));
    if (hit.length === 0) return;
    const first = hit[0] as string;
    const verb = param.endsWith('sort') ? 'sort' : param === 'groupBy' ? 'group' : param.includes('filter') ? 'filter' : 'query';
    const err: any = new Error(
        `Cannot ${verb} '${object}' by '${first}' (${param}): the query was not run. The ${first} field `
        + 'is declared `internal: true`, so its value is never returned on a generic data exit — the engine '
        + 'omits it from every row. '
        + (verb === 'sort'
            ? 'A sort on it orders by that withheld value'
            : verb === 'group'
                ? 'A group key would be the withheld value, served as the key'
                : 'A filter on it confirms a guessed value by whether the row comes back')
        + ', so it is refused rather than evaluated. Use another field.',
    );
    err.code = 'INVALID_FIELD';
    err.status = 400;
    err.httpStatus = 400;
    err.field = first;
    err.fields = hit;
    err.object = object;
    err.param = param;
    throw err;
}
