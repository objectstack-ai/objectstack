// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The shared half of the objectstack#11009 refusal, imported by BOTH write
 * dispatch modules (`engine-update-dispatch.ts` / `engine-delete-dispatch.ts`)
 * so the two verbs cannot drift apart on what an unhonoured by-id predicate
 * is, or on the words that refuse one.
 *
 * ## The defect this refuses
 *
 * A by-id dispatch routes to `driver.update(object, id, …)` /
 * `driver.delete(object, id, …)` — entry points that bind ONLY the primary
 * key (plus tenant scope). Every other key the caller wrote into
 * `options.where` is silently discarded there: a compare-and-set guard
 * (`{ where: { id, status: { $in: [...] } } }`) evaluates to nothing, the
 * write lands unconditionally, and nothing reports that the declared
 * condition never ran. Measured on `better-sqlite3` through a real
 * `ObjectQL` + `SqlDriver` (objectstack#11009); the concrete victim was
 * `SqlHttpOutbox.redeliver`'s terminal-status guard, which this repo's
 * dispatcher could race and overwrite mid-flight while `redeliver` reported
 * success.
 *
 * The refusal is the same answer this dispatch family has ruled twice before
 * (objectstack#5748's operator-object `data.id`, objectstack#6435), and the
 * same one `ENGINE_UPDATE_OPTION_KEYS` gives unknown option keys (#4371): a
 * declaration the engine will not honour is refused at authoring time, never
 * evaluated to nothing.
 *
 * ## What is NOT refused
 *
 *  - A pure primary-key `where` (`{ where: { id } }`), with or without
 *    `multi` — the by-id path honours it in full. `multi: true` beside a
 *    pure-id `where` stays a BY-ID call: `LifecycleService`'s guarded reap
 *    relies on exactly that shape for per-record cascade handling, and
 *    `engine-data-events.test.ts` pins it.
 *  - A `where` carrying extra keys WITH a declared `multi: true` (id sourced
 *    from `where`) — that is a real predicate call, routed to the predicate
 *    path (`driver.updateMany` / `driver.deleteMany`), where `applyFilters`
 *    compiles EVERY key. This is the compare-and-set spelling the refusal
 *    message prescribes.
 */

/**
 * The `options.where` keys a by-id dispatch would silently discard: every own
 * enumerable key other than `id`.
 *
 * `null`-valued keys COUNT, deliberately — unlike the options bag (where
 * `null` is a withdrawal, #4371), a `null` inside `where` is a real predicate
 * (`status IS NULL`), so dropping it loses declared intent.
 */
export function unhonouredByIdPredicateKeys(where: unknown): string[] {
  if (!where || typeof where !== 'object') return [];
  return Object.keys(where as Record<string, unknown>).filter((k) => k !== 'id');
}

/**
 * The message a by-id dispatch carrying unhonoured predicate keys is refused
 * with — one composer for both verbs, and deliberately blind to WHICH source
 * supplied the id (`data.id` or `where.id`): the #5748 symmetry property says
 * the same call shape verdicts alike through either door, so the words must
 * too.
 */
export function engineByIdUnhonouredPredicateMessage(
  verb: 'Update' | 'Delete',
  keys: readonly string[],
): string {
  const list = keys.map((k) => `'${k}'`).join(', ');
  return (
    `${verb} names one row by primary key, but options.where also carries ` +
    `${keys.length > 1 ? 'predicate keys' : 'the predicate key'} ${list}. The by-id path binds ONLY ` +
    `the id — the driver never evaluates the remaining predicate — so the call would succeed with ` +
    `the declared condition silently ignored (#11009). For a conditional (compare-and-set) write, ` +
    `declare the predicate path, which honours EVERY where key: { where: { id, ${keys.join(', ')} }, ` +
    `multi: true } writes at most the one row matching ALL predicates and reports the matched count. ` +
    `For an unconditional single-row write, drop the extra where keys.`
  );
}
