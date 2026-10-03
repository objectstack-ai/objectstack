// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#21454] The stored-metadata-body family at the in-process READER CONTEXTS.
 *
 * The family (`sys_metadata` / `sys_metadata_history`, #21120, #21207) closes
 * every door that serves, copies OR EVALUATES a stored metadata body, or the
 * stored content hash over it: the body is served as its type's read
 * projection with stored credential material withheld, the hash is served in
 * keyed form, and a filter, sort, grouping or search that would EVALUATE either
 * one is refused before the query runs. The generic data door does all three,
 * and that is the reference answer here.
 *
 * Three in-process contexts read the same rows through the engine and served
 * them as stored, because nothing between them and the engine applied any part
 * of the family's rule:
 *
 *  - a sandboxed body's `ctx.api.object(...)` (`sandbox/body-runner.ts`,
 *    `buildSandboxApi`): action and hook bodies alike, and with them every
 *    copy a body makes of what it read, since a body can copy only what it
 *    was served;
 *  - an action handler's `ctx.api` (`action-execution.ts`, `buildActionApi`):
 *    the same scoped context an action body receives, handed to host code
 *    handlers too;
 *  - an action handler's `ctx.engine.find` (`action-execution.ts`,
 *    `buildActionEngineFacade`).
 *
 * The answers all run elevated (`isSystem: true`), so the engine cannot tell
 * them from the platform's own internal readers of the family, which need the
 * stored form. So the family's rule is applied HERE, at the reader-context
 * seam, and never at the engine.
 *
 * ## Three things this seam does to a family READ, consuming the door's own code
 *
 * 1. **Refuse the EVALUATE shapes** ({@link refuseOrNarrowStoredMetadataEvaluate}),
 *    through the generic data door's OWN refusal predicates
 *    (`storedMetadataBodyGroupingRefusal`, `storedMetadataBodyPredicateRefusal`,
 *    `storedMetadataHashEvaluateRefusal`, `storedMetadataSearchRefusal`,
 *    `@objectstack/metadata-protocol`), in the door's own order — a copy of any
 *    of them here would be a second definition of which shapes leak. A `count`
 *    with such a predicate is an oracle too, so it is guarded the same way (it
 *    serves no row, so only the refusal applies to it). A default `$search`
 *    is NARROWED to the door's served set — the body and hash columns removed,
 *    judged field by field by the door's own search predicate — rather than
 *    refused, so a body may still search a family table by `name` exactly as
 *    the door serves it; a search that would scan nothing after the removal is
 *    refused.
 * 2. **Serve the body projected and the hash keyed** ({@link serveStoredMetadataRead}),
 *    using the door's `storedMetadataBodyProjection`, `redactStoredMetadataRows`
 *    (the family's ONE redactor in `@objectstack/spec/kernel`) and
 *    `serveStoredMetadataHashColumnRows`, under the crypto provider's digest or,
 *    while none is registered, the same process-scoped ephemeral key the door
 *    keys under (`ephemeralStoredHashDigest`). A copy would serve a second keyed
 *    form of one row.
 * 3. **Serve what a WRITE verb RETURNS** ({@link serveStoredMetadataWriteReturn}):
 *    a write whose return carries the family's body or hash is served the same
 *    projected / keyed way a read is, since a returned row is a serve. That
 *    serve is for the contexts that may still write here (a host code
 *    handler's `ctx.api`).
 * 4. **Refuse a BODY's write** ({@link refuseStoredMetadataBodyWrites}, #21520):
 *    a sandboxed hook or action body may not write the family's tables at all —
 *    the metadata protocol is their only writer for an app-authored body — so
 *    the API a body holds refuses every family-table write before it runs. A
 *    separate layer, applied only where a body gets its API, because the served
 *    repository is also a host handler's, and the boundary refuses bodies only.
 *
 * ## What it does not do
 *
 * It judges the object by name with the family's own predicate
 * (`isStoredMetadataBodyObject`), exactly as the door does. The engine's own
 * action verb (`ScopedRepo.execute`) is never reached by a served body — the
 * sandbox bridge exposes no `execute`, `sudo` or `withRunAs` — so this seam
 * leaves it untouched (the reach is recorded on #21454, not closed here).
 */

import { isStoredMetadataBodyObject } from '@objectstack/spec/kernel';
import { storedMetadataBodyWriteRefusal } from './stored-metadata-body-boundary.js';
import { isFilterAST, parseFilterAST, resolveSearchFieldResolution } from '@objectstack/spec/data';
import { collectConditionFields } from '@objectstack/plugin-security';
import {
  ephemeralStoredHashDigest,
  redactStoredMetadataRows,
  serveStoredMetadataHashColumnRows,
  storedMetadataBodyProjection,
  storedMetadataBodyGroupingRefusal,
  storedMetadataBodyPredicateRefusal,
  storedMetadataHashEvaluateRefusal,
  storedMetadataSearchRefusal,
  type StoredHashDigest,
} from '@objectstack/metadata-protocol';

/**
 * The keyed digest a family read is served under: the engine's registered
 * crypto provider's, read at the moment of use (a host registers it after the
 * kernel starts), else the process-scoped ephemeral key. The same two sources,
 * in the same order, the data door reads.
 */
function storedHashDigestOf(engine: unknown): StoredHashDigest {
  const accessor = (engine as { getKeyedDigest?: () => StoredHashDigest | undefined } | null | undefined)
    ?.getKeyedDigest;
  const provider = typeof accessor === 'function' ? accessor.call(engine) : undefined;
  return provider ?? ephemeralStoredHashDigest;
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/**
 * Every column a filter NAMES, structure discarded — lowering a `FilterArray`
 * to a `FilterCondition` first so the array door a direct engine call still
 * honours (`lowerWhereFilterArray`) is read the same as the object door.
 *
 * The walk is the generic data door's sibling, `collectConditionFields`
 * (`@objectstack/plugin-security`): the door's own `collectFilterFieldKeys` is
 * internal to `protocol.ts` and cannot be imported here, and restating it would
 * be the second definition the family rule forbids. This collector gates on a
 * dotted head and also reads a cross-field `{ $field }` comparand, so it refuses
 * a DOTTED or COMPARAND reference to the body or hash columns the door's own
 * collector would miss — strictly MORE than the door, never a legitimate
 * scalar-column query, since the family columns are the only ones these
 * predicates name.
 */
function filterHeadFields(where: unknown): string[] {
  if (where == null) return [];
  const lowered = isFilterAST(where) ? parseFilterAST(where) : where;
  return [...collectConditionFields(lowered)];
}

/** The fields an `orderBy` names (`[{ field }]`, or a bare string entry). */
function sortFieldsOf(orderBy: unknown): unknown[] {
  if (!Array.isArray(orderBy)) return [];
  return orderBy.map((entry) => (isPlainRecord(entry) ? entry.field : entry));
}

/**
 * Narrow or refuse a `$search` on a family table the way the data door's
 * `narrowStoredMetadataSearch` does, consuming the door's own search predicate
 * ({@link storedMetadataSearchRefusal}) as the authority on which columns a
 * search may never scan:
 *
 *  - an EXPLICIT field list (`searchFields`, or the object-form `search.fields`)
 *    naming an unscannable column is refused;
 *  - a DEFAULT search is narrowed to the resolved searchable set minus the
 *    columns the predicate refuses, field by field, and the query runs with that
 *    `searchFields`; a set that narrows to empty is refused.
 *
 * Returns the query the read should run — the same reference when nothing
 * changed, a shallow copy carrying the narrowed `searchFields` otherwise.
 */
function narrowFamilySearch(object: string, query: Record<string, unknown>, engine: unknown): Record<string, unknown> {
  const search = query.search;
  const objectForm = search !== null && typeof search === 'object';
  const explicitRaw = query.searchFields != null
    ? query.searchFields
    : objectForm ? (search as Record<string, unknown>).fields : undefined;
  const param = query.searchFields != null ? 'searchFields' : 'search';
  const names: string[] = typeof explicitRaw === 'string'
    ? explicitRaw.split(',').map((s) => s.trim()).filter(Boolean)
    : Array.isArray(explicitRaw)
      ? explicitRaw.filter((f): f is string => typeof f === 'string')
      : [];
  if (names.length > 0) {
    const refusal = storedMetadataSearchRefusal(object, names, param);
    if (refusal) throw refusal;
    return query;
  }
  if (search == null) return query;
  const schema = typeof (engine as { getObject?: (n: string) => unknown })?.getObject === 'function'
    ? (engine as { getObject: (n: string) => any }).getObject(object)
    : undefined;
  const fields = schema?.fields;
  if (!fields) return query;
  const { allowed } = resolveSearchFieldResolution({
    fields,
    searchableFields: schema?.searchableFields,
    displayField: schema?.nameField ?? schema?.displayNameField,
  });
  const narrowed = allowed.filter((field) => !storedMetadataSearchRefusal(object, [field], 'search'));
  if (narrowed.length === 0) {
    const refusal = storedMetadataSearchRefusal(object, allowed, 'search');
    if (refusal) throw refusal;
    return query;
  }
  return { ...query, searchFields: narrowed };
}

/**
 * Refuse every EVALUATE shape on a family read, in the data door's own order
 * (search, grouping, body filter / sort, hash filter / sort / grouping), each
 * through the door's own predicate. Returns the query the read should run,
 * which may carry a narrowed `$search` field set. A non-family object, and a
 * query that is not a record, pass through untouched.
 */
function refuseOrNarrowStoredMetadataEvaluate(object: string, query: unknown, engine: unknown): unknown {
  if (!isStoredMetadataBodyObject(object) || !isPlainRecord(query)) return query;
  const next = narrowFamilySearch(object, query, engine);
  const grouping = storedMetadataBodyGroupingRefusal(object, next.groupBy);
  if (grouping) throw grouping;
  const aggregationFilterFields = Array.isArray(next.aggregations)
    ? (next.aggregations as ReadonlyArray<{ filter?: unknown }>).flatMap((a) => filterHeadFields(a?.filter))
    : [];
  const filterFields = [...filterHeadFields(next.where), ...filterHeadFields(next.filter), ...aggregationFilterFields];
  const sortFields = sortFieldsOf(next.orderBy);
  const bodyPredicate = storedMetadataBodyPredicateRefusal(object, { filterFields, sortFields });
  if (bodyPredicate) throw bodyPredicate;
  const hashEvaluate = storedMetadataHashEvaluateRefusal(object, { groupBy: next.groupBy, filterFields, sortFields });
  if (hashEvaluate) throw hashEvaluate;
  return next;
}

/**
 * Run one READ of `object` and serve its answer the way the generic data door
 * serves the same rows. An object outside the family is read and returned
 * untouched, by reference; a family read first has its EVALUATE shapes refused
 * and its `$search` narrowed ({@link refuseOrNarrowStoredMetadataEvaluate}).
 *
 * `read` receives the query to run: the caller's own (search narrowed), or,
 * when its projection names the body column without the `type` column that
 * selects the redactor, a copy with `type` added; that column is then taken
 * back off the served rows, so the caller gets exactly the columns it named.
 * The answer may be a row list (`find`, `aggregate`), one row (`findOne`) or
 * `null`; each is served in the shape it arrived in.
 */
export async function serveStoredMetadataRead<A>(
  object: string,
  query: unknown,
  engine: unknown,
  read: (query: unknown) => Promise<A>,
): Promise<A> {
  if (!isStoredMetadataBodyObject(object)) return read(query);
  const guarded = refuseOrNarrowStoredMetadataEvaluate(object, query, engine);
  const projection = storedMetadataBodyProjection(object, isPlainRecord(guarded) ? guarded.fields : undefined);
  const answer = await read(
    projection.addedType && isPlainRecord(guarded) ? { ...guarded, fields: projection.fields } : guarded,
  );
  const digest = storedHashDigestOf(engine);
  const opts = { dropType: projection.addedType };
  if (Array.isArray(answer)) {
    return (await serveStoredMetadataHashColumnRows(object, redactStoredMetadataRows(object, answer, opts), digest)) as A;
  }
  if (isPlainRecord(answer)) {
    const [served] = await serveStoredMetadataHashColumnRows(
      object,
      redactStoredMetadataRows(object, [answer], opts),
      digest,
    );
    return served as A;
  }
  return answer;
}

/**
 * Serve what a WRITE verb RETURNS the same projected / keyed way a read is
 * served — a returned row carrying the family's body or hash is a serve too.
 * A write whose return is a number (an affected-row count), `null`, or carries
 * no family column passes through by reference. ⛔ This serves the RETURN only;
 * it neither permits nor refuses the write: a body's write never gets here
 * (the body layer, {@link refuseStoredMetadataBodyWrites}, refuses it first).
 */
async function serveStoredMetadataWriteReturn<A>(object: string, answer: A, engine: unknown): Promise<A> {
  if (!isStoredMetadataBodyObject(object)) return answer;
  const digest = storedHashDigestOf(engine);
  if (Array.isArray(answer)) {
    return (await serveStoredMetadataHashColumnRows(object, redactStoredMetadataRows(object, answer), digest)) as A;
  }
  if (isPlainRecord(answer)) {
    const [served] = await serveStoredMetadataHashColumnRows(object, redactStoredMetadataRows(object, [answer]), digest);
    return served as A;
  }
  return answer;
}

/** The repository verbs whose answer carries rows this seam serves. */
const ROW_SERVING_READS: ReadonlySet<PropertyKey> = new Set(['find', 'findOne', 'aggregate']);
/** The verb whose answer is a number: guarded against the evaluate oracle, nothing to serve. */
const COUNT_READ: PropertyKey = 'count';
/** The write verbs whose RETURN can carry family content (every alias ObjectRepository exposes). */
const WRITE_RETURN_VERBS: ReadonlySet<PropertyKey> = new Set([
  'insert', 'create', 'update', 'updateById', 'upsert', 'delete', 'deleteById', 'updateMany', 'deleteMany',
]);

/** Marks a scoped context this seam already serves through, so a second wrap is a no-op. */
const SERVED_THROUGH_SEAM = Symbol.for('objectstack.runtime.storedMetadataReaderSeam');

function serveRepository(objectName: string, repo: unknown, engine: unknown): unknown {
  if (!isStoredMetadataBodyObject(objectName) || repo === null || typeof repo !== 'object') return repo;
  return new Proxy(repo as Record<PropertyKey, unknown>, {
    get(target, prop) {
      const value = Reflect.get(target, prop, target);
      if (typeof value !== 'function') return value;
      if (ROW_SERVING_READS.has(prop)) {
        return (query?: unknown, ...rest: unknown[]) =>
          serveStoredMetadataRead(objectName, query, engine, (q) => value.call(target, q, ...rest));
      }
      if (prop === COUNT_READ) {
        // `async` so a refusal leaves as a rejected promise, the shape every
        // other verb's refusal takes — `count` answers a number, nothing to
        // serve, so only the evaluate guard runs.
        return async (query?: unknown, ...rest: unknown[]) => {
          refuseOrNarrowStoredMetadataEvaluate(objectName, query, engine);
          return value.call(target, query, ...rest);
        };
      }
      if (WRITE_RETURN_VERBS.has(prop)) {
        // [#21454] Serve what the write RETURNS — for the contexts that may
        // still write here: a host code handler's `ctx.api` (deployer code, the
        // same trust as platform code). A sandboxed BODY never reaches this
        // branch for a family table: its API carries the body layer
        // ({@link refuseStoredMetadataBodyWrites}, #21520), which refuses the
        // write before it gets here. The refusal is not attached HERE because
        // this repository is also a host handler's, and the boundary refuses
        // bodies only.
        return async (...args: unknown[]) =>
          serveStoredMetadataWriteReturn(objectName, await value.apply(target, args), engine);
      }
      return value.bind(target);
    },
  });
}

/**
 * The scoped data API (`ctx.api`) a reader context hands to a body or a
 * handler, with every read of a family object served through
 * {@link serveStoredMetadataRead}, every evaluate shape refused, and every
 * write's RETURN served. Everything else is the same object, by delegation.
 *
 * The contexts the API can derive are served the same way, so no route around
 * the seam opens: `object(name)`, `sudo()`, `withRunAs(...)`, the context a
 * `transaction(fn)` callback receives, and the `ctx` `beginTransaction()`
 * returns (the sandbox's `ctx.api.transaction` reads through that one).
 *
 * Idempotent: an API already served through this seam is returned as is, so a
 * body whose API was served at the action door is not served twice at the
 * sandbox (a keyed hash keyed again would no longer be the door's form).
 * A value that is not an object is returned as is.
 */
export function serveStoredMetadataReadsThrough<T>(api: T, engine: unknown): T {
  return deriveThroughSeam(api, SERVED_THROUGH_SEAM, (name, repo) => serveRepository(name, repo, engine));
}

/** Marks a scoped context whose family-table writes are already refused for a body. */
const BODY_WRITES_REFUSED = Symbol.for('objectstack.runtime.storedMetadataBodyWritesRefused');

/** The repository verbs a body may still call on a family table: the reads this seam serves. */
const BODY_FAMILY_READS: ReadonlySet<PropertyKey> = new Set([...ROW_SERVING_READS, COUNT_READ]);

/**
 * A family table's repository as a sandboxed BODY holds it: the served reads
 * pass through, and every other verb — each write alias, and anything not
 * known to be a read — is refused before it runs, with the boundary's
 * `PERMISSION_DENIED` / 403 and the metadata-API prescription
 * ({@link storedMetadataBodyWriteRefusal}). Fail-closed by construction: a verb
 * added to the repository later is refused here until it is named a read.
 * Refused before the underlying verb is called, so a refused write changes
 * nothing and answers the same whatever its payload or predicate names. Any
 * other object's repository is returned untouched.
 */
function refuseBodyRepositoryWrites(objectName: string, repo: unknown): unknown {
  if (!isStoredMetadataBodyObject(objectName) || repo === null || typeof repo !== 'object') return repo;
  return new Proxy(repo as Record<PropertyKey, unknown>, {
    get(target, prop) {
      const value = Reflect.get(target, prop, target);
      if (typeof value !== 'function') return value;
      if (BODY_FAMILY_READS.has(prop)) return value.bind(target);
      return async () => {
        throw storedMetadataBodyWriteRefusal(objectName, String(prop));
      };
    },
  });
}

/**
 * [#21520, ruling A] The scoped API a sandboxed BODY (a hook body or an action
 * body) holds, with every write of a stored-metadata family table refused: for
 * an app-authored body, the metadata protocol is the family's only writer.
 * Reads are untouched here — they are served by
 * {@link serveStoredMetadataReadsThrough}, which this layers over — and every
 * other object writes as before.
 *
 * Applied at ONE place, the sandbox's `buildSandboxApi`, which only the two body
 * runners reach. It is a separate layer rather than a branch of the served
 * repository because that repository is also a host code handler's `ctx.api`,
 * and the boundary refuses bodies only: the platform's own writers and the
 * deployer's host code reach the store through their own imports. Every
 * context the API derives is refused the same way (the same walk as the read
 * seam). Idempotent, and transparent to the read seam's own marker, so a body
 * API served at the action door is still served exactly once.
 */
export function refuseStoredMetadataBodyWrites<T>(api: T): T {
  return deriveThroughSeam(api, BODY_WRITES_REFUSED, refuseBodyRepositoryWrites);
}

/**
 * The walk both layers share: `api`, and every context it can derive —
 * `object(name)`, `sudo()`, `withRunAs(...)`, the context a `transaction(fn)`
 * callback receives, and the `ctx` `beginTransaction()` returns — with each
 * repository passed through `wrapRepository`. One definition of what a scoped
 * API can derive, so neither layer can leave a route around it.
 */
function deriveThroughSeam<T>(
  api: T,
  marker: symbol,
  wrapRepository: (name: string, repo: unknown) => unknown,
): T {
  if (api === null || typeof api !== 'object') return api;
  if ((api as Record<PropertyKey, unknown>)[marker] === true) return api;
  const wrap = (derived: unknown) => deriveThroughSeam(derived, marker, wrapRepository);
  return new Proxy(api as unknown as Record<PropertyKey, unknown>, {
    get(target, prop) {
      if (prop === marker) return true;
      const value = Reflect.get(target, prop, target);
      if (typeof value !== 'function') return value;
      switch (prop) {
        case 'object':
          return (name: string, ...rest: unknown[]) => wrapRepository(name, value.call(target, name, ...rest));
        case 'sudo':
        case 'withRunAs':
          return (...args: unknown[]) => wrap(value.apply(target, args));
        case 'transaction':
          return (callback: unknown, ...rest: unknown[]) =>
            value.call(
              target,
              typeof callback === 'function'
                ? (trx: unknown, ...info: unknown[]) => (callback as (...a: unknown[]) => unknown)(wrap(trx), ...info)
                : callback,
              ...rest,
            );
        case 'beginTransaction':
          return async (...args: unknown[]) => {
            const begun = await value.apply(target, args);
            return isPlainRecord(begun) && 'ctx' in begun ? { ...begun, ctx: wrap(begun.ctx) } : begun;
          };
        default:
          return value.bind(target);
      }
    },
  }) as unknown as T;
}
