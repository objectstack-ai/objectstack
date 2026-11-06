// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#29985 codemod] The "Data CRUD" facet of
 * `ObjectStackProtocolImplementation`: the bodies of `findData`, `getData`,
 * `cloneData`, `probeRecord` moved out of `protocol.ts` whole by
 * `scripts/codemod-split-protocol.mjs`.
 *
 * A MOVE, not a redesign. `ProtocolDataCrudFacet` is a stateless facet over the host
 * (ruling 6624345766): each static method below is the body of the class
 * member of the same name as `packages/metadata-protocol/scripts/host-split.mjs`
 * moves one (ruling E, item E1), with `this.<member>` read as `host.<member>`
 * and nothing else changed. The facet holds no state: the fields stay on the
 * class, and a body reaches them through the host (`protocol-host.ts`).
 *
 * The class keeps every member as a one-line delegation. A public member
 * keeps its docblock there, which the published `.d.ts` prints; a private
 * member's docblock moved here with its body (docblock ownership).
 *
 * What a body reads from elsewhere, it imports from where `protocol.ts`
 * imports it. Nothing re-exports this module, so the published surface does
 * not move.
 */

import { recordNotFoundError } from '@objectstack/core';
import { staleSummaryRefusalOrThrow, withEarnedAnswer } from '@objectstack/types';
import type { SummaryRecomputeRefusal } from '@objectstack/types';
import { omitInternalFieldsFromWriteResponse } from './write-response-internal-fields.js';
import type { DroppedFieldsEvent, EngineQueryOptions, ValidationAdvisoryEvent } from '@objectstack/spec/data';
import {
    redactStoredMetadataRow,
    redactStoredMetadataRows,
    serveStoredMetadataHashColumnRows,
    serveStoredMetadataHashColumns,
    storedMetadataBodyGroupingRefusal,
    storedMetadataBodyPredicateRefusal,
    storedMetadataBodyProjection,
    storedMetadataHashEvaluateRefusal,
} from './metadata-redaction.js';
import { CLONE_STRIP_FIELDS } from './protocol-write-constants.js';
import { projectionFieldsValue } from './protocol-list-query-params.js';
import { assertQueryReadRows, planQueryReadWindow, resolveQueryReadLimits } from '@objectstack/types';
import {
    QUERY_TRANSPORT_ALIAS_SLOTS,
    QUERY_TRANSPORT_DOLLAR_ALIASES,
    QUERY_TRANSPORT_DOLLAR_PARAMS,
    foldQueryAliasSlots,
    isFilterAST,
    parseFilterAST,
} from '@objectstack/spec/data';
import type { EngineAggregateOptions, EngineCountOptions } from '@objectstack/spec/data';
import { malformedFilterArrayError } from './protocol-data-request-shapes.js';
import {
    RESERVED_LIST_QUERY_PARAMS,
    assertQueryParamArity,
    collectStoredMetadataFilterFields,
    conflictingQueryParamsError,
    countFlagValue,
    narrowStoredMetadataSearch,
    normalizeSortNodes,
    pageWindowValue,
    unusableFilterError,
} from './protocol-list-query-params.js';
import type { ProtocolHost } from './protocol-host.js';

export class ProtocolDataCrudFacet {
    /** The body of `ObjectStackProtocolImplementation#findData`; the method's docblock there is its contract. */
    static async findData(host: Pick<ProtocolHost, 'assertAggregationFieldsExist' | 'assertExpandTargetsExist' | 'assertFilterFieldsExist' | 'assertGroupByFieldsExist' | 'assertNoInternalFieldEvaluated' | 'assertObjectRegistered' | 'assertProjectionFieldsExist' | 'assertQueryParamsAreFields' | 'assertSearchFieldsAreSearchable' | 'assertSortFieldsExist' | 'engine' | 'servedExpand' | 'storedHashDigest'>, request: { object: string, query?: any, context?: any }): Promise<{
            hasMore: boolean;
            total?: number | undefined;
            object: string;
            records: any[];
        }> {
        // [#3770] Existence first: an unregistered object is a 404 before any
        // query parameter is even parsed, so an unknown name can never be
        // probed for query-shape validity (nor reach the driver as a table).
        host.assertObjectRegistered(request.object);
        const options: any = { ...request.query };
        // The execution context is SERVER-DERIVED and never caller input.
        //
        // `request.query` is the raw request bag on every ingress that reaches
        // here — the REST `POST /data/:object/query` route hands `req.body`
        // straight in as `query`. `context` is in the known-params set below, so
        // it was not swept into the implicit-filter bucket either: a caller's
        // `context` survived this spread and, because the assignment below is
        // conditional, became the operation's execution context whenever no
        // server context resolved (before #3963 an anonymous request on a
        // `requireAuth: false` deployment; the invariant holds regardless).
        //
        // What rides on it is total: plugin-security's middleware opens with
        // `if (opCtx.context?.isSystem) return next()` — the entire RLS / FLS /
        // CRUD chain skipped — and `__expandRead` marks a read as an expansion
        // sub-read (#2850; it waived the object-level CRUD gate for "public"
        // objects until #7626 removed that). Neither is ever schema-stripped on
        // this path: `ExecutionContextSchema.parse` runs only in
        // `engine.createContext`, which the read path does not use.
        //
        // Route-level `enforceAuth` is what kept that from being reachable, so
        // this was a fail-OPEN default one layer down. Drop any inbound
        // `context` unconditionally: the protocol must not depend on a gate
        // above it staying switched on.
        delete options.context;

        // [#7321] Arity BEFORE any read, fold or coercion. `IHttpRequest.query`
        // is `Record< string, string | string[] >`; the array arm is real (the
        // `node:http` adapter hands `?x=1&x=2` through as `['1','2']`, measured
        // over a socket on #6878), and every coercion below was written for the
        // string arm. `Number(['1','2'])` is `NaN`, so `?$top=1&$top=2` used to
        // reach the driver as `limit: NaN` — a wrong answer served as a 200.
        //
        // Single-vs-multi is a PER-PARAMETER judgement, never a sweep: `$select`
        // / `$expand` / `$searchFields` / `$orderby` accept the array arm on
        // purpose and are untouched here. See
        // {@link ARRAY_VALUED_QUERY_SLOTS} for the full disposition.
        assertQueryParamArity(options);

        // Forward the dispatcher's ExecutionContext so RBAC/RLS middleware
        // can apply per-request enforcement. The protocol layer is purely
        // a normalizer — it must never strip security context.
        if (request.context !== undefined) {
            options.context = request.context;
        }

        // ====================================================================
        // Normalize legacy params → QueryAST standard (where/fields/orderBy/offset/expand)
        // ====================================================================

        // OData-style `$`-prefixed params → bare aliases that the rest of
        // this function knows how to normalize. Without this step, params
        // like `?$top=2&$orderby=...` survive into the catch-all
        // implicit-filter pass below and get merged into `where` as
        // bogus field-equality predicates (e.g. `where.$top = "2"`),
        // which silently returns zero rows for every list endpoint.
        //
        // [#4226] `wireSpelling` remembers which alias each rewritten slot
        // arrived under, so a rejection quotes the parameter the caller
        // actually wrote. Telling someone who sent `?$orderby=…` that
        // "'orderBy' is invalid" names a parameter absent from their request.
        //
        // [#7321] The table itself now lives at module scope
        // ({@link QUERY_TRANSPORT_DOLLAR_ALIASES}) so the arity survey above and this fold
        // cannot drift apart on which `$` spellings exist.
        const wireSpelling: Record<string, string> = {};
        for (const [dollar, bare] of QUERY_TRANSPORT_DOLLAR_ALIASES) {
            if (options[dollar] != null && options[bare] == null) {
                options[bare] = options[dollar];
                wireSpelling[bare] = dollar;
            }
            delete options[dollar];
        }

        // [#3795] One slot, one value. Every alias spelling of the six
        // QueryAST slots resolves HERE, by the spec's own table, before the
        // per-slot wire coercion below ever runs — so that coercion reads
        // canonical keys only. An alias alone folds into its canonical key;
        // redundant identical spellings collapse; different values for one
        // slot are refused (the #4181 rule, generalized from the filter slot
        // to all of them — four used to resolve BACKWARDS here, each in its
        // own way, disagreeing with the spec's documented precedence and with
        // the runtime dispatcher's copy of the same fold; `top`→`limit`
        // joined the table last, via #4346).
        //
        // `arrivedAs` remembers which spelling carried each slot's value;
        // composed with `wireSpelling` it names the parameter the caller
        // actually wrote in every rejection below (#4226).
        const spellingFor = (name: string): string => wireSpelling[name] ?? name;
        const arrivedAs = foldQueryAliasSlots(options, QUERY_TRANSPORT_ALIAS_SLOTS, (conflict) => {
            throw conflictingQueryParamsError(conflict, spellingFor);
        });
        const slotParam = (canonical: string): string => spellingFor(arrivedAs[canonical] ?? canonical);

        // Numeric fields — coerce querystring strings. `top` already folded
        // into `limit` above: the pair joined the #3795 slot table with #4346,
        // replacing an open-coded rewrite here that resolved it BACKWARDS
        // (`options.limit = Number(options.top)` — the alias overwrote the
        // canonical key, so `{top: 1, limit: 3}` answered 1 over HTTP and 3
        // through a direct engine call).
        //
        // [#25229] The coercion is CHECKED, not bare (see
        // {@link pageWindowValue}). This is the one statement every list door
        // reaches with the window still unvalidated — `GET /data/:object`'s
        // querystring, `POST /data/:object/query`'s body (whose schema checks
        // the type, not the sign) and the runtime dispatcher — so the refusal
        // lives here, once.
        if (options.limit != null) options.limit = pageWindowValue(options.limit, slotParam('limit'));
        if (options.offset != null) options.offset = pageWindowValue(options.offset, slotParam('offset'));

        // Projection: comma-separated string → array. A single-value
        // querystring param arrives as a bare string — `?fields=name` or the
        // folded `?select=` / `$select` spellings — which drivers' `.map()`
        // calls over `query.fields` would otherwise throw on.
        //
        // [#26644] …and a value naming no field is refused rather than becoming
        // `[]`, which every driver serves as no projection at all (see
        // {@link projectionFieldsValue}).
        const projectionKey = slotParam('fields');
        if (typeof options.fields === 'string' || Array.isArray(options.fields)) {
            options.fields = projectionFieldsValue(options.fields, projectionKey);
        } else if (options.fields !== undefined) {
            delete options.fields;
        }
        // [#4226] Unknown projection columns are refused rather than dropped —
        // see `assertProjectionFieldsExist` for why this axis' silent failure
        // returned MORE than was asked for.
        host.assertProjectionFieldsExist(request.object, options.fields, projectionKey);

        // Sort: every wire shape → SortNode[].
        //
        // [#4226] `normalizeSortNodes` folds the two shapes that used to fall
        // through this block untouched — `string[]` and `{field: direction}` —
        // and refuses the ones it cannot read. Before it, "not a string and not
        // an array" simply skipped the branch, leaving a value on `orderBy`
        // that `SqlDriver`'s `Array.isArray` guard then declined to turn into
        // an ORDER BY clause: no sort, no error, no way to tell.
        const sortValue = options.orderBy;
        const sortKey = slotParam('orderBy');
        if (sortValue === undefined || sortValue === null) {
            // Nothing to sort by — and an explicit `orderBy: null` must not ride
            // to the engine as a value every driver quietly declines to read.
            delete options.orderBy;
        } else {
            const orderBy = normalizeSortNodes(sortValue, sortKey);
            // [#4226] Validated on the NORMALIZED nodes, so one gate covers
            // every spelling — `?sort=no_such`, `['-no_such']`, `{no_such:
            // 'desc'}` and `[{field:'no_such'}]` are one mistake with one
            // answer. Assigned only after it passes, so a rejected sort cannot
            // leave a half-applied one behind.
            host.assertSortFieldsExist(request.object, orderBy, sortKey);
            if (orderBy.length > 0) options.orderBy = orderBy;
            else delete options.orderBy;
        }

        // Filter: the folded slot value → a usable `FilterCondition` on
        // `where`, or a rejection. The four spellings of this slot
        // (`where`/`filter`/`filters`/`$filter`) already resolved through the
        // #3795 fold above — #4181's one-slot-one-value rule, which this block
        // pioneered before the fold generalized it.
        const filterKey = slotParam('where');

        if (options.where !== undefined) {
            let parsedFilter = options.where;
            // A blank `?filter=` is ABSENT, not malformed — the same `length > 0`
            // guard the export route applies before parsing. Deleting `where`
            // here (rather than leaving `''` on it) is what lets every consumer
            // below test presence with a plain falsy check.
            if (typeof parsedFilter === 'string' && parsedFilter.trim() === '') {
                delete options.where;
            } else {
                // [#4181] JSON string → object. Parse failure is a REJECTION, not
                // a fallback. The `catch { /* keep as-is */ }` this replaces left
                // the raw string on `where`, a shape no driver consumes — so the
                // filter was dropped whole and `?filter={status:done` (one missing
                // quote) answered 200 with the UNFILTERED page. Worst member of
                // the #3948 family: #4134 zeroed, #4164 dropped one predicate,
                // this returned everything.
                //
                // The sibling `GET /data/:object/export` route has rejected this
                // exact input since it was written (`400 INVALID_REQUEST`,
                // "filter must be JSON"); the list path was the outlier. The
                // guard lives HERE, in the shared normalizer, so `GET
                // /data/:object`, `POST /data/:object/query` and the runtime
                // dispatcher all inherit one answer instead of three.
                if (typeof parsedFilter === 'string') {
                    try {
                        parsedFilter = JSON.parse(parsedFilter);
                    } catch {
                        throw unusableFilterError(filterKey, 'must be valid JSON');
                    }
                }
                // Filter AST array → FilterCondition object
                if (isFilterAST(parsedFilter)) {
                    parsedFilter = parseFilterAST(parsedFilter);
                } else if (Array.isArray(parsedFilter) && parsedFilter.length > 0) {
                    // [#4121] `isFilterAST` was being read as a *conversion* gate,
                    // so an array it refused was assigned to `where` unconverted —
                    // an opaque value the driver then had to make sense of. Every
                    // driver now fails on it, so this is not a narrowing; it moves
                    // the failure to where the malformed filter actually arrived,
                    // with the request's own vocabulary in the message instead of a
                    // driver-internal one.
                    //
                    // It also closes what the driver-side fix could not: a lone
                    // `['and']` / `['or']` sets the join mode, matches no element,
                    // and emits NO predicate — the last shape that still returned
                    // every row silently after #3948. An empty `[]` is left alone:
                    // it means "no filter", and every path already treats it that
                    // way — so it falls through to the shape check below, which
                    // passes it (an array IS an object).
                    throw malformedFilterArrayError(parsedFilter);
                }
                // [#4181] Parsed-but-unusable is the same failure one step later:
                // `?filter=5` / `?filter="open"` / `?filter=null` all yield a
                // non-object `where` that no driver reads. #4121 above catches the
                // array shapes; this catches the scalar ones, and together they are
                // what lets the #4164 merge below trust `where` to be an object.
                if (parsedFilter === null || typeof parsedFilter !== 'object') {
                    throw unusableFilterError(
                        filterKey,
                        `must be a filter object or condition array, received ${parsedFilter === null ? 'null' : typeof parsedFilter}`,
                    );
                }
                options.where = parsedFilter;
            }
        }

        // Expand: the folded slot value → `Record<string, QueryAST>`. A comma
        // list (string) and a name array both lower to `{name: {object: name}}`;
        // the advanced `{rel: QueryAST}` map a caller may send directly on
        // `POST /data/:object/query` passes through as-is. Lowering the ARRAY
        // shape here (not just the string) also closes a pre-#3795 gap: a raw
        // name array used to survive this block whole, so the #4226 gate read
        // its INDICES as relation names and refused real requests with
        // "Unknown field '0'".
        const expandValue = options.expand;
        const expandNames: string[] = [];
        if (typeof expandValue === 'string') {
            expandNames.push(...expandValue.split(',').map((s: string) => s.trim()).filter(Boolean));
        } else if (Array.isArray(expandValue)) {
            expandNames.push(...expandValue);
        }
        if (typeof options.expand !== 'object' || options.expand === null || Array.isArray(options.expand)) {
            delete options.expand;
        }
        if (expandNames.length > 0 && !options.expand) {
            options.expand = {} as Record<string, any>;
            for (const rel of expandNames) {
                options.expand[rel] = { object: rel };
            }
        }
        // [#4226] Both routes into `expand` are gated: the comma-list spellings
        // collected above, and the advanced `{rel: QueryAST}` map a caller may
        // send directly on `POST /data/:object/query`. Validating the map's KEYS
        // rather than `expandNames` is what covers the second one.
        if (options.expand && typeof options.expand === 'object') {
            host.assertExpandTargetsExist(request.object, Object.keys(options.expand));
            // [#22661] …then every level's TARGET is asked its declared exposure,
            // and an entry the decision does not serve is withheld (the field
            // answers as an unexpanded lookup) — see {@link servedExpand}. Ahead
            // of the `internal: true` walk below, so nothing about a withheld
            // target is judged, named or read.
            options.expand = host.servedExpand(request.object, options.expand, 0);
            if (Object.keys(options.expand).length === 0) delete options.expand;
        }

        // [#4254] The `searchFields` override is validated on the value the
        // ENGINE will read — the standalone parameter when present, otherwise
        // the object-form `search: { query, fields }` a `POST` body may carry
        // (same precedence as the engine's own `searchFields ?? search.fields`,
        // and the same shapes: the engine accepts the comma-string and array
        // forms from either slot). Checked whether or not a `search` term rode
        // along: the caller named fields either way, and a stale override is
        // the same typo before the search that will eventually use it is added.
        if (options.searchFields != null) {
            host.assertSearchFieldsAreSearchable(
                request.object, options.searchFields, wireSpelling.searchFields ?? 'searchFields',
            );
        } else if (options.search !== null && typeof options.search === 'object'
            && (options.search as any)?.fields != null) {
            host.assertSearchFieldsAreSearchable(
                request.object, (options.search as any).fields, wireSpelling.search ?? 'search',
            );
        }
        // [#21207] …and on a stored-metadata table a search never scans the body
        // or content-hash columns: refused when named, narrowed away otherwise.
        // Runs after the searchability gate above, so a name that is not
        // searchable at all keeps its own answer. [#21544] The ONE narrowing,
        // a module function the in-process reader-context seam calls too.
        const narrowedSearchFields = narrowStoredMetadataSearch(
            request.object, options, host.engine?.registry?.getObject?.(request.object), wireSpelling,
        );
        if (narrowedSearchFields) options.searchFields = narrowedSearchFields;

        // Boolean fields. [#26644] `count` is CHECKED, not merely lowered: a
        // value that is neither true nor false is refused rather than left to
        // read as "count anyway" below (see {@link countFlagValue}).
        if (options.distinct === 'true') options.distinct = true;
        else if (options.distinct === 'false') options.distinct = false;
        if (options.count != null) options.count = countFlagValue(options.count, slotParam('count'));

        // [#2926 ⑩] Every supported OData-style `$` alias has been consumed and
        // deleted above ($top/$skip/$orderby/$select/$count/$search/
        // $searchFields/$filter/$expand). A `$`-prefixed key can never be a
        // field name, so anything left is an unsupported query parameter —
        // fail loudly instead of letting it fall into the implicit-filter
        // bucket below, where it silently matched zero rows (or, before the
        // $filter alias existed, was dropped entirely and returned the
        // UNFILTERED page — a footgun for scripts resolving ids by name).
        const unsupportedDollarParams = Object.keys(options).filter((k) => k.startsWith('$'));
        if (unsupportedDollarParams.length > 0) {
            // [#16066] The supported set is QUOTED from the declaration, never
            // re-typed here: a spelling added to the spec table used to leave
            // this sentence naming a set the door no longer had, so the caller
            // was told to use a parameter list that was already wrong.
            const err: any = new Error(
                `Unsupported query parameter(s): ${unsupportedDollarParams.join(', ')}. ` +
                `Supported $-prefixed parameters: ${QUERY_TRANSPORT_DOLLAR_PARAMS.join(', ')}.`,
            );
            err.status = 400;
            err.code = 'UNSUPPORTED_QUERY_PARAM';
            throw err;
        }

        // [#4134] A leftover key is about to be lowered into a field-equality
        // predicate (or, when an explicit `where` won, dropped on the floor).
        // Both readings are only sound if the key names a REAL field: a filter
        // on a field that does not exist can never match, so `?pageSize=5`
        // returned 200 + `total: 0` — indistinguishable from "no data". The
        // write path already rejects the same input loudly (`INVALID_FIELD`);
        // this is the read half of that one piece of knowledge, and the mirror
        // of #3948's rule for driver-memory: an unapplied filter must not look
        // like a satisfied one.
        //
        // Validated BEFORE the `!options.where` branch below, so a bad param is
        // a 400 whether or not the caller also sent an explicit filter — the
        // failure must not depend on which other params rode along.
        const leftoverParams = Object.keys(options).filter((k) => !RESERVED_LIST_QUERY_PARAMS.has(k));
        if (leftoverParams.length > 0) {
            host.assertQueryParamsAreFields(request.object, leftoverParams);
        }

        // [#7534] The same question, on the EXPLICIT filter the caller wrote —
        // the sibling door #4134's fix never reached. `options.where` is a
        // lowered `FilterCondition` by this point whichever of the three doors
        // carried it (`where` object, `$filter` string, filter AST), so one call
        // covers all three. Placed here, and not earlier, on purpose: see
        // `assertFilterFieldsExist` for why it runs after the param gate above
        // and before the #4164 merge below.
        host.assertFilterFieldsExist(request.object, options.where, filterKey);

        // Flat field filters: REST-style query params like ?id=abc&status=open
        // are implicit field-level equality predicates. Every leftover key is a
        // verified field name by this point — the #4134 gate above runs FIRST,
        // which is exactly what makes the merge below safe: an unknown name
        // already 400'd, so nothing merged here can be a predicate that matches
        // nothing.
        //
        // [#4164] Implicit predicates now COMPOSE with an explicit `where`
        // instead of being silently dropped. `?filter={...}&status=open` means
        // what it says — both apply, `{ $and: [explicit, implicit] }` — the
        // same composition the engine itself uses to fold the `$search`
        // predicate or an expand's declared filter into an existing `where`,
        // and a combinator the #3774 conformance suite pins across every
        // FilterCondition backend. Contradictory sides need no special case:
        // both predicates apply and the intersection is an HONEST zero (the
        // filters ran), unlike the pre-#4134 zero (a filter that never ran).
        // Consuming the keys here also stops them riding to `engine.find` as
        // stray top-level AST junk, and count() below reads the same
        // `options.where`, so pagination totals see the merged predicate too.
        //
        // #4164 shipped with a `typeof explicitWhere === 'object'` guard here,
        // because the parse tolerance above could leave a raw unparseable string
        // on `where` and folding real predicates into that garbage would neither
        // apply them nor surface the bug. #4181 fixed that at the source — a
        // filter now either parses to an object or 400s — so `where` is an
        // object or absent by construction and the guard is gone with it.
        const explicitWhere = options.where;
        if (leftoverParams.length > 0) {
            const implicitFilters: Record<string, unknown> = {};
            for (const key of leftoverParams) {
                implicitFilters[key] = options[key];
                delete options[key];
            }
            // An absent or empty explicit filter (`?filter={}`, `?filter=`) is
            // vacuous — the implicit predicates stand alone rather than being
            // wrapped in a one-armed `$and`.
            options.where = !explicitWhere || Object.keys(explicitWhere).length === 0
                ? implicitFilters
                : { $and: [explicitWhere, implicitFilters] };
        }

        // [#4254] The aggregation axes name fields too, and were the last
        // read-path axes that answered a wrong name with a plausible result
        // (one null-keyed bucket; sum = 0). Validated before the routing
        // below so an unreadable SHAPE cannot slip past the `Array.isArray`
        // routing guard and ride to `engine.find` as ignored AST junk —
        // rows returned ungrouped, looking exactly like a served query.
        host.assertGroupByFieldsExist(request.object, options.groupBy);
        host.assertAggregationFieldsExist(request.object, options.aggregations);
        // [#25819] An aggregate axis sent as an EMPTY list, with no non-empty
        // axis beside it, asks for an aggregate of nothing. The routing below
        // reads it as no aggregate and handed the key to `engine.find`, which
        // refuses an option it does not execute with an uncoded error whose
        // words carry the quoted object name — read at the REST door as the
        // unknown-object heuristic: `404 OBJECT_NOT_FOUND`, "Object '…' is not
        // registered", for a registered object. No shipped caller sends `[]`
        // meaning the plain rows, so it is refused for what it is. An empty
        // list beside a non-empty one is served as before (`groupBy` with
        // `aggregations: []` lists the groups).
        {
            const emptyAxes = (['groupBy', 'aggregations'] as const)
                .filter((k) => Array.isArray(options[k]) && options[k].length === 0);
            const servedAxis = (['groupBy', 'aggregations'] as const)
                .some((k) => Array.isArray(options[k]) && options[k].length > 0);
            if (emptyAxes.length > 0 && !servedAxis) {
                const named = emptyAxes.map((k) => `'query.${k}'`).join(' and ');
                const err: any = new Error(
                    `${named} ${emptyAxes.length > 1 ? 'are empty lists' : 'is an empty list'} on object `
                    + `'${request.object}': an aggregate query names at least one aggregation, or a non-empty `
                    + `'groupBy' to list its groups. The query was NOT run. Send e.g. { "aggregations": `
                    + `[{ "function": "count", "alias": "n" }] }, or omit ${emptyAxes.map((k) => `'${k}'`).join(' and ')} `
                    + 'for the plain rows.',
                );
                err.status = 400;
                err.code = 'INVALID_QUERY';
                err.param = emptyAxes[emptyAxes.length - 1];
                err.object = request.object;
                throw err;
            }
        }
        // [#21086] A stored metadata body is served only as its type's read
        // projection (see `redactStoredMetadataRows` below), and a GROUP KEY
        // cannot be projected — so grouping by the body column of a
        // stored-metadata table is refused, after the existence gates so an
        // unknown name keeps its own answer.
        const bodyGroupingRefusal = storedMetadataBodyGroupingRefusal(request.object, options.groupBy);
        if (bodyGroupingRefusal) throw bodyGroupingRefusal;
        // [#21120] …and the FILTER / SORT half of the same family (maintainer
        // ruling A): a predicate or an order key on the stored body column
        // evaluates the body — a filter oracle that rebuilds a withheld
        // credential by probing, or an order over the same bytes — so it is
        // refused here, in the same shape as the grouping refusal, before the
        // engine is asked. [#21544] The columns a filter READS are collected by
        // the family's ONE collector, which the reader-context seam calls too:
        // every key's head AND every cross-field `{ $field }` comparand, at any
        // depth, in `where` and each `aggregations[i].filter` — so a filter that
        // reads the body or a hash without naming it as a key (a comparand), or
        // names it below the ingress collector's depth backstop, is refused like
        // a direct one. `[]` outside the family.
        const filterFields = collectStoredMetadataFilterFields(request.object, options);
        const sortFields = Array.isArray(options.orderBy)
            ? (options.orderBy as ReadonlyArray<{ field?: unknown }>).map((e) => e?.field)
            : [];
        const bodyPredicateRefusal = storedMetadataBodyPredicateRefusal(request.object, { filterFields, sortFields });
        if (bodyPredicateRefusal) throw bodyPredicateRefusal;
        // [#21207] The same three shapes on the stored CONTENT-HASH columns
        // (maintainer ruling A on the second execution fork): a group key would
        // serve the stored hash, a filter on it is an online verifier, a sort
        // orders by it. Refused in the body column's envelope, before the engine.
        const hashEvaluateRefusal = storedMetadataHashEvaluateRefusal(request.object, {
            groupBy: options.groupBy,
            filterFields,
            sortFields,
        });
        if (hashEvaluateRefusal) throw hashEvaluateRefusal;

        // [#22646] A field declared `internal: true` is withheld from every
        // generic exit (#21197) — the engine omits it from every row. The
        // EVALUATE positions do not follow that by omission: a filter, sort,
        // group-by, aggregate operand, per-aggregation filter or a one-level
        // expand's own filter/sort on such a column reveals the stored value by
        // evaluating it (a filter is a confirmation oracle, a sort leaks order).
        // So they are refused here, at the generic data door, after the
        // existence gates and before the engine — the same shape, envelope and
        // caller-independence as the stored-metadata body/hash family above.
        // Internal fields in a `$search` set are handled on their own axes: the
        // auto-default never scans one (engine), an explicit `$searchFields`
        // naming one is refused (the gate above, #4254 posture).
        host.assertNoInternalFieldEvaluated(request.object, options);

        // Route to engine.aggregate() when the query has GROUP BY / aggregations.
        // engine.find() does not do in-memory aggregation fallback, so without
        // this branch a spec-shape aggregate request would silently return
        // ungrouped raw rows on drivers (e.g. SqlDriver) that don't natively
        // honor groupBy/aggregations in find().
        const hasGroupBy = Array.isArray(options.groupBy) && options.groupBy.length > 0;
        const hasAggregations = Array.isArray(options.aggregations) && options.aggregations.length > 0;
        // The deployment's read limits (`OS_DATA_DEFAULT_PAGE_SIZE`,
        // `OS_DATA_MAX_PAGE_SIZE`, `OS_DATA_QUERY_ROW_BUDGET`; the rule is
        // `@objectstack/types`' `query-read-limits.ts`). Planned here, after
        // every shape gate and before the engine, so a refusal leaves the
        // driver unasked. All three unset returns the caller's own `limit`.
        const readLimits = resolveQueryReadLimits();
        if (hasGroupBy || hasAggregations) {
            // The grouped branch slices in memory and never reads `offset`, so
            // the window it is judged on is the groups it returns.
            const groupRead = {
                surface: 'list' as const,
                object: request.object,
                limit: typeof options.limit === 'number' ? options.limit : undefined,
                limitParam: slotParam('limit'),
            };
            const groupPlan = planQueryReadWindow(groupRead, readLimits, console);
            if (!groupPlan.probe) options.limit = groupPlan.limit;
            const aggregateQuery: EngineAggregateOptions = {
                where: options.where,
                groupBy: options.groupBy,
                aggregations: options.aggregations,
                // Enforced engine-side since #4286 (step 3) — dropping it here
                // was finding 1: the one wire path to aggregate() lost the
                // clause before any executor could ever see it.
                having: options.having,
                // ADR-0061 `search` is declared on the query beside `groupBy` /
                // `aggregations` with no carve-out, and the flat branch below
                // hands it to `engine.find`. Leaving it out of THIS bag answered
                // a grouped query under a search with the UNSEARCHED groups —
                // no error, no warning. The engine expands it through the same
                // expander `find` uses, so the header numbers are the grouping
                // of exactly the rows the flat query returns. `searchFields` was
                // validated above on both branches (#4254 gate).
                search: options.search,
                searchFields: options.searchFields,
                context: options.context,
            };
            const records = await host.engine.aggregate(request.object, aggregateQuery);
            assertQueryReadRows(groupRead, groupPlan, records.length, console);
            // Apply limit client-side (EngineAggregateOptions doesn't carry limit).
            // `records` is the full grouped set, so its length IS the real total
            // and `hasMore` follows from whether the slice dropped any groups.
            const limited = typeof options.limit === 'number' && options.limit > 0
                ? records.slice(0, options.limit)
                : records;
            return {
                object: request.object,
                records: limited,
                total: records.length,
                hasMore: limited.length < records.length,
            };
        }

        // [#4371 option 2] Strip the PROTOCOL-layer keys off the bag before it
        // becomes the engine option bag — the engine now rejects option keys
        // it does not execute, and these belong to this layer, not to it:
        // - `object`: the POST-body convenience copy of the route object
        //   (reserved above so it is not read as a field filter). It used to
        //   ride the spread into the engine AST and OVERRIDE the resolved
        //   object, splitting `ast.object` from the table actually queried —
        //   a mismatch is refused, never resolved by picking a winner.
        // - `count`: a response-shape flag this method consumed above (and,
        //   since #10757, one it actually HONOURS — see `countOptOut` below).
        // - QueryAST tombstones (`cursor`/`joins`/`windowFunctions`/
        //   `distinct`): reserved at the wire gate so they are not read as
        //   field filters; on the wire they stay ignored-with-tombstone-docs
        //   (schema parse is where they 400), and they must not leak to the
        //   engine as junk.
        // - `having`: consumed by the aggregate branch above; the find path
        //   cannot serve it.
        if (options.object != null && options.object !== request.object) {
            const err: any = new Error(
                `Conflicting object: the route addresses '${request.object}' but the query body ` +
                `says '${options.object}'. The body 'object' key is a convenience copy of the ` +
                'route object and must match it.',
            );
            err.status = 400;
            err.code = 'QUERY_OBJECT_MISMATCH';
            throw err;
        }
        // [#10757] `$count=false` — read the flag BEFORE the strip below deletes
        // it, because the strip is what kept it from ever being honoured: the
        // parameter has been declared (`ODataQuerySchema.$count`,
        // `packages/spec/src/api/odata.zod.ts`), aliased (`$count` → `count`,
        // {@link QUERY_TRANSPORT_DOLLAR_ALIASES}), reserved from the implicit-field-filter
        // bucket ({@link RESERVED_LIST_QUERY_PARAMS}), arity-checked and boolean-
        // coerced — and then deleted unread, so every list request paid for the
        // COUNT query below whether or not the caller wanted a `total`.
        //
        // Only an EXPLICIT `false` opts out. An absent `$count` keeps today's
        // behaviour (count runs, `total` is reported) rather than taking OData's
        // "absent means omit" reading: every existing caller sends nothing and
        // reads `total`, so the OData default would silently break all of them.
        // The parameter is therefore an opt-OUT here, and that asymmetry is
        // deliberate — see the changeset for the wording that ships to consumers.
        const countOptOut = options.count === false;
        for (const k of ['object', 'count', 'joins', 'windowFunctions', 'cursor', 'distinct', 'having']) {
            delete options[k];
        }
        // [#21086] The generic data door is a read exit for the stored metadata
        // body too: a `sys_metadata` / `sys_metadata_history` row's `metadata`
        // column is served as its type's read projection — the one `/meta`
        // serves — so a stored credential is withheld here exactly as there.
        // The row's `type` selects the redactor, so it is read even when the
        // projection named only the body, and taken back off before serving.
        const bodyProjection = storedMetadataBodyProjection(request.object, options.fields);
        if (bodyProjection.addedType) options.fields = bodyProjection.fields;
        // A list read with no `limit` takes the default page size, and its
        // answer says whether more rows exist (`hasMore` / `total` below). A
        // PROBE limit (a row budget with no page size) is the server's, not the
        // caller's: the answer is refused when it overruns, and otherwise it is
        // the whole set, so the probe is taken back off before the page
        // metadata below reads `limit`.
        const listRead = {
            surface: 'list' as const,
            object: request.object,
            limit: typeof options.limit === 'number' ? options.limit : undefined,
            offset: typeof options.offset === 'number' ? options.offset : undefined,
            limitParam: slotParam('limit'),
        };
        const listPlan = planQueryReadWindow(listRead, readLimits, console);
        if (listPlan.limit !== undefined) options.limit = listPlan.limit;
        // [#29764] The bag `engine.find` receives is typed as the engine declares
        // it. `options` is the caller's normalized request bag, and by this line
        // every key the normalizer does not hand on has been folded, deleted or
        // moved into `where`. What can still stand is the find set below, plus
        // `groupBy` / `aggregations` holding null at most (a non-empty one took
        // the aggregate branch above, an empty one was refused). The engine reads
        // a null option as absent, so leaving those two out changes nothing. Keys
        // are copied only when present, so the engine sees the same bag as before.
        const findQuery: EngineQueryOptions = {
            ...(options.context !== undefined ? { context: options.context } : {}),
            ...(options.where !== undefined ? { where: options.where } : {}),
            ...(options.fields !== undefined ? { fields: options.fields } : {}),
            ...(options.orderBy !== undefined ? { orderBy: options.orderBy } : {}),
            ...(options.limit !== undefined ? { limit: options.limit } : {}),
            ...(options.offset !== undefined ? { offset: options.offset } : {}),
            ...(options.search !== undefined ? { search: options.search } : {}),
            ...(options.searchFields !== undefined ? { searchFields: options.searchFields } : {}),
            ...(options.expand !== undefined ? { expand: options.expand } : {}),
        };
        // [#21207] …and its stored CONTENT HASH (`checksum`, `previous_checksum`)
        // is served in keyed form — never the stored value, which beside the
        // projected body confirms a guess at the withheld material offline —
        // under the provider's key, or the process-scoped ephemeral one.
        const found = await host.engine.find(request.object, findQuery);
        if (listPlan.probe) {
            assertQueryReadRows(listRead, listPlan, found.length, console);
            delete options.limit;
        }
        const records = await serveStoredMetadataHashColumnRows(
            request.object,
            redactStoredMetadataRows(
                request.object,
                found,
                { dropType: bodyProjection.addedType },
            ),
            host.storedHashDigest(),
        );
        // Pagination metadata. When a `limit` is present the response is a single
        // page, so `records.length` is the page size — NOT the match total. Run a
        // count over the same `where` so the client can render total pages and know
        // whether more pages remain (true server-side pagination). Without a limit
        // AND without an offset the full result set is returned, so its length
        // already IS the total.
        //
        // [#28547] An offset with no limit is a paged request too. The read
        // returns every match AFTER the offset, so `records.length` is the
        // match count MINUS the offset: `?$skip=3&$count=true` over 14 rows
        // answered `total: 11` while `?$skip=3&$top=100&$count=true` answered
        // 14, and an offset past the end answered `total: 0`. Adding the offset
        // back is not the fix (it says 999 for `offset: 999` over 14 rows), so
        // such a request takes the one count path below, `$count=false` arm
        // included: `total` is the filtered count whatever the offset.
        //
        // [#22790] The count takes the query's `search` / `searchFields` too: the
        // engine expands them through the one ADR-0061 expander `find` uses, so
        // `total` counts exactly the rows this query pages. A search used to skip
        // the count and report a page-local estimate (`offset + page + 1`) that
        // the Console rendered as the record count.
        //
        // [#22588] `limit: 0` IS a limit. It asks for no rows (objectstack#6485,
        // the drivers' pagination conformance), so `records.length` is 0 and was
        // reported as the total: `?$top=0` answered `total: 0` while `?$top=1`
        // answered the true count, and the Console's footer probe — which sends
        // exactly `$top: 0` to read the total and nothing else — showed `0` on
        // every list page. Gated `> 0`, a zero-row page fell into the "no limit,
        // the full set is the total" arm, which is true of every limit except
        // this one. So `>= 0`: a zero-row request is a paged request like any
        // other, and the three arms below keep their meaning for it — the count
        // runs (`total` is the filtered count, whatever the page size), and
        // `$count=false` still omits `total` instead of reporting the page's 0.
        const pageLimit = typeof options.limit === 'number' && options.limit >= 0 ? options.limit : undefined;
        const pageOffset = typeof options.offset === 'number' && options.offset > 0 ? options.offset : 0;
        let total: number | undefined = records.length;
        let hasMore = false;
        if (pageLimit !== undefined || pageOffset > 0) {
            // `distinct` used to suppress the count here too — #4286 finding 2:
            // the flag's ONLY observable effect platform-wide, on a capability
            // that never deduplicated a row. Removed with `query.distinct`
            // (tombstoned in spec 17); `total`/`hasMore` are truthful again.
            if (countOptOut) {
                // [#10757] The caller said it does not need `total`, so the
                // COUNT query is not issued at all — that is the whole point of
                // the parameter, and on a remote database it is a full round
                // trip saved per list request.
                //
                // `total` is OMITTED rather than estimated. `FindDataResponse`
                // declares it optional ("Total number of records matching the
                // filter (IF REQUESTED)",
                // `packages/spec/src/api/protocol.zod.ts`), so absent is the
                // declared shape for "not requested" — and it is the only
                // honest one: a real number was available and the caller
                // declined it. Handing back a plausible-looking guess is how a
                // page-local estimate ends up rendered as a record count.
                //
                // `hasMore` is still answered, from the page alone: a FULL page
                // means there may be more. It never over-reports the data — it
                // can only say "maybe more" on an exactly-full last page.
                // With an offset and no limit, every row after the offset came
                // back, so there is no further page.
                hasMore = pageLimit !== undefined && records.length === pageLimit;
                total = undefined;
            } else {
                // [#10757] `counted` is a separate, always-assigned local so
                // `hasMore` below compares against a `number`: `total` became
                // optional when `$count=false` gained the right to omit it, and
                // TypeScript cannot narrow it back across the try/catch.
                let counted: number;
                try {
                    const countQuery: EngineCountOptions = {
                        where: options.where,
                        search: options.search,
                        searchFields: options.searchFields,
                        context: options.context,
                    };
                    counted = await host.engine.count(request.object, countQuery);
                } catch {
                    // engine.count() has its own find().length fallback; if it still
                    // throws, degrade to a page-local total rather than failing the list.
                    counted = pageOffset + records.length;
                }
                total = counted;
                hasMore = pageOffset + records.length < counted;
            }
        }
        return {
            object: request.object,
            records,
            // [#10757] Omitted, not `undefined`-valued: a JSON body carrying
            // `"total": null` (or a key some serializers keep) reads as "the
            // total is nothing", which is a different claim from "no total was
            // requested". The key is simply absent.
            ...(total === undefined ? {} : { total }),
            hasMore,
        };
    }

    /** The body of `ObjectStackProtocolImplementation#getData`; the method's docblock there is its contract. */
    static async getData(host: Pick<ProtocolHost, 'assertExpandTargetsExist' | 'assertObjectRegistered' | 'assertProjectionFieldsExist' | 'engine' | 'servedExpand' | 'storedHashDigest'>, request: { object: string, id: string, expand?: string | string[], select?: string | string[], context?: any }): Promise<{
            object: string;
            id: string;
            record: Record<string, any>;
        }> {
        host.assertObjectRegistered(request.object); // [#3770]
        const queryOptions: any = {
            where: { id: request.id }
        };
        if (request.context !== undefined) {
            queryOptions.context = request.context;
        }

        // Support fields for single-record retrieval
        //
        // [#4226] Gated exactly as on the list path. `GET /data/:object/:id` and
        // `GET /data/:object` read the same `select`/`expand` against the same
        // field map, so answering one with a 400 and the other with a silently
        // widened projection would recreate, one route over, the very split
        // ("two routes, opposite answers for one input") this issue was filed
        // about.
        //
        // [#26644] …including the empty projection: a blank `?select=` was
        // falsy and skipped, a comma-only one became `[]` — both answered every
        // column. Asked on any value present, as the list path asks it.
        if (request.select != null) {
            queryOptions.fields = typeof request.select === 'string' || Array.isArray(request.select)
                ? projectionFieldsValue(request.select, 'select')
                : request.select;
            host.assertProjectionFieldsExist(request.object, queryOptions.fields, 'select');
        }
        // [#21086] Same read projection as the list path (`findData`): the row's
        // `type` is read even when `select` named only the body.
        const bodyProjection = storedMetadataBodyProjection(request.object, queryOptions.fields);
        if (bodyProjection.addedType) queryOptions.fields = bodyProjection.fields;

        // Support expand for single-record retrieval
        if (request.expand) {
            const expandNames = typeof request.expand === 'string'
                ? request.expand.split(',').map((s: string) => s.trim()).filter(Boolean)
                : request.expand;
            host.assertExpandTargetsExist(request.object, expandNames);
            const expand = {} as Record<string, any>;
            for (const rel of expandNames) {
                expand[rel] = { object: rel };
            }
            // [#22661] The same exposure judgement as the list path: an entry
            // whose target does not serve `get` is withheld ({@link servedExpand}).
            const served = host.servedExpand(request.object, expand, 0);
            if (Object.keys(served).length > 0) queryOptions.expand = served;
        }

        // [#29764] The bag `engine.findOne` receives is typed as the engine
        // declares it. `queryOptions` stays the working bag: the projection
        // helpers above answer `unknown` (they serve the raw list query too), so
        // its `fields` has no declared type until it is handed on here. Keys are
        // copied only when present, so the engine sees the same bag as before.
        const findOneQuery: EngineQueryOptions = {
            where: queryOptions.where,
            ...(queryOptions.context !== undefined ? { context: queryOptions.context } : {}),
            ...(queryOptions.fields !== undefined ? { fields: queryOptions.fields } : {}),
            ...(queryOptions.expand !== undefined ? { expand: queryOptions.expand } : {}),
        };
        const result = await host.engine.findOne(request.object, findOneQuery);
        if (result) {
            return {
                object: request.object,
                id: request.id,
                // [#21207] Same served form as the list path: the content-hash
                // columns keyed.
                record: await serveStoredMetadataHashColumns(
                    request.object,
                    redactStoredMetadataRow(request.object, result, { dropType: bodyProjection.addedType }),
                    host.storedHashDigest(),
                ),
            };
        }
        throw recordNotFoundError(request.object, request.id);
    }

    /** The body of `ObjectStackProtocolImplementation#cloneData`; the method's docblock there is its contract. */
    static async cloneData(host: Pick<ProtocolHost, 'assertObjectRegistered' | 'engine'>, request: { object: string, id: string, overrides?: Record<string, any>, context?: any }): Promise<{
            warnings?: {
                rule: string;
                severity: "info" | "warning";
                field: string;
                code: string;
                message: string;
            }[] | undefined;
            droppedFields?: {
                object: string;
                fields: string[];
                reason: "readonly" | "computed" | "readonly_when" | "primary_key" | "stored_expression";
            }[] | undefined;
            object: string;
            id: any;
            sourceId: string;
            record: any;
        }> {
        // [#3770] This object-existence check used to be open-coded here and
        // was the ONLY one on the whole data plane; it is now the shared gate
        // every data entry point runs. Same error envelope as before.
        host.assertObjectRegistered(request.object);
        const schema: any = host.engine.registry?.getObject(request.object);
        // `enable.clone` defaults to true in the spec; treat an absent block /
        // absent flag as enabled and only block on an explicit `false`.
        if (schema?.enable?.clone === false) {
            const err: any = new Error(`Cloning is disabled for object '${request.object}'`);
            err.code = 'CLONE_DISABLED';
            err.status = 403;
            err.object = request.object;
            throw err;
        }

        const ctx = request.context;
        const ctxOpt = ctx !== undefined ? { context: ctx } : undefined;

        const source = await host.engine.findOne(
            request.object,
            { where: { id: request.id }, ...ctxOpt },
        );
        if (!source) throw recordNotFoundError(request.object, request.id);

        // Copy the source, then strip the columns the engine owns so the insert
        // path re-derives them rather than carrying the source's values over.
        const data: Record<string, any> = { ...source };
        for (const f of CLONE_STRIP_FIELDS) delete data[f];
        const fields: Record<string, any> = schema?.fields || {};
        for (const [name, def] of Object.entries(fields)) {
            if (!def) continue;
            // Engine-/automation-owned values: injected system/audit columns,
            // engine-generated autonumbers, and computed formula/summary fields.
            if ((def as any).system === true
                || (def as any).type === 'autonumber'
                || (def as any).type === 'formula'
                || (def as any).type === 'summary') {
                delete data[name];
                continue;
            }
            // [#29200] A read-only column the source left EMPTY is not carried
            // into the insert. Carried, it reached `engine.insert`'s strip as a
            // present key and was reported in `droppedFields` (and the
            // `X-ObjectStack-Dropped-Fields` header) although neither the caller
            // nor the source supplied a value. Leaving it out stores the same
            // row: the strip would have taken it from a non-system caller, and
            // the insert's defaults treat an explicit `null` exactly as an
            // omitted key. A read-only column that HOLDS a value is still
            // carried, stripped and reported (#15703), and so is one the caller
            // sets through `overrides`, which are applied below.
            if ((def as any).readonly && data[name] == null) delete data[name];
        }
        // Caller overrides win (new name, cleared unique field, reset status…).
        if (request.overrides && typeof request.overrides === 'object') {
            Object.assign(data, request.overrides);
        }

        // [#3043/#14147] A clone is a create: a non-system caller must not carry
        // over (or override in) a read-only column — copying the source's
        // `approval_status` or forging one via `overrides` would mint an approved
        // record. That strip is `engine.insert`'s since #14147, so the payload
        // goes over whole and the insert re-derives the field's `defaultValue`,
        // symmetric with createData. `overrides` are applied ABOVE this line, so
        // a readonly key smuggled through them is still judged by the strip.
        //
        // [#15703] And the verdict is REPORTED, the same listener `createData`
        // wires: a clone is the one create shape that carries a read-only column
        // without the caller typing it (the source's `approval_status` travels in
        // the copy), so the 201 body says which keys the engine dropped instead of
        // leaving the caller to diff `record` against the source. Maintainer
        // ruling 2026-09-08 (option 1); `CloneDataResponseSchema` declares the
        // member in the same change, because that schema is declared AS PRODUCED.
        const dropped: DroppedFieldsEvent[] = [];
        // [#22726] A clone is a create: its advisory rule hits are answered as
        // `warnings`, the same listener `createData` wires.
        const warnings: ValidationAdvisoryEvent[] = [];
        const opts: any = {
            onFieldsDropped: (e: DroppedFieldsEvent) => { dropped.push(e); },
            onValidationAdvisory: (e: ValidationAdvisoryEvent) => { warnings.push(e); },
        };
        if (ctx !== undefined) opts.context = ctx;
        // [#28782] A copy the engine stored but whose parent roll-up it could
        // not recompute carries this method's answer on the refusal, as
        // `createData` does since #28781 (`withEarnedAnswer`).
        let stale: SummaryRecomputeRefusal | undefined;
        const result = await host.engine.insert(request.object, data, opts)
            .catch((e: unknown) => (stale = staleSummaryRefusalOrThrow(e)).written as any);
        // [#7823] Same ingress strip as `createData` — a clone's 201 body is
        // the same generic-data-path surface. (The SOURCE row was read through
        // the engine's find path, which already omits internal fields, so the
        // copy never carried one in; this guards the INSERT RESULT, which the
        // engine returns whole by design.)
        omitInternalFieldsFromWriteResponse(schema, result);
        const answer = {
            object: request.object,
            id: result.id,
            sourceId: request.id,
            record: result,
            ...(dropped.length > 0 ? { droppedFields: dropped } : {}),
            ...(warnings.length > 0 ? { warnings } : {}),
        };
        if (stale) throw withEarnedAnswer(stale, answer);
        return answer;
    }

    /**
     * [#4435] Does this row EXIST? A fact about the database — deliberately
     * NOT "may this caller see it".
     *
     * Read with a system context so no row-level policy narrows it. That is
     * load-bearing, and the first version of this fix got it wrong: probing
     * with the CALLER's context turns the existence gate into an authorization
     * gate, because a row the caller cannot read comes back `null` and the
     * PATCH answers 404. Two things break when it does.
     *
     * 1. It silently changes RLS semantics. Whether an unreadable row may be
     *    written by id is the #1994 pre-image check's decision, made inside
     *    `engine.update` where the write policy lives. A probe in front of it
     *    quietly adds a second, different rule — scope creep into the security
     *    model, from a bug fix about missing records.
     *
     * 2. It disarms a revert-provable security proof. `@proof: rls-by-id-write`
     *    (`packages/qa/dogfood/test/rls-fixture.dogfood.test.ts`, referenced by
     *    the `permission.rowLevelSecurity.using` liveness ledger entry) boots a
     *    fixture whose member can read nothing but has no write policy, and
     *    asserts the runner reports `rls-hole`. A caller-scoped probe 404s that
     *    PATCH, so the RED half goes green — and the gate can no longer prove
     *    it is able to go red. If the #1994 fix were ever reverted, this probe
     *    would MASK it. Accidentally hardening one path is not worth
     *    permanently blinding the gate that watches the whole class.
     *
     * So the probe answers existence only, and authorization stays exactly
     * where it was. The one behaviour this adds is the 404 the issue asked for:
     * an id that names no row at all.
     *
     * ⛔ And what it finds never answers IN FRONT of the write's
     * authorization. Its readers are OCC's `updated_at` comparison, asked only
     * when the caller sent a token ({@link assertVersionMatch}) and answering
     * only for a row the caller's own read returns ({@link assertVersionOf}),
     * and the by-id update's existence check, asked only after `engine.update`
     * has judged and resolved the write (`updateData`, and the bulk faces
     * through {@link assertRecordExists}) — so an update by id answers the same
     * refusal whether or not the id exists, as delete does. With a mismatched
     * token, a caller whose read of the row is refused gets that read refusal.
     */
    static async probeRecord(host: Pick<ProtocolHost, 'engine'>, object: string, id: string): Promise<any> {
        return host.engine.findOne(object, { where: { id }, context: { isSystem: true } });
    }
}
