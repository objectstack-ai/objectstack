// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#21454] The stored-metadata-body family at the in-process READER CONTEXTS.
 *
 * The family (`sys_metadata` / `sys_metadata_history`, #21120, #21207) closes
 * every door that serves a stored metadata body, or the stored content hash
 * over it: the body is served as its type's read projection, with stored
 * credential material withheld, and the hash is served in keyed form, never
 * the stored value. The generic data door does both, and that is the
 * reference answer here.
 *
 * Three in-process contexts read the same rows through the engine and served
 * them as stored, because nothing between them and the engine applied either
 * half:
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
 * stored form. So the projection is applied HERE, at the reader-context seam,
 * and never at the engine.
 *
 * ## One serve, consumed
 *
 * Every function the serve calls is the data door's own, imported from
 * `@objectstack/metadata-protocol`: the `type` companion for a projection
 * that names only the body (`storedMetadataBodyProjection`), the body
 * projection (`redactStoredMetadataRows`, which consumes the family's ONE
 * redactor in `@objectstack/spec/kernel`), and the keyed serve
 * (`serveStoredMetadataHashColumnRows`) under the crypto provider's digest or,
 * while none is registered, the same process-scoped ephemeral key the door
 * keys under (`ephemeralStoredHashDigest`). A copy of any of them here would be
 * a second definition of what a credential is, or a second keyed form of one
 * row.
 *
 * ## What it does not do
 *
 * It judges the object by name with the family's own predicate
 * (`isStoredMetadataBodyObject`), exactly as the door does. Writes, `count`
 * and the evaluate shapes (a filter, sort or grouping on the body or hash
 * columns) are outside it: this seam changes what a READ serves, nothing else.
 */

import { isStoredMetadataBodyObject } from '@objectstack/spec/kernel';
import {
  ephemeralStoredHashDigest,
  redactStoredMetadataRows,
  serveStoredMetadataHashColumnRows,
  storedMetadataBodyProjection,
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
 * Run one READ of `object` and serve its answer the way the generic data door
 * serves the same rows. An object outside the family is read and returned
 * untouched, by reference.
 *
 * `read` receives the query to run: the caller's own, or, when its projection
 * names the body column without the `type` column that selects the redactor,
 * a copy with `type` added; that column is then taken back off the served
 * rows, so the caller gets exactly the columns it named. The answer may be a
 * row list (`find`, `aggregate`), one row (`findOne`) or `null`; each is served
 * in the shape it arrived in.
 */
export async function serveStoredMetadataRead<A>(
  object: string,
  query: unknown,
  engine: unknown,
  read: (query: unknown) => Promise<A>,
): Promise<A> {
  if (!isStoredMetadataBodyObject(object)) return read(query);
  const projection = storedMetadataBodyProjection(object, isPlainRecord(query) ? query.fields : undefined);
  const answer = await read(
    projection.addedType && isPlainRecord(query) ? { ...query, fields: projection.fields } : query,
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

/** The repository verbs whose answer carries rows. `count` answers a number and serves no row. */
const ROW_SERVING_READS: ReadonlySet<PropertyKey> = new Set(['find', 'findOne', 'aggregate']);

/** Marks a scoped context this seam already serves through, so a second wrap is a no-op. */
const SERVED_THROUGH_SEAM = Symbol.for('objectstack.runtime.storedMetadataReaderSeam');

function serveRepository(objectName: string, repo: unknown, engine: unknown): unknown {
  if (!isStoredMetadataBodyObject(objectName) || repo === null || typeof repo !== 'object') return repo;
  return new Proxy(repo as Record<PropertyKey, unknown>, {
    get(target, prop) {
      const value = Reflect.get(target, prop, target);
      if (typeof value !== 'function') return value;
      if (!ROW_SERVING_READS.has(prop)) return value.bind(target);
      return (query?: unknown, ...rest: unknown[]) =>
        serveStoredMetadataRead(objectName, query, engine, (q) => value.call(target, q, ...rest));
    },
  });
}

/**
 * The scoped data API (`ctx.api`) a reader context hands to a body or a
 * handler, with every read of a family object served through
 * {@link serveStoredMetadataRead}. Everything else is the same object, by
 * delegation: a write, a `count`, and every non-family object reach it
 * unchanged.
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
  if (api === null || typeof api !== 'object') return api;
  if ((api as Record<PropertyKey, unknown>)[SERVED_THROUGH_SEAM] === true) return api;
  const wrap = (derived: unknown) => serveStoredMetadataReadsThrough(derived, engine);
  return new Proxy(api as unknown as Record<PropertyKey, unknown>, {
    get(target, prop) {
      if (prop === SERVED_THROUGH_SEAM) return true;
      const value = Reflect.get(target, prop, target);
      if (typeof value !== 'function') return value;
      switch (prop) {
        case 'object':
          return (name: string, ...rest: unknown[]) => serveRepository(name, value.call(target, name, ...rest), engine);
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
