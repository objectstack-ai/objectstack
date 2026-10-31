// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#25467 E0] Part of the module preamble of `protocol.ts`, moved here verbatim:
 * the list-query parameter vocabulary: reserved names, near misses, arity, paging, projection, sort, filter reads and the stored-metadata search narrowing.
 *
 * A MOVE, not a redesign: every declaration below is byte-identical to the text
 * that stood above `ObjectStackProtocolImplementation`; only the imports and the
 * export list at the foot are new. `protocol.ts` re-exports what it exported.
 */
import {
    parseFilterAST, isFilterAST,
    resolveSearchFieldResolution,
    type SearchFieldMeta,
    QUERY_TRANSPORT_ALIAS_SLOTS, QUERY_TRANSPORT_DOLLAR_ALIASES,
    QueryPageWindowParamSchema,
    QueryTransportParamsSchema,
    type QueryAliasConflict,
    type QueryAST,
} from '@objectstack/spec/data';
import {
    isStoredMetadataBodyObject,
    storedMetadataSearchRefusal,
} from './metadata-redaction.js';

/**
 * The canonical `QueryAST` surface (`spec/data/query.zod.ts`), enumerated.
 *
 * Typed as `Record<keyof QueryAST, true>` so `tsc` pins it to the spec in BOTH
 * directions: a key added there is a missing-property error here, a key removed
 * there is an excess-property error here. That matters because the set below
 * decides what is a query parameter and what is a field filter — silently
 * drifting from the AST would resurrect exactly the #4134 failure for whatever
 * key was added.
 *
 * The #4286 tombstones (`joins`, `windowFunctions`) still count: `retiredKey()`
 * keeps a retired key in `keyof QueryAST`, so both stay listed — and therefore
 * deliberately stay RESERVED at this boundary while the tombstone lives. That
 * is the right compat posture: a caller still sending one belongs with the
 * prescription, not with a silent `where.joins` filter. When a tombstone ages
 * out (~two majors) and the key leaves the spec, the excess-property error
 * here is the reminder that deleting its line UN-reserves the name — an object
 * field genuinely called `joins` would start resolving as an implicit filter,
 * which is a behavior change to call out in that changeset.
 */
const QUERY_AST_KEYS: Readonly<Record<keyof QueryAST, true>> = {
    object: true, fields: true, where: true, search: true, searchFields: true,
    orderBy: true, limit: true, offset: true, top: true, cursor: true,
    joins: true, aggregations: true, groupBy: true, having: true,
    windowFunctions: true, distinct: true, expand: true,
};

/**
 * [#4134] Every query-parameter name `findData` consumes itself, consulted
 * AFTER the alias normalization in `findData` has run — so the wire spellings
 * that get rewritten (`$top`→`top`→`limit`, `select`→`fields`, `sort`→
 * `orderBy`, `filter`/`filters`/`$filter`→`where`, `populate`/`$expand`→
 * `expand`, `skip`→`offset`, …) are already gone by this point and
 * deliberately do NOT appear here. Anything still standing is either a name in
 * this set or a candidate field filter.
 *
 * The structural AST keys (`object`, `joins`, `having`, `windowFunctions`)
 * matter even though no querystring carries them: `POST /data/:object/query`
 * hands its body in as `query`, and that body IS a `Partial<QueryAST>`. Without
 * them, `client.data.query('task', { object: 'task', limit: 5 })` would have
 * its `object` key read as a filter and match zero rows.
 *
 * A name in this set can never be used as an implicit field filter, so an
 * object with a field genuinely called e.g. `count` or `cursor` must filter it
 * through the explicit form (`?filter={"count":3}`). That trade-off predates
 * #4134 for the original members; it is called out here so the next person to
 * add one knows what they are spending.
 */
const RESERVED_LIST_QUERY_PARAMS: ReadonlySet<string> = new Set([
    ...Object.keys(QUERY_AST_KEYS),
    // Transport-only extras the normalizer consumes but the AST does not name.
    'count',        // ?count / $count — response flag, not a projection
    // `searchFields` used to be listed here as such an extra. It is a named
    // AST key since #3899 declared it (ADR-0061 P1), so it now arrives through
    // the spread above and the type-level pin covers it — the hand-maintained
    // copy would have been a second source that could silently fall out of step.
    // Server-derived, never caller input (stripped then re-set from `request`).
    'context',
]);

/**
 * [#4134] High-frequency wrong guesses → the parameter that actually works.
 * Keys are normalized (lower-cased, `_`/`-` stripped) so `pageSize`,
 * `page_size` and `PAGE-SIZE` all land on the same entry.
 *
 * This is a HINT table, not an alias table: nothing here is accepted as input.
 * Adding an entry makes a rejection more helpful; it never makes a request
 * succeed, so it does not create the second de-facto contract Prime Directive
 * #12 warns about.
 */
export const QUERY_PARAM_NEAR_MISS: Readonly<Record<string, string>> = {
    // page-size dialects (the #4134 repro: `?pageSize=5` → 200 + empty list)
    pagesize: 'top', persize: 'top', perpage: 'top', pagelimit: 'top',
    rowsperpage: 'top', pagecount: 'top', size: 'top', take: 'top',
    first: 'top', max: 'top', maxresults: 'top', maxrecords: 'top',
    // page-offset dialects
    page: 'skip', pageno: 'skip', pagenum: 'skip', pagenumber: 'skip',
    pageindex: 'skip', start: 'skip', startindex: 'skip', startat: 'skip',
    // sorting
    sortby: 'sort', sortfield: 'sort', sortorder: 'sort', order: 'sort',
    ordering: 'sort',
    // search
    q: 'search', keyword: 'search', keywords: 'search', term: 'search',
    searchterm: 'search', querytext: 'search',
    // filtering
    filterby: 'filter', criteria: 'filter', conditions: 'filter',
    // projection / relations
    columns: 'select', include: 'expand', includes: 'expand', with: 'expand',
};

/**
 * The OData spelling of each parameter {@link QUERY_PARAM_NEAR_MISS} points at.
 * NOT derivable by prefixing `$` — `sort` is `$orderby`, and suggesting a
 * `$sort` that the unsupported-`$` guard rejects would just hand the caller a
 * second 400.
 */
export const ODATA_SPELLING: Readonly<Record<string, string>> = {
    top: '$top', skip: '$skip', sort: '$orderby', search: '$search',
    filter: '$filter', select: '$select', expand: '$expand',
};

// [#16066] The transport alias tables this normalizer folds by are DECLARED,
// and they are declared in the spec — `QUERY_TRANSPORT_ALIAS_SLOTS` and
// `QUERY_TRANSPORT_DOLLAR_ALIASES` (`@objectstack/spec/data`), imported above.
//
// They used to live here as module-private `WIRE_QUERY_ALIAS_SLOTS` /
// `WIRE_DOLLAR_ALIASES`: the spec's own table extended, in this file, with
// spellings no schema named. That extension is what made the `findData` door
// accept a second vocabulary through a slot declaring only the first — two
// dialects, one slot, one of them declared. Folding by the spec's export is
// the single source that closes it; ⛔ do not re-extend a table here.

/**
 * [#7321] The list-query slots whose DECLARED value type admits an array, by
 * canonical key. Everything else this normalizer reads — including a leftover
 * key lowered into an implicit field filter — is single-valued, and an array on
 * it is a repeated wire parameter (see {@link assertQueryParamArity}).
 *
 * This set is the whole judgement. `IHttpRequest.query` is
 * `Record< string, string | string[] >` and the array arm is produced by a real
 * first-party adapter (`NodeHttpServer` hands `?x=1&x=2` through as
 * `['1','2']`, measured over a socket on #6878), so `Array.isArray` at this
 * boundary means one of exactly two things: a repeated querystring parameter,
 * or a JSON array in a `POST /data/:object/query` body. This normalizer serves
 * BOTH ingresses and cannot tell them apart — which is why the rule keys off the
 * declared TYPE rather than off the request. On a slot that never declares an
 * array, `Array.isArray` is unambiguous evidence of repetition; on a slot that
 * does, it is the ordinary shape and must not be touched.
 *
 * Per member, why the array is legal (`packages/spec/src/data/query.zod.ts`):
 *  - `fields`        — `z.array(FieldNodeSchema)`; `?$select=a&$select=b` IS the
 *                      projection `['a','b']`.
 *  - `orderBy`       — `z.array(SortNodeSchema)`, and `normalizeSortNodes` has an
 *                      explicit `string[]` arm: repetition COMPOSES into a
 *                      multi-key sort (`?sort=name&sort=-age`), it does not
 *                      conflict.
 *  - `expand`        — the name-array arm lowers to `{name: {object: name}}`.
 *  - `searchFields`  — `z.array(z.string())`; the engine reads the comma-string
 *                      and the array from either slot.
 *  - `where`         — a FILTER AST is an array (`['status','=','open']`), so a
 *                      blanket arity refusal here would reject the AST body form
 *                      outright. Arity for this slot is judged one layer up, at
 *                      the REST querystring ingress (`assertFilterParamSuppliedOnce`,
 *                      #7390) — the only layer that knows an array on this wire
 *                      is a repetition and can be nothing else. A repeated
 *                      `?filter=` never reaches this block on `GET /data/:object`;
 *                      worse, `?filter=status&filter=%3D&filter=open` spells a
 *                      valid AST and succeeds with a filter nobody expressed.
 *  - `groupBy`       — `z.array(GroupByNodeSchema)`.
 *  - `aggregations`  — `z.array(AggregationNodeSchema)`.
 *  - `joins` / `windowFunctions` — retired ARRAY keys (#4286). The tombstone,
 *                      not an arity refusal, must stay their answer.
 *
 * Deliberately NOT here, each because the spec declares a scalar: `limit`/`top`
 * and `offset` (`z.number()`), `search` (`string | FullTextSearch`), `object`
 * (`z.string()`), `having` (a `FilterCondition` OBJECT — the engine has no AST
 * arm for it), the `count` response flag, and the retired scalars `cursor` /
 * `distinct`.
 */
const ARRAY_VALUED_QUERY_SLOTS: readonly string[] = [
    'fields', 'orderBy', 'expand', 'searchFields', 'where',
    'groupBy', 'aggregations', 'joins', 'windowFunctions',
];

/**
 * [#7321] {@link ARRAY_VALUED_QUERY_SLOTS} expanded to every TRANSPORT spelling that
 * reaches it, derived from the same two tables the fold uses so a new alias
 * cannot silently lose its array arm — the failure mode would be `?$select=a&
 * $select=b` starting to 400, i.e. the damage case this card exists to avoid.
 */
const ARRAY_VALUED_LIST_QUERY_PARAMS: ReadonlySet<string> = (() => {
    const names = new Set<string>(ARRAY_VALUED_QUERY_SLOTS);
    for (const slot of QUERY_TRANSPORT_ALIAS_SLOTS) {
        if (!names.has(slot.canonical)) continue;
        for (const alias of slot.aliases) names.add(alias);
    }
    for (const [dollar, bare] of QUERY_TRANSPORT_DOLLAR_ALIASES) {
        if (names.has(bare)) names.add(dollar);
    }
    return names;
})();

/**
 * [#7321] A parameter this normalizer reads as single-valued, supplied more
 * than once.
 *
 * ## Why a refusal, and why this code
 *
 * `?$top=1&$top=2` is a well-formed request carrying two irreconcilable
 * intents. Picking one is the silent drop itself, and coercing the pair is
 * worse: `Number(['1','2'])` is `NaN`, so the window reached the driver as
 * `limit: NaN` — driver-dependent behaviour under a 200, never an error. That
 * is the same class #6928 / PR #7299 refused one layer over on
 * `GET /api/v1/notifications`, and the same rule commit 293476148 / #6877 landed in
 * `packages/rest` (`readSingleQueryValue` / `repeatedQueryParamMessage`).
 *
 * ## The wording below is MODELLED ON theirs — it is not a verbatim copy
 *
 * A caller who repeats a parameter on two different routes is told the same
 * RULE, in two texts that differ in two measured ways (#17813):
 *
 *  1. The parameter name is quoted differently — single quotes here
 *     (`The 'top' query parameter …`), double quotes in `packages/rest`
 *     (`The "top" query parameter …`) — so the two strings diverge at the
 *     FIRST quoted character, shared prefix included.
 *  2. This one appends the `It was NOT applied as a list: …` clause naming
 *     the `Number(['1','2'])` coercion above. Additive, and absent there.
 *
 * ⛔ Neither delta is a stray to "repair" in passing: both texts are the
 * published output of released endpoints, so aligning the two is a change to
 * what two doors answer, not a comment fix.
 *
 * ## Why the text is copied at all, now that half the reason has gone
 *
 * #17672 published `repeatedQueryParamMessage` from `@objectstack/rest`'s
 * entry, so the sentence that module owns became importable by a sibling
 * package for the first time — but not from HERE. `@objectstack/rest` is in
 * neither this package's `dependencies` nor its `devDependencies`, and the
 * arrow points the other way: `@objectstack/rest` dev-depends on
 * `@objectstack/metadata-protocol` (`query-multiplicity.ts`'s header records
 * that as why it cannot derive the filter-slot spellings from here at
 * runtime). Importing the message would invert a package dependency and
 * settle where the sentence lives for THREE consumers — this normalizer, the
 * rest handlers, and the dispatcher domain that already calls the message
 * function — a layering question deliberately left open. Until it is
 * answered, the copy is the only form reachable from this package, ⛔ nothing
 * holds the two texts equal, and an edit to either one does NOT move the
 * other.
 *
 * `INVALID_REQUEST` / 400 is what {@link conflictingQueryParamsError} in this
 * same normalizer already answers for the IDENTICAL condition reached the other
 * way — two SPELLINGS of one slot carrying different values (#4181 → #3795).
 * One slot given two values is one defect; it must not carry two codes
 * depending on whether the caller repeated `filter` or wrote `filter` and
 * `where`. (The rest layer spells its 400 `VALIDATION_ERROR` and the runtime
 * layer `VALIDATION_FAILED`; those are each package's house catalog member for
 * a 400, registered per package in `error-code-ledger.zod.ts`. The RULE and the
 * status are what have to agree across the three, and do.)
 *
 * ## Why the count and not the values
 *
 * Two identical values are still two occurrences and are still refused: "at
 * most one DISTINCT value" would be a de-duplication rule no caller can
 * predict, while "supply it at most once" is checkable client-side without
 * knowing anything about our semantics (#6877).
 */
function repeatedQueryParamError(param: string, count: number): Error {
    const err: any = new Error(
        `The '${param}' query parameter was supplied ${count} times. Supply it at most once — `
        + 'this endpoint will not choose between conflicting values. It was NOT applied as a '
        + 'list: a single-valued parameter given an array coerces to a value nobody asked for '
        + `(Number(['1','2']) is NaN), which the driver then answers under a 200.`,
    );
    err.status = 400;
    err.code = 'INVALID_REQUEST';
    err.param = param;
    return err;
}

/**
 * [#25229] The page window (`limit` / `offset`, spelled `$top` / `top` /
 * `$skip` / `skip` on the wire) as the non-negative integer every driver
 * needs, or a refusal naming the parameter the caller wrote (#4226).
 *
 * The bare `Number(...)` this replaces failed three ways, none of them loud:
 *
 *  - `NaN` (`?$top=abc`) and a negative limit (`?$top=-1`) reached the driver,
 *    which drops a window it cannot read — every row answered under a 200, the
 *    #7321 class (a malformed window served as if no window was sent);
 *  - a negative offset (`?$skip=-1`, `{"offset": -1}`) reached knex's
 *    `QueryBuilder.offset`, which throws — a 500 for a caller's mistake;
 *  - a blank value (`?$top=`) is `Number('') === 0`, an empty page nobody
 *    asked for.
 *
 * A blank value is refused, not read as absent. The blank `?filter=` is
 * absent because an empty filter and no filter mean the same thing; an empty
 * window does not — absent means "every row", so reading `?$top=` that way is
 * the silent widening above under another name, and reading it as `0` is the
 * guess this replaces. `0` itself stays valid: `$top=0` asks for the total
 * alone.
 *
 * Only the two arms a door can deliver are read: a number (a JSON body) and a
 * string (a querystring). Anything else — `true`, which `Number` would quietly
 * make `1` — is refused like any other value that is not a count.
 *
 * [#25269] The accept set is the spec's `QueryPageWindowParamSchema`, parsed
 * here rather than restated: the same declaration is what `FindDataRequestSchema`
 * and `HttpFindQueryParamsSchema` publish for these parameters, so a client
 * generated from them is told exactly what this check lets through.
 */
function pageWindowValue(value: unknown, param: string): number {
    const window = QueryPageWindowParamSchema.safeParse(value);
    if (window.success) return window.data;
    // `String` for a number: `JSON.stringify(Infinity)` is `null`.
    const shown = typeof value === 'number' ? String(value) : JSON.stringify(value) ?? String(value);
    const err: any = new Error(
        `Query parameter '${param}' must be a non-negative integer; got `
        + `${shown.length > 64 ? `${shown.slice(0, 64)}…` : shown}. The query was not run: a window `
        + 'the driver cannot read is either dropped, answering every row, or rejected by the database.',
    );
    err.status = 400;
    err.code = 'INVALID_REQUEST';
    err.param = param;
    throw err;
}

/**
 * A refused query value as the refusal quotes it: JSON, so a blank or
 * whitespace-only value is visible, and bounded, so a long one cannot bury
 * the sentence around it. [#27484] Exported for the search-fields gate
 * (`protocol-query-validation.ts`), which refuses an empty override in the
 * projection's words.
 */
export function quotedQueryValue(value: unknown): string {
    // `String` for a number: `JSON.stringify(Infinity)` is `null`.
    const shown = typeof value === 'number' ? String(value) : JSON.stringify(value) ?? String(value);
    return shown.length > 64 ? `${shown.slice(0, 64)}…` : shown;
}

/**
 * [#26644] A projection (`fields`, spelled `$select` / `select` on the wire) as
 * the list of field names the engine reads, or a refusal naming the parameter
 * the caller wrote.
 *
 * A comma string is split and trimmed as it always was; what is refused is a
 * value that names NO field — a blank or comma-only string, or an empty array.
 * It used to become `[]`, which `assertProjectionFieldsExist` has nothing to
 * check in and every driver serves as no projection: every column, under a
 * 200. Absent means "every column"; an empty projection asks for none, so
 * reading it as absent is the widening {@link pageWindowValue} refuses on the
 * row axis (a blank `$top`), here on the column axis.
 *
 * One rule for both routes that read a projection: the list's `findData` and
 * the by-id `getData`.
 */
function projectionFieldsValue(value: string | readonly unknown[], param: string): unknown[] {
    const fields = typeof value === 'string'
        ? value.split(',').map((s) => s.trim()).filter(Boolean)
        : [...value];
    if (fields.length > 0) return fields;
    const err: any = new Error(
        `Query parameter '${param}' names no field; got ${quotedQueryValue(value)}. The query was not run: `
        + 'an empty projection was read as no projection, which answers every column. Name at least one '
        + 'field, or leave the parameter out to read every column.',
    );
    err.status = 400;
    err.code = 'VALIDATION_ERROR';
    err.param = param;
    throw err;
}

/**
 * [#26644] The response's total-count flag (`count`, spelled `$count` on the
 * wire) as the boolean `findData` reads its opt-out from, or a refusal naming
 * the parameter the caller wrote.
 *
 * The accept set is the spec's `QueryTransportParamsSchema.count`, parsed here
 * rather than restated: the boolean, or the two strings a querystring carries
 * it as (`null` is absent). Any other value used to stay as it was, so the
 * `options.count === false` opt-out read it as "count anyway" — `?$count=maybe`
 * reported a `total` exactly like `?$count=true`.
 */
function countFlagValue(value: unknown, param: string): boolean | null | undefined {
    const flag = QueryTransportParamsSchema.shape.count.safeParse(value);
    if (flag.success) return typeof flag.data === 'string' ? flag.data === 'true' : flag.data;
    const err: any = new Error(
        `Query parameter '${param}' must be true or false; got ${quotedQueryValue(value)}. The query was not `
        + 'run: any other value was read as absent, which counts and reports a total.',
    );
    err.status = 400;
    err.code = 'VALIDATION_ERROR';
    err.param = param;
    throw err;
}

/**
 * [#7321] Refuse a repeated occurrence of any list-query parameter this
 * normalizer reads as single-valued, and normalise the benign one-element array
 * away so nothing below has to know the union existed.
 *
 * Runs at the TOP of `findData`, ahead of the `$`-alias pass and the #3795 slot
 * fold, for two reasons:
 *
 *  1. The message then quotes the parameter the caller actually wrote — the
 *     #4226 discipline. After the fold, `?$top=1&$top=2` would be reported as
 *     `'limit'`, a name absent from the request.
 *  2. The fold compares slot spellings by `JSON.stringify`, so an unchecked
 *     `?top=1&top=2&limit=1` reaches it as `['1','2']` vs `'1'` and is refused
 *     as a "conflicting query parameters" problem — a true refusal with a false
 *     diagnosis. Checking arity first means the caller is told what is actually
 *     wrong.
 *
 * Length 0 is DELETED rather than set to `undefined` (which is what the rest
 * layer's `refuseRepeatedQueryParams` does with it): the leftover-key bucket
 * below reads `Object.keys(options)`, so a key left behind carrying `undefined`
 * would be lowered into an implicit `{field: undefined}` predicate. "Not
 * supplied" has to mean absent here, not present-and-empty.
 */
function assertQueryParamArity(options: Record<string, unknown>): void {
    for (const name of Object.keys(options)) {
        const value = options[name];
        if (!Array.isArray(value)) continue;
        if (ARRAY_VALUED_LIST_QUERY_PARAMS.has(name)) continue;
        if (value.length > 1) throw repeatedQueryParamError(name, value.length);
        // length 1 → one occurrence an adapter encoded as an array; length 0 →
        // no occurrence at all.
        if (value.length === 0) delete options[name];
        else options[name] = value[0];
    }
}

/**
 * [#4181 → #3795] Spellings of ONE slot carrying DIFFERENT values. Two values
 * for one slot cannot be reconciled — merging them would invent an intent the
 * caller never expressed, and picking one is the silent drop itself — so an
 * ambiguous request is refused. Redundant identical spellings pass. #4181
 * established this on the filter slot; the fold now applies it to all five.
 *
 * `spellingFor` maps each folded name back to the wire spelling the caller
 * actually wrote (`$orderby`, not `orderBy`) — the #4226 discipline.
 */
function conflictingQueryParamsError(
    conflict: QueryAliasConflict,
    spellingFor: (name: string) => string,
): Error {
    const names = conflict.spellings.map((s) => `'${spellingFor(s)}'`).join(', ');
    const err: any = new Error(
        `Conflicting query parameters: ${names} are spellings of the same parameter `
        + `(canonical '${conflict.canonical}') and were given different values. Send exactly one.`,
    );
    err.status = 400;
    err.code = 'INVALID_REQUEST';
    return err;
}

/**
 * [#4181] A filter the normalizer cannot turn into a usable `FilterCondition`
 * by any route other than the array shapes {@link malformedFilterArrayError}
 * already diagnoses: unparseable JSON, or JSON that parses to something no
 * driver can read (a number, a bare string, `null`).
 *
 * Carries `INVALID_FILTER` — the standard-catalog code (`errors.zod.ts`,
 * "Invalid filter expression") that #4121 introduced on this same code path for
 * the array case. One condition, one wire code, however the caller reached it:
 * a `$filter` array with a bad operator and a `?filter=` that is not JSON are
 * the same answer to the same question ("this filter cannot run").
 *
 * The message states the filter was NOT APPLIED, because that is the part a
 * caller cannot infer: the pre-#4181 behavior was an ordinary-looking 200 over
 * the unfiltered set.
 */
function unusableFilterError(param: string, detail: string): Error {
    const err: any = new Error(
        `Query parameter '${param}' ${detail}. It was not applied, and an unapplied `
        + 'filter would have returned the unfiltered result set.',
    );
    err.status = 400;
    err.code = 'INVALID_FILTER';
    err.param = param;
    return err;
}

/**
 * [#4226] A sort the normalizer cannot turn into a usable `SortNode[]`, or one
 * that names a field the object does not have — or, since #4256, a dotted path
 * (`account.company_name`) that would have to cross into a related record no
 * driver joins for.
 *
 * Carries `INVALID_SORT` — the standard-catalog code (`errors.zod.ts`,
 * "Invalid sort specification") that had sat in the catalog with no emitter
 * since it was written. One condition, one wire code, however the caller
 * reached it.
 *
 * The message spells out what an unapplied sort costs, because that is the part
 * a caller cannot infer from the response: `sort` + `top` is how you ask for
 * "the latest N", and a dropped sort turns that into an ARBITRARY N with a
 * perfectly ordinary-looking 200 over it. The rows are all there and all real —
 * which is exactly why nobody notices.
 */
export function invalidSortError(
    param: string,
    detail: string,
    opts?: { hint?: string, extra?: Record<string, unknown> },
): Error {
    const err: any = new Error(
        `Query parameter '${param}' ${detail}. It was not applied, and an unapplied `
        + "sort returns the rows in an arbitrary order — which 'top'/'limit' then "
        + 'slices into an arbitrary page.'
        + (opts?.hint ?? ''),
    );
    err.status = 400;
    err.code = 'INVALID_SORT';
    err.param = param;
    Object.assign(err, opts?.extra ?? {});
    return err;
}

/**
 * [#4721] A sort node that spells its direction `direction` instead of `order`.
 *
 * This is the one unknown key on this axis that has a KNOWN right answer, so it
 * gets a rejection that carries the translation rather than a generic refusal.
 * `direction` is not a typo — it is the live vocabulary of a neighbouring
 * contract (better-auth's adapter `sortBy`), which
 * `plugin-auth/objectql-adapter.ts` already translates to `order` by hand.
 * A necessary translation nothing enforced is exactly ADR-0049's shape.
 *
 * Measured on `main` before this rejection existed, on the schema side of the
 * same door:
 *
 * ```
 * SortNodeSchema.parse({ field: 'updated_at', direction: 'desc' })
 *   →  { field: 'updated_at', order: 'asc' }
 * ```
 *
 * So the failure was not "unsorted" — it was sorted the OTHER WAY, and with a
 * `limit` that means a different set of rows came back under a 200. Worse than
 * the family `invalidSortError` was built for (#3948, #4226): those return the
 * right rows in an arbitrary order, this one returns the wrong rows.
 *
 * `INVALID_SORT` rather than a new code: one condition — "this sort was not
 * applied as written" — keeps one wire code however the caller reached it.
 */
function invalidSortDirectionKeyError(param: string, field: string): Error {
    return invalidSortError(
        param,
        `spells the sort direction for '${field}' as \`direction\`, which is not a key on this `
        + 'axis — the QueryAST sort node is `{ field, order }`',
        {
            hint:
                ` Write \`{ field: '${field}', order: 'desc' }\`. \`direction\` is`
                + " the better-auth adapter's `sortBy` vocabulary, a genuinely different contract; on this"
                + ' axis it was silently dropped and `order` fell back to `asc`, so a descending'
                + ' request came back ascending — and with `limit`, a different set of rows.',
            extra: { field, key: 'direction' },
        },
    );
}

/**
 * [#4226] Every wire spelling of `sort`/`orderBy`, folded to the one shape the
 * QueryAST declares (`SortNodeSchema[]`) — or a rejection.
 *
 * Four spellings arrive here today and only two of them ever reached a driver:
 *
 * | spelling | example | before |
 * |:---|:---|:---|
 * | string | `?sort=-created_at` | worked |
 * | `SortNode[]` | `[{field,order}]` | worked |
 * | `string[]` | `['-created_at']` | **dropped** — the client's own declared type (`orderBy?: string \| string[] \| SortNode[]`) |
 * | `Record<field,dir>` | `{created_at:'desc'}` | **dropped** — what `GET /data/:object/export`, `GET /data/import/jobs` and objectui's calendar all emit |
 *
 * The two dropped ones never failed: `SqlDriver` guards its ORDER BY clause
 * with `Array.isArray(query.orderBy)`, so a shape it could not read produced no
 * clause at all. `GET /data/import/jobs` has been asking for `created_at desc`
 * and serving insertion order ever since it was written; #4181 taught the
 * export route to REJECT an unparseable `orderby`, but the parsed result then
 * fell into this same hole one layer down.
 *
 * Normalizing here — in the one shared normalizer every ingress funnels through
 * — is what gives `GET /data/:object`, `POST /data/:object/query`, the export
 * route and the runtime dispatcher a single answer instead of four. Anything
 * that still cannot be read as a sort is a 400 rather than a silent no-op: per
 * #3948, an unapplied sort must not look like an applied one.
 *
 * [#4721] One key gets named treatment on top of that: a node written
 * `{ field, direction }` is refused with {@link invalidSortDirectionKeyError}
 * rather than read as "sort by `field`, direction unspecified". It is the wire
 * half of a door whose schema half is `SortNodeSchema`'s
 * `aliases: { direction: 'order' }` — both closed in one change, because
 * guarding one door only is the asymmetry #1535 shipped and #4522 came back for.
 */
function normalizeSortNodes(value: unknown, param: string): Array<{ field: string, order: 'asc' | 'desc' }> {
    const direction = (raw: unknown, subject: string): 'asc' | 'desc' => {
        if (raw === undefined || raw === null || raw === '') return 'asc';
        const dir = String(raw).trim().toLowerCase();
        if (dir === 'asc' || dir === 'desc') return dir;
        throw invalidSortError(param, `gives ${subject} the direction '${raw}', which is neither 'asc' nor 'desc'`);
    };
    // `-field` / `field` / `field desc` — the querystring shorthand, also used
    // for each element of the `string[]` form.
    const fromShorthand = (raw: string): { field: string, order: 'asc' | 'desc' } | undefined => {
        const trimmed = raw.trim();
        if (!trimmed) return undefined;
        if (trimmed.startsWith('-')) {
            const field = trimmed.slice(1).trim();
            return field ? { field, order: 'desc' } : undefined;
        }
        const [field, order] = trimmed.split(/\s+/);
        return field ? { field, order: direction(order, `'${field}'`) } : undefined;
    };
    const fromElement = (el: unknown, index: number): { field: string, order: 'asc' | 'desc' } | undefined => {
        if (typeof el === 'string') return fromShorthand(el);
        if (el && typeof el === 'object' && !Array.isArray(el)) {
            const node = el as { field?: unknown, order?: unknown };
            if (typeof node.field === 'string' && node.field.trim()) {
                // [#4721] `{ field, direction }` — the wire half of the door
                // `SortNodeSchema`'s `aliases: { direction: 'order' }` closes on
                // the schema side. Checked HERE and not left to the schema
                // because an external caller's `orderBy` never reaches it: this
                // normalizer runs at the ingress, ahead of any QueryAST parse.
                //
                // Rejecting only on a well-formed sort NODE is deliberate. In
                // the sibling `{field: direction}` map form a key named
                // `direction` is an ordinary column name ("sort by the
                // `direction` column"), and that form does not reach this
                // branch — it has no string `field`.
                if ('direction' in node) throw invalidSortDirectionKeyError(param, node.field.trim());
                return { field: node.field.trim(), order: direction(node.order, `'${node.field}'`) };
            }
        }
        throw invalidSortError(
            param,
            `has an entry at position ${index} that names no field (received ${JSON.stringify(el) ?? typeof el})`,
        );
    };

    if (value === undefined || value === null || value === '') return [];
    if (typeof value === 'string') {
        return value.split(',').map(fromShorthand).filter((s): s is { field: string, order: 'asc' | 'desc' } => !!s);
    }
    if (Array.isArray(value)) {
        return value.map(fromElement).filter((s): s is { field: string, order: 'asc' | 'desc' } => !!s);
    }
    if (typeof value === 'object') {
        const entries = Object.entries(value as Record<string, unknown>);
        if (entries.length === 0) return [];
        // A single `SortNode` sent unwrapped (`{field:'x',order:'desc'}`) is the
        // one-element array it obviously means; anything else is read as the
        // `{field: direction}` map, whose VALUES must be directions — that check
        // is what stops a stray object being silently accepted as "no sort".
        if (typeof (value as any).field === 'string') return [fromElement(value, 0)!];
        return entries.map(([field, dir]) => ({ field, order: direction(dir, `'${field}'`) }));
    }
    throw invalidSortError(param, `is a ${typeof value}, which names no field to sort by`);
}

/** Fold a parameter name to its near-miss lookup key. */
export function nearMissKey(name: string): string {
    return name.toLowerCase().replace(/[_-]/g, '');
}

/** Levenshtein distance, bailed out early once it exceeds `max`. */
function editDistance(a: string, b: string, max: number): number {
    if (Math.abs(a.length - b.length) > max) return max + 1;
    let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
    for (let i = 1; i <= a.length; i++) {
        const row = [i];
        let best = i;
        for (let j = 1; j <= b.length; j++) {
            const cost = a[i - 1] === b[j - 1] ? 0 : 1;
            row[j] = Math.min(prev[j] + 1, row[j - 1] + 1, prev[j - 1] + cost);
            if (row[j] < best) best = row[j];
        }
        if (best > max) return max + 1;
        prev = row;
    }
    return prev[b.length];
}

/**
 * [#4226] The field-typo half of {@link suggestQueryParam}, on its own.
 *
 * The `sort` / `select` / `expand` axes name a field DIRECTLY, so the
 * parameter-dialect half above is not merely useless there but actively wrong:
 * it would answer `?sort=order` with "did you mean the 'sort' query parameter",
 * which is the parameter the caller already used.
 */
export function suggestFieldName(name: string, knownFields: readonly string[]): string {
    const folded = nearMissKey(name);
    // Only worth guessing for names long enough that a small distance is
    // meaningful — at 3 chars everything is within 2 edits of everything.
    if (folded.length >= 4) {
        const max = folded.length <= 5 ? 1 : 2;
        let best: string | undefined;
        let bestDistance = max + 1;
        for (const field of knownFields) {
            const d = editDistance(folded, nearMissKey(field), max);
            if (d < bestDistance) { bestDistance = d; best = field; }
        }
        if (best !== undefined && bestDistance <= max) {
            return ` Did you mean the field '${best}'?`;
        }
    }
    return '';
}

/**
 * [#7534] The logical combinators a `FilterCondition` may carry. These hold
 * NESTED CONDITIONS rather than naming a field, so {@link collectFilterFieldKeys}
 * descends through them instead of judging them.
 *
 * Exactly the three the contract declares (`FilterConditionSchema`,
 * `@objectstack/spec`) — `$and` / `$or` / `$not`. `$nor` is deliberately absent:
 * it is a driver-INTERNAL lowering (`driver-memory` rewrites an input `$not`
 * into a one-operand `$nor`, MongoDB's document-level negation) and is REFUSED
 * as input vocabulary by that same driver, so a `$nor` arriving on the wire is
 * not a combinator this layer should silently descend into.
 */
export const FILTER_LOGICAL_KEYS: ReadonlySet<string> = new Set(['$and', '$or', '$not']);

/**
 * [#21544] The stored-metadata family's ONE filter-field collector: every column
 * a read query's filters READ, judged the way the family's evaluate refusals
 * ({@link storedMetadataBodyPredicateRefusal},
 * {@link storedMetadataHashEvaluateRefusal}) need it. The generic data door
 * calls it, and so does the in-process reader-context seam in
 * `@objectstack/runtime` (`stored-metadata-reader-seam.ts`), on the same query,
 * so the two answer every filter identically. `[]` for an object outside the
 * family ({@link isStoredMetadataBodyObject}) or a query that is not a record.
 *
 * The filter positions it reads are a read query's three: `where`, `filter`
 * (the engine option alias a direct engine call may still carry) and each
 * `aggregations[i].filter`. ⛔ Not `having`: its keys and references name the
 * AGGREGATED row's columns — group keys and aggregation aliases — and the
 * engine refuses any other name before a row exists, so a family column can
 * never be read there, while an alias that happens to be spelled like one
 * (`{ function: 'count', alias: 'metadata' }`) is a legitimate count.
 *
 * What counts as a read, and why it is more than the ingress gate's
 * {@link collectFilterFieldKeys} collects. The first two rules are measured
 * reaches at the generic data door before this collector existed (a family
 * column evaluated, unrefused); the rest are the stricter collector's rules,
 * adopted whole so the door and the seam agree — where measured, the door
 * already refused those shapes elsewhere (its dotted-path rule, the engine's
 * filter doors), and now the family's own refusal answers them first:
 *
 * - **A cross-field comparand is a read.** `{ name: { $eq: { $field: 'metadata' } } }`
 *   compares each row's `name` with its stored body, and the SQL drivers
 *   evaluate it: row presence discloses the referenced column exactly as a
 *   filter on it would. Every node under a field key that carries a string
 *   `$field` — an operator bag, a list member, an `addDays` offset — is a read
 *   of that column: the reference shape `driver-sql` resolves (the spec's
 *   `FieldReferenceSchema`), taken without its other refinements, so a
 *   malformed reference is refused here rather than read.
 * - **Depth never hides a read.** The walk is iterative and visits every node
 *   once per reading, so it terminates on a self-referential live object
 *   without a depth backstop: the ingress collector's backstop stops at 32
 *   levels, and a body predicate nested below it was evaluated unrefused.
 * - **A dotted name reads its head.** `metadata.x` reads `metadata`, as a
 *   key and as a reference.
 * - **A `$` key is never a column, and what sits beneath one is read as a
 *   condition** — the three declared combinators and any other alike, so an
 *   unrecognised combinator cannot hide a family column (the engine refuses
 *   one anyway; the refusal just arrives first).
 * - **A field key's value is read for references only.** The keys of a
 *   nested-relation condition (`{ owner: { region: 'NA' } }`) are another
 *   object's columns; a `$field` beneath one is still collected, so the
 *   ambiguous spelling is refused rather than resolved.
 * - **A `FilterArray` is lowered first** (`parseFilterAST`), the sugar a direct
 *   engine call still honours on `where`, so either authoring form reads the
 *   same.
 *
 * Each column is returned once.
 */
export function collectStoredMetadataFilterFields(object: string, query: unknown): string[] {
    if (!isStoredMetadataBodyObject(object)) return [];
    if (query === null || typeof query !== 'object' || Array.isArray(query)) return [];
    const bag = query as Record<string, unknown>;
    const filters: unknown[] = [bag.where, bag.filter];
    if (Array.isArray(bag.aggregations)) {
        for (const aggregation of bag.aggregations) {
            if (aggregation !== null && typeof aggregation === 'object') {
                filters.push((aggregation as { filter?: unknown }).filter);
            }
        }
    }
    const out = new Set<string>();
    for (const filter of filters) collectFilterReads(isFilterAST(filter) ? parseFilterAST(filter) : filter, out);
    return [...out];
}

/** The head segment of a column name: `metadata.x` reads `metadata`. */
function headSegment(name: string): string {
    return name.split('.')[0] as string;
}

/**
 * The walk {@link collectStoredMetadataFilterFields} runs over one filter
 * condition. A node is visited as a CONDITION (its non-`$` keys are columns)
 * or as a COMPARAND (the value under a column key, where only a `$field`
 * reference is a read), at most once per reading — two readings, because a
 * live object reached once as a comparand and once as a condition must be read
 * both ways.
 */
export function collectFilterReads(root: unknown, out: Set<string>): void {
    const seenAsCondition = new WeakSet<object>();
    const seenAsComparand = new WeakSet<object>();
    const pending: Array<{ node: unknown; condition: boolean }> = [{ node: root, condition: true }];
    while (pending.length > 0) {
        const { node, condition } = pending.pop() as { node: unknown; condition: boolean };
        if (node === null || typeof node !== 'object') continue;
        const seen = condition ? seenAsCondition : seenAsComparand;
        if (seen.has(node)) continue;
        seen.add(node);
        if (Array.isArray(node)) {
            for (const member of node) pending.push({ node: member, condition });
            continue;
        }
        const record = node as Record<string, unknown>;
        if (!condition && typeof record.$field === 'string') out.add(headSegment(record.$field));
        for (const [key, value] of Object.entries(record)) {
            if (condition && !key.startsWith('$')) {
                out.add(headSegment(key));
                pending.push({ node: value, condition: false });
            } else {
                pending.push({ node: value, condition });
            }
        }
    }
}

/**
 * The slice of an object definition {@link narrowStoredMetadataSearch} reads:
 * the field map, the declared `searchableFields`, and the display field the
 * search resolution falls back on.
 */
export interface StoredMetadataSearchSchema {
    fields?: unknown;
    searchableFields?: unknown;
    nameField?: unknown;
    displayNameField?: unknown;
}

/**
 * [#21207, #21544] A `search` on a stored-metadata table never scans its body or
 * content-hash columns — the ONE narrowing the generic data door and the
 * in-process reader-context seam (`@objectstack/runtime`) both call, so a
 * search answers the same through either.
 *
 * A search is a substring filter the engine evaluates over every column it
 * scans, and with no `searchableFields` declared it scans every text-like
 * column — the stored body and both stored hashes among them. Over those it is
 * the verifier the filter refusals close: a guessed hash, or a guessed prefix
 * of withheld credential material, returns the row exactly when it is right.
 * The authority on which columns a search may never scan is the family's
 * search predicate ({@link storedMetadataSearchRefusal}), asked per field:
 *
 * - an EXPLICIT field list — `searchFields`, else the object-form
 *   `search.fields`, the engine's own precedence and both its shapes (a comma
 *   string or an array) — naming one is refused, `INVALID_FIELD` / 400, the
 *   evaluate refusals' envelope, under the caller's wire spelling of the slot
 *   (`wireSpelling`, the door's; the bare canonical name when absent);
 * - [#28120] an explicit list that names NO field — an empty array, a blank or
 *   comma-only string, an array with no string entry — is not "names none": it
 *   is passed through untouched, for the engine's own refusal to answer
 *   (`400 VALIDATION_ERROR` for an empty one, #27732; `400 INVALID_FIELD` for
 *   one naming no searchable field). Narrowing it here wrote a non-empty set
 *   back over the caller's list, so an override the door and the engine both
 *   refuse was served. The door never reaches this with one: its ingress gate
 *   refuses it first;
 * - a search that names none is NARROWED: the object's resolved searchable set
 *   ({@link resolveSearchFieldResolution}) minus those columns is returned, for
 *   the caller to run as `searchFields` — the engine intersects an override
 *   with that set and never widens it;
 * - a set that narrows to nothing is refused rather than returned empty: an
 *   empty override is refused by the engine as one naming no field, a
 *   caller's mistake this caller did not make, so the family's own refusal
 *   names the cause instead.
 *
 * Returns `undefined` when the query runs as it is — an object outside the
 * family, no search, an explicit list that passes or names no field, or no
 * readable field map (the engine has none to expand a search over either; the
 * same rule the door's field gates apply: a non-object, array or empty
 * `fields`). Throws the refusal.
 */
export function narrowStoredMetadataSearch(
    object: string,
    query: Readonly<Record<string, unknown>>,
    schema: StoredMetadataSearchSchema | null | undefined,
    wireSpelling: Readonly<{ search?: string; searchFields?: string }> = {},
): string[] | undefined {
    if (!isStoredMetadataBodyObject(object)) return undefined;
    const search = query.search;
    const objectForm = search !== null && typeof search === 'object';
    const objectFormFields = objectForm ? (search as Record<string, unknown>).fields : undefined;
    const [explicit, param] = query.searchFields != null
        ? [query.searchFields, wireSpelling.searchFields ?? 'searchFields']
        : objectFormFields != null
            ? [objectFormFields, wireSpelling.search ?? 'search']
            : [undefined, ''];
    const names: string[] = typeof explicit === 'string'
        ? explicit.split(',').map((s) => s.trim()).filter(Boolean)
        : Array.isArray(explicit) ? explicit.filter((f: unknown): f is string => typeof f === 'string') : [];
    if (names.length > 0) {
        const refusal = storedMetadataSearchRefusal(object, names, param);
        if (refusal) throw refusal;
        return undefined;
    }
    // [#28120] A list naming no field is the engine's to refuse, never narrowed.
    if (typeof explicit === 'string' || Array.isArray(explicit)) return undefined;
    if (search == null) return undefined;
    const fields = schema?.fields;
    if (!fields || typeof fields !== 'object' || Array.isArray(fields) || Object.keys(fields).length === 0) {
        return undefined;
    }
    const { allowed } = resolveSearchFieldResolution({
        fields: fields as Record<string, SearchFieldMeta>,
        searchableFields: schema?.searchableFields as string[] | undefined,
        displayField: (schema?.nameField ?? schema?.displayNameField) as string | undefined,
    });
    const searchParam = wireSpelling.search ?? 'search';
    const narrowed = allowed.filter((field) => !storedMetadataSearchRefusal(object, [field], searchParam));
    if (narrowed.length === 0) {
        const refusal = storedMetadataSearchRefusal(object, allowed, searchParam);
        if (refusal) throw refusal;
        return undefined;
    }
    return narrowed;
}

// Shared with `protocol.ts` and the sibling preamble modules; module-private before the move.
export { RESERVED_LIST_QUERY_PARAMS, assertQueryParamArity, conflictingQueryParamsError, countFlagValue, normalizeSortNodes, pageWindowValue, projectionFieldsValue, unusableFilterError };
